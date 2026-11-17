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
- [x] 1.8 Automated: `gjs -m tests/test_websearch_core.js` (13 unit checks: case,
      `&`/`#`/Hindi encoding) + `./scripts/headless.sh --unsafe -- tests/e2e_websearch.sh`
      (17 checks with real Enter key presses: g/yt/w, `g settings` beats the app
      result, `yt` alone shows a hint and opens nothing, no keyword = hidden,
      disable/enable). Manual check on the real desktop with a real browser ✅
      (2026-11-17, installed with `make build install-zip` + logout/login).
- [x] 1.9 Fixes found on the way: after Enter, the popup only went transparent
      (it closes on window focus change), so it is now hidden explicitly, deferred
      via `_hiTimer` because hiding inside `activate()` aborted Clutter. `hide()`
      got a re-entrancy guard (`_release_ui()` → focus change → nested `hide()`).
      `_isDraggingIcon()` now finds the app grid by provider id, instead of
      assuming it is `_content.first_child`.

### Phase 2: Settings UI ("Web Search" page)
- [x] 2.1 Schema keys `web-search-enabled` (b, default true) and
      `web-search-engines` (s: a JSON array of `{keyword,name,url,enabled}`). `''`
      (the default) means "built-in defaults", so new defaults still reach users
      who never edited the list. The keys for 3.2/3.3 (`exclusive`, `fallback`,
      `default-engine`) move to Phase 3 with their features.
- [x] 2.2 Keys added to `preferences/keys.js`; schema compiled.
- [x] 2.3 `preferences/webSearchPage.js` builds the page in code (no `.ui`):
      master switch, engine list (keyword · name · URL, plus test / edit / delete
      / enable switch), "+" button. The list is greyed out when the master switch
      is off.
- [x] 2.4 Add/Edit dialog (`Adw.AlertDialog` + `EntryRow`s), validated live by
      `validateEngine()`: keyword required, no spaces, unique (case-insensitive),
      name required, URL needs a scheme and `{q}`. The Save button is disabled
      while the input is invalid.
- [x] 2.5 "Reset" (with a confirm dialog) and a per-row test button (opens a
      search for "GNOME").
- [x] 2.6 Live reload: the extension's settings callback →
      `_applyWebSearchSettings()`. No restart needed.
- [x] 2.7 Tests: `tests/test_websearch_prefs.sh` (20 UI checks, real GTK window,
      memory GSettings), `tests/test_prefs_window.sh` (the real `prefs.js` with
      all 3 pages; no errors on stderr), 4 live-settings cases in
      `tests/e2e_websearch.sh`, and 16 more core unit checks.
      **All tests: `tests/run_all.sh`**.
- [x] 2.8 Fixes on the way: the row subtitle was parsed as markup (`&` in the
      Translate URL); unbalanced unredirect calls made mutter warn on GNOME 46.
- Note: `gnome-extensions prefs` opens no window in the headless shell (same
  with v37), so `test_prefs_window.sh` loads `prefs.js` with a stubbed
  `ExtensionPreferences` instead.

### Phase 3: UX polish
- [x] 3.1 Keyword hint, Flow Launcher style: a keyword only counts with a space
      after it. `g` = normal search (gedit…), `g ` = "Google: type to search…",
      `g naruto` = search. Uses the raw entry text (the shell's terms drop the
      trailing space). The shell also skips searches whose terms are unchanged,
      so `_researchOnTrailingSpace()` forces a re-search when the space is typed
      or deleted.
- [x] 3.2 Exclusive mode (`web-search-exclusive`, default on): wraps
      `SearchResultsView._updateResults`. While a keyword is active, the other
      providers get `[]`; their real results stay cached for subsearches. The
      wrapper is removed on disable.
- [x] 3.3 Fallback (`web-search-fallback` + `web-search-fallback-engine`, default
      `g`): a separate `WebFallbackProvider` kept **last**, so an app result keeps
      Enter. It becomes the default only when nothing else matches. It is quiet
      when a keyword or URL result covers the text. The shell re-appends remote
      providers when the installed apps change, so the wrapper moves it back
      to last.
- [x] 3.4 Typed URLs (`web-search-open-urls`): `https://…`, `localhost:8080`,
      `www.…`, and bare domains with a known TLD (`github.com/x`). `notes.txt`
      and `v1.2` are not treated as URLs.
- [x] 3.5 Favicons (`web-search-favicons`): `providers/favicons.js` uses Soup 3
      and the Google s2 service, downloads once into
      `~/.cache/search-light/favicons/<host>.png` (temp file + rename), and fails
      silently. The settings rows show the cached icon too.
- [x] 3.6 Popup closes after activation (done in Phase 1, see 1.9).
- [x] 3.7 Bug found: result ids were fixed (`web-search`), and the shell caches
      result actors by id without clearing them between searches, so
      `g naruto` → `g naruto shippuden` kept showing the old text. Ids now encode
      their content (`web:g:naruto`, `url:…`, `fallback:…`).
- [x] 3.8 Settings: "Behaviour" group (4 switches + a fallback engine dropdown
      that shows the engine really used).
- [x] 3.9 Tests: core +27 unit checks, e2e now 36 checks (real Space/Backspace/
      Enter, exclusive on/off, fallback order + engine, URLs, seeded favicon,
      stale-label regression), prefs +12 UI checks. `tests/run_all.sh` is green.
- [x] 3.10 Cleaner result row (feedback from the real desktop): the description
      shows only the host (`google.com`), as plain text. The shell bolds every
      search term found in a description, so the keyword `g` lit up the letters
      of "google". `createResultObject()` builds the shell's own
      `ListSearchResult` and drops its highlighter.
- [x] 3.11 Test hardening: e2e waits until `searchInProgress` is false instead
      of a fixed sleep (one rare flaky failure), and the prefs test uses its own
      cache dir (the running extension downloaded real favicons into the
      shared one).
- Note: in the headless shell, `_defaultResult` stays null for app-grid results.
  v37 does the same, so the test checks instead that Enter on an app match
  does not trigger the fallback.

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
| 2026-11-17 | Phase 1 committed (367c3d1) · Phase 2 ✅ | Web Search settings page, live reload, `tests/run_all.sh` (4 suites green). |
| 2026-11-17 | v101 installed on the real desktop | `make build install-zip` + re-login; web search and the settings page confirmed working by hand. Use `install-zip` (a clean install), not `install` (which copies tests/ and scripts/ too). |
| 2026-11-17 | Branch pushed · Phase 3 ✅ | Space-after-keyword, exclusive mode, fallback (last), typed URLs, favicons, stale-label fix. |
