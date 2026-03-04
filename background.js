chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'capture') {
    handleCapture(msg.fileKey).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ error: e.message })
    );
    return true; // async response
  }
});

async function handleCapture(fileKey) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');

  // 1. 获取 captureId
  let captureId;
  try {
    const res = await fetch('https://mcp.figma.com/mcp/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileKey })
    });
    const data = await res.json();
    captureId = data.captureId || data.id;
  } catch (e) {
    console.error('Failed to get captureId:', e);
  }

  // 自动获取失败，弹 prompt
  if (!captureId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => prompt('Auto captureId failed. Paste one manually:'),
      world: 'MAIN'
    });
    captureId = results?.[0]?.result;
    if (!captureId) throw new Error('No captureId');
  }

  const endpoint = `https://mcp.figma.com/mcp/capture/${captureId}/submit`;
  console.log('captureId:', captureId, 'fileKey:', fileKey);

  // 2. 注入 capture.js（files 参数绕过 CSP）
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['capture.js'],
    world: 'MAIN'
  });

  // 3. 触发捕获
  setTimeout(() => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [captureId, endpoint],
      func: (id, ep) => {
        window.figma.captureForDesign({
          captureId: id,
          endpoint: ep,
          selector: 'body'
        });
      },
      world: 'MAIN'
    });
  }, 1500);
}
