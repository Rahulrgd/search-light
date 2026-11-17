#!/usr/bin/env bash
# End-to-end test of web search inside a headless shell. URL opening is stubbed,
# so no browser starts; cases type text and press real keys (Enter, Space, …).
# Run: scripts/headless.sh --unsafe -- tests/e2e_websearch.sh
set -uo pipefail
E="$(dirname "$0")/../scripts/eval.sh"
UUID=search-light@icedman.github.com
GS="gsettings --schemadir $(dirname "$0")/../schemas"
SCHEMA=org.gnome.shell.extensions.search-light
fails=0

ev() { $E "$1"; }
ORDER='(() => { const l = Main.overview.searchController._searchResults._providers; return l[0].id + " … " + l[l.length - 1].id; })()'
mark() { ev "console.log('MARK $1'); 1" >/dev/null; echo "-- $1 | providers: $(ev "$ORDER")"; }
key() {
  ev "const C = imports.gi.Clutter; globalThis.__kbd ??= C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE); const t = imports.gi.GLib.get_monotonic_time(); __kbd.notify_keyval(t, C.KEY_$1, C.KeyState.PRESSED); __kbd.notify_keyval(t + 1000, C.KEY_$1, C.KeyState.RELEASED); 1" >/dev/null
}
stub() {  # record opened URIs instead of launching a browser
  ev 'globalThis.__opened = []; const sl = Main.overview.searchLight; sl._webSearch.openUri = sl._webSuggest.openUri = sl._webFallback.openUri = (u) => __opened.push(u); 1' >/dev/null
}
opened() { ev 'JSON.stringify(__opened)'; }
check() {  # check <name> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "     got      $2"; echo "     expected $3"; fails=$((fails + 1)); fi
}
open_and_type() {
  ev 'if (!Main.overview.searchLight._visible) Main.overview.searchLight._toggle_search_light(); 1' >/dev/null
  sleep 0.5
  ev "Main.overview.searchLight._entry.set_text($(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')); 1" >/dev/null
  settle
}
# Wait until the shell says the search is done (slow remote providers, a loaded
# machine), then a moment for the displays to update.
settle() {
  sleep 0.3
  for _ in $(seq 50); do
    [ "$(ev 'const sr = Main.overview.searchController._searchResults; String(!sr.searchInProgress && !sr._searchTimeoutId)')" = true ] && break
    sleep 0.1
  done
  sleep 0.5
}
# front: web provider first? shown: web result visible? default: who gets Enter
# (web | fallback | other | none)? fb: fallback visible and last?
STATE='JSON.stringify((() => { const sr = Main.overview.searchController._searchResults; const sl = Main.overview.searchLight; const ws = sl._webSearch, fb = sl._webFallback; const d = sr._defaultResult?.provider; const l = sr._providers; return { front: l[0] === ws, shown: !!ws.display?.visible, default: !d ? "none" : d === ws ? "web" : d === fb ? "fallback" : "other", fb: !!fb.display?.visible && l[l.length - 1] === fb }; })())'
APPS_SHOWN='String(Main.overview.searchController._searchResults._providers.some(p => p.id === "applications" && p.display.visible))'
# Texts of the labels inside the web result section
WEB_LABELS='(() => { const out = []; const walk = (a) => { if (a instanceof imports.gi.St.Label && a.visible) out.push(a.text); a.get_children().forEach(walk); }; walk(Main.overview.searchLight._webSearch.display); return JSON.stringify(out); })()'

