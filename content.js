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
  const CARD_WIDTH = 320; // keep in sync with card.css.js
  const CARD_MAX_HEIGHT = 300;
  const CARD_MIN_HEIGHT = 150;
  const GAP = 8; // between selection and card
  const MARGIN = 8; // between card and viewport edge
  const SCROLL_CLOSE_PX = 80; // scroll distance that dismisses the card
  // Keep in sync with MODES in lib/prompt.js.
  const MODES = [
    ['auto', 'Auto'],
    ['define', 'Define'],
    ['explain', 'Explain simply'],
    ['answer', 'Answer a question'],
  ];
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
    const mode = el('select', 'mode');
    mode.title = 'Answer style';
    mode.setAttribute('aria-label', 'Answer style');
    for (const [value, label] of MODES) {
      const option = el('option', '', label);
      option.value = value;
      mode.append(option);
    }
    mode.addEventListener('change', () => {
      // Overrides the automatic choice: start over with the same selection.
      card.mode = mode.value;
      card.turns = [];
      card.body.replaceChildren();
      startAnswer();
    });
    header.append(el('span', 'brand', 'Gloss'), mode, close);
    const body = el('div', 'body');

    const footer = el('form', 'footer');
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'Ask a follow-up…';
    input.setAttribute('aria-label', 'Ask a follow-up');
    input.autocomplete = 'off';
    input.maxLength = 500;
    footer.append(input);
    footer.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question || card.busy) return; // keep the text until the current answer ends
      input.value = '';
      askFollowUp(question);
    });

    box.append(header, body, footer);
    root.append(box);

    card = { host, box, body, selection, mode: 'auto', turns: [] };
    placeCard();
    document.documentElement.append(host);
    addDismissListeners(card);

    showChooser();
  }

  function button(label, onClick, className = 'action') {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  // Opening the card costs nothing: the user picks how to get the answer.
  function showChooser() {
    const c = card;
    const choice = el('div', 'choice');
    choice.append(
      el('p', 'choice-label', 'How do you want the answer?'),
      el('div', 'choice-row')
    );
    choice.lastChild.append(
      button('Search Google', startSearch),
      button('Ask AI', startAnswer, 'action secondary'),
      button('Ask AI + screenshot', startScreenshotAnswer, 'action secondary'),
      button('Google AI Mode + screenshot', startAiMode, 'action secondary')
    );
    c.chooser = choice;
    c.body.append(choice);
  }

  function clearChooser(c) {
    c.chooser?.remove();
    c.chooser = null;
  }

  // Ask the background worker for an answer and stream it into a new answer element.
  // card.turns holds the follow-up conversation after the first answer.
  function startAnswer() {
    const c = card;
    disconnect(c);
    clearChooser(c);
    c.searchId = (c.searchId || 0) + 1; // abandon any search still in flight
    if (c.selection.truncated && !c.turns.length) {
      c.body.append(
        el('p', 'note', `Long selection: only the first ${MAX_SELECTION_CHARS.toLocaleString()} characters were sent.`)
      );
    }
    c.answerText = '';
    c.answerEl = el('div', 'answer');
    c.answerEl.append(loadingDots());
    c.body.append(c.answerEl);
    c.body.scrollTop = c.body.scrollHeight;

    let port;
    try {
      port = chrome.runtime.connect({ name: 'gloss' });
    } catch {
      // The extension was reloaded or updated under this page.
      showError({ message: 'Gloss was updated. Reload this page to use it again.' });
      return;
    }
    c.port = port;
    c.busy = true;
    const current = () => card === c && c.port === port;
    port.onMessage.addListener((msg) => {
      if (!current()) return;
      if (msg.type === 'delta') appendAnswer(msg.text);
      else if (msg.type === 'done') finishAnswer();
      else if (msg.type === 'error') showError(msg);
    });
    port.onDisconnect.addListener(() => {
      if (current() && c.busy) showError({ message: 'Gloss was interrupted.', action: 'retry' });
    });
    const { text, before, after, truncated } = c.selection;
    port.postMessage({
      type: 'ask',
      selection: { text, before, after, truncated },
      page: { title: document.title, url: location.href },
      mode: c.mode,
      turns: c.turns,
      image: c.image || null,
    });
  }

  // --- Screenshot ----------------------------------------------------------

  // Screenshot the visible part of the page (a data: URL) for the AI to look at, or null
  // if it can't be captured. The card is taken out of the page for the shot so it isn't
  // in it; the page's own selection highlight stays visible.
  async function captureScreenshot(c) {
    c.host.remove();
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const reply = await chrome.runtime.sendMessage({ type: 'gloss:capture' });
      return reply?.dataUrl || null;
    } catch {
      return null;
    } finally {
      if (card === c) document.documentElement.append(c.host);
    }
  }

  async function startScreenshotAnswer() {
    const c = card;
    disconnect(c);
    clearChooser(c);
    const id = (c.searchId = (c.searchId || 0) + 1);
    c.answerEl = el('div', 'answer');
    c.answerEl.append(loadingDots());
    c.body.append(c.answerEl);

    const image = await captureScreenshot(c);
    if (card !== c || c.searchId !== id) return;
    c.image = image; // kept for follow-ups and mode changes on this card
    c.answerEl.remove();
    if (!image) {
      c.body.append(el('p', 'note', "Couldn't capture the page, so this answer uses the selected text only."));
    }
    startAnswer();
  }

  // --- Google AI Mode ------------------------------------------------------

  const MAX_AI_MODE_QUESTION_CHARS = 800;

  // Ask Google's AI Mode about the selection, with a screenshot of the page attached.
  async function startAiMode() {
    const c = card;
    disconnect(c);
    clearChooser(c);
    const id = (c.searchId = (c.searchId || 0) + 1);
    const live = () => card === c && c.searchId === id;

    c.answerEl = el('div', 'answer');
    c.answerEl.append(loadingDots(), el('p', 'note', 'Asking Google AI Mode. This takes about 15 to 30 seconds.'));
    c.body.append(c.answerEl);

    const image = await captureScreenshot(c);
    if (!live()) return;
    const selected = c.selection.text.replace(/\s+/g, ' ').trim().slice(0, MAX_AI_MODE_QUESTION_CHARS);
    const question =
      'Answer briefly, in at most two sentences, with the answer first. ' +
      (image ? 'The attached screenshot shows the page the question comes from. ' : '') +
      `Question: ${selected}`;

    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'gloss:aimode', query: question, image });
    } catch {
      if (live()) showError({ message: 'Gloss was updated. Reload this page to use it again.' });
      return;
    }
    if (live()) showAiModeResult(c, selected, Boolean(image), reply);
  }

  function showAiModeResult(c, selected, hadImage, reply) {
    const view = el('div', 'search');
    if (reply?.answer) {
      const answer = el('div', 'answer');
      answer.append(globalThis.GlossMarkdown.render(reply.answer));
      view.append(
        answer,
        el('p', 'note', hadImage ? 'From Google AI Mode, using the screenshot.' : 'From Google AI Mode (no screenshot: the capture failed).')
      );
    } else {
      const reason = reply?.blocked
        ? 'Google is asking you to confirm you are not a robot. Open Google AI Mode, confirm, then try again.'
        : reply?.error === 'attach'
          ? "Couldn't attach the screenshot in Google AI Mode. Google's page may have changed."
          : "Couldn't read an answer from Google AI Mode. You may need to be signed in to Google, or it may not be available in your country.";
      view.append(el('p', 'error', reason));
    }

    const row = el('div', 'choice-row');
    const open = el('a', 'action secondary', 'Open in Google AI Mode');
    open.href = `https://www.google.com/search?udm=50&q=${encodeURIComponent(selected)}`;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    row.append(open, button('Search Google', startSearch, 'action secondary'), button('Ask AI + screenshot', startScreenshotAnswer, 'action secondary'));
    view.append(row);

    c.answerEl.replaceChildren(view);
    c.body.scrollTop = 0;
  }

  // --- Web search ----------------------------------------------------------

  const SEARCH_ENGINES = ['google', 'duckduckgo']; // the second is the fallback
  const MAX_QUERY_CHARS = 250;

  function loadingDots() {
    const loading = el('div', 'loading');
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', 'Working');
    loading.append(el('span'), el('span'), el('span'));
    return loading;
  }

  // Search the web for the selection and show the top answer in the card.
  async function startSearch() {
    const c = card;
    disconnect(c); // stop any AI answer in progress
    clearChooser(c);
    const id = (c.searchId = (c.searchId || 0) + 1);
    const live = () => card === c && c.searchId === id;
    const query = c.selection.text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);

    c.answerText = '';
    c.answerEl = el('div', 'answer');
    c.answerEl.append(loadingDots());
    c.body.append(c.answerEl);
    c.body.scrollTop = c.body.scrollHeight;

    let found = null;
    let blocked = false;
    try {
      for (const engine of SEARCH_ENGINES) {
        const reply = await chrome.runtime.sendMessage({ type: 'gloss:search', query, engine });
        if (!live()) return;
        if (reply?.result) {
          found = { ...reply.result, engine };
          break;
        }
        blocked = blocked || Boolean(reply?.blocked);
      }
    } catch {
      if (live()) showError({ message: 'Gloss was updated. Reload this page to use it again.' });
      return;
    }
    if (live()) showSearchResult(c, query, found, blocked);
  }

  function showSearchResult(c, query, found, blocked) {
    const view = el('div', 'search');
    const engine = found?.engine || 'google';
    const openUrl = globalThis.GlossSearch.searchUrl(engine, query);

    if (!found) {
      view.append(
        el(
          'p',
          'error',
          blocked
            ? 'Google is asking you to confirm you are not a robot. Open the search, confirm, then try again.'
            : "Couldn't read an answer from the web search."
        )
      );
    } else {
      if (found.answer) view.append(el('p', 'search-answer', found.answer));
      const list = el('ul', 'search-results');
      for (const { title, url, snippet } of found.results) {
        const item = el('li');
        const link = el('a', '', title || url);
        link.href = url; // unwrap() only ever returns http(s) URLs
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link);
        if (snippet) item.append(el('span', 'snippet', snippet));
        list.append(item);
      }
      view.append(list);
      view.append(
        el('p', 'note', engine === 'google' ? 'From Google search.' : "Couldn't read Google's page, so this is from DuckDuckGo.")
      );
    }

    const row = el('div', 'choice-row');
    const open = el('a', 'action secondary', engine === 'google' ? 'Open in Google' : 'Open search');
    open.href = openUrl;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    row.append(open, button('Ask AI instead', startAnswer, 'action secondary'));
    view.append(row);

    c.answerEl.replaceChildren(view);
    c.body.scrollTop = 0;
  }

  // Continue the conversation about the same selection. It lives only in card.turns
  // and is discarded when the card closes.
  function askFollowUp(question) {
    const c = card;
    if (c.turns.at(-1)?.role === 'user') c.turns.pop(); // the previous follow-up failed
    c.turns.push({ role: 'user', content: question });
    c.body.append(el('p', 'question', question));
    startAnswer();
  }

  function disconnect(c) {
    const port = c.port;
    c.port = null;
    c.busy = false;
    try {
      port?.disconnect();
    } catch {
      // Already gone.
    }
  }

  function finishAnswer() {
    const c = card;
    disconnect(c);
    if (!c.answerText.trim()) {
      showError({ message: 'No answer came back.', action: 'retry' });
      return;
    }
    c.turns.push({ role: 'assistant', content: c.answerText });
  }

  // Replace the loading dots (or a partial answer) with an error message and, where
  // it helps, a button: action is 'settings', 'retry' or null.
  function showError({ message, action }) {
    const c = card;
    disconnect(c);
    const error = el('div', 'error');
    error.append(el('p', '', message));
    if (action === 'settings') {
      const button = el('button', 'action', 'Open settings');
      button.type = 'button';
      button.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({ type: 'gloss:open-options' }).catch(() => {});
        } catch {
          // Extension context invalidated (reloaded); nothing to open from here.
        }
        closeCard();
      });
      error.append(button);
    } else if (action === 'retry') {
      const button = el('button', 'action', 'Try again');
      button.type = 'button';
      button.addEventListener('click', () => {
        c.answerEl.remove();
        startAnswer();
      });
      error.append(button);
    }
    c.answerEl.replaceChildren(error);
    c.body.scrollTop = c.body.scrollHeight;
  }

  // Add streamed text to the current answer and re-render it.
  function appendAnswer(text) {
    const c = card;
    c.answerText += text;
    const pinned = c.body.scrollHeight - c.body.scrollTop - c.body.clientHeight < 24;
    c.answerEl.replaceChildren(globalThis.GlossMarkdown.render(c.answerText));
    if (pinned) c.body.scrollTop = c.body.scrollHeight;
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  // Place the card just below the selection, or above it when there's more room
  // there, clamped to the viewport. Coordinates are document-relative so the card
  // scrolls with the text it explains.
  function placeCard() {
    const rect = card.selection.getRect();
    const viewW = document.documentElement.clientWidth;
    const viewH = window.innerHeight;
    const width = Math.min(CARD_WIDTH, viewW - 2 * MARGIN);
    const left = clamp(rect.left, MARGIN, viewW - width - MARGIN);

    const roomBelow = viewH - rect.bottom - GAP - MARGIN;
    const roomAbove = rect.top - GAP - MARGIN;
    const above = roomBelow < CARD_MAX_HEIGHT && roomAbove > roomBelow;
    const maxHeight = clamp(above ? roomAbove : roomBelow, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT);
    // "edge" is the card's top edge when below the selection and its bottom edge when
    // above it: translateY(-100%) then lets the card grow upward as the answer streams.
    const edge = above
      ? clamp(rect.top - GAP, MARGIN + maxHeight, viewH - MARGIN)
      : clamp(rect.bottom + GAP, MARGIN, viewH - MARGIN - maxHeight);

    const style = card.host.style;
    style.setProperty('left', `${left + window.scrollX}px`, 'important');
    style.setProperty('top', `${edge + window.scrollY}px`, 'important');
    style.setProperty('transform', above ? 'translateY(-100%)' : 'none', 'important');
    card.box.style.setProperty('--max-height', `${maxHeight}px`);
  }

  // Close on click outside, Esc, or once the anchor has scrolled a little way. These
  // are the only page-level listeners Gloss adds, and closeCard() removes them all.
  function addDismissListeners(c) {
    const startTop = c.selection.getRect().top;
    const startScrollY = window.scrollY;

    // Events from inside the closed shadow root are retargeted to the host.
    c.onPointerDown = (event) => {
      if (event.target !== c.host) closeCard();
    };
    c.onKeyDown = (event) => {
      if (event.key === 'Escape') closeCard();
    };
    c.onScroll = (event) => {
      if (event.target === c.host) return; // scrolling inside the card
      // Measuring the anchor (not window.scrollY) also catches nested scroll areas.
      const rect = c.selection.getRect();
      const moved =
        rect.width || rect.height
          ? Math.abs(rect.top - startTop)
          : Math.abs(window.scrollY - startScrollY);
      if (moved > SCROLL_CLOSE_PX) closeCard();
    };
    document.addEventListener('pointerdown', c.onPointerDown, true);
    document.addEventListener('keydown', c.onKeyDown, true);
    window.addEventListener('scroll', c.onScroll, { capture: true, passive: true });

    // Keep typing in the card from triggering the page's keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      c.box.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  function closeCard() {
    if (!card) return;
    const closing = card;
    card = null;
    document.removeEventListener('pointerdown', closing.onPointerDown, true);
    document.removeEventListener('keydown', closing.onKeyDown, true);
    window.removeEventListener('scroll', closing.onScroll, { capture: true });
    disconnect(closing);
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
