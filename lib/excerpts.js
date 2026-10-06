// Picks the passages of the user's active sources that look relevant to a selection, for
// Google AI Mode. Unlike the AI providers, AI Mode takes its question as typed text, so
// a whole PDF can't be attached: a few short excerpts are included instead. Matching is
// plain keyword overlap, with no embeddings or search index.

const STOPWORDS = new Set(
  ('about above after again also because been before being between both could does doing during each from have ' +
    'having here into just more most much only other over same should some such than that their them then there ' +
    'these they this those through under until very were what when where which while will with would your')
    .split(' ')
);

const words = (text) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter((word) => !STOPWORDS.has(word));

// Splits text into passages of about `size` characters at line boundaries. PDF text
// arrives with a line break at the end of every printed line, so lines are merged.
function passages(text, size) {
  const out = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length > size) {
      out.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + line.trim();
  }
  if (current) out.push(current);
  return out;
}

// sources: [{ name, text }]. selection is what the user selected; context is the text
// around it. Returns up to four { name, text } excerpts, best first, within maxChars.
export function pickExcerpts(sources, selection, context = '', { maxChars = 2400, passageChars = 700 } = {}) {
  const primary = [...new Set(words(selection))];
  if (!primary.length || !sources.length) return [];
  const secondary = [...new Set(words(context))].filter((word) => !primary.includes(word));

  const candidates = [];
  for (const { name, text } of sources) {
    for (const passage of passages(text, passageChars)) {
      const lower = passage.toLowerCase();
      let matched = 0;
      let score = 0;
      for (const word of primary) {
        if (lower.includes(word)) {
          matched++;
          score += 3;
        }
      }
      for (const word of secondary) if (lower.includes(word)) score += 1;
      // A passage has to match at least two of the selection's words (or its only word).
      if (matched >= Math.min(2, primary.length)) {
        candidates.push({ name, text: passage.slice(0, passageChars + 200), score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const candidate of candidates) {
    if (used + candidate.text.length > maxChars) continue;
    picked.push({ name: candidate.name, text: candidate.text });
    used += candidate.text.length;
    if (picked.length >= 4) break;
  }
  return picked;
}
