/**
 * content.js — Content script injected into ChatGPT pages.
 *
 * Responsibilities:
 * 1. Inject inject.js into the page context (to intercept fetch)
 * 2. Listen for captured audio data via window.postMessage
 * 3. Inject download buttons into the ChatGPT UI next to Read Aloud controls
 * 4. Handle download triggers (send to background service worker)
 */

(function () {
  'use strict';

  // ── State ──
  let audioQueue = []; // Stores captured audio clips
  let lastAudioTimestamp = 0;

  // ── 1. Inject the fetch interceptor into page context ──
  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  injectPageScript();

  // ── 2. Listen for audio data from inject.js ──
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'CHATGPT_VOICE_DL_AUDIO') return;

    const { payload } = event.data;
    console.log(`[VoiceDL Content] Received audio: ${(payload.size / 1024).toFixed(1)}KB`);

    audioQueue.push(payload);
    lastAudioTimestamp = payload.timestamp;

    // Update any existing download buttons to show audio is available
    updateDownloadButtons();
  });

  // ── 3. Inject download buttons into ChatGPT UI ──

  // CSS for our injected elements
  const STYLES = `
    .voice-dl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 4px 8px;
      border: none;
      border-radius: 6px;
      background: #39ff14;
      color: #000;
      font-size: 12px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      transition: all 0.2s ease;
      line-height: 1;
      white-space: nowrap;
      opacity: 0;
      transform: scale(0.9);
      animation: voiceDLFadeIn 0.3s ease forwards;
    }

    .voice-dl-btn:hover {
      background: #32e612;
      box-shadow: 0 0 12px rgba(57, 255, 20, 0.3);
      transform: scale(1.02);
    }

    .voice-dl-btn:active {
      transform: scale(0.97);
    }

    .voice-dl-btn svg {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
    }

    .voice-dl-btn.downloading {
      background: #1a7a0a;
      cursor: wait;
      pointer-events: none;
    }

    .voice-dl-btn.success {
      background: #39ff14;
    }

    .voice-dl-btn.no-audio {
      background: #333;
      color: #888;
      cursor: default;
    }

    @keyframes voiceDLFadeIn {
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .voice-dl-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #111;
      color: #e8e8e8;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      padding: 12px 18px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      animation: voiceDLToastIn 0.3s ease, voiceDLToastOut 0.3s ease 2.7s forwards;
    }

    .voice-dl-toast .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #39ff14;
      flex-shrink: 0;
    }

    @keyframes voiceDLToastIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes voiceDLToastOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(10px); }
    }
  `;

  function injectStyles() {
    if (document.getElementById('voice-dl-styles')) return;
    const style = document.createElement('style');
    style.id = 'voice-dl-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // SVG icons
  const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const SPINNER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" style="animation: spin 1s linear infinite; transform-origin: center;"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></path></svg>`;

  function createDownloadButton() {
    const btn = document.createElement('button');
    btn.className = 'voice-dl-btn';
    btn.title = 'Download Read Aloud audio';
    btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
    btn.setAttribute('data-voice-dl', 'true');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDownload(btn);
    });

    return btn;
  }

  function showToast(message) {
    // Remove existing toasts
    document.querySelectorAll('.voice-dl-toast').forEach((t) => t.remove());

    const toast = document.createElement('div');
    toast.className = 'voice-dl-toast';
    toast.innerHTML = `<span class="dot"></span>${message}`;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  async function handleDownload(btn) {
    if (audioQueue.length === 0) {
      showToast('No audio captured yet. Click "Read Aloud" first, then download.');
      return;
    }

    // Get the most recent audio clip
    const audio = audioQueue[audioQueue.length - 1];

    // Update button state
    btn.className = 'voice-dl-btn downloading';
    btn.innerHTML = `${SPINNER_ICON}<span>Saving...</span>`;

    try {
      // Convert base64 back to binary
      const binaryStr = atob(audio.audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Create blob and trigger download
      const blob = new Blob([bytes], { type: audio.contentType });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date(audio.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `chatgpt-voice-${timestamp}.${audio.ext}`;

      // Use chrome.runtime to send download request to background
      chrome.runtime.sendMessage(
        {
          action: 'download',
          url,
          filename,
        },
        (response) => {
          if (response?.success) {
            btn.className = 'voice-dl-btn success';
            btn.innerHTML = `${CHECK_ICON}<span>Saved!</span>`;
            showToast(`Audio saved: ${filename}`);
          } else {
            // Fallback: direct download via anchor element
            downloadViaAnchor(url, filename);
            btn.className = 'voice-dl-btn success';
            btn.innerHTML = `${CHECK_ICON}<span>Saved!</span>`;
            showToast(`Audio saved: ${filename}`);
          }

          // Reset button after delay
          setTimeout(() => {
            btn.className = 'voice-dl-btn';
            btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
          }, 2500);
        }
      );
    } catch (err) {
      console.error('[VoiceDL] Download error:', err);
      btn.className = 'voice-dl-btn';
      btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
      showToast('Download failed. Please try again.');
    }
  }

  function downloadViaAnchor(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function updateDownloadButtons() {
    document.querySelectorAll('.voice-dl-btn.no-audio').forEach((btn) => {
      btn.className = 'voice-dl-btn';
      btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
    });
  }

  // ── 4. Observer: Watch for ChatGPT message action bars and inject buttons ──

  // ChatGPT renders action buttons (copy, read aloud, thumbs up/down) in a
  // container below each assistant message. We look for these containers and
  // inject our download button.

  function findAndInjectButtons() {
    // ChatGPT's Read Aloud button typically has aria-label or data attributes
    // We look for the button groups at the bottom of assistant messages
    const messageActions = document.querySelectorAll(
      // ChatGPT uses various selectors — we target the action button groups
      '[data-testid="conversation-turn-"] .flex.items-center, ' +
      'article .flex.items-center.gap-1, ' +
      '[data-message-author-role="assistant"] .flex.items-center'
    );

    messageActions.forEach((actionBar) => {
      // Skip if we already injected here
      if (actionBar.querySelector('[data-voice-dl]')) return;

      // Check if this looks like a message action bar (has buttons inside)
      const buttons = actionBar.querySelectorAll('button');
      if (buttons.length < 2) return;

      // Look for the Read Aloud button specifically
      const hasReadAloud = Array.from(buttons).some((btn) => {
        const label = btn.getAttribute('aria-label') || btn.textContent || '';
        const svgContent = btn.innerHTML || '';
        return (
          label.toLowerCase().includes('read aloud') ||
          label.toLowerCase().includes('listen') ||
          // Read aloud icon usually contains a speaker/volume SVG path
          svgContent.includes('M11 5L6 9H2v6h4l5 4V5') ||
          svgContent.includes('volume') ||
          svgContent.includes('speaker')
        );
      });

      // Only inject if we found what looks like a real message action bar
      // (has copy button or read aloud button)
      const hasCopy = Array.from(buttons).some((btn) => {
        const label = btn.getAttribute('aria-label') || '';
        return label.toLowerCase().includes('copy');
      });

      if (hasReadAloud || hasCopy) {
        const downloadBtn = createDownloadButton();
        actionBar.appendChild(downloadBtn);
      }
    });
  }

  // Run on initial load and on DOM changes
  function startObserver() {
    injectStyles();
    findAndInjectButtons();

    const observer = new MutationObserver(() => {
      findAndInjectButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Wait for the page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  console.log('[VoiceDL Content] Content script loaded');
})();
