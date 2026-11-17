// Shell providers for the command plugins in pluginsCore.js.
//
// - PluginKeywordProvider (kept right after the web providers): "> htop",
//   "kill fire", "?" — takes Enter while its keyword is typed.
// - PluginGlobalProvider (kept after the app results, before the web
//   fallback): system commands matched by plain text ("lock", "restart").
//
// Activation hands the item's action (plain data) to `runAction`
// (providers/pluginActions.js), which tests replace with a recorder.

import { BaseWebProvider } from './webSearch.js';
import {
  PLUGINS,
  matchPluginKeyword,
  resolvePluginConfig,
  searchGlobalPlugins,
  searchKeywordPlugin,
} from './pluginsCore.js';

class BasePluginProvider extends BaseWebProvider {
  constructor(opts) {
    super({ desktopFile: 'search-light-commands.desktop', ...opts });
    this.config = resolvePluginConfig('');
    this.history = [];
    /** () => [{pid, name, rssKb}] */
    this.processes = () => [];
    /** (action) => void */
    this.runAction = () => {};
  }

  _toItems(list) {
    return list.map((i) => [`plugin:${i.key}`, {
      name: i.name,
      description: i.description,
      iconName: i.icon,
      action: i.action,
    }]);
  }

  activateResult(id, _terms) {
    const action = this._items.get(id)?.action;
    if (!this.enabled || !action || action.type === 'none') return;
    this.runAction(action);
  }
}

export class PluginKeywordProvider extends BasePluginProvider {
  constructor(opts) {
    super({ id: 'search-light-plugins', ...opts });
    this.engines = [];
  }

  /** The keyword plugin addressed by the current text, or null. */
  currentMatch() {
    return this.enabled ? matchPluginKeyword(this._getText?.() ?? '', this.config) : null;
  }

  _compute(text) {
    const match = matchPluginKeyword(text, this.config);
    if (!match) return [];
    return this._toItems(searchKeywordPlugin(match.plugin, match.query, {
      engines: this.engines,
      config: this.config,
      history: this.history,
      processes: this.processes,
    }));
  }
}

export class PluginGlobalProvider extends BasePluginProvider {
  constructor(opts) {
    super({ id: 'search-light-plugins-global', ...opts });
    /** () => true while a keyword (web or plugin) owns the text */
    this.isClaimed = () => false;
    /** () => {rates, date} | null — exchange rates, see providers/rates.js */
    this.getRates = () => null;
    /** () => void — start loading rates (results re-run when they arrive) */
    this.requestRates = () => {};
  }

  _compute(text) {
    if (this.isClaimed()) return [];
    const r = this.getRates();
    const { items, usesRates } = searchGlobalPlugins(text, {
      config: this.config,
      rates: r?.rates ?? null,
      ratesDate: r?.date,
    });
    // Fetches only when the rates are missing or older than 12 h.
    if (usesRates) this.requestRates();
    return this._toItems(items);
  }
}

export { PLUGINS };
