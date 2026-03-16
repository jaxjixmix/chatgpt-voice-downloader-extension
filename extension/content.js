/**
 * content.js — Content script for ChatGPT Voice Downloader.
 *
 * Passive capture: whenever the user clicks "Read Aloud" in ChatGPT,
 * inject.js intercepts the TTS fetch and posts the audio data here.
 * We auto-download it as a file. No extra buttons, no UI — just works.
 */

(function () {
  'use strict';

  // ── 1. Inject fetch interceptor into page context ──
  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
  injectPageScript();

  // ── 2. Listen for captured audio from inject.js ──
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'CHATGPT_VOICE_DL_TTS_START') {
      console.log('[VoiceDL] TTS fetch started');
      showToast('Capturing audio...');
      return;
    }

    if (event.data?.type === 'CHATGPT_VOICE_DL_AUDIO') {
      const { payload } = event.data;
      console.log(`[VoiceDL] Audio captured: ${(payload.size / 1024).toFixed(1)}KB, format=${payload.ext}`);
      triggerDownload(payload);
      return;
    }

    if (event.data?.type === 'CHATGPT_VOICE_DL_ERROR') {
      console.error('[VoiceDL] Capture error:', event.data.payload.error);
      showToast('Failed to capture audio.', true);
    }
  });

  // ── 3. Download ──
  function triggerDownload(audio) {
    try {
      const timestamp = new Date(audio.timestamp)
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const filename = `chatgpt-voice-${timestamp}.${audio.ext}`;

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
            showToast(`Saved ${(audio.size / 1024).toFixed(0)}KB: ${filename}`);
          }
        );
      } catch (e) {
        downloadViaAnchor(audio, filename);
        showToast(`Saved ${(audio.size / 1024).toFixed(0)}KB: ${filename}`);
      }
    } catch (err) {
      console.error('[VoiceDL] Download error:', err);
      showToast('Download failed.', true);
    }
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

  // ── 4. Toast notification ──
  const STYLES = `
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

  function showToast(message, isError = false) {
    injectStyles();
    document.querySelectorAll('.voice-dl-toast').forEach((t) => t.remove());
    const toast = document.createElement('div');
    toast.className = 'voice-dl-toast' + (isError ? ' error' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    toast.appendChild(dot);
    toast.appendChild(document.createTextNode(message));
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
  }

  console.log('[VoiceDL] Content script loaded — passive capture active');
})();
