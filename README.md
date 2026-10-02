# Gloss

A Chrome extension for reading faster. Select a word, phrase, sentence or question on
any page, right-click, choose **Ask Gloss**, and a small card appears next to your
selection with a short AI answer that takes the surrounding text into account. You can
also attach your own PDFs and notes as reference sources.

Plain JavaScript, HTML and CSS. No build step, no server, no accounts.

## Install (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the repository folder (the one containing `manifest.json`).
5. Click the Gloss toolbar icon to open its settings.

After pulling new code, press the reload button on the Gloss entry in `chrome://extensions`,
then reload any tabs where you want to use it.

## Get an API key

Gloss calls the Anthropic API directly with your own key.

1. Sign in at the [Claude Console](https://console.anthropic.com/) and add billing credit.
2. Create a key under **Settings → API keys**.
3. Paste it into the **API key** field in Gloss settings and click **Save**.
4. Click **Test connection** to check it works.

The key is stored in `chrome.storage.local` in this browser only. It is never logged and
is sent nowhere except `https://api.anthropic.com`.

## Use it

- Select text, right-click, **Ask Gloss**. Or select text and press **Alt+G**.
- The card streams a short answer:
  - a word or short phrase gets a definition, then what it means in this context;
  - a longer passage gets a simple two or three sentence explanation;
  - a question (including multiple choice) gets the answer in bold, then a one-line reason.
- The dropdown in the card header (Auto / Define / Explain simply / Answer a question)
  overrides the automatic choice and asks again.
- Type in **Ask a follow-up…** to continue the conversation about the same selection.
  The conversation is thrown away when the card closes.
- Close the card by clicking outside it, pressing Esc, scrolling away, or with the × button.

### Keyboard shortcut

The default is **Alt+G**. Chrome doesn't assign it if another extension already uses it;
change or set it at `chrome://extensions/shortcuts` (there is a button for this in settings).

## Settings

- **Model**: Claude Haiku 4.5 (default, fast and cheap) or Claude Sonnet 5.5 (more capable).
- **Answer length**: Brief (about 50 words) or Normal (about 80 words).

## Reference sources

Sources are your own documents, attached to every question so Gloss can use them and
point out when one contradicts or adds to an answer.

- **Upload PDFs**: text is extracted in the browser, page by page, with pdf.js. Only the
  extracted text is kept, not the PDF.
- **Paste text**: give it a name and paste any text.
- Each source has a checkbox (only ticked sources are attached) and a delete button.
- The page shows the estimated token total of the active sources and warns above about
  150,000 tokens. Estimates assume roughly 4 characters per token.

Active sources are sent with every question, so large ones cost more per question. They
are sent in a cached block: repeat questions within about five minutes reuse the cache
and are cheaper and faster. Caching only applies above a minimum size (about 4,000
tokens of sources on Haiku 4.5).

## Known limitations

- **Pages where extensions can't run**: `chrome://` pages, the Chrome Web Store and
  Chrome's built-in PDF viewer. Gloss shows a red **!** on its toolbar icon there (hover
  for the reason) instead of a card.
- **Embedded frames from other sites**: selections inside cross-origin iframes aren't
  reachable with the minimal `activeTab` permission. The Alt+G shortcut only looks at
  the top-level page.
- **Scanned or image-only PDFs** have no text to extract. Gloss refuses PDFs with no
  text and warns when a PDF has very little. PDFs that rely on special character maps
  (some Chinese, Japanese and Korean documents) may extract poorly.
- **No search over sources**: all active sources are sent whole. Sources larger than the
  model's context window (about 200,000 tokens for Haiku 4.5) are rejected with a
  message; turn some off or switch to Sonnet 5.5.
- **Very long selections** are cut to the first 6,000 characters (the card says so).
- **After reloading the extension**, cards already open on a page stop working until
  you reload that page.
- Token counts are estimates, not exact.

## How it works

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3. Permissions: `contextMenus`, `storage`, `unlimitedStorage`, `activeTab`, `scripting`; host access only to `https://api.anthropic.com/*`. |
| `background.js` | Service worker: context menu, shortcut, injects the content script on demand, makes the streaming API call. |
| `content.js` | Captures the selection and about 300 characters of context each side, renders the card in a closed Shadow DOM, handles follow-ups and dismissal. |
| `card.css.js` | The card's styles (light and dark). |
| `options.html` / `options.js` / `options.css` | Settings and the sources manager. |
| `lib/api.js` | Anthropic Messages API client: SSE parsing and error mapping. |
| `lib/prompt.js` | System prompt and message construction. |
| `lib/store.js` | Everything stored in `chrome.storage.local`. |
| `lib/markdown.js` | Tiny renderer for bold, italics, code and lists that builds DOM nodes only (no `innerHTML`). |
| `lib/pdf*.mjs` | Vendored pdf.js (see `lib/README.md`). |

Nothing runs on a page until you trigger Gloss there. While a card is open it listens
for outside clicks, Esc and scrolling; those listeners are removed when it closes.

## Privacy

There is no backend, analytics or sync. Each question sends the selected text, its
surrounding context, the page title and URL, and your active sources to the Anthropic
API using your key. Nothing else leaves the browser.
