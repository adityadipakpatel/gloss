// Styles for the popup card, as a string: the card lives in a closed Shadow DOM, so
// the content script adopts this as a constructed stylesheet (no <style> tag, which a
// strict page CSP could block).
globalThis.GLOSS_CARD_CSS = `
:host { all: initial; }

.card {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #667085;
  --border: #d9dde3;
  --field: #f6f7f9;
  --accent: #9a6700;
  --danger: #b3261e;

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: calc(100vw - 16px);
  max-height: var(--max-height, 300px);
  overflow: hidden;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}

header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px 5px 11px;
  border-bottom: 1px solid var(--border);
}

.brand {
  margin-right: auto;
  color: var(--accent);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.mode {
  max-width: 150px;
  padding: 2px 4px;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.close {
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--muted);
  background: none;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.close:hover { color: var(--fg); background: var(--field); }

.body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 10px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
}
.body p { margin: 0 0 0.55em; }
.body ul, .body ol { margin: 0 0 0.55em; padding-left: 1.3em; }
.body li { margin: 0.15em 0; }
.answer > :last-child { margin-bottom: 0; }
.body code {
  padding: 0 3px;
  background: var(--field);
  border-radius: 4px;
  font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.question {
  margin: 10px 0 6px;
  padding-top: 8px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  font-weight: 600;
}

.footer { margin: 0; padding: 6px; border-top: 1px solid var(--border); }
.footer input {
  box-sizing: border-box;
  width: 100%;
  padding: 5px 8px;
  color: var(--fg);
  background: var(--field);
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 12.5px;
}
.footer input::placeholder { color: var(--muted); }

.error p { color: var(--danger); }
.action {
  margin-top: 2px;
  padding: 4px 10px;
  color: var(--bg);
  background: var(--accent);
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.note { margin: 0 0 8px; color: var(--muted); font-size: 12px; }

.loading { display: flex; gap: 4px; padding: 5px 0; }
.loading span {
  width: 5px;
  height: 5px;
  background: var(--muted);
  border-radius: 50%;
  animation: gloss-pulse 1s ease-in-out infinite;
}
.loading span:nth-child(2) { animation-delay: 0.15s; }
.loading span:nth-child(3) { animation-delay: 0.3s; }
@keyframes gloss-pulse {
  0%, 80%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .loading span { animation: none; opacity: 0.6; }
}

button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
`;
