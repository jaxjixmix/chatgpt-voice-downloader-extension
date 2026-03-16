/**
 * content.js — Content script for ChatGPT Voice Downloader.
 *
 * Seamless one-click flow:
 *   1. User clicks our "Save" button on any assistant message
 *   2. We enable silent mode (tells inject.js to suppress playback)
 *   3. We click ChatGPT's "More actions" (three-dot) button to open the dropdown
 *   4. We find and click "Read Aloud" inside the dropdown menu
 *   5. inject.js intercepts the TTS fetch, captures audio, posts it back
 *   6. We receive the audio and auto-download it as a file
 *   7. Playback is muted/stopped — user hears nothing
 *
 * ChatGPT uses Radix UI dropdown menus — Read Aloud is hidden behind
 * the "More actions" button rather than being directly in the action bar.
 *
 * Each Save button is tied to a specific message's action bar, so each
 * message gets its own independent download button.
 */

(function () {
  'use strict';

  // ── State ──
  // Map of messageId -> audio payload (so each message's audio is tracked separately)
  const capturedAudio = new Map();
  // The button currently waiting for audio capture
  let pendingButton = null;
  let pendingTimeout = null;

  // ── 1. Inject fetch interceptor into page context ──
  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
  injectPageScript();

  // ── 2. Communication with inject.js ──
  function setSilentMode(enabled) {
    window.postMessage({ type: 'CHATGPT_VOICE_DL_SET_SILENT', payload: { silent: enabled } }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'CHATGPT_VOICE_DL_TTS_START') {
      console.log('[VoiceDL] TTS fetch started');
      return;
    }

    if (event.data?.type === 'CHATGPT_VOICE_DL_AUDIO') {
      const { payload } = event.data;
      console.log(`[VoiceDL] Audio received: ${(payload.size / 1024).toFixed(1)}KB, format=${payload.ext}`);

      // Store by messageId if available
      if (payload.messageId) {
        capturedAudio.set(payload.messageId, payload);
      }

      // If there's a pending button waiting for this audio, auto-download now
      if (pendingButton) {
        clearTimeout(pendingTimeout);
        triggerDownload(pendingButton, payload);
        pendingButton = null;
      }
      return;
    }

    if (event.data?.type === 'CHATGPT_VOICE_DL_ERROR') {
      console.error('[VoiceDL] Capture error:', event.data.payload.error);
      if (pendingButton) {
        clearTimeout(pendingTimeout);
        resetButton(pendingButton);
        pendingButton = null;
        showToast('Failed to capture audio. Try again.');
      }
    }
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
    .voice-dl-btn:active { transform: scale(0.95); }
    .voice-dl-btn svg { width: 14px; height: 14px; flex-shrink: 0; }

    .voice-dl-btn.capturing {
      background: #ff6b35;
      color: #fff;
      cursor: wait;
      pointer-events: none;
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
      pointer-events: none;
    }
    .voice-dl-btn.error {
      background: #ff3333;
      color: #fff;
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
      width: 8px; height: 8px; border-radius: 50%;
      background: #39ff14; flex-shrink: 0;
    }
    .voice-dl-toast.error .dot { background: #ff3333; }

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
  const SPINNER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.78l1.42-1.42M18.36 5.64l1.42-1.42"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>`;

  function showToast(message, isError = false) {
    document.querySelectorAll('.voice-dl-toast').forEach((t) => t.remove());
    const toast = document.createElement('div');
    toast.className = 'voice-dl-toast' + (isError ? ' error' : '');
    toast.innerHTML = `<span class="dot"></span>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
  }

  // ── 4. Core: One-click Save ──

  /**
   * Find the "More actions" (three-dot) button within the action bar area.
   * ChatGPT hides Read Aloud behind this Radix dropdown menu.
   */
  function findMoreActionsButton(actionBar) {
    // Search within the action bar and a few parents up
    const searchRoots = [actionBar];
    let parent = actionBar.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      searchRoots.push(parent);
      parent = parent.parentElement;
    }

    for (const root of searchRoots) {
      const buttons = root.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.hasAttribute('data-voice-dl')) continue;

        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel === 'more actions' || ariaLabel === 'more' || ariaLabel === 'more options') {
          return btn;
        }

        // Also match by aria-haspopup="menu" combined with being in an action area
        if (btn.getAttribute('aria-haspopup') === 'menu') {
          // Verify it's near action buttons (not some unrelated menu trigger)
          const siblings = btn.parentElement?.querySelectorAll('button') || [];
          if (siblings.length >= 2) return btn;
        }
      }
    }
    return null;
  }

  /**
   * Wait for a Radix dropdown menu to appear in the DOM after clicking
   * the "More actions" button, then find and click the Read Aloud item.
   */
  function waitForMenuAndClickReadAloud() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 30; // 30 * 100ms = 3 seconds max

      const check = () => {
        attempts++;

        // Radix UI portals menus to the document body with role="menu"
        // Also check for [data-radix-menu-content] or [data-state="open"] patterns
        const menus = document.querySelectorAll(
          '[role="menu"], [data-radix-menu-content], [data-state="open"][role="menuitem"], div[data-side]'
        );

        for (const menu of menus) {
          const items = menu.querySelectorAll('[role="menuitem"], [data-radix-collection-item], div[tabindex="-1"]');
          for (const item of items) {
            const text = (item.textContent || '').trim().toLowerCase();
            if (text === 'read aloud' || text === 'listen' || text.includes('read aloud')) {
              console.log('[VoiceDL] Found "Read Aloud" in dropdown menu, clicking...');
              item.click();
              resolve(true);
              return;
            }
          }
        }

        // Also scan for any clickable element containing "Read aloud" text
        // (in case menu items don't have role="menuitem")
        const allVisible = document.querySelectorAll('[data-state="open"] *, [role="menu"] *');
        for (const el of allVisible) {
          if (el.children.length > 2) continue; // skip containers
          const text = (el.textContent || '').trim().toLowerCase();
          if ((text === 'read aloud' || text === 'listen') && el.offsetParent !== null) {
            const clickTarget = el.closest('[role="menuitem"]') || el.closest('[tabindex]') || el;
            console.log('[VoiceDL] Found "Read Aloud" text node, clicking:', clickTarget.tagName);
            clickTarget.click();
            resolve(true);
            return;
          }
        }

        if (attempts >= maxAttempts) {
          reject(new Error('Read Aloud menu item not found after 3 seconds'));
          return;
        }

        setTimeout(check, 100);
      };

      // Start checking after a brief delay to let the menu render
      setTimeout(check, 50);
    });
  }

  /**
   * Dismiss any open Radix menu by pressing Escape or clicking elsewhere.
   */
  function dismissMenu() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
    }));
  }

  async function handleSaveClick(btn, actionBar) {
    // Step 1: Find the "More actions" menu button for this message
    const moreBtn = findMoreActionsButton(actionBar);

    if (!moreBtn) {
      // Fallback: try to find Read Aloud button directly (older UI versions)
      const directBtn = findReadAloudButtonDirect(actionBar);
      if (directBtn) {
        btn.className = 'voice-dl-btn capturing';
        btn.innerHTML = `${SPINNER_ICON}<span>Capturing...</span>`;
        pendingButton = btn;
        setSilentMode(true);
        console.log('[VoiceDL] Found Read Aloud button directly, clicking...');
        directBtn.click();
        pendingTimeout = setTimeout(() => timeoutCapture(btn), 30000);
        return;
      }

      showToast('Could not find "More actions" button for this message.', true);
      return;
    }

    // Step 2: Set button to capturing state
    btn.className = 'voice-dl-btn capturing';
    btn.innerHTML = `${SPINNER_ICON}<span>Capturing...</span>`;
    pendingButton = btn;

    // Step 3: Enable silent mode (tells inject.js to suppress playback)
    setSilentMode(true);

    // Step 4: Click "More actions" to open the dropdown menu
    console.log('[VoiceDL] Opening "More actions" menu...');
    moreBtn.click();

    // Step 5: Wait for menu to appear and click "Read Aloud" inside it
    try {
      await waitForMenuAndClickReadAloud();
      console.log('[VoiceDL] Read Aloud triggered via menu');
    } catch (err) {
      console.error('[VoiceDL]', err.message);
      dismissMenu();
      resetButton(btn);
      pendingButton = null;
      setSilentMode(false);
      showToast('Could not find "Read Aloud" in the menu. It may not be available for this message.', true);
      return;
    }

    // Step 6: Set a timeout in case capture fails (30s for long messages)
    pendingTimeout = setTimeout(() => timeoutCapture(btn), 30000);
  }

  function timeoutCapture(btn) {
    if (pendingButton === btn) {
      console.warn('[VoiceDL] Capture timed out');
      resetButton(btn);
      pendingButton = null;
      setSilentMode(false);
      showToast('Capture timed out. The message may be too long, or Read Aloud may not be available.', true);
    }
  }

  /**
   * Fallback: try to find Read Aloud button directly in the action bar
   * (for older ChatGPT UI versions where it wasn't behind a menu).
   */
  function findReadAloudButtonDirect(actionBar) {
    const searchRoots = [actionBar];
    let parent = actionBar.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      searchRoots.push(parent);
      parent = parent.parentElement;
    }

    for (const root of searchRoots) {
      const buttons = root.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.hasAttribute('data-voice-dl')) continue;
        if (isReadAloudButton(btn)) return btn;
      }
    }
    return null;
  }

  function triggerDownload(btn, audio) {
    btn.className = 'voice-dl-btn downloading';
    btn.innerHTML = `${DOWNLOAD_ICON}<span>Saving...</span>`;

    setSilentMode(false);

    try {
      const timestamp = new Date(audio.timestamp)
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const filename = `chatgpt-voice-${timestamp}.${audio.ext}`;

      // Send base64 data to background script for download
      // (Blob URLs from content scripts aren't accessible by the service worker in MV3)
      try {
        chrome.runtime.sendMessage(
          {
            action: 'download',
            base64: audio.audio,
            contentType: audio.contentType,
            filename,
          },
          (response) => {
            if (chrome.runtime.lastError || !response?.success) {
              console.warn('[VoiceDL] Background download failed, using anchor fallback');
              downloadViaAnchor(audio, filename);
            }
            onDownloadSuccess(btn, filename, audio);
          }
        );
      } catch (e) {
        downloadViaAnchor(audio, filename);
        onDownloadSuccess(btn, filename, audio);
      }
    } catch (err) {
      console.error('[VoiceDL] Download error:', err);
      resetButton(btn);
      showToast('Download failed — try again.', true);
    }
  }

  function onDownloadSuccess(btn, filename, audio) {
    btn.className = 'voice-dl-btn success';
    btn.innerHTML = `${CHECK_ICON}<span>Saved!</span>`;
    showToast(`Saved ${(audio.size / 1024).toFixed(0)}KB: ${filename}`);

    setTimeout(() => resetButton(btn), 2500);
  }

  function resetButton(btn) {
    btn.className = 'voice-dl-btn';
    btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
  }

  function downloadViaAnchor(audio, filename) {
    const binaryStr = atob(audio.audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: audio.contentType });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }

  // ── 5. DOM Detection & Button Injection ──

  function isReadAloudButton(el) {
    if (el.tagName !== 'BUTTON') return false;

    // Check data-testid (most reliable if present)
    const testId = el.getAttribute('data-testid') || '';
    if (testId.includes('read-aloud') || testId.includes('voice') || testId.includes('tts') || testId.includes('speak')) return true;

    // Check aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('read aloud') || ariaLabel === 'listen' || ariaLabel.includes('speak')) return true;

    // Check tooltip/title
    const title = (el.getAttribute('title') || '').toLowerCase();
    if (title.includes('read aloud') || title.includes('listen') || title.includes('speak')) return true;

    // Fallback: check SVG paths for speaker/volume icon patterns
    const html = el.innerHTML;
    return (
      html.includes('M11 5L6 9H2v6h4l5 4') ||
      html.includes('M11 4.702') ||
      (html.includes('polygon') && html.includes('11') && html.includes('5') && html.includes('19'))
    );
  }

  function isCopyButton(el) {
    if (el.tagName !== 'BUTTON') return false;

    // Check data-testid
    const testId = el.getAttribute('data-testid') || '';
    if (testId.includes('copy')) return true;

    // Check aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('copy')) return true;

    // Check tooltip/title
    const title = (el.getAttribute('title') || '').toLowerCase();
    if (title.includes('copy')) return true;

    // Fallback: check SVG paths for clipboard icon
    const html = el.innerHTML;
    return (html.includes('M7 5') && html.includes('M14 7')) || html.includes('clipboard');
  }

  function isMoreActionsButton(el) {
    if (el.tagName !== 'BUTTON') return false;
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel === 'more actions' || ariaLabel === 'more' || ariaLabel === 'more options') return true;
    // Match aria-haspopup="menu" buttons that look like action menus
    if (el.getAttribute('aria-haspopup') === 'menu' && el.closest('[class*="action"], [class*="toolbar"], [class*="message"]')) return true;
    return false;
  }

  function findActionBars() {
    const actionBars = new Set();

    // Strategy 1: Look for containers with data-testid suggesting message actions
    document.querySelectorAll('[data-testid*="message-action"], [data-testid*="action-bar"], [data-testid*="toolbar"]').forEach((el) => {
      if (el.querySelectorAll('button').length >= 2) {
        actionBars.add(el);
      }
    });

    // Strategy 2: Find "More actions" buttons, Copy buttons, or Read Aloud buttons
    // and walk up to their container
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      if (isMoreActionsButton(btn) || isCopyButton(btn) || isReadAloudButton(btn)) {
        let container = btn.parentElement;
        while (container && container !== document.body) {
          const childBtns = container.querySelectorAll(':scope > button, :scope > span > button, :scope > div > button');
          if (childBtns.length >= 2) {
            actionBars.add(container);
            break;
          }
          container = container.parentElement;
        }
      }
    }

    return actionBars;
  }

  function createDownloadButton(actionBar) {
    const btn = document.createElement('button');
    btn.className = 'voice-dl-btn';
    btn.title = 'Download this message as audio (one-click)';
    btn.innerHTML = `${DOWNLOAD_ICON}<span>Save</span>`;
    btn.setAttribute('data-voice-dl', 'true');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSaveClick(btn, actionBar);
    });

    return btn;
  }

  function injectDownloadButtons() {
    const actionBars = findActionBars();

    for (const bar of actionBars) {
      if (bar.querySelector('[data-voice-dl]')) continue;
      const downloadBtn = createDownloadButton(bar);
      bar.appendChild(downloadBtn);
    }
  }

  // ── 6. Observer ──
  function startObserver() {
    injectStyles();

    setTimeout(injectDownloadButtons, 1000);
    setTimeout(injectDownloadButtons, 3000);

    const observer = new MutationObserver(() => {
      clearTimeout(startObserver._debounce);
      startObserver._debounce = setTimeout(injectDownloadButtons, 500);
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  console.log('[VoiceDL] Content script loaded — one-click Save buttons active');
})();
