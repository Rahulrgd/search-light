import { convertCurrency, convertUnits } from './convertCore.js';

// Flow Launcher-style command plugins, as pure logic (no Shell imports), so
// they can be unit tested with plain gjs: gjs -m tests/test_plugins_core.js
//
// A plugin never runs anything itself. search() returns items whose `action`
// is plain data ({type: 'system', action: 'lock'}, {type: 'shell', command},
// …); providers/pluginActions.js performs it inside the shell.
//
// Two kinds:
// - keyword plugins ("> htop", "kill fire", "?") answer only after their
//   keyword; their results go right after the web result and take Enter.
// - global plugins (system commands: "lock", "restart") match plain text;
//   their results go after the app results, so they never take Enter from an
//   app.

export const PLUGINS = [
  {
    id: 'help',
    name: 'Keyword help',
    description: 'List all keywords: “?”',
    defaultKeyword: '?',
    icon: 'help-browser-symbolic',
  },
  {
    id: 'shell',
    name: 'Shell command',
    description: 'Run a command in a terminal: “> htop”',
    defaultKeyword: '>',
    icon: 'utilities-terminal-symbolic',
  },
  {
    id: 'kill',
    name: 'Process killer',
    description: 'Stop one of your processes: “kill firefox”',
    defaultKeyword: 'kill',
    icon: 'process-stop-symbolic',
  },
  {
    id: 'units',
    name: 'Unit converter',
    description: 'GNOME Calculator already converts most units in search; ' +
      'turn on for extras (acres, Mbps, stones…): “10 km to mi”; Enter copies',
    defaultKeyword: null, // global
    defaultEnabled: false, // avoid a duplicate row next to Calculator's
    icon: 'accessories-calculator-symbolic',
  },
  {
    id: 'currency',
    name: 'Currency converter',
    description: '“100 usd to inr”, “₹500 in $”; rates from open.er-api.com (12 h cache)',
    defaultKeyword: null, // global
    icon: 'accessories-calculator-symbolic',
  },
  {
    id: 'system',
    name: 'System commands',
    description: 'Lock, suspend, restart, power off, log out, dark style, screenshot',
    defaultKeyword: null, // global
    icon: 'system-shutdown-symbolic',
  },
];

// Power actions go through GNOME's own SystemActions, which ask for
// confirmation (power off / restart / log out show the end-session dialog).
export const SYSTEM_COMMANDS = [
  { key: 'lock', name: 'Lock screen', aliases: ['lock', 'lock screen'], icon: 'system-lock-screen-symbolic' },
  { key: 'suspend', name: 'Suspend', aliases: ['suspend', 'sleep'], icon: 'weather-clear-night-symbolic' },
  { key: 'power-off', name: 'Power off…', aliases: ['power off', 'poweroff', 'shutdown', 'shut down'], icon: 'system-shutdown-symbolic' },
  { key: 'restart', name: 'Restart…', aliases: ['restart', 'reboot'], icon: 'system-reboot-symbolic' },
  { key: 'logout', name: 'Log out…', aliases: ['log out', 'logout', 'sign out'], icon: 'system-log-out-symbolic' },
  { key: 'dark-style', name: 'Toggle dark style', aliases: ['dark mode', 'dark style', 'light mode', 'toggle dark', 'theme'], icon: 'weather-clear-night-symbolic' },
  { key: 'screenshot', name: 'Take a screenshot', aliases: ['screenshot', 'screen shot', 'print screen'], icon: 'camera-photo-symbolic' },
];

// Never offered by the process killer: killing them ends the session.
const PROTECTED_PROCESSES = new Set([
  'gnome-shell', 'gnome-session-binary', 'gnome-session-service',
  'systemd', 'Xwayland', 'dbus-daemon', 'dbus-broker',
]);

const MAX_ROWS = 5;

/**
 * Per-plugin settings from the `plugins` setting (JSON object
 * {id: {enabled, keyword}}). Missing or broken entries use the defaults.
 */
export function resolvePluginConfig(json) {
  let stored = {};
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch (_e) {
    // defaults
  }
  const config = {};
  for (const p of PLUGINS) {
    const s = stored[p.id] ?? {};
    const keyword = typeof s.keyword === 'string' && s.keyword.trim() && !/\s/.test(s.keyword.trim())
      ? s.keyword.trim()
      : p.defaultKeyword;
    config[p.id] = {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : p.defaultEnabled !== false,
      keyword: p.defaultKeyword === null ? null : keyword,
    };
  }
  return config;
}

