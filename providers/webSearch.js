// Web search providers, registered through
// Main.overview.searchController.addProvider():
//
// - WebSearchProvider (kept FIRST): "g naruto" → Google, "g " → hint, typed
//   URLs → "Open …". Being first, its result is the default for Enter.
// - WebFallbackProvider (kept LAST): "Search Google for …" when nothing else
//   claims the text, so it never steals Enter from an app result.
//
// Result ids encode their content ("web:g:naruto"). The shell caches result
// actors by id and does not clear them between searches, so a fixed id would
// keep showing the text of an older query.

import Gio from 'gi://Gio';
import St from 'gi://St';

import {
  buildUrl,
  defaultEngines,
  detectUrl,
  matchQuery,
  pickFallbackEngine,
} from './webSearchCore.js';

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
   */
  constructor({ id, extensionPath, getText, onActivated, iconFor }) {
    this.id = id;
    this.isRemoteProvider = false;
    this.canLaunchSearch = false;
    // Section header (name + icon). A real GAppInfo, because the shell's
    // parental-controls filter calls should_show() on it.
    this.appInfo = Gio.DesktopAppInfo.new_from_filename(
      `${extensionPath}/apps/search-light-web.desktop`,
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
            : new St.Icon({ icon_name: ICON_NAME, icon_size: size });
        },
      };
    });
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
        description: url,
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
      description: url,
      url,
      iconUrl: engine.url,
    }]];
  }
}
