// Gloss content script. Injected on demand by the background worker the first time
// Gloss is triggered in a frame; after that it waits for 'gloss:ask' messages.
(() => {
  // A re-injection (e.g. after the extension is reloaded) replaces the old instance.
  try {
    globalThis.__glossTeardown?.();
  } catch {
    // The old instance belonged to an invalidated extension context; nothing to clean.
  }

  function onMessage(msg, _sender, sendResponse) {
    if (msg?.type !== 'gloss:ask') return;
    sendResponse({ ok: true });
  }

  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.__glossTeardown = () => {
    chrome.runtime.onMessage.removeListener(onMessage);
  };
})();
