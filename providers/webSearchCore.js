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

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Check one engine before saving it.
 * @param {object} engine - {keyword, name, url}
 * @param {object[]} others - the other engines (excluding the one being edited)
 * @returns {string|null} an error message, or null when valid
 */
export function validateEngine(engine, others = []) {
  const keyword = (engine.keyword ?? '').trim();
  const name = (engine.name ?? '').trim();
  const url = (engine.url ?? '').trim();
  if (!keyword) return 'Keyword is required';
  if (/\s/.test(keyword)) return 'Keyword cannot contain spaces';
  if (others.some((e) => e.keyword.toLowerCase() === keyword.toLowerCase()))
    return `Keyword “${keyword}” is already used`;
  if (!name) return 'Name is required';
  if (!url) return 'URL is required';
  if (!SCHEME_RE.test(url)) return 'URL must start with https:// (or another scheme)';
  if (!url.includes(QUERY_PLACEHOLDER)) return `URL must contain ${QUERY_PLACEHOLDER} where the query goes`;
  return null;
}

/** Trimmed copy with only the stored fields. */
export function normalizeEngine(engine) {
  return {
    keyword: engine.keyword.trim(),
    name: engine.name.trim(),
    url: engine.url.trim(),
    enabled: engine.enabled !== false,
  };
}

/** Fresh copy of the defaults, safe to mutate. */
export function defaultEngines() {
  return DEFAULT_ENGINES.map((e) => normalizeEngine(e));
}

/**
 * Engines from the `web-search-engines` setting (a JSON array string).
 * '' (the schema default) means "use the built-in defaults", so new defaults
 * reach users who never edited the list. Invalid entries are dropped; broken
 * JSON falls back to the defaults.
 */
export function resolveEngines(json) {
  if (!json || !json.trim()) return defaultEngines();
  let list;
  try {
    list = JSON.parse(json);
  } catch (_e) {
    return defaultEngines();
  }
  if (!Array.isArray(list)) return defaultEngines();
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const candidate = {
      keyword: String(e.keyword ?? ''),
      name: String(e.name ?? ''),
      url: String(e.url ?? ''),
      enabled: e.enabled,
    };
    if (validateEngine(candidate, out) === null) out.push(normalizeEngine(candidate));
  }
  return out;
}
