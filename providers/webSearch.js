// Web search providers, registered through
// Main.overview.searchController.addProvider():
//
// - WebSearchProvider (kept FIRST): "g naruto" → Google, "g " → hint, typed
//   URLs → "Open …". Being first, its result is the default for Enter.
// - WebSuggestProvider (kept SECOND, opt-in): live suggestions from the
//   engine's suggestion endpoint under the keyword result ("g naru" → naruto…).
// - WebFallbackProvider (kept LAST): "Search Google for …" when nothing else
//   claims the text, so it never steals Enter from an app result.
//
// Result ids encode their content ("web:g:naruto"). The shell caches result
// actors by id and does not clear them between searches, so a fixed id would
// keep showing the text of an older query.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { ListSearchResult } from 'resource:///org/gnome/shell/ui/search.js';

import {
  buildUrl,
  defaultEngines,
  detectUrl,
  displayHost,
  matchQuery,
  parseSuggestions,
  pickFallbackEngine,
} from './webSearchCore.js';
import { fetchJson } from './http.js';

const ICON_NAME = 'web-browser-symbolic';

class BaseWebProvider {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.extensionPath - for apps/search-light-web.desktop
   * @param {Function} opts.getText - raw search entry text (keeps the trailing
   *   space that the shell's terms drop)
   * @param {Function} opts.onActivated - called after a URL is opened
   * @param {Function} [opts.iconFor] - (urlTemplate) => Gio.Icon | null
   * @param {string} [opts.desktopFile] - section header app (apps/<file>)
   */
  constructor({ id, extensionPath, getText, onActivated, iconFor,
    desktopFile = 'search-light-web.desktop' }) {
    this.id = id;
    this.isRemoteProvider = false;
    this.canLaunchSearch = false;
    // Section header (name + icon). A real GAppInfo, because the shell's
    // parental-controls filter calls should_show() on it.
    this.appInfo = Gio.DesktopAppInfo.new_from_filename(
      `${extensionPath}/apps/${desktopFile}`,
    );
    this._getText = getText;
    this._onActivated = onActivated ?? (() => {});
    this._iconFor = iconFor ?? (() => null);
    // Replaced from GSettings by the extension (web-search-*).
    this.enabled = true;
    this.engines = defaultEngines();
    /** id → {name, description, url?, iconUrl?} for the current search */
    this._items = new Map();
    // Replaceable in tests so nothing actually opens a browser.
    this.openUri = (uri) =>
      Gio.AppInfo.launch_default_for_uri(
        uri,
        global.create_app_launch_context(0, -1),
      );
  }

  /** Subclasses: return [[id, item], …] for the text. */
  _compute(_text) {
    return [];
  }

  _results(terms) {
    this._items.clear();
    if (!this.enabled) return [];
    // Raw text when available; terms lose the trailing space.
    const text = this._getText?.() ?? terms.join(' ');
    for (const [id, item] of this._compute(text)) this._items.set(id, item);
    return [...this._items.keys()];
  }

  async getInitialResultSet(terms, _cancellable) {
    return this._results(terms);
  }

  async getSubsearchResultSet(_previousResults, terms, _cancellable) {
    return this._results(terms);
  }

  async getResultMetas(ids, _cancellable) {
    return ids.map((id) => {
      const item = this._items.get(id) ?? { name: id, description: '' };
      return {
        id,
        name: item.name,
        description: item.description,
        createIcon: (size) => {
          const gicon = item.iconUrl ? this._iconFor(item.iconUrl) : null;
          return gicon
            ? new St.Icon({ gicon, icon_size: size })
            : new St.Icon({ icon_name: item.iconName ?? ICON_NAME, icon_size: size });
        },
      };
    });
  }

  // The shell's list result bolds every search term found in the description,
  // and a short keyword like "g" lights up random letters of the host. Build
  // the same row, but keep the description as plain text.
  createResultObject(meta) {
    const view = this.display?._resultsView;
    if (!view) return null; // the shell then builds its default row
    const result = new ListSearchResult(this, meta, view);
    const label = result._descriptionLabel?.clutter_text;
    if (label) {
      view.disconnectObject(result); // its 'terms-changed' highlighter
      label.use_markup = false;
      label.text = meta.description ?? '';
    }
    return result;
  }

  filterResults(results, maxResults) {
    return results.slice(0, maxResults);
  }

  activateResult(id, _terms) {
    const url = this._items.get(id)?.url;
    if (!this.enabled || !url) return;
    this.openUri(url);
    // Search Light hides itself when a new window takes focus; a browser that
    // opens a tab in the background never does that, so hide explicitly.
    this._onActivated();
  }

  // Clicking the section header: open the first result.
  launchSearch(terms) {
    const first = this._results(terms)[0];
    if (first) this.activateResult(first, terms);
  }
}

export class WebSearchProvider extends BaseWebProvider {
  constructor(opts) {
    super({ id: 'search-light-web-search', ...opts });
    this.openUrls = true;
  }

  /** The keyword match for the current text (null when none). */
  currentMatch() {
    return this.enabled ? matchQuery(this._getText?.() ?? '', this.engines) : null;
  }

