# Search Light → Flow Launcher-style Features: Plan

Goal: make Search Light work like Flow Launcher, starting with **web search action
keywords** (`g naruto` → Google, `yt naruto` → YouTube), all configurable from the
extension's Settings.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## How it fits into the current code (already checked)

- Search Light does not have its own search engine. It moves GNOME's
  `Main.overview.searchEntry` + `Main.overview.searchController` into its own popup
  (`extension.js` → `_setupBackground()`).
- So **all GNOME search providers already work** (apps, files, calculator,
  settings, characters…). We only need to add **our own providers**.
- `extension.js` → `_updateProviders()` already has an empty
  `// add providers here` hook, plus `_removeProviders()`, which calls
  `searchController.addProvider()` / `removeProvider()`. This is where the web search
  provider goes.
- `unit-converter` / `currency-converter` settings exist (schema + UI switch), but
  their provider code was removed. These are leftovers that can be revived later.
- Settings use GSettings (`schemas/*.gschema.xml`) + `preferences/keys.js` +
  `ui/*.ui` (Adw pages).

> ✅ **Version mismatch resolved (Phase 0)**: this machine runs **GNOME Shell 46**, while
> the repo (v101) only supported 48–50. The branch now also runs on 46. The installed
> v37 is still in place, and only gets replaced at the end of a phase.

---

## Feature list

### A. Must-have (core Flow Launcher feel)
1. **Web search action keywords**: `g`, `yt`, `w`, `gh`, … + space + query → opens the
   browser with the URL.
2. **Settings page "Web Search"**: add / edit / delete / enable-disable engines
   (keyword, name, URL template with `{q}`, icon). Reset-to-defaults button.
3. **Keyword result on top + Enter opens it**: when a keyword matches, our result is
   the first/default result.
4. **Exclusive mode** (option): when a keyword is active, hide app/file results
   (Flow Launcher behaviour).
5. **Keyword hint**: typing just `yt` (without a query) shows "YouTube: type to
   search…".
6. **Fallback web search**: if nothing matches, show a "Search Google for '…'"
   result at the end (default engine is configurable).
7. **Open URL directly**: typing `github.com/foo` or `https://…` gives an "Open
   URL" result.

### B. Nice-to-have (Flow Launcher plugins that make sense on GNOME)
8. **Search suggestions**: live autocomplete from Google/DDG suggest API
   (async, debounced, opt-in because of privacy).
9. **Shell command** `>`: `> htop` runs in a terminal; `>` without a command shows
   history.
10. **System commands**: `lock`, `suspend`, `restart`, `shutdown`, `logout`,
    `empty trash`, `toggle dark mode`.
11. **Process killer** `kill`: `kill firefox` lists matching processes, Enter =
    SIGTERM.
12. **Browser bookmarks** `b`: read bookmarks from Firefox (`places.sqlite`) and
    Chrome/Brave (`Bookmarks` JSON).
13. **Unit + currency converter**: revive the existing switches
    (`10 km to mi`, `100 usd to inr`; NOTES.md already lists the floatrates source).
