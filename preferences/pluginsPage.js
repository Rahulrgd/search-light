// "Commands" preferences page: enable/disable each command plugin, change its
// keyword, clear the shell history. Stored in the `plugins` setting as JSON
// {id: {enabled, keyword}} (see providers/pluginsCore.js).

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { PLUGINS, resolvePluginConfig } from '../providers/pluginsCore.js';

const KEY_PLUGINS = 'plugins';
const KEY_HISTORY = 'plugin-shell-history';

/** Keyword rule shared with resolvePluginConfig: non-empty, no spaces. */
export function isValidPluginKeyword(keyword) {
  const k = (keyword ?? '').trim();
  return k.length > 0 && !/\s/.test(k);
}

/**
 * @param {Gio.Settings} settings
 * @returns {{page: Adw.PreferencesPage, rows: object}} rows[id] =
 *   {row, toggle, entry?} for tests
 */
export function buildPluginsPage(settings, window) {
  const page = new Adw.PreferencesPage({
    name: 'commands',
    title: 'Commands',
    icon_name: 'utilities-terminal-symbolic',
  });

  const group = new Adw.PreferencesGroup({
    title: 'Command plugins',
    description:
      'Keyword plugins answer after their keyword (“> htop”, “kill firefox”, ' +
      '“?”). System commands match plain text (“lock”, “restart”) and are listed ' +
      'after the apps. Power off, restart and log out ask GNOME to confirm.',
  });
  page.add(group);

  const save = (mutate) => {
    const config = resolvePluginConfig(settings.get_string(KEY_PLUGINS));
    mutate(config);
    settings.set_string(KEY_PLUGINS, JSON.stringify(config));
  };

  const rows = {};
  for (const plugin of PLUGINS) {
    const config = resolvePluginConfig(settings.get_string(KEY_PLUGINS))[plugin.id];
    const row = new Adw.ActionRow({ title: plugin.name, subtitle: plugin.description });
    row.add_prefix(Gtk.Image.new_from_icon_name(plugin.icon));
    let entry = null;
    if (plugin.defaultKeyword !== null) {
      entry = new Gtk.Entry({
        text: config.keyword,
        width_chars: 5,
        max_width_chars: 8,
        valign: Gtk.Align.CENTER,
        tooltip_text: `Keyword (default “${plugin.defaultKeyword}”)`,
      });
      entry.connect('changed', () => {
        const ok = isValidPluginKeyword(entry.text);
        if (ok) entry.remove_css_class('error');
        else entry.add_css_class('error');
        if (ok) save((c) => { c[plugin.id].keyword = entry.text.trim(); });
      });
      row.add_suffix(entry);
    }
    const toggle = new Gtk.Switch({ active: config.enabled, valign: Gtk.Align.CENTER });
    toggle.connect('notify::active', () =>
      save((c) => { c[plugin.id].enabled = toggle.active; }));
    if (entry) toggle.bind_property('active', entry, 'sensitive', 2 /* SYNC_CREATE */);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    group.add(row);
    rows[plugin.id] = { row, toggle, entry };
  }

  const historyGroup = new Adw.PreferencesGroup({ title: 'Shell history' });
  const historyRow = new Adw.ActionRow({ title: 'Clear shell history' });
  const clearButton = new Gtk.Button({
    label: 'Clear',
    valign: Gtk.Align.CENTER,
    css_classes: ['destructive-action'],
  });
  const syncHistory = () => {
    const n = settings.get_strv(KEY_HISTORY).length;
    historyRow.subtitle = n ? `${n} command${n === 1 ? '' : 's'} remembered` : 'Empty';
    clearButton.sensitive = n > 0;
  };
  clearButton.connect('clicked', () => settings.reset(KEY_HISTORY));
  const historyId = settings.connect(`changed::${KEY_HISTORY}`, syncHistory);
  syncHistory();
  historyRow.add_suffix(clearButton);
  historyGroup.add(historyRow);
  page.add(historyGroup);

  window?.connect('close-request', () => {
    settings.disconnect(historyId);
    return false;
  });

  return { page, rows, clearButton };
}
