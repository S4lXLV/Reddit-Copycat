console.log('[Reddit Copycat] Popup script loaded');

document.addEventListener('DOMContentLoaded', function() {
  const saveButton = document.getElementById('saveSubredditsBtn');
  const joinButton = document.getElementById('joinSavedSubreddits');
  const showButton = document.getElementById('showSavedBtn');
  const exportButton = document.getElementById('exportListBtn');
  const importButton = document.getElementById('importListBtn');
  const importInput = document.getElementById('importInput');
  const statusDiv = document.querySelector('.status');
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
  const progressInfo = document.querySelector('.progress-info');
  const leaveSelectedBtn = document.getElementById('leaveSelectedBtn');
  const leaveSavedSubreddits = document.getElementById('leaveSavedSubreddits');
  let currentSubreddits = [];
  let joinedSubreddits = [];
  let selectedSubreddits = new Set();

  let progressListener = null;
  let currentCompletionListener = null;

  // Tab handling for new UI
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // Debug log for initial element check
  console.log('[Reddit Copycat] Settings button:', document.querySelector('.settings-button'));
  console.log('[Reddit Copycat] Settings content:', document.querySelector('.settings-content'));

  // Close all dropdowns when clicking outside
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.settings-dropdown') && !event.target.closest('.dropdown')) {
      // Close settings dropdown
      document.querySelectorAll('.settings-content').forEach(content => {
        content.classList.remove('show');
      });
      document.querySelectorAll('.settings-dropdown').forEach(dropdown => {
        dropdown.classList.remove('active');
      });
      
      // Close bulk actions dropdown
      document.querySelectorAll('.dropdown-content').forEach(content => {
        content.classList.remove('show');
      });
      document.querySelectorAll('.dropdown').forEach(dropdown => {
        dropdown.classList.remove('active');
      });
    }
  });

  // Settings dropdown handler
  const settingsButtons = document.querySelectorAll('.settings-button');
  settingsButtons.forEach(button => {
    button.addEventListener('click', (event) => {
      console.log('[Reddit Copycat] Settings button clicked');
      event.stopPropagation();
      const dropdown = event.target.closest('.settings-dropdown');
      const content = dropdown.querySelector('.settings-content');
      
      // Toggle active state
      dropdown.classList.toggle('active');
      
      // If we're showing the dropdown, ensure smooth animation
      if (!content.classList.contains('show')) {
        content.style.display = 'block';
        // Force a reflow
        content.offsetHeight;
        content.classList.add('show');
      } else {
        content.classList.remove('show');
        // Wait for animation to finish before hiding
        setTimeout(() => {
          if (!content.classList.contains('show')) {
            content.style.display = 'none';
          }
        }, 200);
      }
    });
  });

  // Handle filter checkbox
  document.addEventListener('change', (event) => {
    if (event.target.matches('#filterUnjoined')) {
      console.log('[Reddit Copycat] Filter checkbox changed:', event.target.checked);
      chrome.storage.local.get('savedSubreddits').then(savedSubs => {
        if (savedSubs.savedSubreddits) {
          updateSubredditList(savedSubs.savedSubreddits, event.target.checked);
        }
      });
    }
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      const targetId = `${tab.dataset.tab}-content`;
      document.getElementById(targetId).classList.add('active');
    });
  });

  function showStatus(message, isError = false, duration = 3000, isLoading = false) {
    if (!message) {
      statusDiv.style.display = 'none';
      document.querySelector('.status-overlay').style.display = 'none';
      return;
    }

    console.log(`[Reddit Copycat] Status: ${message} (${isError ? 'error' : isLoading ? 'loading' : 'success'})`);
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    document.querySelector('.status-overlay').style.display = 'block';
    statusDiv.className = `status ${isError ? 'error' : isLoading ? 'loading' : 'success'}`;
    
    if (duration > 0 && !isLoading) {
      setTimeout(() => {
        statusDiv.style.display = 'none';
        document.querySelector('.status-overlay').style.display = 'none';
      }, duration);
    }
  }

  function showProgress(show = true, isLeaving = false) {
    if (progressContainer) {
    progressContainer.style.display = show ? 'flex' : 'none';
      if (show && progressInfo) {
      progressInfo.textContent = isLeaving ? 'Leaving subreddits in progress...' : 'Joining subreddits in progress...';
      }
    }
  }

  function updateProgressInfo(current, total, status, isLeaving = false) {
    if (progressFill && progressText && progressInfo) {
      const percentage = (current / total) * 100;
      progressFill.style.width = `${percentage}%`;
      progressText.textContent = status || `Progress: ${current}/${total} subreddits`;
      progressInfo.textContent = current === total 
        ? (isLeaving ? 'Leaving complete!' : 'Joining complete!') 
        : (isLeaving ? 'Leaving subreddits in progress...' : 'Joining subreddits in progress...');
    }
  }

  function saveProgressState(current, total, status, isLeaving = false) {
    chrome.storage.local.set({
      joinProgress: {
        current,
        total,
        status,
        timestamp: Date.now(),
        isLeaving: isLeaving
      }
    });
  }

  function clearProgressState() {
    chrome.storage.local.set({
      joinProgress: {
        inProgress: false,
        current: 0,
        total: 0,
        status: '',
        isLeaving: false
      }
    });
  }

  function updateProgress(current, total, status, isLeaving = false) {
    updateProgressInfo(current, total, status, isLeaving);
    console.log(`[Reddit Copycat] Progress: ${status || `${current}/${total}`}`);
    
    saveProgressState(current, total, status, isLeaving);
    
    // Only handle completion in the completion listeners, not here
    // This prevents the double-handling that causes blinking
    if (current === total) {
      // Just update the UI text to show completion
      if (progressInfo) {
        progressInfo.textContent = isLeaving ? 'Leaving complete!' : 'Joining complete!';
      }
      if (progressText) {
        progressText.textContent = `Completed: ${current}/${total} subreddits`;
      }
    }
  }

  async function checkJoinStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'checkJoinStatus' });
      return response.isJoining;
    } catch (error) {
      console.error('[Reddit Copycat] Error checking join status:', error);
      return false;
    }
  }

  function setupProgressListener() {
    cleanupProgressListener();
    
    progressListener = function(msg) {
      if (msg.action === 'joinProgress' || msg.action === 'leaveProgress') {
        console.log('[Reddit Copycat] Progress update:', msg);
        showProgress(true, msg.action === 'leaveProgress');
        updateProgress(msg.current, msg.total, msg.status, msg.action === 'leaveProgress');
        
        // Let the completion listeners handle the cleanup
        if (msg.current === msg.total) {
          setTimeout(checkProgressState, 2000);
        }
      }
    };
    
    chrome.runtime.onMessage.addListener(progressListener);
  }

  function cleanupProgressListener() {
    if (progressListener) {
      chrome.runtime.onMessage.removeListener(progressListener);
      progressListener = null;
    }
  }

  async function checkProgressState() {
    try {
      const { joinProgress } = await chrome.storage.local.get(['joinProgress']);
      const status = await chrome.runtime.sendMessage({ action: 'checkJoinStatus' });
      
      if (status.isJoining || (joinProgress?.inProgress && joinProgress.current < joinProgress.total)) {
        try {
          await chrome.tabs.get(status.activeTabId);
          showProgress(true, status.currentOperation?.isLeaving || joinProgress?.isLeaving);
          if (joinProgress) {
            updateProgress(
              joinProgress.current, 
              joinProgress.total, 
              joinProgress.status, 
              status.currentOperation?.isLeaving || joinProgress?.isLeaving
            );
          }
        } catch (error) {
          showStatus('The Reddit tab was closed. Please reopen Reddit and try again.', true);
          showProgress(false);
        }
      } else if (joinProgress?.error) {
        showStatus(joinProgress.error, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Error checking progress state:', error);
    }
  }

  // Check progress state on load and periodically
  checkProgressState();
  setInterval(checkProgressState, 1000);

  async function injectContentScriptIfNeeded() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        if (response.success) {
          console.log('[Reddit Copycat] Content script is already active');
          return true;
        }
      } catch (error) {
        console.log('[Reddit Copycat] Content script not detected, injecting...');
      }

            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        if (response.success) {
          console.log('[Reddit Copycat] Content script successfully injected');
          return true;
        }
      } catch (error) {
        console.error('[Reddit Copycat] Failed to verify content script injection:', error);
        return false;
      }
    } catch (error) {
      console.error('[Reddit Copycat] Error injecting content script:', error);
      return false;
    }
  }

  async function isRedditTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab.url.includes('reddit.com');
    } catch (error) {
      console.error('[Reddit Copycat] Error checking if Reddit tab:', error);
      return false;
    }
  }

  async function getCurrentUserSubreddits() {
    try {
      if (!await isRedditTab()) {
        throw new Error('Please navigate to Reddit before using this feature.');
      }

      if (!await injectContentScriptIfNeeded()) {
        throw new Error('Failed to initialize Reddit Copycat. Please refresh the page and try again.');
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentSubreddits' });
      
      if (!response.success) {
        throw new Error('Failed to fetch subreddits. Please make sure you are logged in to Reddit.');
      }
      
      return response.subreddits || [];
    } catch (error) {
      console.error('[Reddit Copycat] Error getting current subreddits:', error);
      showStatus(error.message || 'An error occurred while fetching subreddits', true);
      return [];
    }
  }

  function updateSelectedCount() {
    const selectedCount = selectedSubreddits.size;
    const floatingActions = document.querySelector('.floating-actions');
    const actionCount = document.querySelector('.action-count');
    
    if (actionCount) {
      actionCount.textContent = `${selectedCount} Selected`;
    }
    
    if (floatingActions) {
      if (selectedCount > 0) {
        floatingActions.classList.add('visible');
      } else {
        floatingActions.classList.remove('visible');
      }
    }
  }

  function updateCheckboxes() {
    const checkboxes = document.querySelectorAll('#subredditList input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = selectedSubreddits.has(checkbox.dataset.subreddit);
    });
    updateSelectedCount();
  }

  async function updateSubredditList(savedSubs, filter = false) {
    try {
      const ul = subredditList.querySelector('ul') || document.createElement('ul');
      ul.innerHTML = '';
      
      if (joinedSubreddits.length === 0) {
        showStatus('Fetching current subreddits...', false, 0, true);
        
        if (!await isRedditTab()) {
          throw new Error('Please navigate to Reddit to see joined status.');
        }

        if (!await injectContentScriptIfNeeded()) {
          throw new Error('Failed to initialize. Please refresh the Reddit page and try again.');
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentSubreddits' });
        
        if (!response || !response.success) {
          throw new Error(response?.error || 'Failed to fetch current subreddits. Please make sure you are logged in to Reddit.');
        }
        
        joinedSubreddits = response.subreddits;
        showStatus('', false, 0);
      }

      let subsToShow = savedSubs;
      if (filter) {
        subsToShow = savedSubs.filter(sub => !joinedSubreddits.includes(sub));
      }

      // Sort subreddits with Not Joined first, then alphabetically within each group
      subsToShow.sort((a, b) => {
        const aJoined = joinedSubreddits.includes(a);
        const bJoined = joinedSubreddits.includes(b);
        
        if (aJoined === bJoined) {
          // If both are joined or both are not joined, sort alphabetically
          return a.localeCompare(b);
        }
        // Put not joined first
        return aJoined ? 1 : -1;
      });

      subsToShow.forEach(sub => {
        const li = document.createElement('li');
        
        const subInfo = document.createElement('div');
        subInfo.className = 'sub-info';
        
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
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sub-name';
        nameSpan.textContent = `r/${sub}`;
        
        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge ' + (joinedSubreddits.includes(sub) ? 'joined' : 'not-joined');
        statusBadge.textContent = joinedSubreddits.includes(sub) ? 'Joined' : 'Not Joined';
        
        const visitBtn = document.createElement('button');
        visitBtn.className = 'secondary-button';
        visitBtn.style.padding = '4px 8px';
        visitBtn.style.width = 'auto';
        visitBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        `;
        visitBtn.title = 'Visit Subreddit';
        visitBtn.onclick = () => window.open(`https://reddit.com/r/${sub}`, '_blank');
        
        checkboxWrapper.appendChild(checkbox);
        subInfo.appendChild(checkboxWrapper);
        subInfo.appendChild(nameSpan);
        subInfo.appendChild(statusBadge);
        subInfo.appendChild(visitBtn);
        li.appendChild(subInfo);
        ul.appendChild(li);
      });

      if (!subredditList.contains(ul)) {
        subredditList.appendChild(ul);
      }

      if (statsDiv) {
      const totalSubs = savedSubs.length;
      const joinedCount = savedSubs.filter(sub => joinedSubreddits.includes(sub)).length;
      const unjoinedCount = totalSubs - joinedCount;
        statsDiv.innerHTML = `
          <div class="stats-item">
            <span class="stats-label">Total:</span>
            <span>${totalSubs}</span>
          </div>
          <div class="stats-item">
            <span class="stats-label">Joined:</span>
            <span>${joinedCount}</span>
          </div>
          <div class="stats-item">
            <span class="stats-label">Not Joined:</span>
            <span>${unjoinedCount}</span>
          </div>
        `;
      }

      subredditList.style.display = 'block';
      updateSelectedCount();
    } catch (error) {
      console.error('[Reddit Copycat] Error updating subreddit list:', error);
      showStatus(error.message, true);
      joinedSubreddits = []; // Reset so it will try again next time
    }
  }

  // Event Listeners
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('#subredditList input[type="checkbox"]');
      const totalCheckboxes = checkboxes.length;
      const buttonText = selectAllBtn.querySelector('.button-text');
      
      // If all are selected, deselect all. Otherwise, select all.
      if (selectedSubreddits.size === totalCheckboxes) {
        selectedSubreddits.clear();
        buttonText.textContent = 'Select All';
      } else {
        checkboxes.forEach(checkbox => {
          selectedSubreddits.add(checkbox.dataset.subreddit);
        });
        buttonText.textContent = 'Deselect All';
      }
      
      updateCheckboxes();
    });
  }

  if (selectUnjoinedBtn) {
    selectUnjoinedBtn.addEventListener('click', async () => {
      try {
        // First, ensure we have the current joined subreddits
        if (joinedSubreddits.length === 0) {
          if (!await isRedditTab()) {
            throw new Error('Please navigate to Reddit first.');
          }

          if (!await injectContentScriptIfNeeded()) {
            throw new Error('Failed to initialize. Please refresh the Reddit page and try again.');
          }

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentSubreddits' });
          
          if (!response || !response.success) {
            throw new Error('Failed to fetch current subreddits. Please make sure you are logged in to Reddit.');
          }
          
          joinedSubreddits = response.subreddits;
        }

        const checkboxes = document.querySelectorAll('#subredditList input[type="checkbox"]');
        const unjoinedBoxes = Array.from(checkboxes).filter(checkbox => 
          !joinedSubreddits.includes(checkbox.dataset.subreddit)
        );
        const buttonText = selectUnjoinedBtn.querySelector('.button-text');
        
        // If all unjoined are selected, deselect them. Otherwise, select all unjoined.
        const allUnjoinedSelected = unjoinedBoxes.every(checkbox => 
          selectedSubreddits.has(checkbox.dataset.subreddit)
        );
        
        if (allUnjoinedSelected) {
          // Deselect all unjoined
          unjoinedBoxes.forEach(checkbox => {
            selectedSubreddits.delete(checkbox.dataset.subreddit);
          });
          buttonText.textContent = 'Select Unjoined Only';
        } else {
          // Select all unjoined
          unjoinedBoxes.forEach(checkbox => {
            selectedSubreddits.add(checkbox.dataset.subreddit);
          });
          buttonText.textContent = 'Deselect Unjoined';
        }

        // Update UI
        updateCheckboxes();
      } catch (error) {
        console.error('[Reddit Copycat] Error selecting unjoined subreddits:', error);
      }
    });
  }

  if (joinSelectedBtn) {
  joinSelectedBtn.addEventListener('click', async () => {
    if (selectedSubreddits.size === 0) return;

    try {
      joinSelectedBtn.disabled = true;
      showProgress(true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startJoining',
        tabId: tab.id,
        subreddits: Array.from(selectedSubreddits)
      });
      
      if (response.success) {
        let message = `Successfully started joining ${selectedSubreddits.size} subreddits!`;
        showStatus(message);
        
        // Reset joined subreddits to force a refresh on next update
        joinedSubreddits = [];
        
        // Clear selected subreddits
        selectedSubreddits.clear();
        updateSelectedCount();
        
        // Set up completion listener
        setupCompletionListener(false);
      } else {
        const errorMsg = response.error || 'Failed to start joining process. Please make sure you are logged in to Reddit and refresh the page.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Join error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    } finally {
      joinSelectedBtn.disabled = false;
    }
  });
  }

  if (leaveSelectedBtn) {
  leaveSelectedBtn.addEventListener('click', async () => {
    if (selectedSubreddits.size === 0) return;

    try {
      leaveSelectedBtn.disabled = true;
      showProgress(true, true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startLeaving',
        tabId: tab.id,
        subreddits: Array.from(selectedSubreddits)
      });
      
      if (response.success) {
        let message = `Successfully started leaving ${selectedSubreddits.size} subreddits!`;
        showStatus(message);
        
        // Reset joined subreddits to force a refresh on next update
        joinedSubreddits = [];
        
        // Clear selected subreddits
        selectedSubreddits.clear();
        updateSelectedCount();

        // Set up completion listener
        setupCompletionListener(true);
      } else {
        const errorMsg = response.error || 'Failed to start leaving process. Please make sure you are logged in to Reddit and refresh the page.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Leave error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    } finally {
      leaveSelectedBtn.disabled = false;
    }
  });
  }

  if (leaveSavedSubreddits) {
  leaveSavedSubreddits.addEventListener('click', async () => {
    try {
      console.log('[Reddit Copycat] Leave all button clicked');
      leaveSavedSubreddits.disabled = true;

      if (!await isRedditTab()) {
        showStatus('Please navigate to Reddit before using this feature.', true);
        return;
      }

      await injectContentScriptIfNeeded();
      showProgress(true, true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startLeaving',
        tabId: tab.id
      });
      
      if (response.success) {
        showStatus('Successfully started leaving process!');
        
        // Reset joined subreddits to force a refresh on next update
        joinedSubreddits = [];

        // Set up completion listener with force refresh
        chrome.storage.local.get(['savedSubreddits'], async (result) => {
          if (result.savedSubreddits) {
            currentSubreddits = result.savedSubreddits;
          }
        });
        setupCompletionListener(true);

      } else if (response.error === 'Operation in progress') {
        showStatus('Please wait, another operation is in progress...', true);
        showProgress(false);
      } else {
        const errorMsg = response.error || 'Failed to start leaving process. Please make sure you are logged in to Reddit and refresh the page.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Leave error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    } finally {
      leaveSavedSubreddits.disabled = false;
    }
  });
  }

  // Load saved subreddits automatically when popup opens
  chrome.storage.local.get(['savedSubreddits'], async (result) => {
    if (result.savedSubreddits && result.savedSubreddits.length > 0) {
      try {
        currentSubreddits = result.savedSubreddits;
        await updateSubredditList(currentSubreddits, filterCheckbox?.checked);
      } catch (error) {
        console.error('[Reddit Copycat] Error displaying subreddits:', error);
        showStatus('Error loading subreddits. Please try again.', true);
      }
    }
  });

  // Dropdown functionality
  const bulkActionsBtn = document.getElementById('bulkActionsBtn');
  const dropdownContent = document.querySelector('.dropdown-content');
  const joinAllBtn = document.getElementById('joinAllBtn');
  const leaveAllBtn = document.getElementById('leaveAllBtn');
  const floatingJoinBtn = document.getElementById('floatingJoinBtn');
  const floatingLeaveBtn = document.getElementById('floatingLeaveBtn');

  // Toggle dropdown when clicking the bulk actions button
  if (bulkActionsBtn) {
    bulkActionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = e.target.closest('.dropdown');
      const content = dropdown.querySelector('.dropdown-content');
      
      // Toggle active state
      dropdown.classList.toggle('active');
      
      // If we're showing the dropdown, ensure smooth animation
      if (!content.classList.contains('show')) {
        content.style.display = 'block';
        // Force a reflow
        content.offsetHeight;
        content.classList.add('show');
      } else {
        content.classList.remove('show');
        // Wait for animation to finish before hiding
        setTimeout(() => {
          if (!content.classList.contains('show')) {
            content.style.display = 'none';
          }
        }, 200);
      }
    });
  }

  // Handle join all action
  joinAllBtn.addEventListener('click', async () => {
    dropdownContent.classList.remove('show');
    try {
      console.log('[Reddit Copycat] Join all button clicked');

      if (!await isRedditTab()) {
        showStatus('Please navigate to Reddit before using this feature.', true);
        return;
      }

      await injectContentScriptIfNeeded();
      showProgress(true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startJoining',
        tabId: tab.id
      });
      
      if (response.success) {
        showStatus('Successfully started joining process!');
        joinedSubreddits = [];
        setupCompletionListener(false);
      } else if (response.error === 'Operation in progress') {
        showStatus('Please wait, another operation is in progress...', true);
        showProgress(false);
      } else {
        const errorMsg = response.error || 'Failed to start joining process. Please make sure you are logged in to Reddit.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Join error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    }
  });

  // Handle leave all action
  leaveAllBtn.addEventListener('click', async () => {
    dropdownContent.classList.remove('show');
    try {
      console.log('[Reddit Copycat] Leave all button clicked');

      if (!await isRedditTab()) {
        showStatus('Please navigate to Reddit before using this feature.', true);
        return;
      }

      await injectContentScriptIfNeeded();
      showProgress(true, true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startLeaving',
        tabId: tab.id
      });
      
      if (response.success) {
        showStatus('Successfully started leaving process!');
        joinedSubreddits = [];
        setupCompletionListener(true);
      } else if (response.error === 'Operation in progress') {
        showStatus('Please wait, another operation is in progress...', true);
        showProgress(false);
      } else {
        const errorMsg = response.error || 'Failed to start leaving process. Please make sure you are logged in to Reddit.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Leave error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    }
  });

  // Handle floating join selected action
  floatingJoinBtn.addEventListener('click', async () => {
    if (selectedSubreddits.size === 0) return;

    try {
      floatingJoinBtn.disabled = true;
      showProgress(true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startJoining',
        tabId: tab.id,
        subreddits: Array.from(selectedSubreddits)
      });
      
      if (response.success) {
        showStatus(`Successfully started joining ${selectedSubreddits.size} subreddits!`);
        joinedSubreddits = [];
        selectedSubreddits.clear();
        updateSelectedCount();
        setupCompletionListener(false);
      } else {
        const errorMsg = response.error || 'Failed to start joining process. Please make sure you are logged in to Reddit.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Join error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    } finally {
      floatingJoinBtn.disabled = false;
    }
  });

  // Handle floating leave selected action
  floatingLeaveBtn.addEventListener('click', async () => {
    if (selectedSubreddits.size === 0) return;

    try {
      floatingLeaveBtn.disabled = true;
      showProgress(true, true);
      setupProgressListener();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        action: 'startLeaving',
        tabId: tab.id,
        subreddits: Array.from(selectedSubreddits)
      });
      
      if (response.success) {
        showStatus(`Successfully started leaving ${selectedSubreddits.size} subreddits!`);
        joinedSubreddits = [];
        selectedSubreddits.clear();
        updateSelectedCount();
        setupCompletionListener(true);
      } else {
        const errorMsg = response.error || 'Failed to start leaving process. Please make sure you are logged in to Reddit.';
        showStatus(errorMsg, true);
        showProgress(false);
      }
    } catch (error) {
      console.error('[Reddit Copycat] Leave error:', error);
      showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      showProgress(false);
    } finally {
      floatingLeaveBtn.disabled = false;
    }
  });

  // Restore all the event listeners and functionality
  if (filterCheckbox) {
    filterCheckbox.addEventListener('change', () => {
      if (currentSubreddits.length > 0) {
        updateSubredditList(currentSubreddits, filterCheckbox.checked);
      }
    });
  }

  if (saveButton) {
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
        
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'saveSubreddits' });
        
        if (response.success) {
          showStatus(`Successfully saved ${response.count} subreddits!`);
          currentSubreddits = response.subreddits;
          await updateSubredditList(response.subreddits, filterCheckbox?.checked || false);
        } else {
          showStatus('Failed to save subreddits. Please make sure you are logged in to Reddit.', true);
        }
      } catch (error) {
        console.error('[Reddit Copycat] Save error:', error);
        showStatus('Error: ' + (error.message || 'Unknown error occurred'), true);
      } finally {
        saveButton.disabled = false;
      }
    });
  }

  // Export functionality
  if (exportButton) {
    exportButton.addEventListener('click', () => {
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
    });
  }

  // Import functionality
  if (importButton) {
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
  }

  // Initial check if we're on Reddit
  isRedditTab().then(isReddit => {
    if (!isReddit) {
      showStatus('Please navigate to Reddit to use this extension.', true, 0);
      if (saveButton) saveButton.disabled = true;
      if (joinButton) joinButton.disabled = true;
    }
  });

  function setupCompletionListener(isLeaving = false) {
    // Clean up any existing completion listener
    if (currentCompletionListener) {
      chrome.storage.onChanged.removeListener(currentCompletionListener);
      currentCompletionListener = null;
    }

    // Create new completion listener
    currentCompletionListener = function completionListener(changes) {
      if (changes.joinProgress && changes.joinProgress.newValue && !changes.joinProgress.newValue.inProgress) {
        // Remove the listener to avoid memory leaks
        chrome.storage.onChanged.removeListener(completionListener);
        currentCompletionListener = null;
        
        // Hide progress window
        showProgress(false);
        
        // Force refresh joined subreddits
        joinedSubreddits = [];
        
        // Update the subreddit list
        chrome.storage.local.get('savedSubreddits', async (result) => {
          if (result.savedSubreddits) {
            currentSubreddits = result.savedSubreddits;
            await updateSubredditList(result.savedSubreddits, document.getElementById('filterUnjoined')?.checked || false);
          }
        });
      }
    };

    // Add the new listener
    chrome.storage.onChanged.addListener(currentCompletionListener);
  }
}); 