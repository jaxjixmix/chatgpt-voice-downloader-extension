/**
 * inject.js — Runs in the PAGE context (not the content script's isolated world).
 *
 * Intercepts fetch() to capture ChatGPT's TTS audio from /backend-api/synthesize.
 *
 * Supports a "silent capture" mode: when the content script signals that we
 * triggered Read Aloud programmatically, we suppress audio playback by
 * muting all <audio> elements and calling pause() shortly after.
 */

(function () {
  'use strict';

  const ORIGINAL_FETCH = window.fetch;

  // When true, we suppress audio playback after capturing
  let silentMode = false;

  // Listen for silent-mode toggle from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'CHATGPT_VOICE_DL_SET_SILENT') {
      silentMode = event.data.payload.silent;
      console.log('[VoiceDL] Silent mode:', silentMode);
    }
  });

  function isTTSRequest(url) {
    const urlStr = typeof url === 'string' ? url : (url instanceof Request ? url.url : String(url));
    return urlStr.includes('/backend-api/synthesize');
  }

  // Extract message_id from the synthesize URL
  function getMessageId(url) {
    try {
      const urlObj = new URL(url, location.origin);
      return urlObj.searchParams.get('message_id') || null;
    } catch (e) {
      return null;
    }
  }

  window.fetch = async function (...args) {
    const [resource, init] = args;
    const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : String(resource));

    if (!isTTSRequest(url)) {
      return ORIGINAL_FETCH.apply(this, args);
    }

    const messageId = getMessageId(url);
    console.log('[VoiceDL] TTS request intercepted:', url, 'messageId:', messageId);

    window.postMessage({
      type: 'CHATGPT_VOICE_DL_TTS_START',
      payload: { url, messageId, timestamp: Date.now() },
    }, '*');

    try {
      const response = await ORIGINAL_FETCH.apply(this, args);
      const clone = response.clone();

      // Collect audio in background
      collectAudio(clone, url, messageId);

      // If silent mode, suppress playback after a brief delay
      if (silentMode) {
        suppressAudioPlayback();
      }

      return response;
    } catch (err) {
      console.error('[VoiceDL] Fetch error:', err);
      throw err;
    }
  };

  // ── AudioContext interception for silent mode ──
  // ChatGPT may use Web Audio API instead of <audio> elements.
  // We wrap AudioContext so that when silent mode is on, all gain nodes
  // are muted and sources are disconnected.
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OriginalAudioContext) {
    const origCreateGain = OriginalAudioContext.prototype.createGain;
    OriginalAudioContext.prototype.createGain = function (...args) {
      const gainNode = origCreateGain.apply(this, args);
      if (silentMode) {
        gainNode.gain.value = 0;
        try { gainNode.gain.setValueAtTime(0, this.currentTime); } catch (e) {}
      }
      return gainNode;
    };

    const origCreateBufferSource = OriginalAudioContext.prototype.createBufferSource;
    OriginalAudioContext.prototype.createBufferSource = function (...args) {
      const source = origCreateBufferSource.apply(this, args);
      if (silentMode) {
        const origStart = source.start.bind(source);
        source.start = function () {
          // Don't start playback in silent mode, but still allow the API call
          // so ChatGPT doesn't error out
          try { origStart(...arguments); } catch (e) {}
          try { source.stop(); } catch (e) {}
        };
      }
      return source;
    };

    // Also intercept resume() to prevent suspended contexts from playing
    const origResume = OriginalAudioContext.prototype.resume;
    OriginalAudioContext.prototype.resume = function () {
      if (silentMode) {
        // Allow resume but immediately suspend to prevent playback
        return origResume.apply(this).then(() => {
          // Don't suspend — it breaks the fetch pipeline. Just mute.
        });
      }
      return origResume.apply(this);
    };
  }

  // Suppress audio playback by muting/pausing all audio elements + AudioContext nodes
  function suppressAudioPlayback() {
    // Run multiple times to catch dynamically created audio elements
    const suppress = () => {
      document.querySelectorAll('audio').forEach((el) => {
        el.muted = true;
        el.volume = 0;
        try { el.pause(); } catch (e) {}
      });

      // Also mute any HTMLMediaElement (video tags playing audio)
      document.querySelectorAll('video').forEach((el) => {
        el.muted = true;
        el.volume = 0;
      });
    };
    // Immediately + delayed to catch elements created after fetch resolves
    suppress();
    setTimeout(suppress, 50);
    setTimeout(suppress, 150);
    setTimeout(suppress, 300);
    setTimeout(suppress, 600);
    setTimeout(suppress, 1000);

    // Also try to click the "stop" button that ChatGPT shows during Read Aloud
    setTimeout(() => {
      clickStopReadAloud();
      // Reset silent mode after we're done
      silentMode = false;
    }, 800);
  }

  function clickStopReadAloud() {
    // ChatGPT replaces the Read Aloud button with a Stop button during playback
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('stop') && !ariaLabel.includes('generating')) {
        btn.click();
        console.log('[VoiceDL] Clicked stop button to halt playback');
        return;
      }
      // Also check for pause-like SVG icons
      const html = btn.innerHTML;
      if (html.includes('M6 4h4v16H6') || html.includes('pause') || html.includes('M6 19h4V5H6')) {
        btn.click();
        console.log('[VoiceDL] Clicked pause/stop button');
        return;
      }
    }
  }

  async function collectAudio(response, url, messageId) {
    try {
      const contentType = response.headers.get('content-type') || '';

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        let totalSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalSize += value.byteLength;
        }

        if (totalSize < 100) {
          console.log('[VoiceDL] Response too small, skipping:', totalSize, 'bytes');
          return;
        }

        const merged = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const base64 = uint8ToBase64(merged);

        let ext = 'aac';
        try {
          const urlObj = new URL(url, location.origin);
          ext = urlObj.searchParams.get('format') || 'aac';
        } catch (e) {}

        console.log(`[VoiceDL] Captured TTS audio: ${(totalSize / 1024).toFixed(1)}KB, format=${ext}`);

        window.postMessage({
          type: 'CHATGPT_VOICE_DL_AUDIO',
          payload: {
            audio: base64,
            contentType: contentType || `audio/${ext}`,
            ext,
            size: totalSize,
            url,
            messageId,
            timestamp: Date.now(),
          },
        }, '*');

      } else {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 100) return;

        const uint8 = new Uint8Array(buffer);
        const base64 = uint8ToBase64(uint8);
        let ext = 'aac';
        try {
          const urlObj = new URL(url, location.origin);
          ext = urlObj.searchParams.get('format') || 'aac';
        } catch (e) {}

        window.postMessage({
          type: 'CHATGPT_VOICE_DL_AUDIO',
          payload: {
            audio: base64,
            contentType: contentType || `audio/${ext}`,
            ext,
            size: buffer.byteLength,
            url,
            messageId,
            timestamp: Date.now(),
          },
        }, '*');
      }
    } catch (err) {
      console.error('[VoiceDL] Error collecting audio:', err);
      window.postMessage({
        type: 'CHATGPT_VOICE_DL_ERROR',
        payload: { error: err.message, url },
      }, '*');
    }
  }

  function uint8ToBase64(uint8) {
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const slice = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  console.log('[VoiceDL] Fetch interceptor installed — listening for /backend-api/synthesize');
})();