/**
 * Which keyword plugin the text addresses. Word keywords need a space after
 * them ("kill fire"); symbol keywords may be followed directly (">htop", "?").
 * @returns {{plugin, query} | null}
 */
export function matchPluginKeyword(text, config) {
  const t = (text ?? '').replace(/^\s+/, '');
  let best = null;
  for (const p of PLUGINS) {
    const c = config[p.id];
    if (!c?.enabled || !c.keyword) continue;
    const kw = c.keyword;
    const symbolic = !/[\p{L}\p{N}]/u.test(kw);
    const head = t.slice(0, kw.length);
    if (head.toLowerCase() !== kw.toLowerCase()) continue;
    const rest = t.slice(kw.length);
    if (!symbolic && !/^\s/.test(rest)) continue;
    // Longest keyword wins (">>" over ">").
    if (!best || kw.length > best.keywordLength)
      best = { plugin: p, query: rest.trim().replace(/\s+/g, ' '), keywordLength: kw.length };
  }
  return best ? { plugin: best.plugin, query: best.query } : null;
}

/**
 * Items for a keyword plugin.
 * @param {object} ctx - {engines, config, history: string[],
 *   processes: () => [{pid, name, rssKb}]}
 * @returns {object[]} [{key, name, description, icon, action}]
 */
export function searchKeywordPlugin(plugin, query, ctx) {
  switch (plugin.id) {
    case 'help': return helpItems(query, ctx);
    case 'shell': return shellItems(query, ctx);
    case 'kill': return killItems(query, ctx);
    default: return [];
  }
}

function helpItems(query, ctx) {
  const q = query.toLowerCase();
  const rows = [];
  for (const e of ctx.engines ?? []) {
    if (e.enabled === false) continue;
    rows.push({ keyword: e.keyword, name: e.name, description: `Search ${e.name}` });
  }
  for (const p of PLUGINS) {
    const c = ctx.config[p.id];
    if (!c?.enabled || !c.keyword || p.id === 'help') continue;
    rows.push({ keyword: c.keyword, name: p.name, description: p.description });
  }
  return rows
    .filter((r) => !q || r.keyword.toLowerCase().startsWith(q) || r.name.toLowerCase().includes(q))
    .map((r) => ({
      key: `help:${r.keyword}`,
      name: `${r.keyword}  —  ${r.name}`,
      description: r.description,
      icon: 'help-browser-symbolic',
      // Fill the entry, ready to type the query.
      action: { type: 'fill', text: `${r.keyword} ` },
    }));
}

function shellItems(query, ctx) {
  const items = [];
  if (query) {
    items.push({
      key: `shell:${query}`,
      name: `Run “${query}”`,
      description: 'In a terminal',
      icon: 'utilities-terminal-symbolic',
      action: { type: 'shell', command: query },
    });
  }
  const q = query.toLowerCase();
  for (const cmd of ctx.history ?? []) {
    if (items.length >= MAX_ROWS) break;
    if (cmd === query || (q && !cmd.toLowerCase().startsWith(q))) continue;
    items.push({
      key: `shell-history:${cmd}`,
      name: `Run “${cmd}”`,
      description: 'From history',
      icon: 'document-open-recent-symbolic',
      action: { type: 'shell', command: cmd },
    });
  }
  if (items.length === 0) {
    items.push({
      key: 'shell:hint',
      name: 'Shell: type a command…',
      description: '> command',
      icon: 'utilities-terminal-symbolic',
      action: { type: 'none' },
    });
  }
  return items;
}

function killItems(query, ctx) {
  if (!query) {
    return [{
      key: 'kill:hint',
      name: 'Process killer: type a process name…',
      description: 'kill <name>',
      icon: 'process-stop-symbolic',
      action: { type: 'none' },
    }];
  }
  const q = query.toLowerCase();
  return (ctx.processes?.() ?? [])
    .filter((p) => p.name.toLowerCase().includes(q) && !PROTECTED_PROCESSES.has(p.name))
    .sort((a, b) => b.rssKb - a.rssKb)
    .slice(0, MAX_ROWS)
    .map((p) => ({
      key: `kill:${p.pid}`,
      name: `Stop ${p.name}`,
      description: `PID ${p.pid} · ${formatKb(p.rssKb)}`,
      icon: 'process-stop-symbolic',
      action: { type: 'kill', pid: p.pid, name: p.name },
    }));
}

