/**
 * inject.js — Runs in the PAGE context (not the content script's isolated world).
 * Intercepts fetch() calls to capture ChatGPT's TTS audio responses.
 *
 * ChatGPT's Read Aloud uses the OpenAI TTS API which returns audio data.
 * We intercept those responses, collect the audio bytes, and post them
 * back to the content script via window.postMessage.
 */

(function () {
  'use strict';

  const ORIGINAL_FETCH = window.fetch;

  // Patterns that indicate a TTS / audio synthesis request
  const TTS_URL_PATTERNS = [
    '/backend-api/synthesize',
    '/v1/audio/speech',
    '/backend-api/conversation/tts',
    '/synthesis',
  ];

  function isTTSRequest(url) {
    const urlStr = typeof url === 'string' ? url : url?.url || '';
    return TTS_URL_PATTERNS.some((pattern) => urlStr.includes(pattern));
  }

  window.fetch = async function (...args) {
    const [resource, init] = args;
    const url = typeof resource === 'string' ? resource : resource?.url || '';

    // Pass through non-TTS requests immediately
    if (!isTTSRequest(url)) {
      return ORIGINAL_FETCH.apply(this, args);
    }

    console.log('[VoiceDL] TTS request detected:', url);

    try {
      const response = await ORIGINAL_FETCH.apply(this, args);

      // Clone the response so we can read the body without consuming it
      const clone = response.clone();

      // Read audio data in the background — don't block the original caller
      (async () => {
        try {
          const contentType = clone.headers.get('content-type') || '';
          const isAudio =
            contentType.includes('audio') ||
            contentType.includes('octet-stream') ||
            contentType.includes('mpeg');

          if (!isAudio && !contentType.includes('application/json')) {
            // Might still be audio with wrong content-type, try anyway
          }

          // Try to read as arrayBuffer
          const buffer = await clone.arrayBuffer();

          if (buffer.byteLength < 100) {
            console.log('[VoiceDL] Response too small, skipping:', buffer.byteLength);
            return;
          }

          // Convert to base64 for transfer via postMessage
          const uint8 = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < uint8.length; i += chunkSize) {
            const slice = uint8.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, slice);
          }
          const base64 = btoa(binary);

          // Determine file extension from content-type
          let ext = 'mp3';
          if (contentType.includes('wav')) ext = 'wav';
          else if (contentType.includes('ogg')) ext = 'ogg';
          else if (contentType.includes('aac')) ext = 'aac';
          else if (contentType.includes('opus')) ext = 'opus';

          console.log(
            `[VoiceDL] Captured TTS audio: ${(buffer.byteLength / 1024).toFixed(1)}KB, type=${contentType}, ext=${ext}`
          );

          window.postMessage(
            {
              type: 'CHATGPT_VOICE_DL_AUDIO',
              payload: {
                audio: base64,
                contentType: contentType || `audio/${ext}`,
                ext,
                size: buffer.byteLength,
                url,
                timestamp: Date.now(),
              },
            },
            '*'
          );
        } catch (err) {
          console.error('[VoiceDL] Error reading TTS response:', err);
        }
      })();

      return response;
    } catch (err) {
      console.error('[VoiceDL] Fetch intercept error:', err);
      return ORIGINAL_FETCH.apply(this, args);
    }
  };

  // Also intercept XMLHttpRequest as a fallback
  const ORIGINAL_XHR_OPEN = XMLHttpRequest.prototype.open;
  const ORIGINAL_XHR_SEND = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._voiceDLUrl = url;
    this._voiceDLIsTTS = isTTSRequest(url);
    return ORIGINAL_XHR_OPEN.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._voiceDLIsTTS) {
      this.responseType = this.responseType || 'arraybuffer';
      this.addEventListener('load', function () {
        try {
          if (this.response instanceof ArrayBuffer && this.response.byteLength > 100) {
            const uint8 = new Uint8Array(this.response);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < uint8.length; i += chunkSize) {
              const slice = uint8.subarray(i, i + chunkSize);
              binary += String.fromCharCode.apply(null, slice);
            }
            const base64 = btoa(binary);
            const contentType = this.getResponseHeader('content-type') || 'audio/mpeg';
            let ext = 'mp3';
            if (contentType.includes('wav')) ext = 'wav';
            else if (contentType.includes('ogg')) ext = 'ogg';

            console.log(`[VoiceDL] XHR captured TTS audio: ${(this.response.byteLength / 1024).toFixed(1)}KB`);

            window.postMessage(
              {
                type: 'CHATGPT_VOICE_DL_AUDIO',
                payload: {
                  audio: base64,
                  contentType,
                  ext,
                  size: this.response.byteLength,
                  url: this._voiceDLUrl,
                  timestamp: Date.now(),
                },
              },
              '*'
            );
          }
        } catch (err) {
          console.error('[VoiceDL] XHR intercept error:', err);
        }
      });
    }
    return ORIGINAL_XHR_SEND.apply(this, args);
  };

  console.log('[VoiceDL] Fetch interceptor installed');
})();
