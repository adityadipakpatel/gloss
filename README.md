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

## Choose a provider and add a key

Gloss works with any of these. Pick one under **AI provider** in settings, paste its key,
click **Save**, then **Test connection**.

| Provider | Cost | Get a key | Default model |
| --- | --- | --- | --- |
| Groq (default) | Free tier | [GroqCloud console](https://console.groq.com/keys) | `openai/gpt-oss-120b` |
| Google Gemini | Free tier | [Google AI Studio](https://aistudio.google.com/apikey) | `gemini-3.8-flash` |
| DeepSeek | Pay as you go, very cheap | [DeepSeek platform](https://platform.deepseek.com/api_keys) | `deepseek-flash` |
| Anthropic (Claude) | Paid API credits | [Claude Console](https://console.anthropic.com/settings/keys) | `claude-haiku-4-5-20251001` |

- Each provider keeps its own key, so you can switch between them without re-entering keys.
- The model dropdown lists suggested models. Choose **Other model ID…** to type any
  model the provider offers (useful when providers rename models).
- Free tiers have per-minute and per-day limits. When you hit one, the card says so and
  offers **Try again**.
- Google may use prompts sent on the Gemini free tier to improve its products. Don't
  use the free tier for anything private.
- A Claude.ai subscription (Pro or Max) can't be used in place of an Anthropic API key.

Keys are stored in `chrome.storage.local` in this browser only. They are never logged,
and each key is sent only to its own provider's API.

## Use it

- Works on any normal website. Select text, right-click, **Ask Gloss**. Or select text
  and press **Alt+G** (**Option+G** on a Mac).
- The card opens straight away and asks **Google AI Mode** about your selection, with a
  screenshot of the visible page attached so it can see diagrams, images and answer options
  that aren't in the selected text. No API key is needed, and it takes about 15 to 30
  seconds. It runs in a short-lived background tab, and the card shows just the answer
  and a one-line reason. Under the answer there are buttons for the alternatives:
  - **Search Google** looks the selection up on the web and shows the top answer (a
    featured snippet when Google has one, otherwise the top three results), with a link to
    open the full search.
  - **Ask AI + screenshot** sends the screenshot and selection to your chosen AI provider
    (Groq, Gemini, DeepSeek or Anthropic; needs that provider's API key) and streams the
    answer. It's usually faster than AI Mode.
  - **Open in Google AI Mode** opens the question in a normal tab.
- The follow-up box and the mode dropdown in the card header (Auto / Define / Explain
  simply / Answer a question) use your chosen AI provider, so they need its API key. The
  AI answers a word or short phrase with a definition, a longer passage with a short
  explanation, and a question (multiple choice, fill in the blank, true/false) with the
  answer in bold and a very short reason.
- The conversation in the card is thrown away when it closes.
- Close the card by clicking outside it, pressing Esc, scrolling away, or with the × button.
  The × closes it for good. The other ways only hide it for 10 seconds: ask about the same
  text again (right-click → Ask Gloss, or the shortcut) and it comes back exactly as it
  was, including an answer that kept arriving while it was hidden. The shortcut works
  even if the click cleared your selection.

### Keyboard shortcut

The default is **Alt+G**, which on a Mac is **Option (⌥)+G**. Chrome doesn't assign it if another extension already uses it;
change or set it at `chrome://extensions/shortcuts` (there is a button for this in settings).

## Settings

- **Provider and model**: see above.
- **Answer length**: Brief (default: the answer plus a few words of reason) or Normal
  (the answer plus a one-line reason, up to about 80 words).

## Reference sources

Sources are your own documents, used so Gloss can draw on them and point out when one
contradicts or adds to an answer. How they are used depends on how you ask:

- **Google AI Mode (the default):** it takes typed text, so a whole PDF can't be sent.
  Gloss picks up to four short passages (about 2,400 characters in total) from your active
  sources that share words with your selection, and types them into the question. The
  card says which sources were used. **Those passages are sent to Google**, so untick a
  source if it shouldn't be. Matching is by keywords, so a passage that uses different
  words for the same idea may be missed.
- **Ask AI + screenshot / follow-ups:** your active sources are sent whole to your chosen
  AI provider, so nothing is missed.
- **Search Google:** sources aren't used.


- **Upload PDFs**: text is extracted in the browser, page by page, with pdf.js. Only the
  extracted text is kept, not the PDF.
- **Paste text**: give it a name and paste any text.
- Each source has a checkbox (only ticked sources are attached) and a delete button.
- The page shows the estimated token total of the active sources and warns above about
  150,000 tokens. Estimates assume roughly 4 characters per token.

Active sources are sent with every question, so large ones cost more (or use more of a
free tier's quota) per question. They always sit at the same place at the start of the
prompt, so providers that cache repeated prompts (Anthropic, Gemini, DeepSeek) can reuse
them. On Anthropic they go in an explicitly cached block, which only applies above a
minimum size (about 4,000 tokens of sources on Haiku 4.5). Groq's free tier limits tokens
per minute, so large sources often fail there.

## Known limitations

- **Screenshots** capture only what is visible in the window right now, not the whole
  scrolled page, and go to a provider only when you press one of the screenshot buttons:
  your AI provider for **Ask AI + screenshot**, or Google for **Google AI Mode +
  screenshot**. The card hides itself for the instant of the capture, so it isn't in the
  picture, and your selection highlight is. Not every model can see images, so for that
  question Gloss switches to the provider's image-capable model: `qwen/qwen3.8-27b` on
  Groq, `deepseek-flash` on DeepSeek, `gemini-3.8-flash` on Gemini, Claude Haiku 4.5 on
  Anthropic (your own pick is used when it can see images). If the capture fails, you get
  a text-only answer and the card says so.
- **Google AI Mode is the most fragile feature.** Google has no API for it, so Gloss
  operates the page like a person would: it attaches the screenshot, types the question,
  and reads the answer when it stops streaming. It needs AI Mode to be available in your
  country and, usually, a signed-in Google account, and a Google layout change can break
  it. When it can't read an answer, the card says why and offers **Open in Google AI
  Mode**, **Search Google** and **Ask AI + screenshot** instead.
- **Search Google is a best effort.** There is no free official Google answer API, so Gloss
  runs the search in a real browser tab (opened in the background in your own browser, so
  it uses your Google session and sees the normal page, then closed within a second or
  two; you may see a tab flicker in the tab bar) and reads the answer from it. A Google
  layout change can leave it with nothing to show, and a "confirm you're not a robot" page
  needs you to confirm once. It then falls back to DuckDuckGo results, and failing that
  shows an error with an **Open in Google** link. The text you select is sent to Google
  (or DuckDuckGo) as the search query, exactly as if you had searched it yourself.
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
  model's context window (about 131,000 tokens on Groq, 200,000 on Claude Haiku 4.5) are
  rejected with a message; turn some off or switch provider.
- **Model names change**: if a suggested model is retired, the card reports that the
  model isn't available. Pick another, or type the current ID under **Other model ID…**.
- **Very long selections** are cut to the first 6,000 characters (the card says so).
- **After reloading the extension**, cards already open on a page stop working until
  you reload that page.
- Token counts are estimates, not exact.

## How it works

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3. Permissions: `contextMenus`, `storage`, `unlimitedStorage`, `activeTab`, `scripting`; host access only to the four AI provider APIs plus Google and DuckDuckGo search. |
| `background.js` | Service worker: context menu, shortcut, injects the content script on demand, makes the streaming API call. |
| `content.js` | Captures the selection and about 300 characters of context each side, renders the card in a closed Shadow DOM, handles follow-ups and dismissal. |
| `card.css.js` | The card's styles (white, whatever the system theme). |
| `options.html` / `options.js` / `options.css` | Settings and the sources manager. |
| `lib/providers.js` | Provider list: endpoints, suggested models, per-provider request settings. |
| `lib/api.js` | Streaming client for the Anthropic and OpenAI-compatible formats: SSE parsing and error mapping. |
| `lib/prompt.js` | System prompt and message construction. |
| `lib/store.js` | Everything stored in `chrome.storage.local`. |
| `lib/aimode.js` | Operates Google AI Mode in a background tab: attaches the screenshot, asks, and reads the finished answer. |
| `lib/excerpts.js` | Picks the passages of your sources that match a selection, for Google AI Mode. |
| `lib/search.js` | Reads a rendered search results tab (Google, or DuckDuckGo as a fallback) into a short answer and a few results. |
| `lib/markdown.js` | Tiny renderer for bold, italics, code and lists that builds DOM nodes only (no `innerHTML`). |
| `lib/pdf*.mjs` | Vendored pdf.js (see `lib/README.md`). |

Nothing runs on a page until you trigger Gloss there. While a card is open it listens
for outside clicks, Esc and scrolling; those listeners are removed when it closes.

## Privacy

There is no backend, analytics or sync. Each question sends the selected text, its
surrounding context, the page title and URL, and your active sources to the provider
you selected, using your key. Nothing else leaves the browser.
