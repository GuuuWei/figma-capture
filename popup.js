const urlInput = document.getElementById('url');
const captureBtn = document.getElementById('capture');
const statusEl = document.getElementById('status');

// 恢复上次的 URL
chrome.storage.local.get('figmaUrl', ({ figmaUrl }) => {
  if (figmaUrl) urlInput.value = figmaUrl;
});

function parseFileKey(url) {
  // figma.com/design/:fileKey/...
  // figma.com/file/:fileKey/...
  // figma.com/board/:fileKey/...
  // figma.com/make/:fileKey/...
  // 也支持 branch: figma.com/design/:fileKey/branch/:branchKey/...
  const m = url.match(/figma\.com\/(?:design|file|board|make)\/([a-zA-Z0-9]+)(?:\/branch\/([a-zA-Z0-9]+))?/);
  if (!m) return null;
  return m[2] || m[1]; // branch key 优先
}

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.display = 'block';
}

captureBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const fileKey = parseFileKey(url);
  if (!fileKey) {
    showStatus('Invalid Figma URL');
    return;
  }

  // 保存 URL
  chrome.storage.local.set({ figmaUrl: url });

  captureBtn.disabled = true;
  showStatus('Getting captureId...');

  // 发消息给 background
  chrome.runtime.sendMessage({ action: 'capture', fileKey }, (resp) => {
    if (resp?.error) {
      showStatus('Error: ' + resp.error);
      captureBtn.disabled = false;
    } else {
      showStatus('Capturing... check Figma in a few seconds');
      setTimeout(() => window.close(), 2000);
    }
  });
});
