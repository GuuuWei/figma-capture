chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'capture') {
    handleCapture(msg.fileKey, msg.selector || 'body').then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ error: e.message })
    );
    return true;
  }
});

// CJK 字体预处理：遍历 DOM，对含中日韩文字的元素强制设置 Figma 可识别的字体
function preprocessCJKFonts(selector) {
  const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
  const FIGMA_CJK_FONT = 'Noto Sans SC';

  const root = document.querySelector(selector) || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  const processed = new Set();
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (!CJK_RE.test(textNode.textContent)) continue;

    const el = textNode.parentElement;
    if (!el || processed.has(el)) continue;
    processed.add(el);

    const computed = getComputedStyle(el);
    const families = computed.fontFamily;

    // 如果已经包含明确的中文字体，跳过
    if (/Noto Sans (SC|TC|JP|KR)|PingFang|Microsoft YaHei|Hiragino|Source Han/i.test(families)) continue;

    // 在原有字体栈前插入 CJK 字体
    el.style.fontFamily = `"${FIGMA_CJK_FONT}", ${families}`;
  }
}

async function handleCapture(fileKey, selector) {
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
  console.log('captureId:', captureId, 'selector:', selector);

  // 2. 预处理 CJK 字体
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [selector],
    func: preprocessCJKFonts,
    world: 'MAIN'
  });

  // 3. 注入 capture.js
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['capture.js'],
    world: 'MAIN'
  });

  // 4. 触发捕获
  setTimeout(() => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [captureId, endpoint, selector],
      func: (id, ep, sel) => {
        window.figma.captureForDesign({
          captureId: id,
          endpoint: ep,
          selector: sel
        });
      },
      world: 'MAIN'
    });
  }, 1500);
}
