// Gloss background service worker.
// Owns the context menu, the keyboard shortcut and (later) the API calls.

const MENU_ID = 'ask-gloss';
// Injected on demand, in this order. Nothing runs on a page until Gloss is triggered there.
const CONTENT_FILES = ['card.css.js', 'content.js'];

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
