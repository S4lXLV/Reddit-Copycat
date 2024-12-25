// Prevent multiple initializations
if (!window.redditCopycatInitialized) {
  window.redditCopycatInitialized = true;
  console.log('[Reddit Copycat] Content script loaded');

  // Global lock for operations
  let isOperationInProgress = false;

  // Cache for API responses
  const apiCache = {
    userSession: null,
    subredditDetails: new Map(),
    lastJoinTimestamp: 0
  };

  const RATE_LIMIT = {
    MIN_DELAY: 2000,        // Minimum 2 seconds between requests
    BATCH_SIZE: 25,         // Process 25 subreddits at a time
    BATCH_DELAY: 60000,     // 1 minute delay between batches
    MAX_RETRIES: 3,         // Maximum number of retries per subreddit
    BACKOFF_BASE: 5000      // Base delay for exponential backoff
  };

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

  async function getUserSession() {
    if (apiCache.userSession) {
      return apiCache.userSession;
    }

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

    apiCache.userSession = {
      modhash: meData.data?.modhash,
      csrfToken
    };

    return apiCache.userSession;
  }

  async function getSubredditDetails(subredditName) {
    if (apiCache.subredditDetails.has(subredditName)) {
      return apiCache.subredditDetails.get(subredditName);
    }

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
    const details = { fullName: aboutData.data.name };
    apiCache.subredditDetails.set(subredditName, details);
    return details;
  }

  async function joinSubreddit(subredditName) {
    try {
      console.log(`[Reddit Copycat] Attempting to join r/${subredditName}`);
      
      // Implement rate limiting
      const now = Date.now();
      const timeSinceLastJoin = now - apiCache.lastJoinTimestamp;
      if (timeSinceLastJoin < RATE_LIMIT.MIN_DELAY) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.MIN_DELAY - timeSinceLastJoin));
      }
      
      // Get cached or fetch new session data
      const session = await getUserSession();
      
      // Get cached or fetch new subreddit details
      const subredditDetails = await getSubredditDetails(subredditName);
      
      // Prepare the request
      const formData = new URLSearchParams();
      formData.append('action', 'sub');
      formData.append('sr', subredditDetails.fullName);
      formData.append('skip_initial_defaults', 'true');
      if (session.modhash) formData.append('uh', session.modhash);

      // Try joining with exponential backoff
      let retryCount = 0;
      while (retryCount < RATE_LIMIT.MAX_RETRIES) {
        try {
          const response = await fetch('https://www.reddit.com/api/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-csrf-token': session.csrfToken,
              'x-requested-with': 'XMLHttpRequest',
              'User-Agent': 'web',
              'Origin': 'https://www.reddit.com',
              'Referer': `https://www.reddit.com/r/${subredditName}`
            },
            body: formData.toString(),
            credentials: 'include'
          });

          if (response.ok) {
            console.log(`[Reddit Copycat] Successfully joined r/${subredditName}`);
            apiCache.lastJoinTimestamp = Date.now();
            return true;
          }

          const responseText = await response.text();
          if (response.status === 429 || responseText.includes('rate')) {
            const backoffDelay = RATE_LIMIT.BACKOFF_BASE * Math.pow(2, retryCount);
            console.log(`[Reddit Copycat] Rate limited, waiting ${backoffDelay}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            retryCount++;
            continue;
          }

          throw new Error(`Join request failed: ${response.status}`);
        } catch (error) {
          console.error(`[Reddit Copycat] Error in join attempt ${retryCount + 1}:`, error);
          retryCount++;
          if (retryCount >= RATE_LIMIT.MAX_RETRIES) {
            throw error;
          }
        }
      }

      throw new Error('Max retries reached');
    } catch (error) {
      console.error(`[Reddit Copycat] Error joining r/${subredditName}:`, error);
      return false;
    }
  }

  async function leaveSubreddit(subredditName) {
    try {
      console.log(`[Reddit Copycat] Attempting to leave r/${subredditName}`);
      
      // Implement rate limiting
      const now = Date.now();
      const timeSinceLastJoin = now - apiCache.lastJoinTimestamp;
      if (timeSinceLastJoin < RATE_LIMIT.MIN_DELAY) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.MIN_DELAY - timeSinceLastJoin));
      }
      
      // Get cached or fetch new session data
      const session = await getUserSession();
      
      // Get cached or fetch new subreddit details
      const subredditDetails = await getSubredditDetails(subredditName);
      
      // Prepare the request
      const formData = new URLSearchParams();
      formData.append('action', 'unsub');
      formData.append('sr', subredditDetails.fullName);
      if (session.modhash) formData.append('uh', session.modhash);

      // Try leaving with exponential backoff
      let retryCount = 0;
      while (retryCount < RATE_LIMIT.MAX_RETRIES) {
        try {
          const response = await fetch('https://www.reddit.com/api/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-csrf-token': session.csrfToken,
              'x-requested-with': 'XMLHttpRequest',
              'User-Agent': 'web',
              'Origin': 'https://www.reddit.com',
              'Referer': `https://www.reddit.com/r/${subredditName}`
            },
            body: formData.toString(),
            credentials: 'include'
          });

          if (response.ok) {
            console.log(`[Reddit Copycat] Successfully left r/${subredditName}`);
            apiCache.lastJoinTimestamp = Date.now();
            return true;
          }

          const responseText = await response.text();
          if (response.status === 429 || responseText.includes('rate')) {
            const backoffDelay = RATE_LIMIT.BACKOFF_BASE * Math.pow(2, retryCount);
            console.log(`[Reddit Copycat] Rate limited, waiting ${backoffDelay}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            retryCount++;
            continue;
          }

          throw new Error(`Leave request failed: ${response.status}`);
        } catch (error) {
          console.error(`[Reddit Copycat] Error in leave attempt ${retryCount + 1}:`, error);
          retryCount++;
          if (retryCount >= RATE_LIMIT.MAX_RETRIES) {
            throw error;
          }
        }
      }

      throw new Error('Max retries reached');
    } catch (error) {
      console.error(`[Reddit Copycat] Error leaving r/${subredditName}:`, error);
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
        const result = await new Promise(resolve => {
          chrome.storage.local.get(['savedSubreddits'], async (result) => {
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
            
            if (subsToJoin.length === 0) {
              console.log('[Reddit Copycat] All subreddits are already joined');
              resolve({ success: false, error: 'You are already a member of all selected subreddits!' });
              return;
            }

            let successCount = 0;
            let totalAttempted = 0;
            let failedSubs = [];

            // Process in batches
            for (let i = 0; i < subsToJoin.length; i += RATE_LIMIT.BATCH_SIZE) {
              const batch = subsToJoin.slice(i, i + RATE_LIMIT.BATCH_SIZE);
              
              // Update progress for batch start
              chrome.runtime.sendMessage({
                action: 'joinProgress',
                current: totalAttempted,
                total: subsToJoin.length,
                status: `Starting batch ${Math.floor(i/RATE_LIMIT.BATCH_SIZE) + 1}...`
              });

              // Process each subreddit in the batch
              for (const subreddit of batch) {
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
              }

              // Add delay between batches if not the last batch
              if (i + RATE_LIMIT.BATCH_SIZE < subsToJoin.length) {
                console.log('[Reddit Copycat] Batch complete, waiting before next batch...');
                chrome.runtime.sendMessage({
                  action: 'joinProgress',
                  current: totalAttempted,
                  total: subsToJoin.length,
                  status: `Batch complete. Waiting ${RATE_LIMIT.BATCH_DELAY/1000} seconds before next batch...`
                });
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.BATCH_DELAY));
              }
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
        const subreddits = await getAllUserSubreddits();
        if (subreddits) {
          console.log(`[Reddit Copycat] Found ${subreddits.length} current subreddits`);
          sendResponse({ success: true, subreddits: subreddits });
        } else {
          console.log('[Reddit Copycat] Failed to get current subreddits');
          sendResponse({ success: false, error: 'Failed to fetch current subreddits', subreddits: [] });
        }
        return true;
      }

      else if (request.action === 'leaveSubreddits') {
        console.log('[Reddit Copycat] Processing leaveSubreddits request');
        const result = await new Promise(resolve => {
          chrome.storage.local.get(['savedSubreddits'], async (result) => {
            const subsToProcess = request.subreddits || result.savedSubreddits;
            
            if (!subsToProcess || subsToProcess.length === 0) {
              console.log('[Reddit Copycat] No subreddits to leave');
              resolve({ success: false, error: 'No subreddits to leave' });
              return;
            }

            console.log(`[Reddit Copycat] Found ${subsToProcess.length} subreddits to process`);
            const currentSubs = await getAllUserSubreddits();
            if (!currentSubs) {
              console.log('[Reddit Copycat] Failed to fetch current subreddits');
              resolve({ success: false, error: 'Failed to fetch current subreddits' });
              return;
            }

            const subsToLeave = subsToProcess.filter(sub => currentSubs.includes(sub));
            console.log(`[Reddit Copycat] ${subsToLeave.length} subreddits to leave`);
            
            if (subsToLeave.length === 0) {
              console.log('[Reddit Copycat] Not a member of any selected subreddits');
              resolve({ success: false, error: 'You are not a member of any selected subreddits!' });
              return;
            }

            let successCount = 0;
            let totalAttempted = 0;
            let failedSubs = [];

            // Process in batches
            for (let i = 0; i < subsToLeave.length; i += RATE_LIMIT.BATCH_SIZE) {
              const batch = subsToLeave.slice(i, i + RATE_LIMIT.BATCH_SIZE);

              // Update progress for batch start
              chrome.runtime.sendMessage({
                action: 'leaveProgress',
                current: totalAttempted,
                total: subsToLeave.length,
                status: `Starting batch ${Math.floor(i/RATE_LIMIT.BATCH_SIZE) + 1}...`
              });

              // Process each subreddit in the batch
              for (const subreddit of batch) {
                totalAttempted++;

                if (!currentSubs.includes(subreddit)) {
                  console.log(`[Reddit Copycat] Skipping r/${subreddit} (not joined)`);
                  chrome.runtime.sendMessage({
                    action: 'leaveProgress',
                    current: totalAttempted,
                    total: subsToLeave.length,
                    status: `Not a member of r/${subreddit} (${totalAttempted}/${subsToLeave.length})`
                  });
                  continue;
                }

                const success = await leaveSubreddit(subreddit);
                if (success) {
                  successCount++;
                  console.log(`[Reddit Copycat] Successfully left r/${subreddit}`);
                } else {
                  failedSubs.push(subreddit);
                  console.log(`[Reddit Copycat] Failed to leave r/${subreddit}`);
                }

                chrome.runtime.sendMessage({
                  action: 'leaveProgress',
                  current: totalAttempted,
                  total: subsToLeave.length,
                  status: success 
                    ? `Left r/${subreddit} (${totalAttempted}/${subsToLeave.length})`
                    : `Failed to leave r/${subreddit} (${totalAttempted}/${subsToLeave.length})`
                });
              }

              // Add delay between batches if not the last batch
              if (i + RATE_LIMIT.BATCH_SIZE < subsToLeave.length) {
                console.log('[Reddit Copycat] Batch complete, waiting before next batch...');
                chrome.runtime.sendMessage({
                  action: 'leaveProgress',
                  current: totalAttempted,
                  total: subsToLeave.length,
                  status: `Batch complete. Waiting ${RATE_LIMIT.BATCH_DELAY/1000} seconds before next batch...`
                });
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.BATCH_DELAY));
              }
            }

            console.log(`[Reddit Copycat] Leaving complete. Success: ${successCount}, Failed: ${failedSubs.length}`);
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