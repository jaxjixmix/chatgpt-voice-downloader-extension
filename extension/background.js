/**
 * background.js — Service worker for the ChatGPT Voice Downloader extension.
 *
 * Handles download requests from the content script using the
 * chrome.downloads API for a clean download experience.
 *
 * Receives base64-encoded audio data (not blob URLs) from the content script,
 * since blob URLs created in content scripts aren't accessible from the
 * service worker in Manifest V3.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    // Validate sender is from a chatgpt.com tab
    if (!sender.tab || !sender.url || !sender.url.includes('chatgpt.com')) {
      sendResponse({ success: false, error: 'Unauthorized sender' });
      return true;
    }
    handleDownload(message, sender, sendResponse);
    return true; // Keep the message channel open for async response
  }
});

async function handleDownload(message, sender, sendResponse) {
  const { base64, contentType, filename } = message;

  if (!base64) {
    sendResponse({ success: false, error: 'No audio data provided' });
    return;
  }

  try {
    // Convert base64 to a data URL for chrome.downloads
    const dataUrl = `data:${contentType || 'audio/aac'};base64,${base64}`;

    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename || 'chatgpt-voice.aac',
      saveAs: false,
    });

    console.log('[VoiceDL BG] Download started:', downloadId, filename);
    sendResponse({ success: true, downloadId });
  } catch (err) {
    console.error('[VoiceDL BG] Download error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// Log extension lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[VoiceDL BG] Extension installed:', details.reason);
});

console.log('[VoiceDL BG] Service worker started');
