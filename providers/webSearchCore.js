// Pure logic for web search action keywords ("g naruto", "yt naruto").
// No Shell/St imports here so it can be unit tested with plain gjs:
//   gjs -m tests/test_websearch_core.js

export const QUERY_PLACEHOLDER = '{q}';

export const DEFAULT_ENGINES = [
  // `suggest`: optional suggestion endpoint answering ["query", ["s1", "s2", …]]
  // (the OpenSearch suggestions format).
  {
    keyword: 'g', name: 'Google', url: 'https://www.google.com/search?q={q}',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q={q}',
  },
  {
    keyword: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={q}',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&ie=utf-8&oe=utf-8&q={q}',
  },
  {
    keyword: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search={q}',
    suggest: 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=6&search={q}',
  },
  {
    keyword: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}',
    suggest: 'https://duckduckgo.com/ac/?type=list&q={q}',
  },
  { keyword: 'gh', name: 'GitHub', url: 'https://github.com/search?q={q}' },
  { keyword: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={q}' },
  { keyword: 'maps', name: 'Google Maps', url: 'https://www.google.com/maps/search/{q}' },
  { keyword: 'amz', name: 'Amazon', url: 'https://www.amazon.in/s?k={q}' },
  { keyword: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q={q}' },
  { keyword: 'tr', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&op=translate&text={q}' },
];

/**
 * Match the raw search text against the engine list. Like Flow Launcher, a
 * keyword only counts once a space follows it: "g" is a normal search (gedit…),
 * "g " shows the engine hint, "g naruto" searches.
 * @param {string} text - the search entry text, untrimmed
 * @param {object[]} engines - [{keyword, name, url, enabled?}]
 * @returns {{engine: object, query: string} | null} query is '' for "g ".
 */
export function matchQuery(text, engines) {
  const m = /^\s*(\S+)\s+([\s\S]*)$/.exec(text ?? '');
  if (!m) return null;
  const keyword = m[1].toLowerCase();
  const engine = engines.find(
    (e) => e.enabled !== false && e.keyword.toLowerCase() === keyword,
  );
  if (!engine) return null;
  return { engine, query: m[2].trim().replace(/\s+/g, ' ') };
}

// Bare domains need a known TLD, so "file.txt" or "v1.2" are not URLs.
const COMMON_TLDS = new Set(
  ('com org net io dev app ai co in me info xyz tv gov edu uk de fr jp ' +
    'us ca au eu tech site online blog page cloud so gg ly fm to sh')
    .split(' '),
);

/**
 * The URL to open when the text looks like one, else null.
 * Accepts "https://…", "http://…", "localhost:8080/x", "www.foo.bar",
 * "github.com/foo" (known TLD). Bare domains get https://.
 */
export function detectUrl(text) {
  const t = (text ?? '').trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\/[^/\s]+/i.test(t)) return t;
  if (/^localhost(:\d+)?(\/\S*)?$/i.test(t)) return `http://${t}`;
  const m = /^((?:[a-z0-9-]+\.)+([a-z]{2,}))(:\d+)?([/?#]\S*)?$/i.exec(t);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (!host.startsWith('www.') && !COMMON_TLDS.has(m[2].toLowerCase())) return null;
  return `https://${t}`;
}

/**
 * Engine for the "search the web for …" fallback: the one with `keyword` if it
 * exists and is enabled, else the first enabled engine, else null.
 */
export function pickFallbackEngine(engines, keyword) {
  const enabled = engines.filter((e) => e.enabled !== false);
  const wanted = (keyword ?? '').toLowerCase();
  return enabled.find((e) => e.keyword.toLowerCase() === wanted) ?? enabled[0] ?? null;
}

/** Short host for display: "https://www.google.com/…" → "google.com". */
export function displayHost(url) {
  const host = faviconHost(url);
  return host ? host.replace(/^www\./, '') : '';
}

/** Host of an engine URL template ("www.google.com"), for its favicon. */
export function faviconHost(urlTemplate) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(urlTemplate ?? '');
  return m ? m[1].toLowerCase() : null;
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
  const suggest = (engine.suggest ?? '').trim();
  if (suggest) {
    if (!/^https?:\/\//i.test(suggest)) return 'Suggestions URL must start with https://';
    if (!suggest.includes(QUERY_PLACEHOLDER)) return `Suggestions URL must contain ${QUERY_PLACEHOLDER}`;
  }
  return null;
}

/** Trimmed copy with only the stored fields. */
export function normalizeEngine(engine) {
  return {
    keyword: engine.keyword.trim(),
    name: engine.name.trim(),
    url: engine.url.trim(),
    suggest: (engine.suggest ?? '').trim(),
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
      // Lists saved before suggestions existed have no `suggest` field: give
      // built-in engines (same URL) their default endpoint.
      suggest: String(
        e.suggest ?? DEFAULT_ENGINES.find((d) => d.url === e.url)?.suggest ?? ''),
      enabled: e.enabled,
    };
    if (validateEngine(candidate, out) === null) out.push(normalizeEngine(candidate));
  }
  return out;
}

/**
 * Suggestions from a parsed suggestion response. Accepts the OpenSearch format
 * ["query", ["s1", …], …] (Google, YouTube, Wikipedia, DuckDuckGo type=list)
 * and DuckDuckGo's default [{phrase: "s1"}, …]. Drops the query itself and
 * duplicates; at most `max` entries.
 */
export function parseSuggestions(data, query, max = 5) {
  let list = [];
  if (Array.isArray(data) && Array.isArray(data[1])) list = data[1];
  else if (Array.isArray(data)) list = data.map((d) => d?.phrase);
  const seen = new Set([(query ?? '').trim().toLowerCase()]);
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const s = item.trim().replace(/\s+/g, ' ');
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
