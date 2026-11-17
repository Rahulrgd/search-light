// Engine favicons, downloaded once into ~/.cache/search-light/favicons/<host>.png.
// Failures are silent: the result just keeps the generic browser icon.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import { faviconHost } from './webSearchCore.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

// Returns a PNG (404 for unknown sites), no API key needed.
const SERVICE = 'https://www.google.com/s2/favicons?sz=64&domain=';

export function faviconDir() {
  return GLib.build_filenamev([GLib.get_user_cache_dir(), 'search-light', 'favicons']);
}

export class FaviconCache {
  constructor(dir = faviconDir()) {
    this.dir = dir;
    this._cancellable = new Gio.Cancellable();
    this._pending = new Set();
    this._session = null;
  }

  _fileForHost(host) {
    return Gio.File.new_for_path(GLib.build_filenamev([this.dir, `${host}.png`]));
  }

  /** Cached icon for an engine URL template, or null. */
  gicon(urlTemplate) {
    const host = faviconHost(urlTemplate);
    if (!host) return null;
    const file = this._fileForHost(host);
    return file.query_exists(null) ? new Gio.FileIcon({ file }) : null;
  }

  /** Download the missing icons for these URL templates (in the background). */
  ensure(urlTemplates) {
    const hosts = new Set(urlTemplates.map(faviconHost).filter(Boolean));
    for (const host of hosts) {
      if (this._pending.has(host) || this._fileForHost(host).query_exists(null)) continue;
      this._pending.add(host);
      this._fetch(host)
        .catch(() => {})
        .finally(() => this._pending.delete(host));
    }
  }

  async _fetch(host) {
    GLib.mkdir_with_parents(this.dir, 0o755);
    this._session ??= new Soup.Session({ timeout: 10 });
    const msg = Soup.Message.new('GET', SERVICE + encodeURIComponent(host));
    const bytes = await this._session.send_and_read_async(
      msg, GLib.PRIORITY_LOW, this._cancellable);
    if (msg.get_status() !== Soup.Status.OK || bytes.get_size() < 64) return;
    // Write to a temp name first so a half-written file is never picked up.
    const tmp = this._fileForHost(`${host}.part`);
    await tmp.replace_contents_bytes_async(
      bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable);
    tmp.move(this._fileForHost(host), Gio.FileCopyFlags.OVERWRITE, null, null);
  }

  destroy() {
    this._cancellable.cancel();
    this._session?.abort();
    this._session = null;
    this._pending.clear();
  }
}
