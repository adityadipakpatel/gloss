// Turns the HTML of a search results page into a short answer plus a few results.
// The background worker fetches the page (content scripts can't, because of page CORS);
// this runs in the page's content script, where DOMParser is available. DOMParser
// documents are inert: nothing in them loads or runs. Only text is copied out.
(() => {
  const GOOGLE = 'https://www.google.com/';
  const DDG = 'https://duckduckgo.com/';
  const MAX_RESULTS = 3;

  // Google's "instant answer" and featured snippet containers. Google changes these
  // class names from time to time, so list several and fall back to plain results.
  const ANSWER_SELECTORS = [
    'div[data-attrid="wa:/description"]',
    'div.hgKElc',
    'span.hgKElc',
    'div.Z0LcW',
    'div.IZ6rdc',
    'div.kno-rdesc span',
    'div[data-attrid="FeaturedSnippet"]',
  ];
  const SNIPPET_SELECTORS = ['div.VwiC3b', 'div[data-sncf]', 'div.lEBKkf', 'span.aCOpRe', 'div.IsZvec'];

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();

  function firstText(selectors, root) {
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        const t = text(node);
        if (t.length >= 2 && t.length <= 400) return t;
      }
    }
    return '';
  }

  // Search engines wrap result links in redirects (/url?q=..., /l/?uddg=...). Return the
  // real destination, but only for http(s) links.
  function unwrap(href, base) {
    try {
      const url = new URL(href, base);
      const target =
        (url.hostname.endsWith('google.com') && url.pathname === '/url' && (url.searchParams.get('q') || url.searchParams.get('url'))) ||
        (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/') && url.searchParams.get('uddg'));
      if (target) return unwrap(target, base);
      return /^https?:$/.test(url.protocol) && !url.hostname.endsWith('google.com') ? url.href : null;
    } catch {
      return null;
    }
  }

  function parseGoogle(doc) {
    // A consent page, a "turn on JavaScript" page or a captcha has no results container.
    if (!doc.querySelector('#search, #rso, #main') || doc.querySelector('form[action*="consent"]')) return null;
    const answer = firstText(ANSWER_SELECTORS, doc);
    const results = [];
    for (const heading of doc.querySelectorAll('a h3')) {
      const link = heading.closest('a');
      const url = unwrap(link.getAttribute('href') || '', GOOGLE);
      if (!url) continue;
      const block = link.closest('div[data-hveid], div.g, div.MjjYud');
      results.push({ title: text(heading), url, snippet: block ? firstText(SNIPPET_SELECTORS, block) : '' });
      if (results.length >= MAX_RESULTS) break;
    }
    return answer || results.length ? { answer, results } : null;
  }

  function parseDuckDuckGo(doc) {
    const results = [];
    for (const item of doc.querySelectorAll('.result')) {
      const link = item.querySelector('a.result__a');
      const url = link && unwrap(link.getAttribute('href') || '', DDG);
      if (!url) continue;
      results.push({ title: text(link), url, snippet: text(item.querySelector('.result__snippet')) });
      if (results.length >= MAX_RESULTS) break;
    }
    return results.length ? { answer: '', results } : null;
  }

  // engine is 'google' or 'duckduckgo'. Returns { answer, results } or null when the
  // page held nothing readable.
  function parse(engine, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return engine === 'google' ? parseGoogle(doc) : parseDuckDuckGo(doc);
  }

  const searchUrl = (engine, query) =>
    engine === 'google'
      ? `${GOOGLE}search?q=${encodeURIComponent(query)}&hl=en`
      : `${DDG}?q=${encodeURIComponent(query)}`;

  globalThis.GlossSearch = { parse, searchUrl };
})();