sleep 3
# Seed a favicon so the icon case needs no network.
SEED_DIR="$XDG_CACHE_HOME/search-light/favicons"
mkdir -p "$SEED_DIR"
cp /usr/share/icons/hicolor/48x48/apps/*.png "$SEED_DIR/www.youtube.com.png" 2>/dev/null ||
  python3 -c 'import base64,sys; open(sys.argv[1],"wb").write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))' "$SEED_DIR/www.youtube.com.png"

mark keyword; open_and_type 'g naruto'; stub
check 'g naruto: web first + default' "$(ev "$STATE")" '{"front":true,"shown":true,"default":"web","fb":false}'
check 'description: plain host, no term highlighting' "$(ev '(() => { let r = null; const walk = (a) => { if (a.style_class?.includes("list-search-result-description")) r = [a.text, a.clutter_text.use_markup]; a.get_children().forEach(walk); }; walk(Main.overview.searchLight._webSearch.display); return JSON.stringify(r); })()')" '["google.com",false]'
key Return; sleep 1
check 'g naruto: opened' "$(opened)" '["https://www.google.com/search?q=naruto"]'
check 'g naruto: popup closed' "$(ev 'String(Main.overview.searchLight._visible)')" 'false'

mark live-label; open_and_type 'yt Naruto'
open_and_type 'yt Naruto Shippuden'; stub
check 'result text follows the query (no stale actor)' "$(ev "$WEB_LABELS" | grep -o 'Search YouTube for “[^”]*”' | head -1)" 'Search YouTube for “Naruto Shippuden”'
check 'cached favicon used for the result' "$(ev '(() => { let f = null; const walk = (a) => { if (a instanceof imports.gi.St.Icon && a.gicon instanceof imports.gi.Gio.FileIcon) f = a.gicon.get_file().get_basename(); a.get_children().forEach(walk); }; walk(Main.overview.searchLight._webSearch.display); return String(f); })()')" 'www.youtube.com.png'
key Return; sleep 1
check 'yt case kept' "$(opened)" '["https://www.youtube.com/results?search_query=Naruto%20Shippuden"]'

mark exclusive; open_and_type 'g settings'; stub
check 'exclusive on: only the web result' "$(ev "$STATE"),$(ev "$APPS_SHOWN")" '{"front":true,"shown":true,"default":"web","fb":false},false'
key Escape; sleep 0.5
$GS set $SCHEMA web-search-exclusive false; sleep 0.5
open_and_type 'g settings'; stub
check 'exclusive off: apps shown, web still default' "$(ev "$STATE"),$(ev "$APPS_SHOWN")" '{"front":true,"shown":true,"default":"web","fb":false},true'
key Return; sleep 1
check 'g settings: opened google' "$(opened)" '["https://www.google.com/search?q=settings"]'
$GS reset $SCHEMA web-search-exclusive

mark space; open_and_type 'yt'; stub
check '"yt" without space: no keyword result' "$(ev "$STATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["shown"])')" 'False'
key space; settle
check '"yt " (real Space key): hint shown + default' "$(ev "$STATE")" '{"front":true,"shown":true,"default":"web","fb":false}'
key Return; sleep 1
check 'hint + Enter: nothing opened' "$(opened)" '[]'
key BackSpace; settle
check 'Backspace: hint gone again' "$(ev "$STATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["shown"])')" 'False'
key Escape; sleep 0.5

mark fallback; open_and_type 'settings'; stub
# (The shell's own default for app results is null in the headless session,
# with v37 too, so check what matters: Enter must not trigger the fallback.)
check 'app match: fallback shown last, not default' "$(ev "$STATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["fb"], d["default"] != "fallback")')" 'True True'
key Return; sleep 1
check 'app match + Enter: fallback not opened' "$(opened)" '[]'
key Escape; sleep 0.5
open_and_type 'zzqqxx naruto'; stub
check 'no match: fallback is default' "$(ev "$STATE")" '{"front":true,"shown":false,"default":"fallback","fb":true}'
key Return; sleep 1
check 'fallback opens default engine (Google)' "$(opened)" '["https://www.google.com/search?q=zzqqxx%20naruto"]'
$GS set $SCHEMA web-search-fallback-engine ddg; sleep 0.5
open_and_type 'zzqqxx'; stub
key Return; sleep 1
check 'fallback engine setting (ddg)' "$(opened)" '["https://duckduckgo.com/?q=zzqqxx"]'
$GS reset $SCHEMA web-search-fallback-engine
$GS set $SCHEMA web-search-fallback false; sleep 0.5
open_and_type 'zzqqxx'
check 'fallback off: no result' "$(ev "$STATE")" '{"front":true,"shown":false,"default":"none","fb":false}'
key Escape; sleep 0.5
$GS reset $SCHEMA web-search-fallback

mark url; open_and_type 'github.com/Rahulrgd'; stub
check 'typed URL: open result first + default' "$(ev "$STATE")" '{"front":true,"shown":true,"default":"web","fb":false}'
key Return; sleep 1
check 'typed URL opened with https' "$(opened)" '["https://github.com/Rahulrgd"]'
open_and_type 'notes.txt'
check 'notes.txt is not a URL' "$(ev "$STATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["shown"])')" 'False'
key Escape; sleep 0.5
$GS set $SCHEMA web-search-open-urls false; sleep 0.5
open_and_type 'github.com/Rahulrgd'
check 'open-urls off: no URL result' "$(ev "$STATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["shown"])')" 'False'
key Escape; sleep 0.5
$GS reset $SCHEMA web-search-open-urls
check 'popup closed: providers stay registered' "$(ev "$ORDER")" 'search-light-web-search … search-light-web-fallback'

mark suggest  # network stubbed: records URLs, answers in OpenSearch format
$GS set $SCHEMA web-search-suggestions true; sleep 0.5
stub_suggest() {
  ev 'globalThis.__fetches = []; Main.overview.searchLight._webSuggest._cache.clear(); Main.overview.searchLight._webSuggest.fetchJson = async (url) => { __fetches.push(url); if (globalThis.__fetchFail) throw new Error("offline"); const q = decodeURIComponent(url.split("q=").pop()); return [q, [q + "to", q + "to shippuden", q + "to episodes"]]; }; 1' >/dev/null
}
SUGGEST='(() => { const sl = Main.overview.searchLight; const d = sl._webSuggest.display; const l = Main.overview.searchController._searchResults._providers; const names = []; const walk = (a) => { if (a.style_class?.includes("list-search-result-title")) a.get_children().forEach((c) => c instanceof imports.gi.St.Label && names.push(c.text)); a.get_children().forEach(walk); }; if (d?.visible) walk(d); return JSON.stringify({ second: l[1] === sl._webSuggest, rows: names }); })()'
open_and_type 'x'; stub; stub_suggest
open_and_type 'g naru'
check 'suggestions under the keyword result' "$(ev "$SUGGEST")" '{"second":true,"rows":["naruto","naruto shippuden","naruto episodes"]}'
check 'one request, query encoded' "$(ev 'JSON.stringify(__fetches.map((u) => u.replace(/^.*[?&]q=/, "q=")))')" '["q=naru"]'
check 'keyword result still first + default' "$(ev "$STATE")" '{"front":true,"shown":true,"default":"web","fb":false}'
check 'exclusive mode keeps suggestions, hides apps' "$(ev "$APPS_SHOWN")" 'false'
ev 'globalThis.__fetches = []; 1' >/dev/null
# One Eval, 50 ms apart: separate Evals can be >250 ms apart on a busy machine.
ev '["g s", "g sa", "g sas", "g sasu"].forEach((t, i) => imports.gi.GLib.timeout_add(0, 50 * i, () => { Main.overview.searchLight._entry.set_text(t); return false; })); 1' >/dev/null
sleep 0.5; settle
check 'typing fast: debounced to the last text only' "$(ev 'JSON.stringify(__fetches.map((u) => u.replace(/^.*[?&]q=/, "q=")))')" '["q=sasu"]'
open_and_type 'g naru'
check 'same query again: served from cache' "$(ev 'String(__fetches.length)')" '1'
key Tab; settle
check 'Tab completes the first suggestion' "$(ev 'Main.overview.searchLight._entry.get_text()')" 'g naruto'
check 'after Tab: suggestions for the new text' "$(ev "$SUGGEST")" '{"second":true,"rows":["narutoto","narutoto shippuden","narutoto episodes"]}'
open_and_type 'g naru'; stub
ev 'Main.overview.searchLight._webSuggest.display._content.get_child_at_index(1).activate(); 1' >/dev/null; sleep 1
check 'activating a suggestion searches it' "$(opened)" '["https://www.google.com/search?q=naruto%20shippuden"]'
open_and_type 'yt bor'
check 'per-engine endpoint (YouTube)' "$(ev 'JSON.stringify(__fetches.slice(-1).map((u) => u.includes("ds=yt")))')" '[true]'
open_and_type 'gh rust'
check 'engine without suggest URL: no request, no rows' "$(ev 'String(__fetches.some((u) => u.includes("rust")))'),$(ev "$SUGGEST")" 'false,{"second":true,"rows":[]}'
ev 'globalThis.__fetchFail = true; 1' >/dev/null
open_and_type 'g offline'
check 'request fails: no rows, keyword result unaffected' "$(ev "$SUGGEST"),$(ev "$STATE")" '{"second":true,"rows":[]},{"front":true,"shown":true,"default":"web","fb":false}'
ev 'globalThis.__fetchFail = false; 1' >/dev/null
key Escape; sleep 0.5
$GS reset $SCHEMA web-search-suggestions; sleep 0.5
ev 'globalThis.__fetches = []; 1' >/dev/null
open_and_type 'g boruto'
check 'suggestions off (default): no request, no rows' "$(ev 'String(__fetches.length)'),$(ev "$SUGGEST")" '0,{"second":true,"rows":[]}'
key Tab; sleep 0.5
check 'suggestions off: Tab does not complete' "$(ev 'Main.overview.searchLight._entry.get_text()')" 'g boruto'
key Escape; sleep 0.5

mark plugins  # the lowest-level actions are stubbed: nothing really runs
stub_plugins() {
  ev 'globalThis.__ran = []; const pa = Main.overview.searchLight._pluginActions; pa._system = (w) => __ran.push("system:" + w); pa._kill = (pid) => __ran.push("kill:" + pid); pa._shell = (c) => { __ran.push("shell:" + c); pa._onShellCommand(c); }; pa.listProcesses = () => [{ pid: 101, name: "firefox", rssKb: 900000 }, { pid: 102, name: "firefox-bin", rssKb: 2000000 }, { pid: 103, name: "gnome-shell", rssKb: 500000 }]; 1' >/dev/null
}
ran() { ev 'JSON.stringify(__ran)'; }
PLUG='(() => { const sl = Main.overview.searchLight; const sr = Main.overview.searchController._searchResults; const l = sr._providers; const d = sr._defaultResult?.provider; const titles = (p) => { const out = []; const walk = (a) => { if (a.style_class?.includes("list-search-result-title")) a.get_children().forEach((c) => c instanceof imports.gi.St.Label && out.push(c.text)); a.get_children().forEach(walk); }; if (p.display?.visible) walk(p.display); return out; }; return JSON.stringify({ kw: titles(sl._pluginKeyword), global: titles(sl._pluginGlobal), default: d === sl._pluginKeyword ? "keyword" : d === sl._pluginGlobal ? "global" : d ? "other" : "none", order: l.indexOf(sl._pluginKeyword) === 2 && l.indexOf(sl._pluginGlobal) === l.length - 2 }); })()'
$GS reset $SCHEMA plugin-shell-history
open_and_type 'x'; stub_plugins
open_and_type '> htop'
check '"> htop": run row, plugin takes Enter' "$(ev "$PLUG")" '{"kw":["Run “htop”"],"global":[],"default":"keyword","order":true}'
check '"> htop": no web fallback' "$(ev "$STATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["fb"])')" 'False'
key Return; sleep 1
check 'Enter runs the command (after hiding the popup)' "$(ran),$(ev 'String(Main.overview.searchLight._visible)')" '["shell:htop"],false'
check 'command saved to history' "$($GS get $SCHEMA plugin-shell-history)" "['htop']"
open_and_type '>'; stub_plugins
check '">" alone lists history' "$(ev "$PLUG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["kw"])')" "['Run “htop”']"
key Escape; sleep 0.5
open_and_type 'kill fire'; stub_plugins; open_and_type 'kill fire'
check '"kill fire": biggest first, exclusive hides apps' "$(ev "$PLUG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["kw"])'),$(ev "$APPS_SHOWN")" "['Stop firefox-bin', 'Stop firefox'],false"
key Return; sleep 1
check 'Enter stops the biggest match' "$(ran)" '["kill:102"]'
open_and_type 'kill gnome'
check 'gnome-shell is never offered' "$(ev "$PLUG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["kw"])')" '[]'
key Escape; sleep 0.5
open_and_type '?'; stub_plugins
check '"?" lists keywords' "$(ev "$PLUG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["kw"][0], d["default"])')" 'g  —  Google keyword'
key Return; settle
check 'help row fills the entry, popup stays' "$(ev 'Main.overview.searchLight._entry.get_text()'),$(ev 'String(Main.overview.searchLight._visible)')" 'g ,true'
key Escape; sleep 0.5
open_and_type 'lock'; stub_plugins
check '"lock": global command placed after the apps' "$(ev "$PLUG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["global"], d["order"])')" "['Lock screen'] True"
key Escape; sleep 0.5
# ("lock" also matches the Clocks app, which keeps Enter; "reboot" matches no app.)
open_and_type 'reboot'; stub_plugins
check '"reboot": global command is the default' "$(ev "$PLUG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["global"], d["default"])')" "['Restart…'] global"
key Return; sleep 1
check 'Enter restarts via GNOME SystemActions (it asks to confirm)' "$(ran),$(ev 'String(Main.overview.searchLight._visible)')" '["system:restart"],false'
open_and_type 'g lock'
check 'keyword active: no global commands' "$(ev "$PLUG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["global"])')" '[]'
key Escape; sleep 0.5
$GS set $SCHEMA plugins '{"shell":{"enabled":false},"kill":{"keyword":"k"}}'; sleep 0.5
open_and_type '> htop'
check 'shell plugin disabled: no row' "$(ev "$PLUG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["kw"])')" '[]'
open_and_type 'k fire'
check 'custom keyword "k" works' "$(ev "$PLUG" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["kw"]))')" '2'
key Escape; sleep 0.5
$GS reset $SCHEMA plugins; $GS reset $SCHEMA plugin-shell-history

mark reenable; gnome-extensions disable $UUID; sleep 1
check 'disabled: providers removed' "$(ev 'String(Main.overview.searchController._searchResults._providers.filter(p => p.id.startsWith("search-light-")).length)')" '0'
check 'disabled: _updateResults/_registerProvider restored' "$(ev 'const sr = Main.overview.searchController._searchResults; String(!("__slUpdateResults" in sr) && !("__slRegisterProvider" in sr))')" 'true'
gnome-extensions enable $UUID; sleep 2
check 're-enabled: one of each, in place' "$(ev 'const l = Main.overview.searchController._searchResults._providers; [l.filter(p => p.id.startsWith("search-light-")).length, l[0].id, l[1].id, l[2].id, l[l.length - 2].id, l[l.length - 1].id].join(",")')" '5,search-light-web-search,search-light-web-suggest,search-light-plugins,search-light-plugins-global,search-light-web-fallback'
open_and_type 'w naruto'; stub
key Return; sleep 1
check 're-enabled: w naruto' "$(opened)" '["https://en.wikipedia.org/wiki/Special:Search?search=naruto"]'

mark settings  # live settings changes, no restart
$GS set $SCHEMA web-search-engines '[{"keyword":"ex","name":"Example","url":"https://ex.com/?q={q}"}]'; sleep 0.5
open_and_type 'ex foo bar'; stub
key Return; sleep 1
check 'custom engine from settings' "$(opened)" '["https://ex.com/?q=foo%20bar"]'
open_and_type 'g naruto'
check 'removed engine: no keyword result, fallback uses first engine' "$(ev "$STATE")" '{"front":true,"shown":false,"default":"fallback","fb":true}'
key Escape; sleep 0.5
$GS set $SCHEMA web-search-enabled false; sleep 0.5
open_and_type 'ex foo'
check 'master switch off: no web results at all' "$(ev "$STATE")" '{"front":true,"shown":false,"default":"none","fb":false}'
key Escape; sleep 0.5
$GS reset $SCHEMA web-search-enabled; $GS reset $SCHEMA web-search-engines; sleep 0.5
open_and_type 'yt naruto'
check 'reset: defaults back' "$(ev "$STATE")" '{"front":true,"shown":true,"default":"web","fb":false}'
key Escape; sleep 0.5

mark done
cp "$FF_TEST_DIR/shell.log" "${SL_KEEP_LOG:-/dev/null}" 2>/dev/null || true
check 'extension state' "$(gnome-extensions info $UUID | sed -n 's/.*State: //p')" 'ACTIVE'
# Count only errors that come from this extension. GNOME 46 itself logs
# "already disposed" criticals in the headless session: installed-changed makes
# _reloadRemoteProviders() rebuild remote providers mid-search (happens without
# our provider too).
# Our wrapper of _updateResults can show up deeper in their stack traces, so
# only a top frame (#0) in our files counts.
ERR_RE='JS ERROR|TypeError|ReferenceError|SyntaxError|#0 .*extensions/search-light@'
log_errors="$(grep -cE "$ERR_RE" "$FF_TEST_DIR/shell.log")"
check 'no extension errors in shell.log' "$log_errors" '0'
[ "$log_errors" = 0 ] || grep -E "$ERR_RE" -B2 -A3 "$FF_TEST_DIR/shell.log" | head -30

echo; [ $fails -eq 0 ] && echo "all passed" || echo "$fails failed"
exit $fails
