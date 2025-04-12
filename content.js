// Global variables
let pipVideo = null;
let observer = null;
let settings = {
  autoPipEnabled: true,
  siteList: [],
  listType: 'blacklist'
};

// Initialize
function init() {
  // Get settings from storage
  chrome.storage.local.get(['autoPipEnabled', 'siteList', 'listType'], (result) => {
    settings = {
      autoPipEnabled: result.autoPipEnabled !== undefined ? result.autoPipEnabled : true,
      siteList: result.siteList || [],
      listType: result.listType || 'blacklist'
    };
    
    // Check if the current site is allowed/blocked based on settings
    const currentHost = window.location.hostname;
    const isInList = settings.siteList.some(site => 
      currentHost === site || currentHost.endsWith('.' + site)
    );
    
    const shouldRun = 
      (settings.listType === 'blacklist' && !isInList) || 
      (settings.listType === 'whitelist' && isInList);
    
    if (settings.autoPipEnabled && shouldRun) {
      setupVideoObserver();
      handleIframes(); // Also check for videos in iframes
    }
  });
  
  // Listen for changes to settings
  chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) {
      settings[key] = changes[key].newValue;
    }
    
    // Re-evaluate if we should be running
    const currentHost = window.location.hostname;
    const isInList = settings.siteList.some(site => 
      currentHost === site || currentHost.endsWith('.' + site)
    );
    
    const shouldRun = 
      (settings.listType === 'blacklist' && !isInList) || 
      (settings.listType === 'whitelist' && isInList);
    
    if (settings.autoPipEnabled && shouldRun) {
      if (!observer) setupVideoObserver();
    } else {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (pipVideo && document.pictureInPictureElement) {
        document.exitPictureInPicture();
        pipVideo = null;
      }
    }
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggle-pip') {
      togglePictureInPicture();
    }
  });
  
  // Handle page visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// Set up mutation observer to detect video elements
function setupVideoObserver() {
  // First, check if there are already videos on the page
  checkExistingVideos();
  
  // Then, observe for new videos being added
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === 'VIDEO') {
            handleVideoElement(node);
          } else if (node.querySelectorAll) {
            const videos = node.querySelectorAll('video');
            videos.forEach(handleVideoElement);
          }
        }
      }
    }
    
    // Also check iframes periodically, as they might load after the page
    handleIframes();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Check for existing video elements
function checkExistingVideos() {
  const videos = document.querySelectorAll('video');
  
  if (videos.length > 0) {
    // Sort videos by dimensions to find the primary/largest one
    const sortedVideos = Array.from(videos).sort((a, b) => {
      const aArea = a.offsetWidth * a.offsetHeight;
      const bArea = b.offsetWidth * b.offsetHeight;
      return bArea - aArea; // Sort from largest to smallest
    });
    
    // Handle the largest video
    handleVideoElement(sortedVideos[0]);
  }
}

// Handle a video element
function handleVideoElement(video) {
  // Skip tiny videos (likely ads or thumbnails)
  if (video.offsetWidth < 100 || video.offsetHeight < 100) return;
  
  // Skip if another video is already in PiP
  if (document.pictureInPictureElement) return;
  
  // Remove existing listeners if any
  video.removeEventListener('play', onVideoPlay);
  
  // Add event listeners to the video
  video.addEventListener('play', onVideoPlay);
  
  // If the video is already playing, activate PiP
  if (!video.paused && !video.ended && video.currentTime > 0) {
    activatePictureInPicture(video);
  }
  
  // Store reference to this video if it's playing and larger than current reference
  if (!pipVideo || 
      (video.offsetWidth * video.offsetHeight > pipVideo.offsetWidth * pipVideo.offsetHeight)) {
    if (!video.paused && !video.ended && video.currentTime > 0) {
      pipVideo = video;
    }
  }
}

// Function to handle video play event
function onVideoPlay() {
  const video = this;
  
  // Don't activate PiP if the video is already in fullscreen
  if (document.fullscreenElement) return;
  
  // Only activate PiP if the video is actually playing
  if (!video.paused && !video.ended && video.currentTime > 0) {
    activatePictureInPicture(video);
    pipVideo = video;
  }
}

// Activate PiP for a video
async function activatePictureInPicture(video) {
  // Skip if PiP is not supported
  if (!document.pictureInPictureEnabled) return;
  
  // Skip if already in PiP mode
  if (document.pictureInPictureElement === video) return;
  
  try {
    await video.requestPictureInPicture();
    pipVideo = video;
    
    // Add event listener for when PiP is closed
    video.addEventListener('leavepictureinpicture', () => {
      pipVideo = null;
    }, { once: true });
  } catch (error) {
    console.error('Failed to enter Picture-in-Picture mode:', error);
  }
}

// Handle visibility changes (tab switching, etc.)
function handleVisibilityChange() {
  if (document.hidden && pipVideo && !document.pictureInPictureElement) {
    // If tab becomes hidden and we have a designated PiP video that's not in PiP,
    // try to activate PiP
    activatePictureInPicture(pipVideo);
  }
}

// Manual toggle PiP for the primary video
function togglePictureInPicture() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
    pipVideo = null;
  } else {
    const videos = document.querySelectorAll('video');
    if (videos.length > 0) {
      // Sort videos by dimensions to find the primary/largest one
      const sortedVideos = Array.from(videos).sort((a, b) => {
        const aArea = a.offsetWidth * a.offsetHeight;
        const bArea = b.offsetWidth * b.offsetHeight;
        return bArea - aArea; // Sort from largest to smallest
      });
      
      // Activate PiP for the largest video
      activatePictureInPicture(sortedVideos[0]);
    }
  }
}

// Handle cross-domain iframes
function handleIframes() {
  // Get all iframes on the page
  const iframes = document.querySelectorAll('iframe');
  
  // Try to access each iframe's content, if possible
  iframes.forEach(iframe => {
    try {
      // Check if we can access the iframe's content
      const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
      
      // If we can access it, check for videos
      const videos = iframeDocument.querySelectorAll('video');
      videos.forEach(handleVideoElement);
    } catch (error) {
      // CORS restrictions prevent access to iframe content
      // We can't do much here due to security restrictions
    }
  });
}

// Special handling for YouTube
function handleYouTubeSpecifics() {
  // Check if we're on YouTube
  if (window.location.hostname.includes('youtube.com')) {
    // YouTube uses HTML5 video player but sometimes it can be tricky to detect
    // Force check a bit later to ensure the player has fully loaded
    setTimeout(() => {
      const videos = document.querySelectorAll('video');
      if (videos.length > 0) {
        const mainVideo = videos[0]; // Usually the main player is the first video element
        handleVideoElement(mainVideo);
      }
    }, 2000);
  }
}

// Initialize the extension
init();

// Add YouTube-specific handling
handleYouTubeSpecifics();

// Set up a periodic check for videos and PiP status
// This helps catch any videos that were missed by the observer
setInterval(() => {
  if (settings.autoPipEnabled) {
    // Re-check for videos if we don't have one in PiP yet
    if (!document.pictureInPictureElement) {
      checkExistingVideos();
      handleIframes();
    }
    
    // When tab is hidden and we have a video, make sure it's in PiP
    if (document.hidden && pipVideo && !document.pictureInPictureElement) {
      activatePictureInPicture(pipVideo);
    }
  }
}, 5000); 