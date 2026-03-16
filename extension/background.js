/**
 * background.js — Service worker for the ChatGPT Voice Downloader extension.
 *
 * Handles download requests from the content script using the
 * chrome.downloads API for a clean download experience.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message, sender, sendResponse);
    return true; // Keep the message channel open for async response
  }
});

async function handleDownload(message, sender, sendResponse) {
  const { url, filename } = message;

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: filename || 'chatgpt-voice.mp3',
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
