/**
 * content.js — Content script injected into ChatGPT pages.
 *
 * Responsibilities:
 * 1. Inject inject.js into the page context ASAP (to intercept fetch before ChatGPT loads)
 * 2. Listen for captured audio data via window.postMessage
 * 3. Inject download buttons into the ChatGPT UI
 * 4. Handle download triggers
 */

(function () {
  'use strict';

  // ── State ──
  let audioQueue = [];
  let ttsActive = false;

  // ── 1. Inject the fetch interceptor into page context IMMEDIATELY ──
  // Using inline script for fastest possible injection (before any other JS runs)
  function injectPageScript() {
    // Method 1: Inline script element (fastest, runs synchronously)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    // Inject into <html> element which exists even at document_start
    (document.head || document.documentElement).appendChild(script);
  }

  injectPageScript();

  // ── 2. Listen for audio data from inject.js ──
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'CHATGPT_VOICE_DL_TTS_START') {
      console.log('[VoiceDL Content] TTS started');
      ttsActive = true;
      updateAllButtons('recording');
      return;
    }

    if (event.data?.type !== 'CHATGPT_VOICE_DL_AUDIO') return;

    const { payload } = event.data;
    console.log(`[VoiceDL Content] Received audio: ${(payload.size / 1024).toFixed(1)}KB, format=${payload.ext}`);

    audioQueue.push(payload);
    ttsActive = false;
    updateAllButtons('ready');
    showToast(`Audio captured! ${(payload.size / 1024).toFixed(1)}KB — click Save to download`);
  });

  // ── 3. Styles ──
  const STYLES = `
    .voice-dl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 2px 8px;
      margin-left: 2px;
      border: none;
      border-radius: 6px;
      background: #39ff14;
      color: #000;
      font-size: 11px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      transition: all 0.2s ease;
      line-height: 1.4;
      white-space: nowrap;
      height: 30px;
      vertical-align: middle;
    }

    .voice-dl-btn:hover {
      background: #2de010;
      box-shadow: 0 0 12px rgba(57, 255, 20, 0.4);
    }

    .voice-dl-btn:active {
      transform: scale(0.95);
    }

    .voice-dl-btn svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .voice-dl-btn.recording {
      background: #ff6b35;
      color: #fff;
      animation: voiceDLPulse 1s ease-in-out infinite;
    }

    .voice-dl-btn.downloading {
      background: #1a7a0a;
      color: #fff;
      cursor: wait;
      pointer-events: none;
    }

    .voice-dl-btn.success {
      background: #39ff14;
      color: #000;
    }

    @keyframes voiceDLPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .voice-dl-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1a1a1a;
      color: #e8e8e8;
      border: 1px solid #333;
      border-radius: 10px;
      padding: 12px 18px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      animation: voiceDLSlideIn 0.3s ease;
    }

    .voice-dl-toast .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #39ff14;
      flex-shrink: 0;
    }

    @keyframes voiceDLSlideIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  function injectStyles() {
    if (document.getElementById('voice-dl-styles')) return;
    const style = document.createElement('style');
    style.id = 'voice-dl-styles';
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── SVG Icons ──
  const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const MIC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;

  // ── Button creation ──
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
    document.querySelectorAll('.voice-dl-toast').forEach((t) => t.remove());
    const toast = document.createElement('div');
    toast.className = 'voice-dl-toast';
    toast.innerHTML = `<span class="dot"></span>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
  }

  function updateAllButtons(state) {
    document.querySelectorAll('[data-voice-dl]').forEach((btn) => {
      if (state === 'recording') {
        btn.className = 'voice-dl-btn recording';
        btn.innerHTML = `${MIC_ICON}<span>Capturing...</span>`;
      } else if (state === 'ready') {
        btn.className = 'voice-dl-btn';
        btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
      }
    });
  }

  async function handleDownload(btn) {
    if (audioQueue.length === 0) {
      showToast('No audio captured yet — click "Read Aloud" on a message first.');
      return;
    }

    const audio = audioQueue[audioQueue.length - 1];

    btn.className = 'voice-dl-btn downloading';
    btn.innerHTML = `${DOWNLOAD_ICON}<span>Saving...</span>`;

    try {
      const binaryStr = atob(audio.audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: audio.contentType });
      const blobUrl = URL.createObjectURL(blob);

      const timestamp = new Date(audio.timestamp)
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const filename = `chatgpt-voice-${timestamp}.${audio.ext}`;

      // Try chrome.downloads API via background worker
      try {
        chrome.runtime.sendMessage(
          { action: 'download', url: blobUrl, filename },
          (response) => {
            if (chrome.runtime.lastError || !response?.success) {
              // Fallback: anchor-based download
              downloadViaAnchor(blobUrl, filename);
            }
            onDownloadSuccess(btn, filename);
          }
        );
      } catch (e) {
        // Extension context might be invalid — use anchor fallback
        downloadViaAnchor(blobUrl, filename);
        onDownloadSuccess(btn, filename);
      }
    } catch (err) {
      console.error('[VoiceDL] Download error:', err);
      btn.className = 'voice-dl-btn';
      btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
      showToast('Download failed — try again.');
    }
  }

  function onDownloadSuccess(btn, filename) {
    btn.className = 'voice-dl-btn success';
    btn.innerHTML = `${CHECK_ICON}<span>Saved!</span>`;
    showToast(`Saved: ${filename}`);
    setTimeout(() => {
      btn.className = 'voice-dl-btn';
      btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
    }, 2500);
  }

  function downloadViaAnchor(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── 4. DOM Injection — Find action bars and add our button ──
  //
  // Strategy: Instead of relying on brittle selectors, we find ALL buttons on
  // the page that look like ChatGPT's "Read Aloud" button (by scanning SVG
  // content or aria-labels), then inject our button into the same parent container.
  //
  // ChatGPT's action buttons (Copy, Read Aloud, Like, Dislike) are grouped in
  // a parent container. We find that container and append our button.

  function isReadAloudButton(el) {
    if (el.tagName !== 'BUTTON') return false;
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('read aloud') || ariaLabel === 'listen') return true;

    // Check for the speaker/volume SVG icon paths used by ChatGPT
    const html = el.innerHTML;
    if (
      html.includes('M11 5L6 9H2v6h4l5 4') ||   // Volume/speaker icon path
      html.includes('polygon') && html.includes('11') && html.includes('5') && html.includes('19') ||
      html.includes('M11 4.702') ||                // Newer ChatGPT speaker icon
      html.includes('audio') ||
      html.includes('sound') ||
      html.includes('speaker') ||
      html.includes('volume')
    ) {
      return true;
    }

    return false;
  }

  function isCopyButton(el) {
    if (el.tagName !== 'BUTTON') return false;
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('copy')) return true;

    // ChatGPT copy icon usually has two overlapping rectangles
    const html = el.innerHTML;
    if (html.includes('M7 5') && html.includes('M14 7')) return true;
    if (html.includes('clipboard') || html.includes('copy')) return true;

    return false;
  }

  function findActionBars() {
    const actionBars = new Set();

    // Strategy: Find all buttons on the page, check if they're Read Aloud or Copy,
    // then identify their parent action bar container
    const allButtons = document.querySelectorAll('button');

    for (const btn of allButtons) {
      if (isReadAloudButton(btn) || isCopyButton(btn)) {
        // Walk up to find the action bar container
        // The container is the nearest ancestor that contains multiple buttons
        let container = btn.parentElement;
        while (container && container !== document.body) {
          const siblingButtons = container.querySelectorAll(':scope > button, :scope > span > button, :scope > div > button');
          if (siblingButtons.length >= 2) {
            actionBars.add(container);
            break;
          }
          container = container.parentElement;
        }
      }
    }

    return actionBars;
  }

  function injectDownloadButtons() {
    const actionBars = findActionBars();

    for (const bar of actionBars) {
      // Skip if already injected
      if (bar.querySelector('[data-voice-dl]')) continue;

      const downloadBtn = createDownloadButton();
      bar.appendChild(downloadBtn);
    }
  }

  // ── 5. MutationObserver — Watch for new messages ──
  function startObserver() {
    injectStyles();

    // Initial scan
    setTimeout(injectDownloadButtons, 1000);
    setTimeout(injectDownloadButtons, 3000);

    const observer = new MutationObserver(() => {
      // Debounce — ChatGPT mutates DOM frequently
      clearTimeout(startObserver._debounce);
      startObserver._debounce = setTimeout(injectDownloadButtons, 500);
    });

    // Observe the whole body for new messages being added
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  console.log('[VoiceDL Content] Content script loaded — watching for ChatGPT action bars');
})();
