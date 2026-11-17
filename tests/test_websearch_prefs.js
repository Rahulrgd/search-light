// UI test for preferences/webSearchPage.js. Needs a display, so run it inside the
// headless shell (memory GSettings backend, nothing touches real settings):
//   scripts/headless.sh -- tests/test_websearch_prefs.sh
// SL_SHOT_DIR=<dir> also saves screenshots of the page and the Add dialog.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';

import { buildWebSearchPage } from '../preferences/webSearchPage.js';
import { buildPluginsPage } from '../preferences/pluginsPage.js';

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
function pump(ms = 50) {
  const ctx = GLib.MainContext.default();
  const end = GLib.get_monotonic_time() + ms * 1000;
  while (GLib.get_monotonic_time() < end) ctx.iteration(false);
}
function* walk(widget) {
  for (let c = widget.get_first_child(); c; c = c.get_next_sibling()) {
    yield c;
    yield* walk(c);
  }
}
function shoot(name) {
  const dir = GLib.getenv('SL_SHOT_DIR');
  if (!dir) return;
  pump(400); // let open/close animations finish
  const paintable = new Gtk.WidgetPaintable({ widget: win });
  const snap = new Gtk.Snapshot();
  paintable.snapshot(snap, win.get_width(), win.get_height());
  const texture = win.get_native().get_renderer().render_texture(snap.to_node(), null);
  texture.save_to_png(`${dir}/${name}.png`);
  print(`screenshot: ${dir}/${name}.png`);
}
// What a click on a dialog button does: emit the response, then close.
function respond(dialog, response) {
  pump(300); // a dialog still animating in ignores force_close()
  dialog.emit('response', response);
  dialog.force_close();
  for (let i = 0; i < 20 && win.visible_dialog === dialog; i++) pump(50);
  pump(100);
  const left = win.visible_dialog;
  if (left) print(`     (after ${response}: still open: ${left.heading})`);
}
const stored = () => settings.get_string('web-search-engines');
const keywords = () => JSON.parse(stored()).map((e) => e.keyword);

Adw.init();
// Seed a cached favicon (the cache dir is the headless session's temp one).
const favDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'search-light', 'favicons']);
GLib.mkdir_with_parents(favDir, 0o755);
GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 16, 16)
  .savev(`${favDir}/www.google.com.png`, 'png', [], []);
const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.search-light' });
const opened = [];
const win = new Adw.PreferencesWindow({ default_width: 720, default_height: 900 });
const ui = buildWebSearchPage(settings, win, { openUri: (u) => opened.push(u) });
win.add(ui.page);
win.present();
pump(500);

eq('starts from defaults (setting untouched)', [stored(), ui.model.engines.length], ['', 10]);
const rowTitles = () => [...walk(ui.enginesGroup)].filter((w) => w instanceof Adw.ActionRow).map((r) => r.title);
eq('one row per engine', rowTitles().length, 10);
shoot('1-page');

// Row favicons: cached file for Google, generic icon for the others
// (an image loaded from a file is a PAINTABLE; the generic one is an ICON_NAME;
// Adw.ActionRow also has its own, empty, internal image)
const prefixImage = (rowIndex) => {
  const row = [...walk(ui.enginesGroup)].filter((w) => w instanceof Adw.ActionRow)[rowIndex];
  return [...walk(row)].find((w) => w instanceof Gtk.Image &&
    !(w.get_parent() instanceof Gtk.Button) && w.storage_type !== Gtk.ImageType.EMPTY);
};
eq('cached favicon in the Google row, generic icon in YouTube row',
  [prefixImage(0).storage_type, prefixImage(1).icon_name],
  [Gtk.ImageType.PAINTABLE, 'web-browser-symbolic']);

// Behaviour switches are bound to settings (both ways)
ui.switches['web-search-exclusive'].active = false;
eq('exclusive switch -> setting', settings.get_boolean('web-search-exclusive'), false);
settings.set_boolean('web-search-exclusive', true);
eq('setting -> exclusive switch', ui.switches['web-search-exclusive'].active, true);
for (const key of ['web-search-fallback', 'web-search-open-urls', 'web-search-favicons'])
  eq(`${key} switch on by default`, ui.switches[key].active, true);
eq('suggestions switch off by default (privacy)', ui.switches['web-search-suggestions'].active, false);

// Fallback engine combo
const choice = () => ui.fallbackRow.model.get_string(ui.fallbackRow.selected);
eq('fallback combo: default Google', choice(), 'Google (g)');
ui.fallbackRow.selected = 3; // DuckDuckGo
eq('fallback combo -> setting', settings.get_string('web-search-fallback-engine'), 'ddg');
settings.set_string('web-search-fallback-engine', 'yt');
pump();
eq('setting -> fallback combo', choice(), 'YouTube (yt)');
settings.set_string('web-search-fallback-engine', 'nope');
pump();
eq('unknown keyword: combo shows the engine really used', choice(), 'Google (g)');
settings.set_boolean('web-search-fallback', false);
eq('fallback off: combo insensitive', ui.fallbackRow.sensitive, false);
settings.reset('web-search-fallback');
settings.reset('web-search-fallback-engine');
pump();

// Test button on the Google row
const testBtn = [...walk(ui.enginesGroup)].find((w) => w instanceof Gtk.Button && w.tooltip_text?.startsWith('Test: search Google'));
testBtn.emit('clicked');
eq('test button opens a sample search', opened, ['https://www.google.com/search?q=GNOME']);

