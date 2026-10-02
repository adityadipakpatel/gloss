// Gloss background service worker.
// Owns the context menu, the keyboard shortcut and the API calls.
import { ApiError, describeError, streamMessage } from './lib/api.js';
import { buildFirstMessage, buildSystem } from './lib/prompt.js';
import { getSettings } from './lib/store.js';

const FIRST_ANSWER_TOKENS = 400;
const FOLLOW_UP_TOKENS = 800;

const MENU_ID = 'ask-gloss';
// Injected on demand, in this order. Nothing runs on a page until Gloss is triggered there.
const CONTENT_FILES = ['lib/markdown.js', 'card.css.js', 'content.js'];

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
      const { apiKey, model, length } = await getSettings();
      if (!apiKey) throw new ApiError('no_key');
      // msg.turns holds the follow-up conversation so far (assistant/user alternating).
      const turns = msg.turns || [];
      const body = {
        model,
        max_tokens: turns.length ? FOLLOW_UP_TOKENS : FIRST_ANSWER_TOKENS,
        system: buildSystem({ mode: msg.mode, length }),
        messages: [buildFirstMessage(msg), ...turns],
      };
      await streamMessage({
        apiKey,
        body,
        signal,
        onText: (text) => send({ type: 'delta', text }),
      });
      send({ type: 'done' });
    } catch (err) {
      if (!signal.aborted) send({ type: 'error', ...describeError(err) });
    }
  });
});
