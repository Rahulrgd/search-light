// Unit tests for providers/pluginsCore.js. Run: gjs -m tests/test_plugins_core.js
import {
  PLUGINS,
  resolvePluginConfig,
  matchPluginKeyword,
  searchKeywordPlugin,
  searchSystemCommands,
  pushHistory,
  parseProcStatus,
  formatKb,
  terminalArgv,
  searchGlobalPlugins,
} from '../providers/pluginsCore.js';
import { DEFAULT_ENGINES } from '../providers/webSearchCore.js';
import System from 'system';

let failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) print(`ok   ${name}`);
  else { failed++; print(`FAIL ${name}\n     got      ${a}\n     expected ${e}`); }
}
const cfg = resolvePluginConfig('');
const m = (t, c = cfg) => { const r = matchPluginKeyword(t, c); return r ? [r.plugin.id, r.query] : null; };

// config
eq('defaults', Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, [v.enabled, v.keyword]])),
  { help: [true, '?'], shell: [true, '>'], kill: [true, 'kill'], units: [false, null], currency: [true, null], system: [true, null] });
const custom = resolvePluginConfig(JSON.stringify({ kill: { keyword: 'k' }, shell: { enabled: false }, system: { keyword: 'sys' }, help: { keyword: 'a b' } }));
eq('custom keyword, disabled plugin, global stays global, bad keyword ignored',
  [custom.kill.keyword, custom.shell.enabled, custom.system.keyword, custom.help.keyword], ['k', false, null, '?']);
eq('broken json = defaults', resolvePluginConfig('{oops').kill.keyword, 'kill');

// keyword matching
eq('> htop', m('> htop'), ['shell', 'htop']);
eq('>htop (symbol keyword needs no space)', m('>htop'), ['shell', 'htop']);
eq('? alone', m('?'), ['help', '']);
eq('kill fire', m('kill  fire fox '), ['kill', 'fire fox']);
eq('killer is not kill', m('killer'), null);
eq('kill without space = no match', m('kill'), null);
eq('case-insensitive word keyword', m('KILL x'), ['kill', 'x']);
eq('disabled plugin does not match', m('> htop', custom), null);
eq('custom keyword', m('k chrome', custom), ['kill', 'chrome']);
eq('plain text', m('firefox'), null);

// help
const ctx = {
  engines: DEFAULT_ENGINES,
  config: cfg,
  history: ['htop', 'ls -la', 'git status'],
  processes: () => [
    { pid: 10, name: 'firefox', rssKb: 900000 },
    { pid: 11, name: 'firefox-bin', rssKb: 2500000 },
    { pid: 12, name: 'gnome-shell', rssKb: 400000 },
    { pid: 13, name: 'code', rssKb: 300 },
  ],
};
const help = searchKeywordPlugin(PLUGINS[0], '', ctx);
eq('help lists engines + keyword plugins (not itself, not global)', help.length, DEFAULT_ENGINES.length + 2);
eq('help row fills the entry', help.find((h) => h.key === 'help:>').action, { type: 'fill', text: '> ' });
eq('help filter by keyword prefix', searchKeywordPlugin(PLUGINS[0], 'y', ctx).map((h) => h.key), ['help:yt']);
eq('help filter by name', searchKeywordPlugin(PLUGINS[0], 'process', ctx).map((h) => h.key), ['help:kill']);

// shell
const shell = PLUGINS.find((p) => p.id === 'shell');
eq('shell: run + matching history', searchKeywordPlugin(shell, 'g', ctx).map((i) => i.action),
  [{ type: 'shell', command: 'g' }, { type: 'shell', command: 'git status' }]);
eq('shell: empty query lists history', searchKeywordPlugin(shell, '', ctx).map((i) => i.action.command), ['htop', 'ls -la', 'git status']);
eq('shell: same command not listed twice', searchKeywordPlugin(shell, 'htop', ctx).length, 1);
eq('shell: no history, no query = hint', searchKeywordPlugin(shell, '', { ...ctx, history: [] })[0].action, { type: 'none' });

