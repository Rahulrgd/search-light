// Performs plugin actions inside the shell (see pluginsCore.js for the data).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { spawn } from 'resource:///org/gnome/shell/misc/util.js';

import { KNOWN_TERMINALS, parseProcStatus, terminalArgv } from './pluginsCore.js';

const PROCESS_CACHE_MS = 2000;

export class PluginActions {
  /**
   * @param {object} opts
   * @param {Function} opts.afterHide - (fn, delayMs) runs fn once the popup
   *   is hidden (popup first, so a dialog or the lock screen is not covered)
   * @param {Function} opts.onShellCommand - (command) after a command ran
   */
  constructor({ afterHide, onShellCommand }) {
    this._afterHide = afterHide;
    this._onShellCommand = onShellCommand ?? (() => {});
    this._procCache = null;
    // Replaceable in tests (the headless shell has no readable clipboard).
    this.setClipboard = (text) =>
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
  }

  run(action) {
    switch (action.type) {
      case 'fill': {
        const entry = Main.overview.searchEntry;
        entry.set_text(action.text);
        entry.clutter_text.set_cursor_position(-1);
        return; // keep the popup open
      }
      case 'system':
        this._afterHide(() => this._system(action.action),
          action.action === 'screenshot' ? 300 : 0);
        return;
      case 'shell':
        this._afterHide(() => this._shell(action.command), 0);
        return;
      case 'copy':
        this.setClipboard(action.text);
        this._afterHide(() => {}, 0);
        return;
      case 'kill':
        this._afterHide(() => this._kill(action.pid), 0);
        this._procCache = null;
        return;
    }
  }

  _system(what) {
    const sa = SystemActions.getDefault();
    switch (what) {
      case 'lock': sa.activateLockScreen(); break;
      case 'suspend': sa.activateSuspend(); break;
      case 'power-off': sa.activatePowerOff(); break; // GNOME asks to confirm
      case 'restart': sa.activateRestart(); break; // GNOME asks to confirm
      case 'logout': sa.activateLogout(); break; // GNOME asks to confirm
      case 'screenshot': sa.activateScreenshotUI(); break;
      case 'dark-style': {
        const s = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        s.set_string('color-scheme',
          s.get_string('color-scheme') === 'prefer-dark' ? 'default' : 'prefer-dark');
        break;
      }
    }
  }

  _kill(pid) {
    spawn(['kill', '-TERM', String(pid)]);
  }

  /** Default terminal: GNOME's setting if installed, else the first known one. */
  findTerminal() {
    let preferred = null;
    try {
      preferred = new Gio.Settings({ schema_id: 'org.gnome.desktop.default-applications.terminal' })
        .get_string('exec');
    } catch (_e) {
      // schema missing
    }
    for (const t of [preferred, ...KNOWN_TERMINALS]) {
      const path = t && GLib.find_program_in_path(t);
      if (path) return path;
    }
    return null;
  }

  _shell(command) {
    const terminal = this.findTerminal();
    if (!terminal) {
      Main.notify('Search Light', 'No terminal found to run the command');
      return;
    }
    spawn(terminalArgv(terminal, GLib.getenv('SHELL'), command));
    this._onShellCommand(command);
  }

  /** The user's own processes (cached briefly; /proc is read synchronously). */
  listProcesses() {
    const now = GLib.get_monotonic_time();
    if (this._procCache && now - this._procCache.time < PROCESS_CACHE_MS * 1000)
      return this._procCache.list;
    const read = (path) => {
      try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
      } catch (_e) {
        return ''; // the process exited meanwhile
      }
    };
    const me = parseProcStatus(read('/proc/self/status'));
    const list = [];
    const dir = Gio.File.new_for_path('/proc');
    // The owner comes with the directory listing, so other users' and system
    // processes are skipped without reading their status file.
    const children = dir.enumerate_children(
      'standard::name,unix::uid', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null))) {
      const name = info.get_name();
      if (!/^\d+$/.test(name)) continue;
      if (me && info.get_attribute_uint32('unix::uid') !== me.uid) continue;
      const st = parseProcStatus(read(`/proc/${name}/status`));
      if (!st || st.uid !== me?.uid || st.rssKb === 0) continue;
      list.push({ pid: Number(name), name: st.name, rssKb: st.rssKb });
    }
    children.close(null);
    this._procCache = { time: now, list };
    return list;
  }
}