  _compute(text) {
    const match = matchQuery(text, this.engines);
    if (match) {
      const { engine, query } = match;
      if (!query) {
        return [[`hint:${engine.keyword}`, {
          name: `${engine.name}: type to search…`,
          description: `${engine.keyword} <query>`,
          iconUrl: engine.url,
        }]];
      }
      const url = buildUrl(engine.url, query);
      return [[`web:${engine.keyword}:${query}`, {
        name: `Search ${engine.name} for “${query}”`,
        description: displayHost(url),
        url,
        iconUrl: engine.url,
      }]];
    }
    const url = this.openUrls ? detectUrl(text) : null;
    if (url) {
      return [[`url:${url}`, { name: `Open ${url}`, description: 'Open in your browser', url }]];
    }
    return [];
  }
}

export class WebFallbackProvider extends BaseWebProvider {
  constructor(opts) {
    super({ id: 'search-light-web-fallback', ...opts });
    this.fallbackKeyword = 'g';
    /** () => true when another web result already covers the text */
    this.isClaimed = () => false;
  }

  _compute(text) {
    const query = text.trim().replace(/\s+/g, ' ');
    if (!query || this.isClaimed()) return [];
    const engine = pickFallbackEngine(this.engines, this.fallbackKeyword);
    if (!engine) return [];
    const url = buildUrl(engine.url, query);
    return [[`fallback:${engine.keyword}:${query}`, {
      name: `Search ${engine.name} for “${query}”`,
      description: displayHost(url),
      url,
      iconUrl: engine.url,
    }]];
  }
}

const SUGGEST_ICON = 'edit-find-symbolic';
const CACHE_SIZE = 50;

export class WebSuggestProvider extends BaseWebProvider {
  constructor(opts) {
    super({
      id: 'search-light-web-suggest',
      desktopFile: 'search-light-suggest.desktop', // "Suggestions" header
      ...opts,
    });
    this.enabled = false; // opt-in (web-search-suggestions)
    this.max = 5;
    this.debounceMs = 250;
    // Replaceable in tests: (url, cancellable) => Promise<parsed JSON>
    this.fetchJson = fetchJson;
    this._cache = new Map(); // "kw\nquery" → [suggestions]
    this._generation = 0;
    this._timeouts = new Set();
    this._last = null; // {keyword typed, engine, query, list} of the shown rows
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        this._timeouts.delete(id);
        resolve();
        return GLib.SOURCE_REMOVE;
      });
      this._timeouts.add(id);
    });
  }

  // The shell's cancellable is cancel()ed and then reset() for every new
  // search, so a finished-but-stale search cannot tell from it. A generation
  // counter can: only the newest call may fetch or publish results.
  async _resultsAsync(cancellable) {
    const generation = ++this._generation;
    const isStale = () => generation !== this._generation || this._destroyed;
    if (!this.enabled) return this._publish(null, []);

    const text = this._getText?.() ?? '';
    const match = matchQuery(text, this.engines);
    if (!match || !match.query || !match.engine.suggest)
      return this._publish(null, []);
    const { engine, query } = match;
    const key = `${engine.keyword}\n${query.toLowerCase()}`;

    let list = this._cache.get(key);
    if (!list) {
      await this._sleep(this.debounceMs); // typing fast: only the last one fetches
      if (isStale()) return [];
      try {
        const data = await this.fetchJson(buildUrl(engine.suggest, query), cancellable);
        list = parseSuggestions(data, query, this.max);
      } catch (_e) {
        return isStale() ? [] : this._publish(null, []); // offline, aborted, bad JSON
      }
      this._cache.set(key, list);
      if (this._cache.size > CACHE_SIZE)
        this._cache.delete(this._cache.keys().next().value);
      if (isStale()) return [];
    }
    const typedKeyword = text.trim().split(/\s+/)[0];
    return this._publish({ typedKeyword, engine, query, list }, list);
  }

  _publish(last, list) {
    this._last = last;
    this._items.clear();
    for (const s of list) {
      this._items.set(`suggest:${last.engine.keyword}:${s}`, {
        name: s,
        description: '', // the keyword result right above names the engine
        url: buildUrl(last.engine.url, s),
        iconName: SUGGEST_ICON,
      });
    }
    return [...this._items.keys()];
  }

  getInitialResultSet(_terms, cancellable) {
    return this._resultsAsync(cancellable);
  }

  getSubsearchResultSet(_previousResults, _terms, cancellable) {
    return this._resultsAsync(cancellable);
  }

  /**
   * Tab completion: "<keyword> <first suggestion>" for the rows on screen, or
   * null (no suggestions for this text, or already completed).
   */
  completion() {
    const last = this._last;
    if (!this.enabled || !last || last.list.length === 0) return null;
    const match = matchQuery(this._getText?.() ?? '', this.engines);
    if (!match || match.engine !== last.engine || match.query !== last.query)
      return null;
    return `${last.typedKeyword} ${last.list[0]}`;
  }

  destroy() {
    this._destroyed = true;
    for (const id of this._timeouts) GLib.source_remove(id);
    this._timeouts.clear();
    this._cache.clear();
  }
}
