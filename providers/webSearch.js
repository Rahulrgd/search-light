// Search provider for web search action keywords ("g naruto" → Google).
// Registered through Main.overview.searchController.addProvider() and kept at the
// front of the provider list, so its result is shown first and Enter opens it.

import Gio from 'gi://Gio';
import St from 'gi://St';

import { DEFAULT_ENGINES, matchEngine, buildUrl } from './webSearchCore.js';

const RESULT_ID = 'web-search';
const ICON_NAME = 'web-browser-symbolic';

export class WebSearchProvider {
  /**
   * @param {string} extensionPath - used to load apps/search-light-web.desktop
   * @param {Function} onActivated - called after a URL is opened (hides the popup)
   */
  constructor(extensionPath, onActivated = () => {}) {
    this._onActivated = onActivated;
    this.id = 'search-light-web-search';
    this.isRemoteProvider = false;
    this.canLaunchSearch = false;
    // Provides the section header (name + icon). A real GAppInfo, because the
    // shell's parental-controls filter calls should_show() on it.
    this.appInfo = Gio.DesktopAppInfo.new_from_filename(
      `${extensionPath}/apps/search-light-web.desktop`,
    );
    this.engines = DEFAULT_ENGINES;
    this._match = null;
    // Replaceable in tests so nothing actually opens a browser.
    this.openUri = (uri) =>
      Gio.AppInfo.launch_default_for_uri(
        uri,
        global.create_app_launch_context(0, -1),
      );
  }

  _results(terms) {
    this._match = matchEngine(terms, this.engines);
    return this._match ? [RESULT_ID] : [];
  }

  async getInitialResultSet(terms, _cancellable) {
    return this._results(terms);
  }

  async getSubsearchResultSet(_previousResults, terms, _cancellable) {
    return this._results(terms);
  }

  async getResultMetas(ids, _cancellable) {
    const match = this._match;
    if (!match) return [];
    const { engine, query } = match;
    return ids.map((id) => ({
      id,
      name: query
        ? `Search ${engine.name} for “${query}”`
        : `${engine.name}: type to search…`,
      description: query ? buildUrl(engine.url, query) : `${engine.keyword} <query>`,
      createIcon: (size) =>
        new St.Icon({ icon_name: ICON_NAME, icon_size: size }),
    }));
  }

  filterResults(results, maxResults) {
    return results.slice(0, maxResults);
  }

  activateResult(_id, terms) {
    const match = matchEngine(terms, this.engines);
    if (!match || !match.query) return;
    this.openUri(buildUrl(match.engine.url, match.query));
    // Search Light hides itself when a new window takes focus; a browser that
    // opens a tab in the background never does that, so hide explicitly.
    this._onActivated();
  }

  // Clicking the section header: same as activating the result.
  launchSearch(terms) {
    this.activateResult(RESULT_ID, terms);
  }
}
