const urlInput = document.getElementById('url');
const selectorInput = document.getElementById('selector');
const captureBtn = document.getElementById('capture');
const statusEl = document.getElementById('status');

// 恢复上次的值
chrome.storage.local.get(['figmaUrl', 'selector'], (data) => {
  if (data.figmaUrl) urlInput.value = data.figmaUrl;
  if (data.selector) selectorInput.value = data.selector;
});

function parseFileKey(url) {
  const m = url.match(/figma\.com\/(?:design|file|board|make)\/([a-zA-Z0-9]+)(?:\/branch\/([a-zA-Z0-9]+))?/);
  if (!m) return null;
  return m[2] || m[1];
}

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.display = 'block';
}

captureBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const fileKey = parseFileKey(url);
  if (!fileKey) { showStatus('Invalid Figma URL'); return; }

  const selector = selectorInput.value.trim() || 'body';

  chrome.storage.local.set({ figmaUrl: url, selector });

  captureBtn.disabled = true;
  showStatus('Getting captureId...');

  chrome.runtime.sendMessage({ action: 'capture', fileKey, selector }, (resp) => {
    if (resp?.error) {
      showStatus('Error: ' + resp.error);
      captureBtn.disabled = false;
    } else {
      showStatus('Capturing... check Figma in a few seconds');
      setTimeout(() => window.close(), 2000);
    }
  });
});
