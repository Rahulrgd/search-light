// "Web Search" preferences page: turn keywords on/off and add, edit, delete,
// enable/disable, test and reset search engines.
//
// WebSearchEngines is the model (GSettings <-> engine list) and holds no widgets,
// so tests can drive it directly; buildWebSearchPage() is the UI on top of it.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
  buildUrl,
  defaultEngines,
  normalizeEngine,
  resolveEngines,
  validateEngine,
} from '../providers/webSearchCore.js';

const KEY_ENABLED = 'web-search-enabled';
const KEY_ENGINES = 'web-search-engines';
const TEST_QUERY = 'GNOME';

export class WebSearchEngines {
  constructor(settings) {
    this._settings = settings;
    this._listeners = [];
    this._writing = false;
    this.engines = resolveEngines(settings.get_string(KEY_ENGINES));
    // Changes from elsewhere (dconf-editor, another prefs window, reset).
    this._changedId = settings.connect(`changed::${KEY_ENGINES}`, () => {
      if (this._writing) return;
      this.engines = resolveEngines(settings.get_string(KEY_ENGINES));
      this._emit();
    });
  }

  onChanged(callback) {
    this._listeners.push(callback);
  }

  _emit() {
    this._listeners.forEach((cb) => cb(this.engines));
  }

  _save() {
    this._writing = true;
    try {
      this._settings.set_string(KEY_ENGINES, JSON.stringify(this.engines));
    } finally {
      this._writing = false;
    }
    this._emit();
  }

  /** Engines except the one at `index` (for the uniqueness check). */
  others(index) {
    return this.engines.filter((_e, i) => i !== index);
  }

  /** @throws {Error} with a user-facing message when the engine is invalid */
  add(engine) {
    const error = validateEngine(engine, this.engines);
    if (error) throw new Error(error);
    this.engines.push(normalizeEngine({ ...engine, enabled: true }));
    this._save();
  }

  /** @throws {Error} with a user-facing message when the engine is invalid */
  update(index, engine) {
    const error = validateEngine(engine, this.others(index));
    if (error) throw new Error(error);
    const enabled = this.engines[index].enabled;
    this.engines[index] = normalizeEngine({ ...engine, enabled });
    this._save();
  }

  remove(index) {
    this.engines.splice(index, 1);
    this._save();
  }

  setEnabled(index, enabled) {
    if (this.engines[index].enabled === enabled) return;
    this.engines[index].enabled = enabled;
    this._save();
  }

  /** Back to the schema default (''), which means "built-in defaults". */
  reset() {
    this._writing = true;
    try {
      this._settings.reset(KEY_ENGINES);
    } finally {
      this._writing = false;
    }
    this.engines = defaultEngines();
    this._emit();
  }

  destroy() {
    if (this._changedId) this._settings.disconnect(this._changedId);
    this._changedId = 0;
    this._listeners = [];
  }
}

function iconButton(iconName, tooltip, cssClasses = ['flat']) {
  return new Gtk.Button({
    icon_name: iconName,
    tooltip_text: tooltip,
    valign: Gtk.Align.CENTER,
    css_classes: cssClasses,
  });
}

/**
 * @param {Gio.Settings} settings
 * @param {Gtk.Window} window - parent for dialogs
 * @param {object} [options]
 * @param {Function} [options.openUri] - replaces the browser launch (tests)
 * @returns {{page: Adw.PreferencesPage, model: WebSearchEngines,
 *   openEditor: Function, confirmReset: Function,
 *   enginesGroup: Adw.PreferencesGroup}}
 */