export function formatKb(kb) {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${kb} KB`;
}

/** System commands matching plain text (≥ 2 chars, alias prefix). */
export function searchSystemCommands(text) {
  const q = (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  return SYSTEM_COMMANDS
    .filter((c) => c.aliases.some((a) => a.startsWith(q)))
    .map((c) => ({
      key: `system:${c.key}`,
      name: c.name,
      description: 'System',
      icon: c.icon,
      action: { type: 'system', action: c.key },
    }));
}

/** Add a command to the front of the history (deduplicated, capped). */
export function pushHistory(history, command, max = 20) {
  const cmd = command.trim();
  if (!cmd) return history.slice(0, max);
  return [cmd, ...history.filter((h) => h !== cmd)].slice(0, max);
}

/**
 * Parse /proc/<pid>/status text into {name, uid, rssKb} (null if unusable).
 * Kept here so it can be tested without /proc.
 */
export function parseProcStatus(text) {
  const name = /^Name:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const uid = /^Uid:\s*(\d+)/m.exec(text)?.[1];
  const rss = /^VmRSS:\s*(\d+)\s*kB/m.exec(text)?.[1];
  if (!name || uid === undefined) return null;
  return { name, uid: Number(uid), rssKb: rss ? Number(rss) : 0 };
}

// How each terminal takes "run this command": flags before the program.
const TERMINAL_EXEC_FLAGS = {
  'gnome-terminal': ['--'],
  kgx: ['--'],
  ptyxis: ['--'],
  tilix: ['-e'],
  konsole: ['-e'],
  'xfce4-terminal': ['-x'],
  alacritty: ['-e'],
  kitty: [],
  wezterm: ['start', '--'],
  foot: [],
  xterm: ['-e'],
  'x-terminal-emulator': ['-e'],
};
export const KNOWN_TERMINALS = Object.keys(TERMINAL_EXEC_FLAGS);

/**
 * argv that opens `terminal` running `command` in the user's shell and keeps
 * the terminal open afterwards. The command is one argv element, never
 * re-quoted into a larger string.
 */
export function terminalArgv(terminal, userShell, command) {
  const base = terminal.split('/').pop();
  const flags = TERMINAL_EXEC_FLAGS[base] ?? ['-e'];
  const sh = userShell || '/bin/bash';
  return [terminal, ...flags, sh, '-c', `${command}; exec "${sh}"`];
}

const CATEGORY_NAMES = {
  length: 'Length', mass: 'Mass', volume: 'Volume', area: 'Area', speed: 'Speed',
  time: 'Time', data: 'Data', temperature: 'Temperature',
};

/**
 * Global plugin items for plain text: conversions first, then system
 * commands.
 * @param {object} ctx - {config, rates: {CODE: per USD}|null, ratesDate: string}
 * @returns {{items: object[], needsRates: boolean, usesRates: boolean}}
 *   needsRates = a currency conversion was recognized but no rates are loaded
 *   yet; usesRates = a currency conversion was recognized (refresh if stale)
 */
export function searchGlobalPlugins(text, ctx) {
  const items = [];
  let needsRates = false;
  let usesRates = false;
  if (ctx.config.units?.enabled) {
    const r = convertUnits(text);
    if (r) {
      items.push({
        key: `units:${r.text}`,
        name: r.text,
        description: `${CATEGORY_NAMES[r.category]} · Enter copies ${r.copy}`,
        icon: 'accessories-calculator-symbolic',
        action: { type: 'copy', text: r.copy },
      });
    }
  }
  if (ctx.config.currency?.enabled) {
    const r = convertCurrency(text, ctx.rates ?? null);
    usesRates = !!r;
    if (r?.pending) {
      needsRates = true;
      items.push({
        key: 'currency:pending',
        name: r.text,
        description: 'open.er-api.com',
        icon: 'accessories-calculator-symbolic',
        action: { type: 'none' },
      });
    } else if (r) {
      items.push({
        key: `currency:${r.text}`,
        name: r.text,
        description: `Rates ${ctx.ratesDate ?? ''} · Enter copies ${r.copy}`.replace('Rates  ·', 'Rates ·'),
        icon: 'accessories-calculator-symbolic',
        action: { type: 'copy', text: r.copy },
      });
    }
  }
  if (ctx.config.system?.enabled) items.push(...searchSystemCommands(text));
  return { items, needsRates, usesRates };
}
