// Gloss background service worker.
// Owns the context menu, the keyboard shortcut and the API calls.
import { ApiError, describeError, streamAnswer } from './lib/api.js';
import { buildFirstMessage, buildSystem } from './lib/prompt.js';
import { PROVIDERS, contextTokens } from './lib/providers.js';
import { getActiveSources, getSettings } from './lib/store.js';

// Room left in the context window for instructions, the selection and the answer.
const RESERVED_TOKENS = 5000;

const MENU_ID = 'ask-gloss';
// Injected on demand, in this order. Nothing runs on a page until Gloss is triggered there.
const CONTENT_FILES = ['lib/markdown.js', 'lib/search.js', 'card.css.js', 'content.js'];

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first: reloading the unpacked extension fires onInstalled again.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Ask Gloss', contexts: ['selection'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) ask(tab, info.frameId ?? 0, info.selectionText);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'ask-gloss') ask(tab, 0);
});

// The toolbar icon has no popup; clicking it opens the settings page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Searching happens in a real browser tab, so it has the user's own session and a fully
// rendered page and meets none of the restrictions a plain request does. The tab is
// opened in the background, read, and closed straight away.
const SEARCH_URLS = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en`,
  duckduckgo: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
};
const SEARCH_LOAD_TIMEOUT_MS = 12_000;

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, SEARCH_LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // The page may already have finished before the listener was attached.
    chrome.tabs.get(tabId).then((tab) => tab.status === 'complete' && done(), done);
  });
}

// Runs inside the search tab. Results can appear a moment after the page loads.
async function readSearchPage(engine) {
  if (location.pathname.startsWith('/sorry')) return { blocked: true };
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = globalThis.GlossSearch.parseDocument(engine, document);
    if (result) return { result };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { result: null };
}

// Returns { result } ({ answer, results } or null), { blocked: true }, or { error }.
async function runSearch({ query, engine }) {
  const makeUrl = SEARCH_URLS[engine];
  if (!makeUrl || typeof query !== 'string' || !query.trim()) return { error: 'bad request' };
  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: makeUrl(query.slice(0, 300)), active: false });
    tabId = tab.id;
    await waitForTabLoad(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/search.js'] });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readSearchPage,
      args: [engine],
    });
    return injection?.result || { result: null };
  } catch (err) {
    return { error: String(err?.message || err) };
  } finally {
    if (tabId != null) chrome.tabs.remove(tabId).catch(() => {}); // the user may have closed it
  }
}

// Content scripts can't open the options page or fetch other sites themselves.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'gloss:open-options') chrome.runtime.openOptionsPage();
  if (msg?.type === 'gloss:search') {
    runSearch(msg).then(sendResponse);
    return true; // reply asynchronously
  }
});

// Tell the content script in the given frame to open a card, injecting it first if needed.
async function ask(tab, frameId, selectionText = '') {
  if (!tab || tab.id == null || tab.id < 0) return;
  const message = { type: 'gloss:ask', selectionText };
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, message, { frameId });
    } catch {
      // No content script in this frame yet, or it was orphaned by an extension reload.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        files: CONTENT_FILES,
      });
      await chrome.tabs.sendMessage(tab.id, message, { frameId });
    }
  } catch {
    flagUnsupported(tab.id);
  }
}

// Content scripts can't run on chrome:// pages, the Web Store or the built-in PDF
// viewer, so there is nowhere to draw a card. Say so on the toolbar icon instead.
function flagUnsupported(tabId) {
  const ignore = () => {}; // the tab may be gone by the time these run
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#b3261e' }).catch(ignore);
  chrome.action.setBadgeText({ tabId, text: '!' }).catch(ignore);
  chrome.action
    .setTitle({
      tabId,
      title:
        "Gloss can't run on this page. Browser pages, the Chrome Web Store, the built-in PDF viewer and frames from other sites are off limits to extensions.",
    })
    .catch(ignore);
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(ignore);
    chrome.action.setTitle({ tabId, title: 'Gloss' }).catch(ignore);
  }, 8000);
}

// Each answer gets its own port from the content script: one 'ask' message in, then
// 'delta' messages and a final 'done' or 'error' out. The open port keeps this worker
// alive while streaming; closing the card disconnects it, which aborts the request.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'gloss') return;
  const controller = new AbortController();
  const { signal } = controller;
  port.onDisconnect.addListener(() => controller.abort());
  const send = (message) => {
    if (!signal.aborted) port.postMessage(message);
  };

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'ask') return;
    try {
      const { provider, apiKey, model, length } = await getSettings();
      if (!apiKey) throw new ApiError('no_key');
      // msg.turns holds the follow-up conversation so far (assistant/user alternating).
      const turns = msg.turns || [];
      // Fail early with a clear message when the sources can't fit. This is only an
      // estimate; the provider's own "too long" error maps to the same message.
      const sources = await getActiveSources();
      const sourceTokens = sources.reduce((sum, s) => sum + s.tokens, 0);
      if (sourceTokens > contextTokens(provider, model) - RESERVED_TOKENS) {
        throw new ApiError('too_large');
      }
      const limits = PROVIDERS[provider].maxTokens;
      await streamAnswer({
        provider,
        apiKey,
        model,
        maxTokens: turns.length ? limits.followUp : limits.first,
        // Active sources go in their own cached system block (see buildSystem).
        system: buildSystem({ sources, mode: msg.mode, length }),
        messages: [buildFirstMessage(msg), ...turns],
        signal,
        onText: (text) => send({ type: 'delta', text }),
      });
      send({ type: 'done' });
    } catch (err) {
      if (!signal.aborted) send({ type: 'error', ...describeError(err) });
    }
  });
});
