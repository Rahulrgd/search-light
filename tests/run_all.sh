#!/usr/bin/env bash
# Runs every test: unit tests directly, the rest inside isolated headless shells.
#   tests/run_all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
run() {  # run <name> <command...>
  local name="$1"; shift
  local out
  out="$("$@" 2>&1)"
  if [ $? -eq 0 ]; then
    echo "PASS $name"
  else
    echo "FAIL $name"
    echo "$out" | grep -vE '^ok |SpiRegistry|calendar-server' | head -30
    fails=$((fails + 1))
  fi
}
run 'core unit tests'      gjs -m tests/test_websearch_core.js
run 'plugin unit tests'    gjs -m tests/test_plugins_core.js
run 'shell e2e + smoke'    scripts/headless.sh --unsafe -- bash -c 'tests/e2e_websearch.sh && tests/smoke.sh'
run 'web search prefs UI'  scripts/headless.sh -- tests/test_websearch_prefs.sh
run 'full prefs window'    scripts/headless.sh -- tests/test_prefs_window.sh
echo
[ $fails -eq 0 ] && echo "all suites passed" || echo "$fails suite(s) failed"
exit $fails
