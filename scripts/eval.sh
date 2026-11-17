#!/usr/bin/env bash
# Run a JS snippet in the shell via org.gnome.Shell.Eval and print the result.
# Only works inside scripts/headless.sh --unsafe.
# Usage: scripts/eval.sh 'js code'   (or: scripts/eval.sh - < file.js)
# Prints the plain result (JSON-decoded when the shell returns a JSON string);
# on failure prints "EVAL-ERROR: <message>" and exits 1.
set -euo pipefail
code="${1:-}"
[ "$code" = "-" ] && code="$(cat)"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "$code" | python3 -c '
import ast, json, re, sys
raw = sys.stdin.read().strip()
m = re.match(r"^\((true|false), (.*)\)$", raw, re.S)
if not m:
    print(raw); sys.exit(1)
ok, val = m.group(1) == "true", ast.literal_eval(m.group(2))
if ok:
    try:
        val = json.loads(val)
    except ValueError:
        pass
    print(val)
else:
    print("EVAL-ERROR: " + val); sys.exit(1)
'
