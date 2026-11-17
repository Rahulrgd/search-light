#!/usr/bin/env bash
# Runs tests/test_websearch_prefs.js with this repo's schema and an in-memory
# GSettings backend. Run inside the headless shell (it provides the display):
#   scripts/headless.sh -- tests/test_websearch_prefs.sh
# Fails on any GTK/GLib warning or critical as well.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GSETTINGS_SCHEMA_DIR="$ROOT/schemas" GSETTINGS_BACKEND=memory
err="$(mktemp)"
# Own cache dir: the extension running in the same headless session downloads
# real favicons into the session's cache, which would race the icon checks.
export XDG_CACHE_HOME="$(mktemp -d)"
trap 'rm -rf "$err" "$XDG_CACHE_HOME"' EXIT
gjs -m "$ROOT/tests/test_websearch_prefs.js" 2>"$err"
rc=$?
if grep -qE -- '-(WARNING|CRITICAL) \*\*|JS ERROR|Error' "$err"; then
    echo "FAIL warnings/errors on stderr:"
    grep -E -- '-(WARNING|CRITICAL) \*\*|JS ERROR|Error' -A2 "$err" | head -20
    rc=1
fi
exit "$rc"
