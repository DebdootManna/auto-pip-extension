// Global variables
let pipVideo = null;
let observer = null;
let lastKnownPlayingVideos = [];
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
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggle-pip') {
      togglePictureInPicture();
      sendResponse({success: true});
    }
    return true;
  });
  
  // Handle page visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Listen for tab blur events - more reliable than visibilitychange on some browsers
  window.addEventListener('blur', () => {
    // Short timeout to make sure the visibility state has changed
    setTimeout(handleVisibilityChange, 100);
  });
  
  // Additional listener for when the tab loses focus
  window.addEventListener('beforeunload', () => {
    // Try to activate PiP before the page unloads
    if (pipVideo && !document.pictureInPictureElement) {
      activatePictureInPicture(pipVideo);
    }
  });
}

// Set up mutation observer to detect video elements
function setupVideoObserver() {
  // First, check if there are already videos on the page
  checkExistingVideos();
  
  // Then, observe for new videos being added
  observer = new MutationObserver((mutations) => {
    let videosFound = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === 'VIDEO') {
            handleVideoElement(node);
            videosFound = true;
          } else if (node.querySelectorAll) {
            const videos = node.querySelectorAll('video');
            if (videos.length > 0) {
              videos.forEach(handleVideoElement);
              videosFound = true;
            }
          }
        }
      }
    }
    
    // If we found new videos, update our tracking
    if (videosFound) {
      updatePlayingVideosList();
    }
    
    // Also check iframes periodically, as they might load after the page
    handleIframes();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true, 
    attributeFilter: ['src', 'style', 'class']
  });
}

// Track all playing videos on the page
function updatePlayingVideosList() {
  const allVideos = document.querySelectorAll('video');
  
  lastKnownPlayingVideos = Array.from(allVideos).filter(video => 
    !video.paused && 
    !video.ended && 
    video.currentTime > 0 &&
    video.readyState > 2 &&
    video.offsetWidth > 100 && 
    video.offsetHeight > 100
  ).sort((a, b) => {
    // Sort by size (largest first)
    return (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight);
  });
  
  // Update our primary video reference if we have playing videos
  if (lastKnownPlayingVideos.length > 0 && 
     (!pipVideo || pipVideo.paused || pipVideo.ended)) {
    pipVideo = lastKnownPlayingVideos[0];
  }
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
    
    // Handle all videos and attach event listeners
    sortedVideos.forEach(handleVideoElement);
    
    // Update our list of playing videos
    updatePlayingVideosList();
  }
}

// Handle a video element
function handleVideoElement(video) {
  // Skip tiny videos (likely ads or thumbnails)
  if (video.offsetWidth < 100 || video.offsetHeight < 100) return;
  
  // Skip if another video is already in PiP
  if (document.pictureInPictureElement) return;
  
  // Remove existing listeners if any to avoid duplicates
  video.removeEventListener('play', onVideoPlay);
  video.removeEventListener('pause', onVideoPause);
  
  // Add event listeners to the video
  video.addEventListener('play', onVideoPlay);
  video.addEventListener('pause', onVideoPause);
  
  // If the video is already playing, update our tracking
  if (!video.paused && !video.ended && video.currentTime > 0) {
    // If this is the largest playing video, make it our primary reference
    if (!pipVideo || 
        (video.offsetWidth * video.offsetHeight > 
         pipVideo.offsetWidth * pipVideo.offsetHeight)) {
      pipVideo = video;
    }
  }
}

// Function to handle video play event
function onVideoPlay() {
  const video = this;
  
  // Don't activate PiP if the video is already in fullscreen
  if (document.fullscreenElement) return;
  
  // Only update our reference if the video is actually playing
  if (!video.paused && !video.ended && video.currentTime > 0) {
    // Update our list of playing videos
    updatePlayingVideosList();
    
    // If we're in a hidden tab, activate PiP
    if (document.hidden) {
      activatePictureInPicture(video);
    }
  }
}

// Function to handle video pause event
function onVideoPause() {
  // Update our list of playing videos
  updatePlayingVideosList();
}

