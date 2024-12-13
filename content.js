// Prevent multiple initializations
if (!window.redditCopycatInitialized) {
  window.redditCopycatInitialized = true;
  console.log('[Reddit Copycat] Content script loaded');

  // Global lock for operations
  let isOperationInProgress = false;

  async function getAllUserSubreddits() {
    try {
      console.log('[Reddit Copycat] Starting to fetch subreddits');
      let subreddits = [];
      let after = null;
      let retryCount = 0;
      const maxRetries = 3;
      let pageCount = 0;
      
      do {
        try {
          const url = after 
            ? `https://www.reddit.com/subreddits/mine/subscriber.json?limit=100&after=${after}&raw_json=1`
            : 'https://www.reddit.com/subreddits/mine/subscriber.json?limit=100&raw_json=1';
          
          console.log(`[Reddit Copycat] Fetching page ${++pageCount}, after: ${after || 'start'}`);
          
          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              'Accept': 'application/json'
            }
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const data = await response.json();
          if (!data.data) {
            throw new Error('Invalid response format');
          }
          
          const newSubs = data.data.children.map(child => child.data.display_name);
          subreddits = subreddits.concat(newSubs);
          after = data.data.after;
          console.log(`[Reddit Copycat] Found ${newSubs.length} subreddits on page ${pageCount}. Total: ${subreddits.length}`);
          retryCount = 0;
        } catch (error) {
          console.error(`[Reddit Copycat] Error in pagination:`, error);
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error('Max retries reached while fetching subreddits');
          }
          console.log(`[Reddit Copycat] Retry ${retryCount}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      } while (after);

      console.log(`[Reddit Copycat] Successfully fetched all subreddits. Total: ${subreddits.length}`);
      return subreddits;
    } catch (error) {
      console.error('[Reddit Copycat] Error fetching subreddits:', error);
      return null;
    }
  }

  async function getRedditCsrfToken() {
    try {
      console.log('[Reddit Copycat] Getting CSRF token');
      
      // First try to get token from Reddit's API endpoint
      try {
        const response = await fetch('https://www.reddit.com/api/me.json', {
          credentials: 'include'
        });
        if (response.ok) {
          const token = response.headers.get('x-reddit-session');
          if (token) {
            console.log('[Reddit Copycat] CSRF token obtained from API');
            return token;
          }
        }
      } catch (error) {
        console.log('[Reddit Copycat] Failed to get token from API, trying alternative methods');
      }

      // Try to get token from the page
      const response = await fetch('https://www.reddit.com', {
        credentials: 'include'
      });
      const text = await response.text();
      
      // Try different token patterns
      const patterns = [
        /"csrf_token"\s*:\s*"([^"]+)"/,
        /csrf_token=([^;]+)/,
        /data-csrf-token="([^"]+)"/,
        /&csrf_token=([^&"]+)/
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          console.log('[Reddit Copycat] CSRF token obtained from pattern:', pattern);
          return match[1];
        }
      }

      // Try to get token from cookies
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrf_token') {
          console.log('[Reddit Copycat] CSRF token obtained from cookies');
          return value;
        }
      }

      throw new Error('CSRF token not found in any location');
    } catch (error) {
      console.error('[Reddit Copycat] Error getting CSRF token:', error);
      return null;
    }
  }

  async function joinSubreddit(subredditName) {
    try {
      console.log(`[Reddit Copycat] Attempting to join r/${subredditName}`);
      
      // First, get the subreddit details
      console.log(`[Reddit Copycat] Fetching details for r/${subredditName}`);
      const aboutResponse = await fetch(`https://www.reddit.com/r/${subredditName}/about.json`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!aboutResponse.ok) {
        throw new Error(`Subreddit not found: ${aboutResponse.status}`);
      }

      const aboutData = await aboutResponse.json();
      const fullName = aboutData.data.name;
      console.log(`[Reddit Copycat] Got subreddit fullname: ${fullName}`);

      // Get the modhash and session info
      const meResponse = await fetch('https://www.reddit.com/api/me.json', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!meResponse.ok) {
        throw new Error('Failed to get user session');
      }

      const meData = await meResponse.json();
      const modhash = meData.data?.modhash;
      console.log('[Reddit Copycat] Got user session data');

      // Get CSRF token from cookies
      const cookies = document.cookie.split(';');
      let csrfToken = '';
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrf_token') {
          csrfToken = value;
          break;
        }
      }

      if (!csrfToken) {
        throw new Error('CSRF token not found in cookies');
      }

      // Prepare the request
      const formData = new URLSearchParams();
      formData.append('action', 'sub');
      formData.append('sr', fullName);
      formData.append('skip_initial_defaults', 'true');
      if (modhash) formData.append('uh', modhash);

      console.log(`[Reddit Copycat] Sending join request for ${fullName}`);
      
      // First try the old endpoint
      try {
        const oldResponse = await fetch(`https://www.reddit.com/r/${subredditName}/subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-csrf-token': csrfToken,
            'x-requested-with': 'XMLHttpRequest',
            'User-Agent': 'web'
          },
          body: formData.toString(),
          credentials: 'include'
        });

        if (oldResponse.ok) {
          console.log(`[Reddit Copycat] Successfully joined r/${subredditName} using old endpoint`);
          return true;
        }
      } catch (error) {
        console.log('[Reddit Copycat] Old endpoint failed, trying new endpoint');
      }

      // Try the new endpoint
      const response = await fetch('https://www.reddit.com/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-csrf-token': csrfToken,
          'x-requested-with': 'XMLHttpRequest',
          'User-Agent': 'web',
          'Origin': 'https://www.reddit.com',
          'Referer': `https://www.reddit.com/r/${subredditName}`
        },
        body: formData.toString(),
        credentials: 'include'
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.error(`[Reddit Copycat] Join response:`, {
          status: response.status,
          statusText: response.statusText,
          responseText: responseText
        });

        // Try one more time with the direct API
        const directResponse = await fetch('https://oauth.reddit.com/api/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${csrfToken}`,
            'User-Agent': 'web'
          },
          body: formData.toString(),
          credentials: 'include'
        });

        if (!directResponse.ok) {
          throw new Error(`Join request failed: ${response.status}`);
        }
      }

      console.log(`[Reddit Copycat] Successfully joined r/${subredditName}`);
      return true;
    } catch (error) {
      console.error(`[Reddit Copycat] Error joining r/${subredditName}:`, error);
      return false;
    }
  }

  // Message handler function
  async function handleMessage(request, sender, sendResponse) {
    console.log('[Reddit Copycat] Received message:', request);

    // Handle ping message
    if (request.action === 'ping') {
      console.log('[Reddit Copycat] Received ping, responding...');
      sendResponse({ success: true });
      return;
    }

    if (isOperationInProgress) {
      console.log('[Reddit Copycat] Operation already in progress, ignoring request');
      sendResponse({ success: false, error: 'Operation in progress' });
      return;
    }

    try {
      isOperationInProgress = true;

      if (request.action === 'saveSubreddits') {
        console.log('[Reddit Copycat] Processing saveSubreddits request');
        const subreddits = await getAllUserSubreddits();
        if (subreddits && subreddits.length > 0) {
          console.log(`[Reddit Copycat] Saving ${subreddits.length} subreddits`);
          await new Promise((resolve) => {
            chrome.storage.local.set({ savedSubreddits: subreddits }, () => {
              sendResponse({ success: true, count: subreddits.length, subreddits: subreddits });
              resolve();
            });
          });
        } else {
          console.log('[Reddit Copycat] No subreddits found or error occurred');
          sendResponse({ success: false });
        }
      }

      else if (request.action === 'joinSubreddits') {
        console.log('[Reddit Copycat] Processing joinSubreddits request');
        const result = await new Promise((resolve) => {
          chrome.storage.local.get(['savedSubreddits'], async (result) => {
            // Use the subreddits from the request if provided, otherwise use all saved subreddits
            const subsToProcess = request.subreddits || result.savedSubreddits;
            
            if (!subsToProcess || subsToProcess.length === 0) {
              console.log('[Reddit Copycat] No subreddits to join');
              resolve({ success: false, error: 'No subreddits to join' });
              return;
            }

            console.log(`[Reddit Copycat] Found ${subsToProcess.length} subreddits to process`);
            const currentSubs = await getAllUserSubreddits();
            if (!currentSubs) {
              console.log('[Reddit Copycat] Failed to fetch current subreddits');
              resolve({ success: false, error: 'Failed to fetch current subreddits' });
              return;
            }

            const subsToJoin = subsToProcess.filter(sub => !currentSubs.includes(sub));
            console.log(`[Reddit Copycat] ${subsToJoin.length} subreddits to join`);
            let successCount = 0;
            let totalAttempted = 0;
            let failedSubs = [];

            chrome.runtime.sendMessage({
              action: 'joinProgress',
              current: 0,
              total: subsToJoin.length,
              status: `Found ${subsToJoin.length} subreddits to join...`
            });

            for (let i = 0; i < subsToJoin.length; i++) {
              const subreddit = subsToJoin[i];
              totalAttempted++;

              if (currentSubs.includes(subreddit)) {
                console.log(`[Reddit Copycat] Skipping r/${subreddit} (already joined)`);
                chrome.runtime.sendMessage({
                  action: 'joinProgress',
                  current: totalAttempted,
                  total: subsToJoin.length,
                  status: `Already joined r/${subreddit} (${totalAttempted}/${subsToJoin.length})`
                });
                continue;
              }

              const success = await joinSubreddit(subreddit);
              if (success) {
                successCount++;
                console.log(`[Reddit Copycat] Successfully joined r/${subreddit}`);
              } else {
                failedSubs.push(subreddit);
                console.log(`[Reddit Copycat] Failed to join r/${subreddit}`);
              }

              chrome.runtime.sendMessage({
                action: 'joinProgress',
                current: totalAttempted,
                total: subsToJoin.length,
                status: success 
                  ? `Joined r/${subreddit} (${totalAttempted}/${subsToJoin.length})`
                  : `Failed to join r/${subreddit} (${totalAttempted}/${subsToJoin.length})`
              });

              const delay = failedSubs.length > 0 ? 2000 : 1000;
              await new Promise(resolve => setTimeout(resolve, delay));
            }

            console.log(`[Reddit Copycat] Joining complete. Success: ${successCount}, Failed: ${failedSubs.length}`);
            if (failedSubs.length > 0) {
              console.log('[Reddit Copycat] Failed subreddits:', failedSubs);
            }

            resolve({ 
              success: successCount > 0,
              totalProcessed: totalAttempted,
              successCount: successCount,
              failedSubs: failedSubs
            });
          });
        });

        sendResponse(result);
        return true;
      }

      else if (request.action === 'getCurrentSubreddits') {
        console.log('[Reddit Copycat] Getting current subreddits');
        getAllUserSubreddits().then(subreddits => {
          if (subreddits) {
            console.log(`[Reddit Copycat] Found ${subreddits.length} current subreddits`);
            sendResponse({ success: true, subreddits: subreddits });
          } else {
            console.log('[Reddit Copycat] Failed to get current subreddits');
            sendResponse({ success: false, subreddits: [] });
          }
        });
        return true;
      }

      else {
        console.log('[Reddit Copycat] Unknown message action:', request.action);
        sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[Reddit Copycat] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    } finally {
      isOperationInProgress = false;
    }
  }

  // Set up message listener only once
  console.log('[Reddit Copycat] Setting up message listener');
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender, sendResponse);
    return true; // Keep the message channel open
  });

  console.log('[Reddit Copycat] Content script initialized successfully');
} else {
  console.log('[Reddit Copycat] Content script already initialized, skipping...');
} 