/**
 * inject.js — Runs in the PAGE context (not the content script's isolated world).
 *
 * Intercepts fetch() to capture ChatGPT's TTS audio from /backend-api/synthesize.
 * Posts the captured audio data back to the content script via postMessage.
 * That's it — no playback suppression, no UI, just capture.
 */

(function () {
  'use strict';

  const ORIGINAL_FETCH = window.fetch;

  function isTTSRequest(url) {
    const urlStr = typeof url === 'string' ? url : (url instanceof Request ? url.url : String(url));
    return urlStr.includes('/backend-api/synthesize');
  }

  function getMessageId(url) {
    try {
      const urlObj = new URL(url, location.origin);
      return urlObj.searchParams.get('message_id') || null;
    } catch (e) {
      return null;
    }
  }

  window.fetch = async function (...args) {
    const [resource] = args;
    const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : String(resource));

    if (!isTTSRequest(url)) {
      return ORIGINAL_FETCH.apply(this, args);
    }

    const messageId = getMessageId(url);
    console.log('[VoiceDL] TTS request intercepted:', url, 'messageId:', messageId);

    window.postMessage({
      type: 'CHATGPT_VOICE_DL_TTS_START',
      payload: { url, messageId, timestamp: Date.now() },
    }, location.origin);

    const response = await ORIGINAL_FETCH.apply(this, args);
    const clone = response.clone();

    // Collect audio in background (don't block the response)
    collectAudio(clone, url, messageId);

    return response;
  };

  async function collectAudio(response, url, messageId) {
    try {
      const contentType = response.headers.get('content-type') || '';

      let ext = 'aac';
      try {
        const urlObj = new URL(url, location.origin);
        ext = urlObj.searchParams.get('format') || 'aac';
      } catch (e) {}

      let totalSize = 0;
      let base64 = '';

      const MAX_SIZE = 50 * 1024 * 1024; // 50MB safety limit

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalSize += value.byteLength;

          if (totalSize > MAX_SIZE) {
            console.warn('[VoiceDL] Audio exceeds 50MB limit, aborting capture');
            reader.cancel();
            return;
          }
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

        base64 = uint8ToBase64(merged);
      } else {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 100) return;
        totalSize = buffer.byteLength;
        base64 = uint8ToBase64(new Uint8Array(buffer));
      }

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
      }, location.origin);

    } catch (err) {
      console.error('[VoiceDL] Error collecting audio:', err);
      window.postMessage({
        type: 'CHATGPT_VOICE_DL_ERROR',
        payload: { error: err.message, url },
      }, location.origin);
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
