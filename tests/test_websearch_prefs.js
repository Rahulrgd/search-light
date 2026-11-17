// UI test for preferences/webSearchPage.js. Needs a display, so run it inside the
// headless shell (memory GSettings backend, nothing touches real settings):
//   scripts/headless.sh -- tests/test_websearch_prefs.sh
// SL_SHOT_DIR=<dir> also saves screenshots of the page and the Add dialog.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import System from 'system';

import { buildWebSearchPage } from '../preferences/webSearchPage.js';

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
  pump(300);
  const left = win.visible_dialog;
  if (left) print(`     (after ${response}: still open: ${left.heading})`);
}
const stored = () => settings.get_string('web-search-engines');
const keywords = () => JSON.parse(stored()).map((e) => e.keyword);

Adw.init();
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

win.close();
print(failed ? `\n${failed} failed` : '\nall passed');
System.exit(failed ? 1 : 0);
