#!/bin/bash
# antigravity-statusline-shim.sh — forwarding shim (spec 0243 R2). The status
# line command is hooks/antigravity-statusline-shim.ts; this file remains only
# so a `statusLine.command` still naming this `.sh` path keeps working until
# setup rewrites it to the direct `node` form.
#
# It invokes the TypeScript entry with the arguments and standard input it
# received and exits 0 whatever happens, including a `node` that is missing
# from the search path. It redirects nothing: the prior status-line command's
# standard output and standard error must still reach Antigravity CLI. The
# entry itself writes nothing else (spec 0243 R13, R14).

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v node >/dev/null 2>&1 || exit 0
node "$DIR/antigravity-statusline-shim.ts" "$@"
exit 0
