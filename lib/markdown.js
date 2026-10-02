// Tiny, safe markdown renderer for model output: paragraphs, bullet and numbered
// lists, **bold**, *italics* and `code`. It only ever creates elements and text
// nodes (never innerHTML), so nothing in the model's output can become markup.
(() => {
  const INLINE = new RegExp(
    [
      /\*\*(.+?)\*\*/, // **bold**
      /(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/, // *italic*
      /(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/, // _italic_ (not snake_case)
      /`([^`\n]+)`/, // `code`
    ]
      .map((re) => re.source)
      .join('|'),
    'g'
  );

  function appendInline(parent, text) {
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
      if (match.index > last) parent.append(text.slice(last, match.index));
      const [, bold, starItalic, underscoreItalic, code] = match;
      if (bold != null) {
        const strong = document.createElement('strong');
        appendInline(strong, bold); // allow italics inside bold
        parent.append(strong);
      } else {
        const node = document.createElement(code != null ? 'code' : 'em');
        node.textContent = code ?? starItalic ?? underscoreItalic;
        parent.append(node);
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // Returns a DocumentFragment. Called again with the whole text on every streamed
  // chunk; unclosed markers simply show as literal characters until they close.
  function render(markdown) {
    const fragment = document.createDocumentFragment();
    let list = null;
    let paragraph = null;
    for (const raw of markdown.split('\n')) {
      const line = raw.trim();
      if (!line) {
        list = paragraph = null;
        continue;
      }
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        const tag = bullet ? 'UL' : 'OL';
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag);
          fragment.append(list);
        }
        const item = document.createElement('li');
        appendInline(item, (bullet || numbered)[1]);
        list.append(item);
        paragraph = null;
        continue;
      }
      list = null;
      if (paragraph) {
        paragraph.append(document.createElement('br'));
      } else {
        paragraph = document.createElement('p');
        fragment.append(paragraph);
      }
      appendInline(paragraph, line.replace(/^#{1,6}\s+/, '')); // headings become plain lines
    }
    return fragment;
  }

  globalThis.GlossMarkdown = { render };
})();
