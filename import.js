document.addEventListener('DOMContentLoaded', function() {
  const dropZone = document.getElementById('dropZone');
  const importInput = document.getElementById('importInput');
  const statusDiv = document.getElementById('status');

  function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    statusDiv.className = `status ${isError ? 'error' : 'success'}`;
  }

  // Handle drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Handle file selection
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      showStatus('Please select a JSON file', true);
      return;
    }

    try {
      showStatus('Reading file...');
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.savedSubreddits || !Array.isArray(data.savedSubreddits)) {
        throw new Error('Invalid file format');
      }

      showStatus('Processing import...');

      // Send to background script for processing
      const response = await chrome.runtime.sendMessage({
        action: 'processImport',
        data: data.savedSubreddits
      });

      if (response.success) {
        showStatus('Import successful! You can close this window.');
        setTimeout(() => {
          window.close();
        }, 2000);
      } else {
        throw new Error(response.error || 'Import failed');
      }
    } catch (error) {
      console.error('Import error:', error);
      showStatus('Error: ' + error.message, true);
    }

    // Reset the input
    importInput.value = '';
  }

  // Click anywhere in drop zone to trigger file input
  dropZone.addEventListener('click', () => {
    importInput.click();
  });
}); 