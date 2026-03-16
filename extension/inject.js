/**
 * inject.js — Runs in the PAGE context (not the content script's isolated world).
 * Intercepts fetch() calls to capture ChatGPT's TTS audio responses.
 *
 * The Read Aloud request looks like:
 *   GET /backend-api/synthesize?message_id=...&conversation_id=...&voice=cove&format=aac
 *
 * The response is audio data (AAC format). We intercept it, collect all chunks
 * from the stream, and post back to the content script via window.postMessage.
 */

(function () {
  'use strict';

  // Grab original fetch BEFORE anything else can patch it
  const ORIGINAL_FETCH = window.fetch;

  function isTTSRequest(url) {
    const urlStr = typeof url === 'string' ? url : (url instanceof Request ? url.url : String(url));
    return urlStr.includes('/backend-api/synthesize');
  }

  window.fetch = async function (...args) {
    const [resource, init] = args;
    const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : String(resource));

    if (!isTTSRequest(url)) {
      return ORIGINAL_FETCH.apply(this, args);
    }

    console.log('[VoiceDL] TTS request intercepted:', url);

    // Notify content script that TTS started
    window.postMessage({ type: 'CHATGPT_VOICE_DL_TTS_START', payload: { url, timestamp: Date.now() } }, '*');

    try {
      const response = await ORIGINAL_FETCH.apply(this, args);

      // We need to read the body without consuming it for the caller.
      // Clone the response — the original goes back to ChatGPT, we read the clone.
      const clone = response.clone();

      // Read the full body in the background (handles both streaming and non-streaming)
      collectAudio(clone, url);

      return response;
    } catch (err) {
      console.error('[VoiceDL] Fetch error:', err);
      return ORIGINAL_FETCH.apply(this, args);
    }
  };

  async function collectAudio(response, url) {
    try {
      const contentType = response.headers.get('content-type') || '';

      // Try reading the body via the ReadableStream to handle chunked/streaming responses
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

        // Merge all chunks into a single Uint8Array
        const merged = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

        // Convert to base64 for postMessage transfer
        const base64 = uint8ToBase64(merged);

        // Determine format from URL params or content-type
        let ext = 'aac'; // default — ChatGPT uses AAC
        const urlObj = new URL(url, location.origin);
        const formatParam = urlObj.searchParams.get('format');
        if (formatParam) {
          ext = formatParam; // e.g. 'aac', 'mp3', 'opus'
        } else if (contentType.includes('mpeg') || contentType.includes('mp3')) {
          ext = 'mp3';
        } else if (contentType.includes('wav')) {
          ext = 'wav';
        } else if (contentType.includes('ogg') || contentType.includes('opus')) {
          ext = 'opus';
        }

        console.log(`[VoiceDL] Captured TTS audio: ${(totalSize / 1024).toFixed(1)}KB, format=${ext}, content-type=${contentType}`);

        window.postMessage({
          type: 'CHATGPT_VOICE_DL_AUDIO',
          payload: {
            audio: base64,
            contentType: contentType || `audio/${ext}`,
            ext,
            size: totalSize,
            url,
            timestamp: Date.now(),
          },
        }, '*');

      } else {
        // Fallback: read as arrayBuffer (non-streaming)
        const buffer = await response.arrayBuffer();

        if (buffer.byteLength < 100) return;

        const uint8 = new Uint8Array(buffer);
        const base64 = uint8ToBase64(uint8);
        let ext = 'aac';
        try {
          const urlObj = new URL(url, location.origin);
          ext = urlObj.searchParams.get('format') || 'aac';
        } catch (e) {}

        console.log(`[VoiceDL] Captured TTS audio (fallback): ${(buffer.byteLength / 1024).toFixed(1)}KB`);

        window.postMessage({
          type: 'CHATGPT_VOICE_DL_AUDIO',
          payload: {
            audio: base64,
            contentType: contentType || `audio/${ext}`,
            ext,
            size: buffer.byteLength,
            url,
            timestamp: Date.now(),
          },
        }, '*');
      }
    } catch (err) {
      console.error('[VoiceDL] Error collecting audio:', err);
    }
  }

  // Efficient base64 encoding for large Uint8Arrays
  function uint8ToBase64(uint8) {
    const chunkSize = 0x8000; // 32KB chunks to avoid call stack limits
    let binary = '';
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const slice = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  console.log('[VoiceDL] Fetch interceptor installed — listening for /backend-api/synthesize');
})();
