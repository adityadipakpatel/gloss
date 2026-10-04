// Drives Google's AI Mode inside a search tab the background worker opened: attaches a
// screenshot, types the question, submits it, waits for the answer to finish streaming,
// and returns its text. Injected into that tab only; never into the user's pages.
//
// Google doesn't offer an API for this, so it works by looking at the page the way a
// person would. That makes it the most fragile part of Gloss: if Google changes AI
// Mode's layout it may stop working, and it returns an error code instead of guessing.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ANSWER_TIMEOUT_MS = 60_000;
  const MAX_ANSWER_CHARS = 1500;
  const INPUT_SELECTOR = 'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], input[type="search"]';
  // Buttons and labels that are page chrome, not part of the answer.
  const UI_LINE = /^(ai mode|all|images|videos|news|shopping|more|copy|share|show more|show all|good response|bad response|thumb(s)? (up|down)|new chat|sign in)$/i;
  // Hidden labels for screen readers ("Skip to previous prompt", "AI Mode response is
  // ready"...) and the model's closing offers ("Would you like help with...").
  const A11Y_LINE = /^(ai mode conversation|you sent|skip to|ai mode response|all items removed)/i;
  const OFFER_LINE = /^(would you like|do you want|let me know|if you('d| would) like|feel free)/i;
  const ANSWER_END = /^(sources|show all|ai responses may include mistakes|learn more)/i;

  async function waitFor(check, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const value = check();
      if (value) return value;
      await sleep(200);
    }
    return null;
  }

  function visible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const findInput = () => [...document.querySelectorAll(INPUT_SELECTOR)].find(visible) || null;
  const labelOf = (node) => `${node.getAttribute('aria-label') || ''} ${node.title || ''}`;
  const clickables = () => [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')].filter(visible);
  // Previews of attached images are blob: or data: images.
  const imageCount = () => document.querySelectorAll('img[src^="blob:"], img[src^="data:image"]').length;

  function fileFromDataUrl(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const type = /^data:([^;]+)/.exec(header)?.[1] || 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], 'screenshot.jpg', { type });
  }

  // Try the page's file input first, then a simulated paste into the question box.
  async function attachImage(box, file) {
    const before = imageCount();
    const attached = () => imageCount() > before;
    const transfer = new DataTransfer();
    transfer.items.add(file);

    let fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) {
      // The input often only exists once the "add image" control has been opened.
      clickables().find((b) => /upload|add image|attach|photo|lens|image/i.test(labelOf(b)))?.click();
      await sleep(600);
      clickables().find((b) => /upload/i.test(`${labelOf(b)} ${b.textContent}`))?.click();
      await sleep(300);
      fileInput = document.querySelector('input[type="file"]');
    }
    if (fileInput) {
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (await waitFor(attached, 6000)) return true;
    }
    box.focus();
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    return Boolean(await waitFor(attached, 6000));
  }

  function setText(box, text) {
    box.focus();
    if (box.isContentEditable) {
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
      return;
    }
    const proto = box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, text); // bypass framework value tracking
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function submit(box, text) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      box.dispatchEvent(
        new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }
    await sleep(1500);
    // If Enter did nothing, the text is still in the box: use the send button instead.
    const remaining = box.isContentEditable ? box.innerText : box.value;
    if (remaining && remaining.includes(text.slice(0, 20))) {
      clickables().find((b) => /^(submit|send)|\bsubmit\b/i.test(labelOf(b)) && !b.disabled)?.click();
    }
  }

  const blocked = () => location.pathname.startsWith('/sorry');

  const pageLines = () =>
    (document.body.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  // The answer is whatever text appeared on the page after the question was submitted,
  // minus the echo of the question and the page's own buttons and labels. Comparing
  // before and after needs no knowledge of how the page is laid out.
  function newAnswerText(baseline, question, minLine) {
    const lines = [];
    for (const line of pageLines()) {
      if (baseline.has(line) || line.length < minLine || UI_LINE.test(line)) continue;
      if (A11Y_LINE.test(line) || OFFER_LINE.test(line)) continue;
      // The page echoes the question (also inside "You sent: ..." labels).
      if (line.includes(question.slice(0, 40)) || (line.length > 8 && question.includes(line))) continue;
      if (ANSWER_END.test(line) && lines.length) break;
      lines.push(line);
    }
    // Drop a closing offer such as "Would you like help with ...?".
    while (lines.length > 1 && lines.at(-1).endsWith('?')) lines.pop();
    return lines.join('\n').slice(0, MAX_ANSWER_CHARS);
  }

  // The question asks for {"answer": "...", "reason": "..."}. Find the last complete
  // object of that shape in the text (tolerating curly quotes and line breaks) and ignore
  // the <placeholder> template that the page echoes back with the question.
  function parseAnswerJson(text) {
    const flat = text.replace(/[“”]/g, '"').replace(/\s+/g, ' ');
    const unescape = (raw = '') => {
      try {
        return JSON.parse(`"${raw}"`);
      } catch {
        return raw;
      }
    };
    const pattern = /"answer"\s*:\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)")?\s*\}/g;
    let found = null;
    for (const match of flat.matchAll(pattern)) {
      const answer = unescape(match[1]).trim();
      if (answer && !answer.startsWith('<')) found = { answer, reason: unescape(match[2]).trim() };
    }
    return found;
  }

  // Wait for the answer to finish: the response buttons (thumbs up and down) appear when
  // it is done, and as a fallback the text simply stops changing.
  async function readAnswer(baseline, question, minLine) {
    const end = Date.now() + ANSWER_TIMEOUT_MS;
    let last = '';
    let changedAt = Date.now();
    while (Date.now() < end) {
      await sleep(700);
      if (blocked()) return { blocked: true };
      const text = newAnswerText(baseline, question, minLine);
      if (text !== last) {
        last = text;
        changedAt = Date.now();
      }
      const quiet = Date.now() - changedAt;
      const structured = parseAnswerJson(pageLines().join('\n'));
      if (structured && quiet > 700) return structured; // a complete JSON object is a finished answer
      const finished =
        clickables().some((b) => /good response|bad response/i.test(labelOf(b))) ||
        pageLines().some((line) => /ai mode response is ready/i.test(line));
      if (text && ((finished && quiet > 1500) || (text.length >= 40 && quiet > 4000))) {
        return { answer: text.replace(/[{}"]/g, '') }; // not JSON after all: show it as plain text
      }
    }
    if (last) return { answer: last.replace(/[{}"]/g, '') };
    // Say what the page showed, so a failure can be diagnosed.
    return { error: 'timeout', sample: pageLines().slice(-8).join(' | ').slice(0, 300) };
  }

  // image: a data: URL to attach, or null. preloaded: the question is already in the
  // page URL, so Google submits it by itself.
  async function run(question, image, preloaded) {
    if (blocked()) return { blocked: true };
    const box = await waitFor(findInput, 10_000);
    if (!box) return { error: 'no-input' };
    // When the page was loaded with the question in it, lines of 1 to 3 characters are
    // labels (an account initial, "PRO"), since there was no chance to take a baseline.
    if (preloaded) return readAnswer(new Set(), question, 4);
    if (image && !(await attachImage(box, fileFromDataUrl(image)))) return { error: 'attach' };
    const baseline = new Set(pageLines());
    setText(box, question);
    await sleep(300);
    await submit(box, question);
    return readAnswer(baseline, question, 1);
  }

  globalThis.GlossAiMode = { run };
})();
