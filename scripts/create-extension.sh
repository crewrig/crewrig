#!/bin/bash
# create-extension.sh — forwarding shim (spec 0258 requirement 32). The scaffolder is
# scripts/create-extension.ts; this file remains so every caller that still runs
# `bash scripts/create-extension.sh` (the two Bash suites scripts/tests/test-create-extension-combinations.sh
# and scripts/tests/test-build-extension.sh, until their own row migrates them) reaches the
# TypeScript scaffolder.
#
# It runs the Node.js floor guard (scripts/lib/node-floor-guard.js), then the scaffolder with
# every argument and its standard input, and returns the scaffolder's exit status, standard
# output and standard error unchanged. It fails closed: a scaffolder that cannot run must not
# report success. With `node` absent it writes one `Error:` line and exits 1; below the floor it
# exits with the floor guard's status and diagnostic, and the scaffolder is not run, so nothing is
# created. NAME, TIER, CREWRIG_TEST_FZF_SELECTION and every other environment variable reach the
# scaffolder as set. The shell implementation lived here up to commit 47ee9acb.
#
# Usage: NAME=my-extension bash scripts/create-extension.sh [--components <list>]

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node was not found on PATH; the extension scaffolder needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
  exit 1
fi

node "$DIR/lib/node-floor-guard.js" || exit $?

exec node "$DIR/create-extension.ts" "$@"
