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

  // The answer sits in a sibling of some ancestor of the question box. Take the sibling
  // with the most text, then strip page chrome from it.
  function answerText(box, question) {
    const root = document.querySelector('main, [role="main"], #main') || document.body;
    let best = '';
    for (let node = box; node && node !== root.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement?.children || []) {
        if (sibling === node || sibling.contains(box)) continue;
        const text = sibling.innerText || '';
        if (text.length > best.length && text.length < 12_000) best = text;
      }
      if (node === root) break;
    }
    const lines = [];
    for (const raw of best.split('\n')) {
      const line = raw.trim();
      if (!line || UI_LINE.test(line) || line.startsWith(question.slice(0, 30))) continue;
      if (ANSWER_END.test(line) && lines.length) break;
      lines.push(line);
    }
    return lines.join('\n').slice(0, MAX_ANSWER_CHARS);
  }

  const blocked = () => location.pathname.startsWith('/sorry');

  // Wait until the answer has grown past what was on the page before submitting and has
  // stopped changing.
  async function readAnswer(box, question, baseline) {
    const end = Date.now() + ANSWER_TIMEOUT_MS;
    let last = '';
    let changedAt = Date.now();
    while (Date.now() < end) {
      await sleep(700);
      if (blocked()) return { blocked: true };
      const text = answerText(box, question);
      if (text !== last) {
        last = text;
        changedAt = Date.now();
      }
      const generating = clickables().some((b) => /stop/i.test(labelOf(b)));
      const grew = text.length > 60 && text !== baseline;
      if (grew && !generating && Date.now() - changedAt > 3000) return { answer: text };
    }
    return last.length > 60 && last !== baseline ? { answer: last } : { error: 'timeout' };
  }

  // image: a data: URL to attach, or null. preloaded: the question is already in the
  // page URL, so Google submits it by itself.
  async function run(question, image, preloaded) {
    if (blocked()) return { blocked: true };
    const box = await waitFor(findInput, 10_000);
    if (!box) return { error: 'no-input' };
    if (preloaded) return readAnswer(box, question, '');
    if (image && !(await attachImage(box, fileFromDataUrl(image)))) return { error: 'attach' };
    const baseline = answerText(box, question);
    setText(box, question);
    await sleep(300);
    await submit(box, question);
    return readAnswer(box, question, baseline);
  }

  globalThis.GlossAiMode = { run };
})();