14. **Custom query shortcuts / aliases**: e.g. `naruto` → `yt naruto episode 1`
    (Flow's "Custom Query Shortcuts").
15. **Usage-based ranking + query history**: results you pick often come first;
    `↑` brings back the last query.
16. **`?` help**: lists all action keywords along with their descriptions.

### C. Future ideas (later / experimental)
- **Clipboard history** `cb` (needs a clipboard watcher; privacy setting).
- **Emoji picker** `:` (`:fire` → 🔥, copied to the clipboard).
- **Window switcher** `win`: search open windows by title (like Flow's Window Walker).
- **Quick Look / preview pane**: right-side preview for files/URLs.
- **Context menu** (Shift+Enter or →): per-result actions such as "copy URL",
  "open in private window", "open folder".
- **Per-engine browser choice / private window** option.
- **Bang syntax** (`!g naruto`) as an alternative to the plain keyword.
- **Translate** `tr en hi hello`, **dictionary** `def word`.
- **Color picker / converter** `#ff0000` → rgb/hsl preview.
- **Plugin architecture**: one `providers/*.js` file per feature, each with its own
  enable switch + keyword, so it works like Flow's plugin store.
- **Import/export** engine list (JSON), plus a Flow Launcher `Settings.json` web
  search importer.
- **Custom hotkeys per keyword** (e.g. Super+Y opens the popup with `yt ` already
  filled in).

---

## Phases & steps

### Phase 0: Setup & base decision
- [x] 0.1 GNOME 46 compatibility: `metadata.json` now lists 46–50. Two 48-only APIs
      replaced with fallbacks: `St.BoxLayout` `orientation` vs `vertical`, and
      `global.compositor.(en|dis)able_unredirect` vs `Meta.*_unredirect_for_display`
      (helper `setUnredirect()` in `extension.js`).
- [x] 0.2 Branch `feat/web-search` created. Installed v37 backup:
      `~/.local/share/gnome-shell/search-light-v37-backup.tar.gz`.
- [x] 0.3 Dev loop: `scripts/headless.sh` (copied from focusflow) runs an isolated,
      memory-capped headless shell that symlinks this repo; the real desktop and the
      installed v37 are never touched. `scripts/eval.sh` = Shell.Eval helper.
      `tests/smoke.sh` = open → type → Escape → reopen → disable/enable.
      Run: `./scripts/headless.sh --unsafe -- tests/smoke.sh`.
      Real-desktop install (`make build install`) needs logout/login on Wayland,
      so it is only for the end of each phase.
- [x] 0.4 Probe (`tests/probe_providers.sh`) results on GNOME 46:
      `searchController.addProvider()` exists and appends the provider at the end
      (index 12 of 13) and creates `provider.display`. Moving it to the front with
      `_providers.unshift()` + `_content.set_child_at_index(display, 0)` works. With
      `g naruto`, Enter (`activateDefault`) calls `activateResult('probe-1', ['g','naruto'])`.
      `removeProvider()` is clean. Still open for Phase 1: does a front provider win
      Enter when apps **also** match (e.g. `g gimp`)?

### Phase 1: Web search MVP (hardcoded engines)
- [x] 1.1 New file `providers/webSearch.js`: provider interface
      (`id`, `appInfo`, `isRemoteProvider=false`, `canLaunchSearch`,
      `getInitialResultSet`, `getSubsearchResultSet`, `getResultMetas`,
      `filterResults`, `activateResult`).
- [x] 1.2 Parser: first term = keyword, rest = query. Match is case-insensitive.
- [x] 1.3 Default engines (hardcoded): `g` Google, `yt` YouTube, `w` Wikipedia,
      `ddg` DuckDuckGo, `gh` GitHub, `so` StackOverflow, `maps` Google Maps,
      `amz` Amazon, `imdb` IMDb, `tr` Google Translate.
- [x] 1.4 URL build: `template.replace('{q}', encodeURIComponent(query))`, open
      with `Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1))`.
- [x] 1.5 Provider icon/name: add a `.desktop` file in `apps/` (same pattern as the
      Calculator one) or use a custom `appInfo` shim.
- [x] 1.6 Register it in `_updateProviders()`, cleanup in `_removeProviders()`
      (disable/enable leak check). The provider stays registered for the whole
      enabled lifetime. Upstream's `_release_ui()` removed providers on every hide
      and never added them back, and removing them mid-search raced with in-flight
      results.
- [x] 1.7 Put the result on top: move the provider display to index 0 in
      `_searchResults._content`, and move it to the front of the `_providers` array so
      **Enter** activates it by default.
- [~] 1.8 Automated: `gjs -m tests/test_websearch_core.js` (13 unit checks: case,
      `&`/`#`/Hindi encoding) + `./scripts/headless.sh --unsafe -- tests/e2e_websearch.sh`
      (17 checks with real Enter key presses: g/yt/w, `g settings` beats the app
      result, `yt` alone shows a hint and opens nothing, no keyword = hidden,
      disable/enable). **Pending**: a manual check on the real desktop with a real
      browser (`make build install`, then logout/login).
- [x] 1.9 Fixes found on the way: after Enter, the popup only went transparent
      (it closes on window focus change), so it is now hidden explicitly, deferred
      via `_hiTimer` because hiding inside `activate()` aborted Clutter. `hide()`
      got a re-entrancy guard (`_release_ui()` → focus change → nested `hide()`).
      `_isDraggingIcon()` now finds the app grid by provider id, instead of
      assuming it is `_content.first_child`.

### Phase 2: Settings UI ("Web Search" page)
- [ ] 2.1 Schema keys: `web-search-enabled` (b), `web-search-engines` (s, JSON
      array: `{keyword,name,url,icon,enabled}`), `web-search-default-engine` (s),
      `web-search-exclusive` (b), `web-search-fallback` (b).
- [ ] 2.2 Add the new keys to `preferences/keys.js` + `glib-compile-schemas`.
- [ ] 2.3 New `ui/websearch.ui` Adw page: master switch, engines list
      (`AdwActionRow` + enable switch + edit/delete buttons), "Add engine" button.
- [ ] 2.4 Add/Edit dialog: keyword, name, URL (validation: `{q}` must be present,
      keyword must be unique and contain no spaces), icon chooser (optional).
- [ ] 2.5 "Reset to defaults" + "Test" button (opens a sample query).
- [ ] 2.6 Extension listens for settings changes → provider reloads engines live (no
      restart needed).
- [ ] 2.7 Add a case in `tests/test_prefs.js`.

### Phase 3: UX polish
- [ ] 3.1 Keyword hint: just `yt` or `yt ` → placeholder result "YouTube: type to search".
- [ ] 3.2 Exclusive mode: when a keyword matches, suppress other providers'
      results (wrap or filter `_searchResults` `_doSearch`/`_providers`).
- [ ] 3.3 Fallback engine result (at the bottom when there is no keyword).
- [ ] 3.4 URL detection → "Open <url>" result.
- [ ] 3.5 Favicons: download once to `~/.cache/search-light/icons/` and reuse
      (fallback: `web-browser-symbolic`).
- [ ] 3.6 Popup must close properly after activation (check the existing
      `mainContainer.opacity = 0` logic).

### Phase 4: Search suggestions (opt-in)
- [ ] 4.1 Async HTTP with `Soup 3`, 250 ms debounce, `Gio.Cancellable` to cancel old
      requests.
- [ ] 4.2 Per-engine suggest URL (Google: `suggestqueries.google.com/complete/search?client=firefox&q=`,
      DDG: `duckduckgo.com/ac/?q=`).
- [ ] 4.3 Show suggestions as extra rows; Tab = autocomplete into the entry.
- [ ] 4.4 Privacy note + default OFF.

### Phase 5: More Flow-style providers (one by one, each with its own switch)
- [ ] 5.1 Refactor: common `providers/base.js` + registry (keyword, enabled, priority).
- [ ] 5.2 System commands.
- [ ] 5.3 Shell command `>`.
- [ ] 5.4 Unit + currency converter revive.
- [ ] 5.5 Browser bookmarks `b`.
- [ ] 5.6 Process killer `kill`.
- [ ] 5.7 `?` help / keyword list.
- [ ] 5.8 Custom query shortcuts.
- [ ] 5.9 Usage-based ranking + history.

### Phase 6: Quality & release
- [ ] 6.1 Run `make lint`, fix warnings.
- [ ] 6.2 Enable/disable 20× → no leaked signals/timers (check `journalctl`). Also
      `GLib-CRITICAL Source ID … not found` on disable.
- [ ] 6.2b Shell segfaults on teardown (logout) while the popup is open. This is
      pre-existing: v37 does the same. The search UI is still reparented into the
      popup when the shell destroys it.
- [ ] 6.3 Test on GNOME 46 (local) + 48/50 (VM or nested).
- [ ] 6.4 README: new features section + screenshots; CHANGELOG entry.
- [ ] 6.5 Bump version, `make publish` zip, optional upstream PR to icedman.

---

## Progress log
| Date | Phase/Step | Note |
|------|------------|------|
| 2026-11-17 | — | Plan created |
| 2026-11-17 | Phase 0 ✅ (commit 2caa9fc) | GNOME 46 compat (2 API fallbacks), headless test setup, provider probe passed. Known leftover: `GLib-CRITICAL Source ID … not found` on disable (same class of bug as upstream, harmless; fix in 6.2). Hand-calling `hide()` via Eval aborts the shell on v37 too, so tests close the popup with a virtual Escape key. |
| 2026-11-17 | Phase 1 ✅ (except the 1.8 manual browser check) | `g`/`yt`/`w`/… keyword search works headless on GNOME 46; 10 default engines hardcoded in `providers/webSearchCore.js`. |
