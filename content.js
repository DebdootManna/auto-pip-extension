// Check if the script has already been injected
if (typeof window.autoPipExtensionLoaded === 'undefined') {
  // Mark script as loaded
  window.autoPipExtensionLoaded = true;
  
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

  // Special handling for YouTube
  function handleYouTubeSpecifics() {
    if (window.location.hostname.includes('youtube.com')) {
      console.log('YouTube specific handling activated');
      
      // YouTube uses a special player - we need more specific handling
      const youtubeHandler = {
        getMainVideo: () => {
          // YouTube's main video is usually inside the .html5-video-player container
          const player = document.querySelector('.html5-video-player');
          return player ? player.querySelector('video') : null;
        },
        
        setupPipObserver: () => {
          // Watch for YouTube's own state changes
          const videoContainer = document.querySelector('#movie_player');
          if (videoContainer) {
            const ytObserver = new MutationObserver(() => {
              updatePlayingVideosList();
            });
            
            ytObserver.observe(videoContainer, {
              attributes: true,
              childList: false,
              subtree: false
            });
          }
        },
        
        // Special PiP activation for YouTube
        activateYouTubePip: async () => {
          const video = youtubeHandler.getMainVideo();
          if (!video) return false;
          
          try {
            // For YouTube, we need to make sure video is properly loaded
            if (video.readyState < 2) {
              await new Promise(resolve => {
                setTimeout(resolve, 1000);  // Wait longer for YouTube videos
              });
            }
            
            if (document.pictureInPictureElement !== video && 
                video.readyState >= 2 && 
                video.videoWidth > 0) {
              await video.requestPictureInPicture();
              pipVideo = video;
              return true;
            }
          } catch (e) {
            console.log('YouTube PiP attempt failed, will retry:', e);
            return false;
          }
          return false;
        }
      };
      
      // Set up special YouTube handling
      youtubeHandler.setupPipObserver();
      
      // Override visibility handler for YouTube
      const originalVisibilityHandler = handleVisibilityChange;
      handleVisibilityChange = async () => {
        if (document.hidden) {
          // Try YouTube-specific method first
          let success = await youtubeHandler.activateYouTubePip();
          
          // If YouTube-specific method failed, use regular method
          if (!success) {
            // Use a retry mechanism with exponential backoff
            let retries = 0;
            const maxRetries = 3;
            
            const attemptPip = async () => {
              if (retries >= maxRetries || document.pictureInPictureElement) return;
              
              const video = youtubeHandler.getMainVideo();
              if (video && !video.paused && video.readyState >= 2) {
                try {
                  await video.requestPictureInPicture();
                  pipVideo = video;
                } catch (e) {
                  console.log(`Retry ${retries + 1}/${maxRetries} failed:`, e);
                  retries++;
                  // Exponential backoff
                  setTimeout(attemptPip, 500 * Math.pow(2, retries));
                }
              }
            };
            
            attemptPip();
          }
        } else if (document.pictureInPictureElement) {
          // Exit PiP mode when returning to the YouTube tab
          document.exitPictureInPicture()
            .catch(error => console.log('Error exiting PiP:', error));
        }
      };
      
      // More frequent checks for YouTube
      setInterval(() => {
        if (settings.autoPipEnabled && document.hidden && !document.pictureInPictureElement) {
          youtubeHandler.activateYouTubePip();
        }
      }, 2000);
    }
  }

  // Modify the activatePictureInPicture function for better YouTube support
  async function activatePictureInPicture(video) {
    // Skip if PiP is not supported
    if (!document.pictureInPictureEnabled) return;
    
    // Skip if already in PiP mode
    if (document.pictureInPictureElement === video) return;
    
    // Special case for YouTube
    const isYouTube = window.location.hostname.includes('youtube.com');
    
    try {
      // Ensure video is ready and has valid content
      if (!video || 
          video.readyState < 2 || 
          video.videoWidth === 0 || 
          video.videoHeight === 0 ||
          video.disablePictureInPicture === true) {
        
        // For YouTube, wait longer and retry
        if (isYouTube) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (video && video.readyState >= 1) {
            // Continue with the attempt, even if not fully ready
          } else {
            console.log('Video not ready for PiP yet');
            return;
          }
        } else {
          console.log('Video not ready for PiP yet');
          return;
        }
      }
      
      // For YouTube, make a more deliberate attempt
      if (isYouTube) {
        // Make sure we have a clean state
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        }
        
        // Try the request
        await video.requestPictureInPicture();
        pipVideo = video;
      } else {
        // Regular flow for non-YouTube sites
        // Try to enter PiP mode
        await video.requestPictureInPicture();
        pipVideo = video;
      }
      
      // Add event listener for when PiP is closed
      video.addEventListener('leavepictureinpicture', () => {
        // Only look for another video if document is still hidden
        if (document.hidden && lastKnownPlayingVideos.length > 0) {
          // Find the next best video that isn't this one
          const nextVideo = lastKnownPlayingVideos.find(v => 
            v !== video && 
            v.readyState >= 2 && 
            v.videoWidth > 0 && 
            v.videoHeight > 0
          );
          
          if (nextVideo) {
            // Use a slight delay to avoid rapid PiP switching
            setTimeout(() => {
              activatePictureInPicture(nextVideo);
            }, 300);
          }
        }
      }, { once: true });
    } catch (error) {
      console.error('Failed to enter Picture-in-Picture mode:', error);
      
      // If this video failed, try the next one if we're in a hidden tab
      if (document.hidden && lastKnownPlayingVideos.length > 0) {
        const nextVideo = lastKnownPlayingVideos.find(v => 
          v !== video && 
          v.readyState >= 2 && 
          v.videoWidth > 0 && 
          v.videoHeight > 0
        );
        
        if (nextVideo) {
          // Use a longer delay before trying the next video on YouTube
          const delay = isYouTube ? 1000 : 300;
          setTimeout(() => {
            activatePictureInPicture(nextVideo);
          }, delay);
        }
      }
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

  // Run YouTube-specific handling
  handleYouTubeSpecifics();
} 