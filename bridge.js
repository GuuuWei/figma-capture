if (!window.__figmaCaptureBridge) {
  window.__figmaCaptureBridge = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== '__figma_capture_fetch') return;

    const { url, requestId } = event.data;

    chrome.runtime.sendMessage({ type: 'fetch-image', url }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          type: '__figma_capture_fetch_response',
          requestId,
          error: chrome.runtime.lastError.message
        }, '*');
        return;
      }
      window.postMessage({
        type: '__figma_capture_fetch_response',
        requestId,
        ...(response || { error: 'no response' })
      }, '*');
    });
  });
}
