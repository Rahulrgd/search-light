// Unit tests for providers/webSearchCore.js. Run: gjs -m tests/test_websearch_core.js
import {
  DEFAULT_ENGINES,
  matchEngine,
  buildUrl,
  validateEngine,
  resolveEngines,
  defaultEngines,
} from '../providers/webSearchCore.js';
import System from 'system';

let failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    print(`ok   ${name}`);
  } else {
    failed++;
    print(`FAIL ${name}\n     got      ${a}\n     expected ${e}`);
  }
}
const kw = (m) => (m ? [m.engine.keyword, m.query] : null);

eq('g naruto', kw(matchEngine(['g', 'naruto'], DEFAULT_ENGINES)), ['g', 'naruto']);
eq('yt multi word', kw(matchEngine(['yt', 'naruto', 'ep', '1'], DEFAULT_ENGINES)), ['yt', 'naruto ep 1']);
eq('keyword is case-insensitive', kw(matchEngine(['YT', 'Naruto'], DEFAULT_ENGINES)), ['yt', 'Naruto']);
eq('query keeps case', matchEngine(['g', 'GNOME', 'Shell'], DEFAULT_ENGINES).query, 'GNOME Shell');
eq('keyword only', kw(matchEngine(['yt'], DEFAULT_ENGINES)), ['yt', '']);
eq('unknown keyword', matchEngine(['naruto'], DEFAULT_ENGINES), null);
eq('keyword not first', matchEngine(['naruto', 'g'], DEFAULT_ENGINES), null);
eq('empty terms', matchEngine([], DEFAULT_ENGINES), null);
eq('disabled engine', matchEngine(['x', 'q'], [{ keyword: 'x', name: 'X', url: '{q}', enabled: false }]), null);

eq('url encode', buildUrl('https://e.com/?q={q}', 'a&b #c'), 'https://e.com/?q=a%26b%20%23c');
eq('url hindi', buildUrl('https://e.com/?q={q}', 'नमस्ते'), 'https://e.com/?q=%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87');
eq('url path placeholder', buildUrl('https://www.google.com/maps/search/{q}', 'delhi'), 'https://www.google.com/maps/search/delhi');
eq('all defaults have {q} and unique keywords',
  DEFAULT_ENGINES.every((e) => e.url.includes('{q}')) &&
    new Set(DEFAULT_ENGINES.map((e) => e.keyword)).size === DEFAULT_ENGINES.length,
  true);

// validateEngine
const ok = { keyword: 'ex', name: 'Example', url: 'https://ex.com/?q={q}' };
eq('valid engine', validateEngine(ok, DEFAULT_ENGINES), null);
eq('missing keyword', validateEngine({ ...ok, keyword: '  ' }), 'Keyword is required');
eq('keyword with space', validateEngine({ ...ok, keyword: 'e x' }), 'Keyword cannot contain spaces');
eq('duplicate keyword (case-insensitive)', validateEngine({ ...ok, keyword: 'YT' }, DEFAULT_ENGINES), 'Keyword “YT” is already used');
eq('missing name', validateEngine({ ...ok, name: '' }), 'Name is required');
eq('url without scheme', validateEngine({ ...ok, url: 'ex.com/?q={q}' }), 'URL must start with https:// (or another scheme)');
eq('url without {q}', validateEngine({ ...ok, url: 'https://ex.com/' }), 'URL must contain {q} where the query goes');
eq('non-http scheme allowed', validateEngine({ ...ok, url: 'spotify:search:{q}' }), null);

// resolveEngines
eq('empty setting = defaults', resolveEngines('').length, DEFAULT_ENGINES.length);
eq('broken json = defaults', resolveEngines('{nope').length, DEFAULT_ENGINES.length);
eq('non-array json = defaults', resolveEngines('{}').length, DEFAULT_ENGINES.length);
eq('explicit empty list stays empty', resolveEngines('[]'), []);
eq('custom list, trimmed, enabled kept',
  resolveEngines(JSON.stringify([{ keyword: ' ex ', name: 'Ex', url: 'https://ex.com/{q}', enabled: false }])),
  [{ keyword: 'ex', name: 'Ex', url: 'https://ex.com/{q}', enabled: false }]);
eq('invalid + duplicate entries dropped',
  resolveEngines(JSON.stringify([ok, { ...ok, name: 'Dup' }, { keyword: 'bad' }, null, 5])).map((e) => e.name),
  ['Example']);
const d = defaultEngines();
d[0].keyword = 'changed';
eq('defaultEngines returns a copy', DEFAULT_ENGINES[0].keyword, 'g');

print(failed ? `\n${failed} failed` : '\nall passed');
System.exit(failed ? 1 : 0);
