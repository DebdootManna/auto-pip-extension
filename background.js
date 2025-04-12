// Initialize default settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    autoPipEnabled: true,
    siteList: [],
    listType: 'blacklist' // 'blacklist' or 'whitelist'
  });
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-pip') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      // Make sure we have tabs
      if (tabs && tabs.length > 0) {
        // Check if tab is valid
        try {
          // Wrap in try-catch to handle any errors
          chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle-pip' }, (response) => {
            // Handle any last error silently
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              console.log('Could not send message to tab:', lastError.message);
            }
          });
        } catch (error) {
          console.log('Error sending message:', error);
        }
      }
    });
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.local.get(['autoPipEnabled', 'siteList', 'listType'], (result) => {
      sendResponse(result);
    });
    return true; // Keep the messaging channel open for async response
  }
  
  // Always return false for non-async callbacks
  return false;
});

// Listen for tab updates and make sure we have content scripts running
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only inject when the tab has completed loading
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    // Check if we should run on this site
    chrome.storage.local.get(['autoPipEnabled', 'siteList', 'listType'], (result) => {
      const currentHost = new URL(tab.url).hostname;
      const isInList = result.siteList && result.siteList.some(site => 
        currentHost === site || currentHost.endsWith('.' + site)
      );
      
      const shouldRun = 
        (result.listType === 'blacklist' && !isInList) || 
        (result.listType === 'whitelist' && isInList);
      
      if (result.autoPipEnabled && shouldRun) {
        // Ensure content script is running
        chrome.scripting.executeScript({
          target: {tabId: tabId},
          files: ['content.js']
        }).catch(err => {
          // Ignore errors if script is already injected
          console.log('Script injection error (might be already injected):', err);
        });
      }
    });
  }
}); 