# ChatGPT Voice Downloader

A Chrome extension that automatically downloads ChatGPT's **Read Aloud** audio. Click Read Aloud like you normally would — the audio file appears in your downloads folder. No extra buttons, no UI changes, no configuration.

**[Download the extension](https://github.com/jaxjixmix/chatgpt-voice-downloader-extension/releases/latest/download/chatgpt-voice-downloader.zip)** · **[Releases](https://github.com/jaxjixmix/chatgpt-voice-downloader-extension/releases)**

---

## How it works

1. You click **Read Aloud** on any ChatGPT response
2. The extension intercepts the TTS fetch request in the background
3. The audio file (AAC) auto-downloads to your machine

That's it. No popup, no extra buttons injected into ChatGPT, no sign-up.

## Install the extension

### From the latest release

1. Go to [Releases](https://github.com/jaxjixmix/chatgpt-voice-downloader-extension/releases/latest)
2. Download `chatgpt-voice-downloader.zip`
3. Unzip it
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** and select the unzipped folder

### From source

```bash
git clone https://github.com/jaxjixmix/chatgpt-voice-downloader-extension.git
cd chatgpt-voice-downloader-extension
```

Then load `extension/` as an unpacked extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory

## Run the landing page locally

The landing page is a single `index.html` file. No framework, no build step.

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node
npx serve .

# Option 3: just open the file
open index.html
```

Then visit `http://localhost:8000`.

## Build

```bash
bash build.sh
```

This creates a `dist/` folder containing:
- `chatgpt-voice-downloader.zip` — for users to load unpacked in Chrome
- `chatgpt-voice-downloader-cws.zip` — for Chrome Web Store upload

GitHub Actions runs `build.sh` on every push to `main`. On version tags (`v*`), the release workflow attaches both zips to a GitHub release.

## Architecture

```
├── index.html           # Marketing landing page (download links point to GitHub release)
├── build.sh             # Zips extension/ into dist/ (user zip + CWS zip)
└── extension/
    ├── manifest.json    # Manifest V3 — scoped to chatgpt.com, downloads permission
    ├── inject.js        # Runs in PAGE context — intercepts fetch(/backend-api/synthesize)
    ├── content.js       # Content script — receives audio from inject.js, triggers download
    ├── background.js    # Service worker — calls chrome.downloads.download() with base64 data
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

### Data flow

```
ChatGPT page
  │
  ├─ User clicks "Read Aloud"
  │
  ├─ ChatGPT calls fetch("/backend-api/synthesize?message_id=...&format=aac")
  │
  ├─ inject.js (page context)
  │    ├─ Intercepts the fetch via monkey-patched window.fetch
  │    ├─ Clones the response, reads the stream via ReadableStream reader
  │    ├─ Converts audio bytes to base64
  │    └─ Posts CHATGPT_VOICE_DL_AUDIO message to window
  │
  ├─ content.js (content script, isolated world)
  │    ├─ Receives the postMessage
  │    ├─ Sends base64 + filename to background.js via chrome.runtime.sendMessage
  │    └─ Shows a toast notification ("Saved 42KB: chatgpt-voice-2026-03-17.aac")
  │
  └─ background.js (service worker)
       ├─ Receives base64 audio data
       ├─ Creates a data URL (data:audio/aac;base64,...)
       └─ Calls chrome.downloads.download() → file saved to disk
```

### Why inject.js runs in page context

Chrome content scripts run in an **isolated world** — they can't see the page's `window.fetch`. To intercept ChatGPT's TTS requests, `inject.js` is injected as a `<script>` tag from `content.js`, so it shares the page's JavaScript context and can monkey-patch `fetch`.

### Why base64 instead of blob URLs

In Manifest V3, blob URLs created in a content script aren't accessible from the service worker. So the audio bytes are base64-encoded and sent via `chrome.runtime.sendMessage` to the background, which constructs a data URL for `chrome.downloads.download()`.

## Extending

### Change the audio format

ChatGPT's synthesize endpoint accepts a `format` query param. The extension reads this to determine the file extension. If ChatGPT changes the default format or you want to force a different one, modify the `ext` logic in `inject.js:57-61`.

### Add a popup or options page

The extension currently has no popup. To add one:

1. Create `extension/popup.html` and `extension/popup.js`
2. Add to `manifest.json`:
   ```json
   "action": {
     "default_popup": "popup.html",
     "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png" }
   }
   ```
3. Use `chrome.storage.local` to persist settings and read them in `content.js`

### Add a toggle to enable/disable auto-download

1. Store a flag in `chrome.storage.local` (e.g. `{ enabled: true }`)
2. In `content.js`, check the flag before calling `triggerDownload()`
3. Expose the toggle via a popup or by clicking the extension icon

### Support other sites

The extension is scoped to `chatgpt.com` via `manifest.json` host permissions and content script matches. To support another site:

1. Add the site's URL pattern to `host_permissions` and `content_scripts.matches` in `manifest.json`
2. Update `inject.js` to detect that site's TTS endpoint (the `/backend-api/synthesize` check)
3. Update `web_accessible_resources` matches

### Modify the toast notification

Toast styles are in `content.js:98-127`. The `showToast()` function at line 137 handles display and auto-dismiss (3.5s). Change the timing, styling, or position there.

### Customize the filename

The filename pattern is in `content.js:47-51`. Currently it generates `chatgpt-voice-YYYY-MM-DDTHH-MM-SS.{ext}`. Modify the `triggerDownload()` function to change the naming convention — you have access to `audio.messageId` if you want to include the message ID.

## Tech details

- **Manifest V3** — Chrome's current extension platform
- **No dependencies** — pure vanilla JS, no bundler, no npm
- **Permissions**: `downloads` (to save files) + host access to `chatgpt.com`
- **Audio format**: AAC by default (determined by ChatGPT's `format` query param)
- **Landing page**: Single HTML file, no framework — Outfit + JetBrains Mono fonts, dark theme

## License

MIT
