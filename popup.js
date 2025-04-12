document.addEventListener('DOMContentLoaded', () => {
  const autoPipToggle = document.getElementById('autoPipToggle');
  const listTypeSelect = document.getElementById('listType');
  const siteInput = document.getElementById('siteInput');
  const addSiteButton = document.getElementById('addSite');
  const siteListContainer = document.getElementById('siteListContainer');
  
  // Load saved settings
  chrome.storage.local.get(['autoPipEnabled', 'siteList', 'listType'], (result) => {
    autoPipToggle.checked = result.autoPipEnabled !== false;
    
    if (result.listType) {
      listTypeSelect.value = result.listType;
    }
    
    if (result.siteList && result.siteList.length > 0) {
      displaySiteList(result.siteList);
    }
  });
  
  // Toggle auto PiP
  autoPipToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoPipEnabled: autoPipToggle.checked });
  });
  
  // Change list type
  listTypeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ listType: listTypeSelect.value });
  });
  
  // Add site to list
  addSiteButton.addEventListener('click', addSite);
  siteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSite();
    }
  });
  
  function addSite() {
    const site = siteInput.value.trim().toLowerCase();
    
    // Simple validation
    if (!site) return;
    
    // Extract domain from URL if full URL was entered
    let domain = site;
    try {
      if (site.includes('://')) {
        domain = new URL(site).hostname;
      } else if (site.includes('/')) {
        domain = site.split('/')[0];
      }
    } catch (e) {
      domain = site;
    }
    
    // Remove www. prefix if present
    if (domain.startsWith('www.')) {
      domain = domain.slice(4);
    }
    
    chrome.storage.local.get(['siteList'], (result) => {
      const siteList = result.siteList || [];
      
      // Check if site is already in the list
      if (siteList.includes(domain)) {
        siteInput.value = '';
        return;
      }
      
      // Add site to list
      siteList.push(domain);
      chrome.storage.local.set({ siteList });
      
      // Update display
      displaySiteList(siteList);
      siteInput.value = '';
    });
  }
  
  function displaySiteList(siteList) {
    siteListContainer.innerHTML = '';
    
    siteList.forEach(site => {
      const siteItem = document.createElement('div');
      siteItem.className = 'site-item';
      
      const siteName = document.createElement('span');
      siteName.textContent = site;
      
      const removeButton = document.createElement('button');
      removeButton.textContent = '×';
      removeButton.title = 'Remove';
      removeButton.addEventListener('click', () => removeSite(site));
      
      siteItem.appendChild(siteName);
      siteItem.appendChild(removeButton);
      siteListContainer.appendChild(siteItem);
    });
  }
  
  function removeSite(site) {
    chrome.storage.local.get(['siteList'], (result) => {
      const siteList = result.siteList || [];
      const updatedList = siteList.filter(s => s !== site);
      
      chrome.storage.local.set({ siteList: updatedList });
      displaySiteList(updatedList);
    });
  }
}); 