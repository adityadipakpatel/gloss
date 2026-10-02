// Gloss content script. Injected on demand by the background worker the first time
// Gloss is triggered in a frame; after that it waits for 'gloss:ask' messages.
(() => {
  // A re-injection (e.g. after the extension is reloaded) replaces the old instance.
  try {
    globalThis.__glossTeardown?.();
  } catch {
    // The old instance belonged to an invalidated extension context; nothing to clean.
  }

  const CONTEXT_CHARS = 300; // how much surrounding text to send either side
  const MAX_SELECTION_CHARS = 6000;
  const BLOCK_SELECTOR =
    'p, li, td, th, dd, dt, blockquote, figcaption, pre, h1, h2, h3, h4, h5, h6, article, section, div';

  function onMessage(msg, _sender, sendResponse) {
    if (msg?.type !== 'gloss:ask') return;
    sendResponse({ ok: true });
    const selection = captureSelection(msg.selectionText);
    if (selection) openCard(selection);
  }

  let card = null; // state of the open card, or null

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function openCard(selection) {
    closeCard();

    // A custom tag name keeps page rules like "div { ... }" off the host; the closed
    // shadow root keeps page CSS and scripts out of the card itself.
    const host = document.createElement('gloss-card');
    host.style.cssText =
      'all: initial !important; position: absolute !important; z-index: 2147483647 !important;';
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(globalThis.GLOSS_CARD_CSS);
    root.adoptedStyleSheets = [sheet];

    const box = el('div', 'card');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Gloss');
    const header = el('header');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeCard);
    header.append(el('span', 'brand', 'Gloss'), close);
    const body = el('div', 'body');
    box.append(header, body);
    root.append(box);

    card = { host, box, body, selection };
    placeCard();
    document.documentElement.append(host);

    body.append(el('p', '', 'Gloss is alive. The answer will appear here.'));
  }

  // Put the card just below the selection (document coordinates, so it scrolls with it).
  function placeCard() {
    const rect = card.selection.getRect();
    card.host.style.setProperty('left', `${rect.left + window.scrollX}px`, 'important');
    card.host.style.setProperty('top', `${rect.bottom + 8 + window.scrollY}px`, 'important');
  }

  function closeCard() {
    if (!card) return;
    const closing = card;
    card = null;
    closing.host.remove();
  }

  const squash = (s) => s.replace(/\s+/g, ' ');

  // Returns { text, before, after, truncated, getRect } for the current selection, or
  // null if nothing is selected. getRect() gives the anchor's current viewport rect.
  function captureSelection(fallbackText) {
    let found = fromTextField() || fromRange();
    if (!found && fallbackText?.trim()) {
      // The context menu saw a selection we can't reach from here; use its text alone.
      const rect = new DOMRect(window.innerWidth / 2 - 160, window.innerHeight / 3, 0, 0);
      found = { text: fallbackText, before: '', after: '', getRect: () => rect };
    }
    if (!found) return null;
    const text = found.text.trim();
    return {
      ...found,
      text: text.slice(0, MAX_SELECTION_CHARS),
      truncated: text.length > MAX_SELECTION_CHARS,
      before: squash(found.before).slice(-CONTEXT_CHARS),
      after: squash(found.after).slice(0, CONTEXT_CHARS),
    };
  }

  // Selections inside <input>/<textarea> aren't exposed through window.getSelection().
  function fromTextField() {
    const field = document.activeElement;
    if (!field || (field.tagName !== 'TEXTAREA' && field.tagName !== 'INPUT')) return null;
    const { selectionStart: start, selectionEnd: end, value } = field; // null on e.g. type=email
    if (start == null || end == null || end <= start) return null;
    return {
      text: value.slice(start, end),
      before: value.slice(Math.max(0, start - CONTEXT_CHARS), start),
      after: value.slice(end, end + CONTEXT_CHARS),
      getRect: () => field.getBoundingClientRect(),
    };
  }

  function fromRange() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const text = selection.toString();
    if (!text.trim()) return null;
    const range = selection.getRangeAt(0).cloneRange();

    // Context = the rest of the enclosing block (paragraph, list item, cell...).
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const block = element?.closest(BLOCK_SELECTOR) || document.body;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);

    return {
      text,
      before: before.toString().slice(-CONTEXT_CHARS * 2),
      after: after.toString().slice(0, CONTEXT_CHARS * 2),
      getRect: () => range.getBoundingClientRect(),
    };
  }

  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.__glossTeardown = () => {
    closeCard();
    chrome.runtime.onMessage.removeListener(onMessage);
  };
})();
