// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ savedSubreddits: [] });
});

let joinInProgress = false;
let activeTabId = null;
let currentJoinOperation = null;

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startJoining') {
    // Store the active tab ID
    activeTabId = message.tabId;
    
    // Forward the join request to content script
    chrome.tabs.sendMessage(message.tabId, {
      action: 'joinSubreddits',
      subreddits: message.subreddits
    }).then(response => {
      if (response.success) {
        joinInProgress = true;
        currentJoinOperation = {
          tabId: message.tabId,
          subreddits: message.subreddits
        };
        // Initialize progress state
        chrome.storage.local.set({
          joinProgress: {
            current: 0,
            total: message.subreddits ? message.subreddits.length : 0,
            status: 'Starting...',
            timestamp: Date.now(),
            inProgress: true
          }
        });
      }
      sendResponse(response);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  else if (message.action === 'joinProgress') {
    // Store progress state
    chrome.storage.local.set({
      joinProgress: {
        current: message.current,
        total: message.total,
        status: message.status,
        timestamp: Date.now(),
        inProgress: true
      }
    });

    // Forward progress updates to any open popup
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, ignore the error
    });

    // Check if joining is complete
    if (message.current === message.total) {
      joinInProgress = false;
      currentJoinOperation = null;
      
      // Show completion notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: 'Reddit Copycat',
        message: `Successfully joined ${message.current} subreddits!`
      });
      
      // Clear progress after a delay
      setTimeout(() => {
        chrome.storage.local.set({
          joinProgress: {
            inProgress: false
          }
        });
      }, 2000);
    }
  }
  
  else if (message.action === 'checkJoinStatus') {
    // Send back both the status and the active tab ID
    sendResponse({ 
      isJoining: joinInProgress,
      activeTabId: activeTabId,
      currentOperation: currentJoinOperation
    });
    return true;
  }

  else if (message.action === 'processImport') {
    processImport(message.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  else if (message.action === 'startLeaving') {
    // Store the active tab ID
    activeTabId = message.tabId;
    
    // Forward the leave request to content script
    chrome.tabs.sendMessage(message.tabId, {
      action: 'leaveSubreddits',
      subreddits: message.subreddits
    }).then(response => {
      if (response.success) {
        joinInProgress = true;
        currentJoinOperation = {
          tabId: message.tabId,
          subreddits: message.subreddits,
          isLeaving: true
        };
        // Initialize progress state
        chrome.storage.local.set({
          joinProgress: {
            current: 0,
            total: message.subreddits ? message.subreddits.length : 0,
            status: 'Starting to leave...',
            timestamp: Date.now(),
            inProgress: true,
            isLeaving: true
          }
        });
      }
      sendResponse(response);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  else if (message.action === 'leaveProgress') {
    // Store progress state
    chrome.storage.local.set({
      joinProgress: {
        current: message.current,
        total: message.total,
        status: message.status,
        timestamp: Date.now(),
        inProgress: true,
        isLeaving: true
      }
    });

    // Forward progress updates to any open popup
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, ignore the error
    });

    // Check if leaving is complete
    if (message.current === message.total) {
      joinInProgress = false;
      currentJoinOperation = null;
      
      // Show completion notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: 'Reddit Copycat',
        message: `Successfully left ${message.current} subreddits!`
      });
      
      // Clear progress after a delay
      setTimeout(() => {
        chrome.storage.local.set({
          joinProgress: {
            inProgress: false
          }
        });
      }, 2000);
    }
  }
});

// Handle import processing in the background
async function processImport(importedSubs) {
  try {
    // Get current subreddits and merge
    const storage = await chrome.storage.local.get(['savedSubreddits']);
    const currentSubs = storage.savedSubreddits || [];
    const newSubs = importedSubs.filter(sub => !currentSubs.includes(sub));
    const allSubs = [...new Set([...currentSubs, ...importedSubs])];
    
    // Save the merged list
    await chrome.storage.local.set({
      savedSubreddits: allSubs,
      lastImport: {
        success: true,
        newCount: newSubs.length,
        totalCount: allSubs.length,
        timestamp: Date.now()
      }
    });

    // Show notification
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: 'Reddit Copycat',
      message: `Successfully imported ${newSubs.length} new subreddits! (${allSubs.length} total)`
    });

    return { 
      success: true,
      newCount: newSubs.length,
      totalCount: allSubs.length
    };
  } catch (error) {
    console.error('[Reddit Copycat] Import processing error:', error);
    
    await chrome.storage.local.set({
      lastImport: {
        success: false,
        error: error.message,
        timestamp: Date.now()
      }
    });

    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: 'Reddit Copycat',
      message: 'Failed to process import: ' + error.message
    });

    throw error;
  }
}

// Listen for tab updates to handle Reddit page refreshes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('reddit.com') && joinInProgress && tabId === activeTabId) {
    console.log('[Reddit Copycat] Reddit page refreshed, reinjecting content script');
    // Reinject content script if needed
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).then(() => {
      // Small delay to ensure content script is initialized
      setTimeout(() => {
        // Try to resume the join operation
        if (currentJoinOperation) {
          chrome.tabs.sendMessage(tabId, {
            action: 'joinSubreddits',
            subreddits: currentJoinOperation.subreddits
          }).catch(() => {
            console.log('[Reddit Copycat] Failed to resume join operation');
          });
        }
      }, 1000);
    });
  }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    // The Reddit tab was closed
    joinInProgress = false;
    currentJoinOperation = null;
    activeTabId = null;
    chrome.storage.local.set({
      joinProgress: {
        inProgress: false,
        error: 'The Reddit tab was closed. Please reopen Reddit and try again.'
      }
    });
  }
}); 