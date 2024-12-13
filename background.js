// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ savedSubreddits: [] });
});

// Handle import processing in the background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processImport') {
    processImport(request.data)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open
  }
});

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

    return { success: true };
  } catch (error) {
    console.error('Import processing error:', error);
    
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

// Clean up old import status periodically
chrome.alarms.create('cleanupImportStatus', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanupImportStatus') {
    chrome.storage.local.get(['lastImport', 'pendingImport'], (result) => {
      const now = Date.now();
      
      // Clean up old import status
      if (result.lastImport && now - result.lastImport.timestamp > 300000) {
        chrome.storage.local.remove('lastImport');
      }
      
      // Clean up stale pending imports
      if (result.pendingImport && now - result.pendingImport.timestamp > 300000) {
        chrome.storage.local.remove('pendingImport');
      }
    });
  }
}); 