// Activate PiP for a video
async function activatePictureInPicture(video) {
  // Skip if PiP is not supported
  if (!document.pictureInPictureEnabled) return;
  
  // Skip if already in PiP mode
  if (document.pictureInPictureElement === video) return;
  
  // Skip videos that aren't ready
  if (video.readyState < 2) return;
  
  try {
    await video.requestPictureInPicture();
    pipVideo = video;
    
    // Add event listener for when PiP is closed
    video.addEventListener('leavepictureinpicture', () => {
      // Only look for another video if document is still hidden
      if (document.hidden && lastKnownPlayingVideos.length > 0) {
        // Find the next best video that isn't this one
        const nextVideo = lastKnownPlayingVideos.find(v => v !== video);
        if (nextVideo) {
          activatePictureInPicture(nextVideo);
        }
      }
    }, { once: true });
  } catch (error) {
    console.error('Failed to enter Picture-in-Picture mode:', error);
  }
}

// Handle visibility changes (tab switching, etc.)
function handleVisibilityChange() {
  // When tab becomes hidden
  if (document.hidden) {
    // Update our list of playing videos first
    updatePlayingVideosList();
    
    // If we have a primary video or any playing videos
    if (pipVideo && !pipVideo.paused && !pipVideo.ended) {
      // Try to activate PiP
      activatePictureInPicture(pipVideo);
    } else if (lastKnownPlayingVideos.length > 0) {
      // If our primary reference isn't playing, use the first playing video
      activatePictureInPicture(lastKnownPlayingVideos[0]);
    }
  } 
  // When tab becomes visible again and there's a PiP video
  else if (document.pictureInPictureElement) {
    // Exit PiP mode when returning to the original tab
    document.exitPictureInPicture()
      .catch(error => console.log('Error exiting PiP:', error));
  }
}

// Manual toggle PiP for the primary video
function togglePictureInPicture() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
    pipVideo = null;
  } else {
    // Update our list of videos first
    updatePlayingVideosList();
    
    if (lastKnownPlayingVideos.length > 0) {
      // Use the first playing video
      activatePictureInPicture(lastKnownPlayingVideos[0]);
    } else {
      // If no playing videos, check for any videos
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
      
      // Update our tracking after handling iframe videos
      if (videos.length > 0) {
        updatePlayingVideosList();
      }
    } catch (error) {
      // CORS restrictions prevent access to iframe content
      // We can't do much here due to security restrictions
    }
  });
}

// Special handling for YouTube and other sites
function handleSpecificSites() {
  // YouTube specific handling
  if (window.location.hostname.includes('youtube.com')) {
    // YouTube sometimes loads videos dynamically or replaces them
    // Set up a more aggressive check for the main player
    const checkYouTubePlayer = () => {
      const videos = document.querySelectorAll('video');
      videos.forEach(handleVideoElement);
      updatePlayingVideosList();
    };
    
    // Check more frequently for the first minute
    const checkInterval = setInterval(checkYouTubePlayer, 1000);
    setTimeout(() => clearInterval(checkInterval), 60000);
    
    // Also check when player controls are used
    document.addEventListener('click', (e) => {
      // Wait a bit for the video state to update after clicking controls
      setTimeout(updatePlayingVideosList, 500);
    });
  }
}

// Create a heartbeat to ensure PiP stays active when tab is hidden
function startPipHeartbeat() {
  // Regularly check if we should be in PiP mode when the tab is hidden
  setInterval(() => {
    if (document.hidden && settings.autoPipEnabled) {
      // Update our tracking
      updatePlayingVideosList();
      
      // If we have playing videos but none are in PiP, activate for the primary one
      if (lastKnownPlayingVideos.length > 0 && !document.pictureInPictureElement) {
        activatePictureInPicture(lastKnownPlayingVideos[0]);
      }
    }
  }, 1000); // Check every second
}

// Initialize the extension
init();

// Run site-specific handling
handleSpecificSites();

// Start the PiP heartbeat
startPipHeartbeat();

// Set up a periodic check for videos and PiP status
// This helps catch any videos that were missed by the observer
setInterval(() => {
  if (settings.autoPipEnabled) {
    // Re-check for videos if we don't have one in PiP yet
    if (!document.pictureInPictureElement) {
      checkExistingVideos();
      handleIframes();
    }
  }
}, 3000); 