#!/usr/bin/env bash
# Run a JS snippet in the shell via org.gnome.Shell.Eval and print the result.
# Only works inside scripts/headless.sh --unsafe.
# Usage: scripts/eval.sh 'js code'   (or: scripts/eval.sh - < file.js)
set -euo pipefail
code="${1:-}"
[ "$code" = "-" ] && code="$(cat)"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "$code"