// kill
const kill = PLUGINS.find((p) => p.id === 'kill');
eq('kill: matches, biggest first, protected hidden', searchKeywordPlugin(kill, 'f', ctx).map((i) => i.action.pid), [11, 10]);
eq('kill: gnome-shell never offered', searchKeywordPlugin(kill, 'gnome', ctx), []);
eq('kill: row text', searchKeywordPlugin(kill, 'code', ctx)[0].description, 'PID 13 · 300 KB');
eq('kill: empty query = hint', searchKeywordPlugin(kill, '', ctx)[0].action, { type: 'none' });

// system commands
const sys = (t) => searchSystemCommands(t).map((i) => i.action.action);
eq('lock', sys('lo'), ['lock', 'logout']);
eq('shutdown alias', sys('shut'), ['power-off']);
eq('reboot alias', sys('Reboot'), ['restart']);
eq('one letter: nothing', sys('l'), []);
eq('unrelated: nothing', sys('firefox'), []);

// helpers
eq('history push dedupes + caps', pushHistory(['a', 'b', 'c'], 'b', 3), ['b', 'a', 'c']);
eq('history ignores empty', pushHistory(['a'], '  '), ['a']);
eq('proc status parse', parseProcStatus('Name:\tfirefox\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t  204800 kB\n'), { name: 'firefox', uid: 1000, rssKb: 204800 });
eq('proc status: kernel thread (no RSS)', parseProcStatus('Name:\tkworker\nUid:\t0\t0\t0\t0\n'), { name: 'kworker', uid: 0, rssKb: 0 });
eq('formatKb', [formatKb(300), formatKb(204800), formatKb(2500000)], ['300 KB', '200 MB', '2.4 GB']);

eq('gnome-terminal argv', terminalArgv('/usr/bin/gnome-terminal', '/bin/zsh', 'htop'), ['/usr/bin/gnome-terminal', '--', '/bin/zsh', '-c', 'htop; exec "/bin/zsh"']);
eq('x-terminal-emulator uses -e', terminalArgv('x-terminal-emulator', '', 'ls')[1], '-e');
eq('unknown terminal falls back to -e', terminalArgv('myterm', '/bin/bash', 'ls').slice(0, 2), ['myterm', '-e']);
eq('command stays one argv element', terminalArgv('kgx', '/bin/bash', 'echo "a b"; rm -i x').length, 5);

// global plugins: conversions + system commands
const unitsOn = resolvePluginConfig(JSON.stringify({ units: { enabled: true } }));
eq('units off by default, can be turned on', [cfg.units.enabled, unitsOn.units.enabled], [false, true]);
const gctx = { config: unitsOn, rates: { USD: 1, INR: 83 }, ratesDate: '2026-11-17' };
const g = (t, c = gctx) => searchGlobalPlugins(t, c);
eq('units row copies the value', g('10 km to mi').items[0].action, { type: 'copy', text: '6.213711922' });
eq('currency row', g('100 usd to inr').items.map((i) => [i.name, i.description]),
  [['100.00 USD = 8,300.00 INR', 'Rates 2026-11-17 · Enter copies 8300.00']]);
eq('no rates: pending row + needsRates', [g('1 usd to inr', { ...gctx, rates: null }).needsRates, g('1 usd to inr', { ...gctx, rates: null }).items[0].action.type], [true, 'none']);
eq('units do not ask for rates', g('10 km to mi', { ...gctx, rates: null }).needsRates, false);
eq('currency with rates: usesRates (refresh if stale)', [g('1 usd to inr').usesRates, g('10 km to mi').usesRates], [true, false]);
eq('system commands still listed', g('reboot').items.map((i) => i.key), ['system:restart']);
const off = resolvePluginConfig(JSON.stringify({ units: { enabled: false }, currency: { enabled: false } }));
eq('disabled converters: nothing', [g('10 km to mi', { ...gctx, config: off }).items, g('1 usd to inr', { ...gctx, config: off }).items], [[], []]);

print(failed ? `\n${failed} failed` : '\nall passed');
System.exit(failed ? 1 : 0);