// Add dialog: live validation
let ed = ui.openEditor(null);
pump();
eq('fresh add dialog: no error, Add disabled', [ed.errorLabel.visible, ed.dialog.get_response_enabled('save')], [false, false]);
ed.keywordRow.text = 'yt';
ed.nameRow.text = 'Dup';
ed.urlRow.text = 'https://ex.com/?q={q}';
eq('duplicate keyword blocked', [ed.errorLabel.label, ed.dialog.get_response_enabled('save')], ['Keyword “yt” is already used', false]);
ed.keywordRow.text = 'ex';
ed.urlRow.text = 'https://ex.com/';
eq('missing {q} blocked', ed.errorLabel.label, 'URL must contain {q} where the query goes');
ed.urlRow.text = 'https://ex.com/?q={q}';
ed.nameRow.text = 'Example';
shoot('2-add-dialog');
eq('valid: no error, Add enabled', [ed.errorLabel.visible, ed.dialog.get_response_enabled('save')], [false, true]);
respond(ed.dialog, 'save');
eq('dialog closed after Add', win.visible_dialog, null);
eq('added engine saved to settings', keywords().slice(-1), ['ex']);
eq('row added', rowTitles().slice(-1), ['Example']);

// Edit dialog keeps its own keyword valid, saves the change
eq('suggest field: invalid URL blocks Save', (() => {
  const d = ui.openEditor(0);
  d.suggestRow.text = 'https://ex.com/ac';
  const r = [d.errorLabel.label, d.dialog.get_response_enabled('save')];
  respond(d.dialog, 'cancel');
  return r;
})(), ['Suggestions URL must contain {q}', false]);
ed = ui.openEditor(10);
pump();
eq('edit dialog prefilled + valid', [ed.keywordRow.text, ed.dialog.get_response_enabled('save')], ['ex', true]);
ed.nameRow.text = 'Example 2';
respond(ed.dialog, 'save');
eq('edit saved', JSON.parse(stored())[10].name, 'Example 2');

// Cancel does not save
ed = ui.openEditor(10);
ed.nameRow.text = 'Cancelled';
respond(ed.dialog, 'cancel');
eq('cancel keeps old value', JSON.parse(stored())[10].name, 'Example 2');

// Per-engine switch
const firstSwitch = [...walk(ui.enginesGroup)].find((w) => w instanceof Gtk.Switch);
firstSwitch.active = false;
pump();
eq('switch disables engine', JSON.parse(stored())[0].enabled, false);
eq('disabled engine leaves the fallback choices', [ui.fallbackRow.model.get_n_items(), choice()], [10, 'YouTube (yt)']);

// Delete button on the last row
const delBtns = [...walk(ui.enginesGroup)].filter((w) => w instanceof Gtk.Button && w.tooltip_text === 'Delete');
delBtns[delBtns.length - 1].emit('clicked');
pump();
eq('delete removes engine', [keywords().length, keywords().includes('ex')], [10, false]);

// Master switch greys out the list
settings.set_boolean('web-search-enabled', false);
pump();
eq('disabled: engine list insensitive', ui.enginesGroup.sensitive, false);
settings.set_boolean('web-search-enabled', true);
pump();

// Change from outside the page (e.g. dconf-editor)
settings.set_string('web-search-engines', JSON.stringify([{ keyword: 'z', name: 'Zed', url: 'https://z.dev/{q}' }]));
pump();
eq('external change re-renders', [ui.model.engines.length, rowTitles()], [1, ['Zed']]);

// Reset (confirm dialog)
const rd = ui.confirmReset();
respond(rd, 'reset');
eq('reset: back to schema default + 10 rows', [settings.get_user_value('web-search-engines'), rowTitles().length], [null, 10]);

// Empty list shows a placeholder row
ui.model.engines.splice(0).length;
settings.set_string('web-search-engines', '[]');
pump();
eq('empty list placeholder', rowTitles(), ['No search engines']);
ui.model.reset();
pump(300);

eq('no dialog left open', win.visible_dialog, null);

// --- Commands page ---
const cp = buildPluginsPage(settings, win);
win.add(cp.page);
win.set_visible_page(cp.page);
pump(300);
shoot('4-commands-page');
const plugins = () => JSON.parse(settings.get_string('plugins') || '{}');
eq('commands: one row per plugin, global has no keyword field',
  [Object.keys(cp.rows).length, cp.rows.system.entry, cp.rows.units.entry, cp.rows.kill.entry.text], [6, null, null, 'kill']);
cp.rows.kill.entry.text = 'k';
eq('keyword change saved', plugins().kill.keyword, 'k');
cp.rows.kill.entry.text = 'k x';
eq('keyword with a space: not saved, entry marked', [plugins().kill.keyword, cp.rows.kill.entry.has_css_class('error')], ['k', true]);
cp.rows.kill.entry.text = 'kill';
cp.rows.shell.toggle.active = false;
eq('switch off saved, keyword field greyed', [plugins().shell.enabled, cp.rows.shell.entry.sensitive], [false, false]);
cp.rows.shell.toggle.active = true;
settings.set_strv('plugin-shell-history', ['htop', 'ls']);
pump();
eq('history row shows the count, Clear enabled', [cp.clearButton.sensitive], [true]);
cp.clearButton.emit('clicked');
pump();
eq('Clear empties the history', [settings.get_strv('plugin-shell-history'), cp.clearButton.sensitive], [[], false]);
settings.reset('plugins');

win.close();
print(failed ? `\n${failed} failed` : '\nall passed');
System.exit(failed ? 1 : 0);
