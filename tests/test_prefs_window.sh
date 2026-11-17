#!/usr/bin/env bash
# Loads the real prefs.js into an Adw.PreferencesWindow, the way the Extensions
# app does, and checks that every page builds without errors. The one import that
# only exists inside the Extensions app (ExtensionPreferences) is swapped for a
# small stub in a temporary copy of the repo.
# Run inside the headless shell (it provides the display):
#   scripts/headless.sh -- tests/test_prefs_window.sh
# SL_SHOT_DIR=<dir> also saves a screenshot of the Web Search page.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -r "$ROOT"/*.js "$ROOT"/ui "$ROOT"/preferences "$ROOT"/providers "$ROOT"/schemas "$TMP"/
sed -i "s#'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'#'./__stub_prefs.js'#" "$TMP/prefs.js"
grep -q "__stub_prefs.js" "$TMP/prefs.js" || { echo "FAIL could not stub the ExtensionPreferences import"; exit 1; }

cat > "$TMP/__stub_prefs.js" <<'EOF'
import Gio from 'gi://Gio';
export class ExtensionPreferences {
  constructor(metadata) {
    this.metadata = metadata;
    this.path = metadata.path;
  }
  getSettings(schema) {
    return new Gio.Settings({ schema_id: schema ?? this.metadata['settings-schema'] });
  }
}
export const gettext = (s) => s;
EOF

cat > "$TMP/__run.js" <<'EOF'
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import System from 'system';
import Preferences from './prefs.js';

const dir = GLib.path_get_dirname(System.programPath);
function pump(ms) {
  const end = GLib.get_monotonic_time() + ms * 1000;
  while (GLib.get_monotonic_time() < end) GLib.MainContext.default().iteration(false);
}
Adw.init();
const win = new Adw.PreferencesWindow({ default_width: 760, default_height: 980 });
const prefs = new Preferences({
  uuid: 'search-light@icedman.github.com',
  path: dir,
  'settings-schema': 'org.gnome.shell.extensions.search-light',
});
prefs.fillPreferencesWindow(win);
win.present();
pump(500);

function* walk(w) {
  for (let c = w.get_first_child(); c; c = c.get_next_sibling()) { yield c; yield* walk(c); }
}
// Adw.PreferencesWindow.get_pages() needs Adw 1.6+; GNOME 46 ships 1.5.
const pages = [...walk(win)].filter((w) => w instanceof Adw.PreferencesPage).map((p) => p.title);
print(`pages: ${JSON.stringify(pages)}`);
let failed = 0;
if (!pages.includes('Web Search')) { print('FAIL Web Search page missing'); failed++; }
else print('ok   Web Search page present');

win.set_visible_page_name('web-search');
pump(500);
print(`ok   visible page: ${win.get_visible_page_name()}`);
const shotDir = GLib.getenv('SL_SHOT_DIR');
if (shotDir) {
  const paintable = new Gtk.WidgetPaintable({ widget: win });
  const snap = new Gtk.Snapshot();
  paintable.snapshot(snap, win.get_width(), win.get_height());
  win.get_native().get_renderer().render_texture(snap.to_node(), null)
    .save_to_png(`${shotDir}/3-prefs-window.png`);
  print(`screenshot: ${shotDir}/3-prefs-window.png`);
}
win.close();
pump(200);
System.exit(failed);
EOF

export GSETTINGS_SCHEMA_DIR="$TMP/schemas" GSETTINGS_BACKEND=memory
err="$TMP/stderr"
gjs -m "$TMP/__run.js" 2>"$err"
rc=$?
# Pre-existing, harmless GTK deprecation chatter from the old .ui files is not ours.
if grep -E -- '-(WARNING|CRITICAL) \*\*|JS ERROR|Error' "$err" | grep -v 'is deprecated' | grep -q .; then
  echo "FAIL warnings/errors on stderr:"
  grep -E -A3 -- '-(WARNING|CRITICAL) \*\*|JS ERROR|Error' "$err" | head -20
  rc=1
else
  echo "ok   no errors on stderr"
fi
exit "$rc"
