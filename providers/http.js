// Small shared HTTP helper (Soup 3) for search suggestions.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

let session = null;

/**
 * GET a URL and parse the body as JSON.
 * @param {string} url
 * @param {Gio.Cancellable} [cancellable] - cancelling aborts the request
 * @throws on a bad URL, a non-200 status, cancellation or invalid JSON
 */
export async function fetchJson(url, cancellable = null) {
  const msg = Soup.Message.new('GET', url);
  if (!msg) throw new Error(`Invalid URL: ${url}`);
  // A generic client name: nothing that identifies the user.
  session ??= new Soup.Session({ timeout: 5, user_agent: 'search-light' });
  const bytes = await session.send_and_read_async(
    msg, GLib.PRIORITY_DEFAULT, cancellable);
  if (msg.get_status() !== Soup.Status.OK)
    throw new Error(`HTTP ${msg.get_status()}`);
  return JSON.parse(new TextDecoder().decode(bytes.toArray()));
}

/** Abort pending requests and drop the session (extension disable). */
export function closeHttp() {
  session?.abort();
  session = null;
}
