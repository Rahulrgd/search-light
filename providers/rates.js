// Exchange rates for the currency converter: open.er-api.com (free, no key),
// cached in ~/.cache/search-light/rates.json for 12 hours. Loaded only when a
// currency conversion is typed; nothing about the query is sent.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { fetchJson } from './http.js';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const URL = 'https://open.er-api.com/v6/latest/USD';
const MAX_AGE_S = 12 * 3600;
const RETRY_AFTER_S = 5 * 60; // after a failed fetch

export class RatesCache {
  constructor(path = GLib.build_filenamev([GLib.get_user_cache_dir(), 'search-light', 'rates.json'])) {
    this._file = Gio.File.new_for_path(path);
    this._data = null; // {rates, fetched (unix s), date (YYYY-MM-DD of the source)}
    this._lastAttempt = 0;
    this._loading = false;
    this._cancellable = new Gio.Cancellable();
    this._readFile();
    // Replaceable in tests.
    this.fetchJson = fetchJson;
  }

  _readFile() {
    try {
      const [ok, bytes] = this._file.load_contents(null);
      const data = ok && JSON.parse(new TextDecoder().decode(bytes));
      if (data?.rates?.USD === 1) this._data = data;
    } catch (_e) {
      // no cache yet
    }
  }

  /** {rates, date} or null when nothing was ever loaded. */
  get() {
    return this._data ? { rates: this._data.rates, date: this._data.date } : null;
  }

  _now() {
    return Math.floor(GLib.get_real_time() / 1e6);
  }

  /** Fetch in the background when missing or stale; onUpdated() after a fetch. */
  ensureFresh(onUpdated) {
    const now = this._now();
    if (this._loading) return;
    if (this._data && now - this._data.fetched < MAX_AGE_S) return;
    if (now - this._lastAttempt < RETRY_AFTER_S) return;
    this._loading = true;
    this._lastAttempt = now;
    this.fetchJson(URL, this._cancellable)
      .then(async (json) => {
        if (json?.result !== 'success' || json.rates?.USD !== 1) return;
        const date = new Date((json.time_last_update_unix ?? now) * 1000)
          .toISOString().slice(0, 10);
        this._data = { rates: json.rates, fetched: now, date };
        GLib.mkdir_with_parents(this._file.get_parent().get_path(), 0o755);
        await this._file.replace_contents_bytes_async(
          new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this._data))),
          null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable);
        onUpdated?.();
      })
      .catch(() => {}) // offline: keep the old rates, retry later
      .finally(() => { this._loading = false; });
  }

  destroy() {
    this._cancellable.cancel();
  }
}
