# usage-headless.sh — usage_headless_run <cli> -- <args…> (spec 0206 PLAN v3
# step 15). Wraps a framework-owned, non-interactive launch of one of the
# four CLIs: resolves CREWRIG_USAGE_ROOT (default ${HOME}/.crewrig/usage) AT
# FUNCTION ENTRY — before any per-invocation `HOME=` override the caller
# applies to the CLI itself — records the launch instant, adds the
# structured-output flag, forwards the CLI's own stdout UNCHANGED to this
# process's own stdout, and derives one `run-total` record through
# scripts/lib/usage-capture/adapters/headless-envelope.js.
#
# The HOME ordering above is load-bearing: scripts/probe-extension-mcp-
# token.sh runs Copilot CLI under HOME="$isolated_home", and a record
# resolved after that override would be written inside a throwaway home and
# deleted with it.
#
# Usage (source this file, then call the function):
#   # shellcheck source=scripts/lib/usage-headless.sh
#   . "$REPO_DIR/scripts/lib/usage-headless.sh"
#   usage_headless_run claude-code -- claude -p "..." --output-format json
#
# The wrapped run's own exit status is preserved and returned unchanged;
# usage capture NEVER fails or blocks the wrapped run (same R15 contract as
# hooks/usage-capture.sh — a capture failure is swallowed, never surfaced).

usage_headless_run() {
  local cli="$1"; shift
  if [ "$1" = "--" ]; then shift; fi

  # Resolved BEFORE the wrapped command runs and BEFORE the caller's own
  # HOME override (if any) takes effect on the args below — see the header.
  local usage_root="${CREWRIG_USAGE_ROOT:-${HOME}/.crewrig/usage}"

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  local headless_js="$script_dir/usage-capture/adapters/headless-envelope.js"

  local launch_instant
  launch_instant="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  local out
  out="$(mktemp)"
  "$@" > "$out"
  local rc=$?

  cat "$out"

  local envelope_file
  envelope_file="$(mktemp)"
  # The wrapped run's own stdout IS the structured envelope when the caller
  # passed the CLI's own --output-format json (or equivalent) flag; a run
  # that did not (or whose output did not parse) still derives a record —
  # the headless-envelope adapter treats a missing/invalid envelope as
  # "reports nothing", never as a reason to skip capture (R19 applies
  # regardless of whether the envelope parsed).
  cp "$out" "$envelope_file"
  rm -f "$out"

  # Written to a temp .js file rather than passed inline via `node -e`: the
  # single-quoted-inside-single-quoted fragility that class of embedding
  # carries (an apostrophe in a comment breaks the outer bash quoting) is not
  # worth the risk here.
  local driver_dir driver
  driver_dir="$(mktemp -d)"
  driver="$driver_dir/driver.js"
  cat > "$driver" <<'NODE_DRIVER_EOF'
const fs = require('fs');
const path = require('path');
const headlessPath = process.argv[2];
const headless = require(headlessPath);
const record = require(path.join(path.dirname(headlessPath), '..', 'record'));
const sink = require(path.join(path.dirname(headlessPath), '..', 'sink'));
let envelope = null;
try {
  envelope = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
} catch (err) {
  envelope = null;
}
const rec = headless.capture({
  cli: process.argv[4],
  envelope,
  launchInstant: process.argv[5],
  projectRoot: process.cwd(),
  now: record.nowInstant,
});
try {
  sink.submit(rec);
} catch (err) {
  // capture never fails or blocks the wrapped run (same contract as R15).
}
NODE_DRIVER_EOF

  CREWRIG_USAGE_ROOT="$usage_root" node --disable-warning=ExperimentalWarning "$driver" \
    "$headless_js" "$envelope_file" "$cli" "$launch_instant" >/dev/null 2>&1

  rm -f "$envelope_file"
  rm -rf "$driver_dir"

  return "$rc"
}
