// Pure logic for web search action keywords ("g naruto", "yt naruto").
// No Shell/St imports here so it can be unit tested with plain gjs:
//   gjs -m tests/test_websearch_core.js

export const QUERY_PLACEHOLDER = '{q}';

export const DEFAULT_ENGINES = [
  { keyword: 'g', name: 'Google', url: 'https://www.google.com/search?q={q}' },
  { keyword: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={q}' },
  { keyword: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search={q}' },
  { keyword: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' },
  { keyword: 'gh', name: 'GitHub', url: 'https://github.com/search?q={q}' },
  { keyword: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={q}' },
  { keyword: 'maps', name: 'Google Maps', url: 'https://www.google.com/maps/search/{q}' },
  { keyword: 'amz', name: 'Amazon', url: 'https://www.amazon.in/s?k={q}' },
  { keyword: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q={q}' },
  { keyword: 'tr', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&op=translate&text={q}' },
];

/**
 * Match search terms against the engine list.
 * @param {string[]} terms - whitespace-split search text (case preserved)
 * @param {object[]} engines - [{keyword, name, url, enabled?}]
 * @returns {{engine: object, query: string} | null} null when the first term is
 *   not a keyword. query is '' when only the keyword was typed.
 */
export function matchEngine(terms, engines) {
  if (!terms || terms.length === 0) return null;
  const keyword = terms[0].toLowerCase();
  const engine = engines.find(
    (e) => e.enabled !== false && e.keyword.toLowerCase() === keyword,
  );
  if (!engine) return null;
  return { engine, query: terms.slice(1).join(' ') };
}

/** Put the URL-encoded query into the engine's URL template. */
export function buildUrl(template, query) {
  return template.split(QUERY_PLACEHOLDER).join(encodeURIComponent(query));
}
