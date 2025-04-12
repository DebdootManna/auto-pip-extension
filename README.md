# Auto Picture-in-Picture Chrome Extension

A Chrome extension that automatically enables Picture-in-Picture (PiP) mode for videos when you navigate away from the tab, similar to behavior found in browsers like Opera and Arc.

## Features

- **Automatic PiP Activation**: Videos automatically enter PiP mode when you switch tabs or windows
- **Intelligent Video Detection**: Identifies and prioritizes the main/largest video on the page
- **Smart PiP Behavior**: Automatically closes PiP when you return to the original tab
- **Site Filtering**: Customizable blacklist/whitelist for controlling where PiP activates
- **Keyboard Shortcut**: Toggle PiP manually with Alt+P (Option+P on Mac)
- **Cross-Site Support**: Works across most websites including YouTube, Netflix, Twitch, and more
- **Cross-Origin Handling**: Attempts to handle embedded videos when permitted by CORS policies

## Installation

### From Chrome Web Store (Recommended)
1. Visit the extension page on the Chrome Web Store (link will be added once published)
2. Click "Add to Chrome"
3. Confirm the installation when prompted

### Manual Installation (Developer Mode)
1. Download or clone this repository to your local machine
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the `auto-pip-extension` folder
5. The extension should now appear in your extensions list and toolbar

## Usage

### Automatic Mode
1. Play any video on a website
2. Switch to another tab or application
3. The video will automatically pop out in Picture-in-Picture mode
4. Return to the original tab to automatically exit PiP mode

### Manual Toggle
- Press **Alt+P** (Option+P on Mac) to toggle PiP mode for the current video
- Click the extension icon and use the toggle switch in the popup

## Settings

Click the extension icon to access settings:

- **Auto PiP**: Enable/disable automatic PiP activation
- **Blacklist/Whitelist**: Choose between blacklist mode (PiP works everywhere except listed sites) or whitelist mode (PiP only works on listed sites)
- **Site List**: Add or remove domains from your blacklist/whitelist

## How It Works

This extension uses the following web APIs and techniques:

- **Picture-in-Picture API**: Uses the standard `requestPictureInPicture()` method on HTML5 video elements
- **Mutation Observer**: Monitors the DOM for new video elements being added
- **Visibility API**: Detects when tabs become hidden or visible
- **Chrome Extension APIs**: Uses storage, messaging, and content scripts to manage extension state

## Browser Compatibility

- Chrome 69 or newer (Picture-in-Picture API requirement)
- Works on Windows, macOS, and Linux
- Also compatible with Chromium-based browsers like Edge, Brave, and Vivaldi

## Known Limitations

- Cannot access videos inside cross-origin iframes due to browser security restrictions
- Some DRM-protected content may not work with Picture-in-Picture mode
- YouTube's Theater and Fullscreen modes may interfere with automatic PiP activation
- Videos shorter than 100x100 pixels are ignored to avoid PiP for thumbnails/previews

## Privacy

This extension:
- Does not collect any user data
- Does not send any information to remote servers
- Only accesses video elements on the pages you visit
- All settings are stored locally in your browser

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 