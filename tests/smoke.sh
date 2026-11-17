#!/usr/bin/env bash
# Smoke test: open Search Light, type, close, re-enable. Writes MARK lines into
# shell.log so errors can be matched to the step that caused them.
# Run: scripts/headless.sh --unsafe -- tests/smoke.sh
set -uo pipefail
E="$(dirname "$0")/../scripts/eval.sh"
UUID=search-light@icedman.github.com
key() {  # press+release a keyval through a virtual keyboard, like a real user
  $E "const C = imports.gi.Clutter; globalThis.__kbd ??= C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE); const t = imports.gi.GLib.get_monotonic_time(); __kbd.notify_keyval(t, C.KEY_$1, C.KeyState.PRESSED); __kbd.notify_keyval(t + 1000, C.KEY_$1, C.KeyState.RELEASED); 1" >/dev/null
}
mark() { $E "console.log('MARK $1'); 1" >/dev/null; }

sleep 3
mark open;      $E 'Main.overview.searchLight._toggle_search_light(); 1' >/dev/null; sleep 1
mark type;      $E 'Main.overview.searchLight._entry.set_text("settings"); 1' >/dev/null; sleep 2
$E 'JSON.stringify(Main.overview.searchController._searchResults._providers.filter(p => p.display?.visible).map(p => p.appInfo?.get_id() ?? p.id))'
mark retype;    $E 'Main.overview.searchLight._entry.set_text("files"); 1' >/dev/null; sleep 2
mark close;     key Escape; sleep 1
$E 'String(Main.overview.searchLight._visible)'
mark reopen;    $E 'Main.overview.searchLight._toggle_search_light(); 1' >/dev/null; sleep 1
mark close2;    key Escape; sleep 1
mark disable;   gnome-extensions disable $UUID; sleep 1
mark enable;    gnome-extensions enable $UUID; sleep 2
gnome-extensions info $UUID | grep State
mark done
