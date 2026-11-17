#!/usr/bin/env bash
# Phase 0.4 probe: how does this GNOME version's SearchResultsView treat an
# extension-added provider (ordering, default activation)?
# Run: scripts/headless.sh --unsafe -- tests/probe_providers.sh
set -uo pipefail
E="$(dirname "$0")/../scripts/eval.sh"

sleep 3
echo "== shell version"
$E 'imports.misc.config.PACKAGE_VERSION'

echo "== open search light"
$E 'Main.overview.searchLight._toggle_search_light(); Main.overview.searchLight._entry ? "entry ok" : "no entry"'
sleep 1

echo "== register probe provider"
$E '
const sc = Main.overview.searchController;
const sr = sc._searchResults;
globalThis.__probeActivated = null;
globalThis.__probe = {
  id: "probe@search-light",
  isRemoteProvider: false,
  canLaunchSearch: false,
  appInfo: null,
  getInitialResultSet: async (terms) => terms[0] === "g" ? ["probe-1"] : [],
  getSubsearchResultSet: async (prev, terms) => terms[0] === "g" ? ["probe-1"] : [],
  getResultMetas: async (ids) => ids.map(id => ({id, name: "Probe: " + id, description: "probe",
      createIcon: (size) => new (imports.gi.St.Icon)({icon_name: "web-browser-symbolic", icon_size: size})})),
  filterResults: (r, max) => r.slice(0, max),
  activateResult: (id, terms) => { globalThis.__probeActivated = id + " " + terms.join(" "); },
};
sc.addProvider(globalThis.__probe);
JSON.stringify({
  hasAddProvider: typeof sc.addProvider,
  nProviders: sr._providers.length,
  probeIndex: sr._providers.indexOf(globalThis.__probe),
  hasDisplay: !!globalThis.__probe.display,
  contentChildren: sr._content.get_n_children(),
  displayIndex: sr._content.get_children().indexOf(globalThis.__probe.display),
})'

echo "== type query"
$E 'Main.overview.searchLight._entry.set_text("g naruto"); "typed"'
sleep 2
$E '
const sr = Main.overview.searchController._searchResults;
JSON.stringify({
  visibleProviders: sr._providers.filter(p => p.display && p.display.visible)
      .map(p => p.id + (p.appInfo ? "(" + p.appInfo.get_id() + ")" : "")),
  defaultResult: sr._defaultResult ? (sr._defaultResult.provider?.id ?? "?") : null,
})'

echo "== move probe to front (providers array + display)"
$E '
const sr = Main.overview.searchController._searchResults;
const p = globalThis.__probe;
sr._providers.splice(sr._providers.indexOf(p), 1);
sr._providers.unshift(p);
sr._content.set_child_at_index(p.display, 0);
Main.overview.searchLight._entry.set_text("g naruto ");
"moved"'
sleep 2
$E '
const sr = Main.overview.searchController._searchResults;
JSON.stringify({
  displayIndex: sr._content.get_children().indexOf(globalThis.__probe.display),
  defaultResult: sr._defaultResult ? (sr._defaultResult.provider?.id ?? "?") : null,
})'

echo "== activate default (Enter)"
$E 'Main.overview.searchController._searchResults.activateDefault(); "activated"'
sleep 1
$E 'String(globalThis.__probeActivated)'

echo "== remove probe"
$E 'Main.overview.searchController.removeProvider(globalThis.__probe); Main.overview.searchController._searchResults._providers.length'
