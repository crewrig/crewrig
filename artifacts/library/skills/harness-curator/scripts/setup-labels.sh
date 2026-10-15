#!/bin/bash
# setup-labels.sh — forwarding shim (spec 0258 R32). The label bootstrap of the Harness Curator is
# setup-labels.ts; this file remains so every caller that still runs
# `bash setup-labels.sh` (the Bash oracle test.sh and any
# installed copy of the skill) reaches the TypeScript entry until row J4 retires it.
#
# It runs the Node.js floor check inline, then the TypeScript entry with every
# argument and its standard input, and returns the entry's exit status, standard
# output and standard error unchanged. A skill shim has no scripts/lib/ above it, so the
# floor check is a `node -e` major-version test in place of scripts/lib/node-floor-guard.js.
# It fails closed: with `node` absent it writes one `Error:` line and exits 1; below the
# floor it prints the floor guard's diagnostic and exits 1, and the entry is not run.
#
# Usage: bash setup-labels.sh [arguments of setup-labels.ts]

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; the label bootstrap needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node -e 'var v=process.version,m=/^v?(\d+)\./.exec(v);if(!m||parseInt(m[1],10)<24){process.stderr.write("crewrig: Node.js "+v+" detected; crewrig requires Node.js >= 24. Install a supported release from https://nodejs.org/en/download\n");process.exit(1)}' || exit $?

exec node "$DIR/setup-labels.ts" "$@"
