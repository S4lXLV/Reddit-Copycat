console.log('[Reddit Copycat] Popup script loaded');

document.addEventListener('DOMContentLoaded', function() {
  const saveButton = document.getElementById('saveSubreddits');
  const joinButton = document.getElementById('joinSavedSubreddits');
  const showButton = document.getElementById('showSubreddits');
  const exportButton = document.getElementById('exportSubreddits');
  const importButton = document.getElementById('importSubreddits');
  const importInput = document.getElementById('importInput');
  const statusDiv = document.getElementById('status');
  const subredditList = document.getElementById('subredditList');
  const progressContainer = document.querySelector('.progress-container');
  const progressFill = document.querySelector('.progress-fill');
  const progressText = document.querySelector('.progress-text');
  const filterContainer = document.querySelector('.filter-container');
  const filterCheckbox = document.getElementById('filterUnjoined');
  const statsDiv = document.querySelector('.stats');
  const selectionControls = document.querySelector('.selection-controls');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const selectUnjoinedBtn = document.getElementById('selectUnjoinedBtn');
  const joinSelectedBtn = document.getElementById('joinSelectedBtn');
  const selectedCountDiv = document.querySelector('.selected-count');
  let currentSubreddits = [];
  let joinedSubreddits = [];
  let selectedSubreddits = new Set();

  let progressListener = null;

  function showStatus(message, isError = false, duration = 3000, isLoading = false) {
    if (!message) {
      statusDiv.style.display = 'none';
      return;
    }

    console.log(`[Reddit Copycat] Status: ${message} (${isError ? 'error' : isLoading ? 'loading' : 'success'})`);
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    statusDiv.className = `status ${isError ? 'error' : isLoading ? 'loading' : 'success'}`;
    
    if (duration > 0 && !isLoading) {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, duration);
    }
  }

  function updateProgress(current, total, status) {
    const percentage = (current / total) * 100;
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = status || `Progress: ${current}/${total} subreddits`;
    console.log(`[Reddit Copycat] Progress: ${status || `${current}/${total}`}`);
  }

  function displaySubreddits(subreddits) {
    console.log(`[Reddit Copycat] Displaying ${subreddits.length} subreddits`);
    currentSubreddits = subreddits;
    updateSubredditList(subreddits, filterCheckbox.checked);
  }

  function exportSubreddits() {
    chrome.storage.local.get(['savedSubreddits'], (result) => {
      if (!result.savedSubreddits || result.savedSubreddits.length === 0) {
        showStatus('No subreddits to export. Save some subreddits first!', true);
        return;
      }

      const data = {
        savedSubreddits: result.savedSubreddits,
        exportDate: new Date().toISOString(),
        version: '1.0'
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `reddit-copycat-export-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus(`Exported ${result.savedSubreddits.length} subreddits successfully!`);
    });
  }

  function importSubreddits(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          
          if (!data.savedSubreddits || !Array.isArray(data.savedSubreddits)) {
            throw new Error('Invalid file format');
          }

          chrome.storage.local.get(['savedSubreddits'], (result) => {
            const currentSubs = result.savedSubreddits || [];
            const newSubs = data.savedSubreddits.filter(sub => !currentSubs.includes(sub));
            const allSubs = [...new Set([...currentSubs, ...data.savedSubreddits])];

            chrome.storage.local.set({ savedSubreddits: allSubs }, () => {
              showStatus(`Imported ${newSubs.length} new subreddits! (${allSubs.length} total)`);
              if (subredditList.style.display === 'block') {
                displaySubreddits(allSubs);
              }
              resolve({ newCount: newSubs.length, totalCount: allSubs.length });
            });
          });
        } catch (error) {
          console.error('[Reddit Copycat] Import error:', error);
          showStatus('Failed to import: Invalid file format', true);
          reject(error);
        }
      };
      reader.onerror = function(error) {
        showStatus('Failed to read the file', true);
        reject(error);
      };
      reader.readAsText(file);
    });
  }

  // Export button click handler
  exportButton.addEventListener('click', exportSubreddits);

  // Import button click handler
  importButton.addEventListener('click', async () => {
    try {
      importButton.disabled = true;
      
      // Open import window
      await chrome.windows.create({
        url: 'import.html',
        type: 'popup',
        width: 600,
        height: 600,
        focused: true
      });

    } catch (error) {
      console.error('[Reddit Copycat] Import error:', error);
      showStatus('Failed to open import window', true);
    } finally {
      importButton.disabled = false;
    }
  });

  // Handle file selection
  importInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
      importButton.disabled = false;
      return;
    }

    try {
      showStatus('Reading file...', false, 0);
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.savedSubreddits || !Array.isArray(data.savedSubreddits)) {
        throw new Error('Invalid file format');
      }

      // Store the data for processing
      await chrome.storage.local.set({
        pendingImport: {
          subreddits: data.savedSubreddits,
          timestamp: Date.now()
        }
      });

      // Start processing
      await processPendingImport();
    } catch (error) {
      console.error('[Reddit Copycat] Import error:', error);
      showStatus('Failed to read file: ' + error.message, true);
      importButton.disabled = false;
    }

    // Reset the form to allow selecting the same file again
    importForm.reset();
  });

  async function processPendingImport() {
    try {
      const { pendingImport } = await chrome.storage.local.get(['pendingImport']);
      if (!pendingImport) return;

      showStatus('Processing import...', false, 0);

      // Send to background script for processing
      await chrome.runtime.sendMessage({
        action: 'processImport',
        data: pendingImport.subreddits
      });

      // Clear the pending import
      await chrome.storage.local.remove('pendingImport');
    } catch (error) {
      console.error('[Reddit Copycat] Process import error:', error);
      showStatus('Failed to process import: ' + error.message, true);
    } finally {
      importButton.disabled = false;
    }
  }

  // Check if there's a pending import when popup opens
  document.addEventListener('DOMContentLoaded', async () => {
    // First check if there's a pending import from a previous session
    const { pendingImport } = await chrome.storage.local.get(['pendingImport']);
    if (pendingImport) {
      showStatus('Processing previous import...', false);
      await processPendingImport();
    }

    // Check for recent import status
    const { lastImport } = await chrome.storage.local.get(['lastImport']);
    if (lastImport) {
      const timeSinceImport = Date.now() - lastImport.timestamp;
      if (timeSinceImport < 5000) {
        if (lastImport.success) {
          showStatus(`Successfully imported ${lastImport.newCount} new subreddits! (${lastImport.totalCount} total)`);
          if (subredditList.style.display === 'block') {
            chrome.storage.local.get(['savedSubreddits'], (result) => {
              if (result.savedSubreddits && result.savedSubreddits.length > 0) {
                displaySubreddits(result.savedSubreddits);
              }
            });
          }
        } else {
          showStatus(`Import failed: ${lastImport.error}`, true);
        }
      }
    }
  });

  async function isRedditTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isReddit = tab && tab.url && tab.url.includes('reddit.com');
    console.log(`[Reddit Copycat] Current tab is${isReddit ? '' : ' not'} Reddit:`, tab?.url);
    return isReddit;
  }

  async function injectContentScriptIfNeeded() {
    console.log('[Reddit Copycat] Checking content script status');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.log('[Reddit Copycat] No active tab found');
      return false;
    }

    try {
      // First try to send a ping message to see if the content script is already running
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' })
        .catch(async (error) => {
          if (error.message.includes('Receiving end does not exist')) {
            console.log('[Reddit Copycat] Content script not found, injecting...');
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            // Wait a bit for the script to initialize
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        });
      return true;
    } catch (error) {
      console.error('[Reddit Copycat] Error checking/injecting content script:', error);
      return false;
    }
  }

  function cleanupProgressListener() {
    if (progressListener) {
      chrome.runtime.onMessage.removeListener(progressListener);
      progressListener = null;
    }
  }

  async function getCurrentUserSubreddits() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentSubreddits' });
      return response.subreddits || [];
    } catch (error) {
      console.error('[Reddit Copycat] Error getting current subreddits:', error);
      return [];
    }
  }

  function updateSelectedCount() {
    const count = selectedSubreddits.size;
    selectedCountDiv.textContent = `Selected: ${count} subreddit${count !== 1 ? 's' : ''}`;
    joinSelectedBtn.style.display = count > 0 ? 'block' : 'none';
    joinSelectedBtn.disabled = count === 0;
  }

  function updateCheckboxes() {
    const checkboxes = document.querySelectorAll('#subredditList input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = selectedSubreddits.has(checkbox.dataset.subreddit);
    });
    updateSelectedCount();
  }

  async function updateSubredditList(savedSubs, filter = false) {
    const ul = subredditList.querySelector('ul');
    ul.innerHTML = '';
    
    if (joinedSubreddits.length === 0) {
      joinedSubreddits = await getCurrentUserSubreddits();
    }

    let subsToShow = savedSubs;
    if (filter) {
      subsToShow = savedSubs.filter(sub => !joinedSubreddits.includes(sub));
    }

    subsToShow.sort().forEach(sub => {
      const li = document.createElement('li');
      
      // Create checkbox wrapper
      const checkboxWrapper = document.createElement('div');
      checkboxWrapper.className = 'checkbox-wrapper';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.subreddit = sub;
      checkbox.checked = selectedSubreddits.has(sub);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedSubreddits.add(sub);
        } else {
          selectedSubreddits.delete(sub);
        }
        updateSelectedCount();
      });
      
      // Create subreddit info section
      const subInfo = document.createElement('div');
      subInfo.className = 'sub-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'sub-name';
      nameSpan.textContent = `r/${sub}`;
      
      const statusBadge = document.createElement('span');
      statusBadge.className = 'status-badge ' + (joinedSubreddits.includes(sub) ? 'joined' : 'not-joined');
      statusBadge.textContent = joinedSubreddits.includes(sub) ? 'Joined' : 'Not Joined';
      
      checkboxWrapper.appendChild(checkbox);
      subInfo.appendChild(checkboxWrapper);
      subInfo.appendChild(nameSpan);
      subInfo.appendChild(statusBadge);
      li.appendChild(subInfo);
      ul.appendChild(li);
    });

    const totalSubs = savedSubs.length;
    const joinedCount = savedSubs.filter(sub => joinedSubreddits.includes(sub)).length;
    const unjoinedCount = totalSubs - joinedCount;
    statsDiv.textContent = `Total: ${totalSubs} | Joined: ${joinedCount} | Not Joined: ${unjoinedCount}`;

    subredditList.style.display = 'block';
    filterContainer.style.display = 'block';
    selectionControls.style.display = 'block';
    updateSelectedCount();
  }

  selectAllBtn.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#subredditList input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      selectedSubreddits.add(checkbox.dataset.subreddit);
    });
    updateCheckboxes();
  });

  deselectAllBtn.addEventListener('click', () => {
    selectedSubreddits.clear();
    updateCheckboxes();
  });

  selectUnjoinedBtn.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#subredditList input[type="checkbox"]');
    selectedSubreddits.clear();
    checkboxes.forEach(checkbox => {
      const sub = checkbox.dataset.subreddit;
      if (!joinedSubreddits.includes(sub)) {
        selectedSubreddits.add(sub);
      }
    });
    updateCheckboxes();
  });

  joinSelectedBtn.addEventListener('click', async () => {
    if (selectedSubreddits.size === 0) return;

    try {
      joinSelectedBtn.disabled = true;
      progressContainer.style.display = 'block';
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      chrome.runtime.onMessage.addListener(function progressListener(msg) {
        if (msg.action === 'joinProgress') {
          updateProgress(msg.current, msg.total, msg.status);
          if (msg.current === msg.total) {
            setTimeout(() => {
              progressContainer.style.display = 'none';
              chrome.runtime.onMessage.removeListener(progressListener);
            }, 2000);
          }
        }
      });

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'joinSubreddits',
        subreddits: Array.from(selectedSubreddits)
      });
      
      if (response.success) {
        let message = `Successfully joined ${response.successCount} out of ${response.totalProcessed} selected subreddits!`;
        if (response.failedSubs && response.failedSubs.length > 0) {
          message += ` Failed to join ${response.failedSubs.length} subreddits.`;
          console.log('[Reddit Copycat] Failed subreddits:', response.failedSubs);
        }
        showStatus(message, response.failedSubs && response.failedSubs.length > 0);
        
        // Update joined subreddits and refresh the list
        joinedSubreddits = await getCurrentUserSubreddits();
        updateSubredditList(currentSubreddits, filterCheckbox.checked);
        selectedSubreddits.clear();
        updateSelectedCount();
      } else {
        const errorMsg = response.error || 'Failed to join subreddits. Please make sure you are logged in to Reddit and refresh the page.';
        showStatus(errorMsg, true);
        progressContainer.style.display = 'none';
      }
    } catch (error) {
      console.error('[Reddit Copycat] Join error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      progressContainer.style.display = 'none';
    } finally {
      joinSelectedBtn.disabled = false;
    }
  });

  // Update show button click handler
  showButton.addEventListener('click', () => {
    chrome.storage.local.get(['savedSubreddits'], async (result) => {
      if (result.savedSubreddits && result.savedSubreddits.length > 0) {
        if (subredditList.style.display === 'none' || !subredditList.style.display) {
          showButton.disabled = true;
          showStatus('Fetching subreddits... This might take a moment for the first time.', false, 0, true);
          
          try {
            currentSubreddits = result.savedSubreddits;
            await updateSubredditList(currentSubreddits, filterCheckbox.checked);
            showButton.textContent = 'Hide Saved Subreddits';
            showStatus('', false); // Clear the status
          } catch (error) {
            console.error('[Reddit Copycat] Error displaying subreddits:', error);
            showStatus('Error loading subreddits. Please try again.', true);
          } finally {
            showButton.disabled = false;
          }
        } else {
          subredditList.style.display = 'none';
          filterContainer.style.display = 'none';
          selectionControls.style.display = 'none';
          joinSelectedBtn.style.display = 'none';
          showButton.textContent = 'Show Saved Subreddits';
        }
      } else {
        showStatus('No subreddits saved yet. Click "Save Current Subreddits" first or import a list.', true);
      }
    });
  });

  // Filter checkbox handler
  filterCheckbox.addEventListener('change', () => {
    if (currentSubreddits.length > 0) {
      updateSubredditList(currentSubreddits, filterCheckbox.checked);
    }
  });

  saveButton.addEventListener('click', async () => {
    try {
      console.log('[Reddit Copycat] Save button clicked');
      saveButton.disabled = true;

      if (!await isRedditTab()) {
        showStatus('Please navigate to Reddit before using this feature.', true);
        return;
      }

      await injectContentScriptIfNeeded();
      showStatus('Fetching your subreddits... This may take a moment.', false, 0);
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Reddit Copycat] Sending saveSubreddits message to tab:', tab.id);
      
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'saveSubreddits' })
        .catch(error => {
          console.error('[Reddit Copycat] Message send error:', error);
          if (error.message.includes('Receiving end does not exist')) {
            throw new Error('Please refresh the Reddit page and try again.');
          }
          throw error;
        });
      
      console.log('[Reddit Copycat] Save response:', response);
      if (response.success) {
        showStatus(`Successfully saved ${response.count} subreddits!`);
        if (subredditList.style.display === 'block') {
          displaySubreddits(response.subreddits);
        }
      } else if (response.error === 'Operation in progress') {
        showStatus('Please wait, another operation is in progress...', true);
      } else {
        showStatus('Failed to save subreddits. Please make sure you are logged in to Reddit and refresh the page.', true);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Save error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
    } finally {
      saveButton.disabled = false;
    }
  });

  joinButton.addEventListener('click', async () => {
    try {
      console.log('[Reddit Copycat] Join button clicked');
      joinButton.disabled = true;

      if (!await isRedditTab()) {
        showStatus('Please navigate to Reddit before using this feature.', true);
        return;
      }

      await injectContentScriptIfNeeded();
      progressContainer.style.display = 'block';
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Reddit Copycat] Setting up progress listener');
      
      // Clean up any existing listener
      cleanupProgressListener();
      
      // Set up new progress listener
      progressListener = function(msg) {
        if (msg.action === 'joinProgress') {
          console.log('[Reddit Copycat] Progress update:', msg);
          updateProgress(msg.current, msg.total, msg.status);
          if (msg.current === msg.total) {
            setTimeout(() => {
              progressContainer.style.display = 'none';
              cleanupProgressListener();
            }, 2000);
          }
        }
      };
      
      chrome.runtime.onMessage.addListener(progressListener);

      console.log('[Reddit Copycat] Sending joinSubreddits message to tab:', tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'joinSubreddits' })
        .catch(error => {
          console.error('[Reddit Copycat] Message send error:', error);
          if (error.message.includes('Receiving end does not exist')) {
            throw new Error('Please refresh the Reddit page and try again.');
          }
          throw error;
        });
      
      console.log('[Reddit Copycat] Join response:', response);
      if (response.success) {
        let message = `Successfully joined ${response.successCount} out of ${response.totalProcessed} subreddits!`;
        if (response.failedSubs && response.failedSubs.length > 0) {
          message += ` Failed to join ${response.failedSubs.length} subreddits.`;
          console.log('[Reddit Copycat] Failed subreddits:', response.failedSubs);
        }
        showStatus(message, response.failedSubs && response.failedSubs.length > 0);
      } else if (response.error === 'Operation in progress') {
        showStatus('Please wait, another operation is in progress...', true);
        progressContainer.style.display = 'none';
      } else {
        const errorMsg = response.error || 'Failed to join subreddits. Please make sure you are logged in to Reddit and refresh the page.';
        showStatus(errorMsg, true);
        progressContainer.style.display = 'none';
      }
    } catch (error) {
      console.error('[Reddit Copycat] Join error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      progressContainer.style.display = 'none';
    } finally {
      joinButton.disabled = false;
    }
  });

  // Initial check if we're on Reddit
  isRedditTab().then(isReddit => {
    if (!isReddit) {
      showStatus('Please navigate to Reddit to use this extension.', true, 0);
      saveButton.disabled = true;
      joinButton.disabled = true;
    }
  });
}); 