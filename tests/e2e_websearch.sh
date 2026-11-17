#!/usr/bin/env bash
# End-to-end test of web search keywords inside a headless shell. URL opening is
# stubbed, so no browser starts; each case types a query and presses a real Enter.
# Run: scripts/headless.sh --unsafe -- tests/e2e_websearch.sh
set -uo pipefail
E="$(dirname "$0")/../scripts/eval.sh"
UUID=search-light@icedman.github.com
fails=0

ev() { $E "$1"; }
ORDER='Main.overview.searchController._searchResults._providers.slice(0, 3).map(p => p.id).join(" ")'
mark() { ev "console.log('MARK $1'); 1" >/dev/null; echo "-- $1 | providers: $(ev "$ORDER")"; }
key() {
  ev "const C = imports.gi.Clutter; globalThis.__kbd ??= C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE); const t = imports.gi.GLib.get_monotonic_time(); __kbd.notify_keyval(t, C.KEY_$1, C.KeyState.PRESSED); __kbd.notify_keyval(t + 1000, C.KEY_$1, C.KeyState.RELEASED); 1" >/dev/null
}
stub() {  # record opened URIs instead of launching a browser
  ev 'globalThis.__opened = []; Main.overview.searchLight._webSearch.openUri = (u) => __opened.push(u); 1' >/dev/null
}
check() {  # check <name> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "     got      $2"; echo "     expected $3"; fails=$((fails + 1)); fi
}
open_and_type() {
  ev 'if (!Main.overview.searchLight._visible) Main.overview.searchLight._toggle_search_light(); 1' >/dev/null
  sleep 0.5
  ev "Main.overview.searchLight._entry.set_text($(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')); 1" >/dev/null
  sleep 1.5
}
STATE='JSON.stringify((() => { const sr = Main.overview.searchController._searchResults; const ws = Main.overview.searchLight._webSearch; return { front: sr._providers[0] === ws, shown: !!ws.display?.visible, defaultIsWeb: sr._defaultResult?.provider === ws }; })())'

sleep 3

mark case1; open_and_type 'g naruto'; stub
check 'g naruto: state' "$(ev "$STATE")" '{"front":true,"shown":true,"defaultIsWeb":true}'
key Return; sleep 1
check 'g naruto: opened' "$(ev 'JSON.stringify(__opened)')" '["https://www.google.com/search?q=naruto"]'
check 'g naruto: popup closed' "$(ev 'String(Main.overview.searchLight._visible)')" 'false'

mark case2; open_and_type 'yt Naruto Shippuden'; stub
key Return; sleep 1
check 'yt case kept' "$(ev 'JSON.stringify(__opened)')" '["https://www.youtube.com/results?search_query=Naruto%20Shippuden"]'

mark case3; open_and_type 'g settings'; stub
check 'g settings: web wins over apps' "$(ev "$STATE")" '{"front":true,"shown":true,"defaultIsWeb":true}'
check 'g settings: apps also matched' "$(ev 'String(Main.overview.searchController._searchResults._providers.some(p => p.id === "applications" && p.display.visible))')" 'true'
key Return; sleep 1
check 'g settings: opened google' "$(ev 'JSON.stringify(__opened)')" '["https://www.google.com/search?q=settings"]'

mark case4; open_and_type 'yt'; stub
check 'yt alone: hint shown' "$(ev "$STATE")" '{"front":true,"shown":true,"defaultIsWeb":true}'
key Return; sleep 1
check 'yt alone: nothing opened' "$(ev 'JSON.stringify(__opened)')" '[]'
key Escape; sleep 0.5

mark case5; open_and_type 'settings'; stub
check 'no keyword: web hidden' "$(ev "$STATE")" '{"front":true,"shown":false,"defaultIsWeb":false}'
key Escape; sleep 0.5
check 'popup closed: provider still registered at front' "$(ev 'String(Main.overview.searchController._searchResults._providers[0] === Main.overview.searchLight._webSearch)')" 'true'

mark case6; gnome-extensions disable $UUID; sleep 1
check 'disabled: provider removed' "$(ev 'String(Main.overview.searchController._searchResults._providers.filter(p => p.id === "search-light-web-search").length)')" '0'
gnome-extensions enable $UUID; sleep 2
check 'enabled: registered before first popup' "$(ev 'String(Main.overview.searchController._searchResults._providers[0].id)')" 'search-light-web-search'
check 're-enabled: one provider, at front' "$(ev 'const l = Main.overview.searchController._searchResults._providers; String(l.filter(p => p.id === "search-light-web-search").length) + "," + (l[0].id === "search-light-web-search")')" '1,true'
open_and_type 'w naruto'; stub
key Return; sleep 1
check 're-enabled: w naruto' "$(ev 'JSON.stringify(__opened)')" '["https://en.wikipedia.org/wiki/Special:Search?search=naruto"]'

mark case7  # live settings changes, no restart
GS="gsettings --schemadir $(dirname "$0")/../schemas"
SCHEMA=org.gnome.shell.extensions.search-light
$GS set $SCHEMA web-search-engines '[{"keyword":"ex","name":"Example","url":"https://ex.com/?q={q}"}]'; sleep 0.5
open_and_type 'ex foo bar'; stub
key Return; sleep 1
check 'custom engine from settings' "$(ev 'JSON.stringify(__opened)')" '["https://ex.com/?q=foo%20bar"]'
open_and_type 'g naruto'
check 'removed engine no longer matches' "$(ev "$STATE")" '{"front":true,"shown":false,"defaultIsWeb":false}'
key Escape; sleep 0.5
$GS set $SCHEMA web-search-enabled false; sleep 0.5
open_and_type 'ex foo'
check 'master switch off: no web result' "$(ev "$STATE")" '{"front":true,"shown":false,"defaultIsWeb":false}'
key Escape; sleep 0.5
$GS reset $SCHEMA web-search-enabled; $GS reset $SCHEMA web-search-engines; sleep 0.5
open_and_type 'yt naruto'
check 'reset: defaults back' "$(ev "$STATE")" '{"front":true,"shown":true,"defaultIsWeb":true}'
key Escape; sleep 0.5

mark done
cp "$FF_TEST_DIR/shell.log" "${SL_KEEP_LOG:-/dev/null}" 2>/dev/null || true
check 'extension state' "$(gnome-extensions info $UUID | sed -n 's/.*State: //p')" 'ACTIVE'
# Count only errors that come from this extension. GNOME 46 itself logs
# "already disposed" criticals in the headless session: installed-changed makes
# _reloadRemoteProviders() rebuild remote providers mid-search (happens without
# our provider too).
ERR_RE='JS ERROR|TypeError|ReferenceError|SyntaxError|extensions/search-light@'
log_errors="$(grep -cE "$ERR_RE" "$FF_TEST_DIR/shell.log")"
check 'no extension errors in shell.log' "$log_errors" '0'
[ "$log_errors" = 0 ] || grep -E "$ERR_RE" -B2 -A3 "$FF_TEST_DIR/shell.log" | head -30

echo; [ $fails -eq 0 ] && echo "all passed" || echo "$fails failed"
exit $fails
