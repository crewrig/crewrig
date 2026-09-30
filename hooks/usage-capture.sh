#!/bin/bash
# usage-capture.sh — forwarding shim (spec 0243 R2). The hook is
# hooks/usage-capture.ts; this file remains only so an installation whose
# wired command line still names this `.sh` path keeps capturing until setup
# rewrites it to the direct `node` form.
#
# It invokes the TypeScript entry with the arguments and standard input it
# received and exits 0 on every failure with nothing on either stream,
# including a `node` that is missing from the search path. No `exec` (it would
# let Node's own exit status reach the triggering CLI) and no trap.
#
# Usage: bash hooks/usage-capture.sh <cli> <event>   (payload on stdin)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v node >/dev/null 2>&1 || exit 0
node "$DIR/usage-capture.ts" "$@" >/dev/null 2>&1
exit 0