export function buildWebSearchPage(settings, window, options = {}) {
  const openUri =
    options.openUri ??
    ((uri) => new Gtk.UriLauncher({ uri }).launch(window, null, null));
  const model = new WebSearchEngines(settings);

  const page = new Adw.PreferencesPage({
    name: 'web-search',
    title: 'Web Search',
    icon_name: 'web-browser-symbolic',
  });

  // --- on/off ---
  const general = new Adw.PreferencesGroup({
    description:
      'Type a keyword, a space and your query. “g naruto” searches Google, ' +
      '“yt naruto” searches YouTube. Press Enter to open it in your browser.',
  });
  const enabledRow = new Adw.SwitchRow({
    title: 'Web search keywords',
    subtitle: 'Show a web search result when the text starts with a keyword',
  });
  settings.bind(KEY_ENABLED, enabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
  general.add(enabledRow);
  page.add(general);

  // --- engine list ---
  const addButton = iconButton('list-add-symbolic', 'Add search engine');
  const enginesGroup = new Adw.PreferencesGroup({
    title: 'Search engines',
    description: 'Click a row to edit it. Keywords are not case-sensitive.',
    header_suffix: addButton,
  });
  settings.bind(KEY_ENABLED, enginesGroup, 'sensitive', Gio.SettingsBindFlags.GET);
  page.add(enginesGroup);

  // --- reset ---
  const resetGroup = new Adw.PreferencesGroup();
  const resetRow = new Adw.ActionRow({
    title: 'Reset search engines',
    subtitle: 'Restore the built-in list. Your own engines are removed.',
  });
  const resetButton = new Gtk.Button({
    label: 'Reset',
    valign: Gtk.Align.CENTER,
    css_classes: ['destructive-action'],
  });
  resetRow.add_suffix(resetButton);
  resetGroup.add(resetRow);
  page.add(resetGroup);

  let rows = [];

  function makeRow(engine, index) {
    const row = new Adw.ActionRow({
      subtitle_lines: 1,
      use_markup: false,
      activatable: true,
    });
    // Set after use_markup is off: as construct properties they can be applied
    // first and parsed as markup ("&" in URLs breaks Pango markup).
    row.title = engine.name;
    row.subtitle = engine.url;
    row.add_prefix(
      new Gtk.Label({
        label: engine.keyword,
        width_chars: 5,
        xalign: 0,
        css_classes: ['monospace', 'heading'],
      }),
    );

    const testButton = iconButton(
      'web-browser-symbolic',
      `Test: search ${engine.name} for “${TEST_QUERY}”`,
    );
    testButton.connect('clicked', () =>
      openUri(buildUrl(engine.url, TEST_QUERY)),
    );
    const editButton = iconButton('document-edit-symbolic', 'Edit');
    editButton.connect('clicked', () => openEditor(index));
    const deleteButton = iconButton('user-trash-symbolic', 'Delete');
    deleteButton.connect('clicked', () => model.remove(index));
    const toggle = new Gtk.Switch({
      active: engine.enabled,
      valign: Gtk.Align.CENTER,
      tooltip_text: 'Enabled',
    });
    toggle.connect('notify::active', () =>
      model.setEnabled(index, toggle.active),
    );

    [testButton, editButton, deleteButton, toggle].forEach((w) =>
      row.add_suffix(w),
    );
    row.connect('activated', () => openEditor(index));
    return row;
  }

  function render() {
    rows.forEach((r) => enginesGroup.remove(r));
    rows = model.engines.map((e, i) => makeRow(e, i));
    if (rows.length === 0) {
      rows = [
        new Adw.ActionRow({
          title: 'No search engines',
          subtitle: 'Add one with the + button, or reset to the defaults.',
        }),
      ];
    }
    rows.forEach((r) => enginesGroup.add(r));
  }

  /** Add (index null) or edit (index) dialog with live validation. */
  function openEditor(index = null) {
    const editing = index !== null;
    const current = editing
      ? model.engines[index]
      : { keyword: '', name: '', url: 'https://' };

    const list = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ['boxed-list'],
    });
    const keywordRow = new Adw.EntryRow({ title: 'Keyword', text: current.keyword });
    const nameRow = new Adw.EntryRow({ title: 'Name', text: current.name });
    const urlRow = new Adw.EntryRow({ title: 'URL (use {q} for the query)', text: current.url });
    [keywordRow, nameRow, urlRow].forEach((r) => list.append(r));

    const errorLabel = new Gtk.Label({
      wrap: true,
      xalign: 0,
      css_classes: ['caption', 'error'],
    });
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
    box.append(list);
    box.append(errorLabel);

    const dialog = new Adw.AlertDialog({
      heading: editing ? 'Edit search engine' : 'Add search engine',
      body: 'Example URL: https://www.google.com/search?q={q}',
      extra_child: box,
      close_response: 'cancel',
      default_response: 'save',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('save', editing ? 'Save' : 'Add');
    dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);

    const values = () => ({
      keyword: keywordRow.text,
      name: nameRow.text,
      url: urlRow.text,
    });
    let touched = editing;
    const validate = () => {
      const error = validateEngine(values(), model.others(editing ? index : -1));
      // Don't greet a fresh "Add" dialog with an error.
      errorLabel.label = touched && error ? error : '';
      errorLabel.visible = errorLabel.label !== '';
      dialog.set_response_enabled('save', error === null);
      return error;
    };
    [keywordRow, nameRow, urlRow].forEach((r) =>
      r.connect('changed', () => {
        touched = true;
        validate();
      }),
    );
    validate();

    dialog.connect('response', (_d, response) => {
      if (response !== 'save' || validate() !== null) return;
      if (editing) model.update(index, values());
      else model.add(values());
    });
    dialog.present(window);
    return { dialog, keywordRow, nameRow, urlRow, errorLabel };
  }

  function confirmReset() {
    const dialog = new Adw.AlertDialog({
      heading: 'Reset search engines?',
      body: 'The list goes back to the built-in engines. Engines you added or edited are removed.',
      close_response: 'cancel',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('reset', 'Reset');
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect('response', (_d, response) => {
      if (response === 'reset') model.reset();
    });
    dialog.present(window);
    return dialog;
  }

  addButton.connect('clicked', () => openEditor(null));
  resetButton.connect('clicked', () => confirmReset());
  model.onChanged(render);
  render();

  window.connect('close-request', () => {
    model.destroy();
    return false;
  });

  return { page, model, openEditor, confirmReset, enginesGroup };
}
