# usage-headless.sh — headless usage capture for a framework-owned,
# non-interactive CLI launch (spec 0206 PLAN v3 step 15). Three call shapes,
# because the four CLIs' own structured-output affordances are NOT uniform:
#
#   usage_headless_run <cli> -- <args…>
#     For a CLI whose own stdout, once --output-format json (or equivalent)
#     is added to <args…>, both IS the structured envelope AND is meant to
#     be consumed as such by the caller (a framework launch site that
#     already wants the JSON). Forwards stdout unchanged; derives one
#     run-total record from it.
#
#   usage_headless_capture_usage_file <cli> <usage_output_file> <launch_instant>
#     For a CLI whose structured summary lands in a SEPARATE file via its
#     own side-channel flag (Copilot CLI's --usage-output-file) rather than
#     stdout — verified live (DEV follow-up, issue #1169) to leave the
#     wrapped command's own stdout/stderr completely unaffected. Call this
#     AFTER the wrapped invocation completes; it never touches the
#     invocation's own output streams.
#
#   usage_headless_agy_rewrite_json_response <out_file> <launch_instant>
#     For Antigravity CLI specifically: `agy` has no side-channel flag —
#     --output-format json changes what lands on stdout. Call sites that
#     need PLAIN TEXT on stdout (not JSON) must instead run
#     `agy ... --output-format json` themselves, capture that JSON into
#     <out_file>, then call this function, which derives one run-total
#     record from <out_file> and REWRITES it to hold exactly the JSON
#     envelope's own `.response` field — verified live, byte-identical to
#     what `agy ...` (plain text mode) would have written directly, on two
#     distinct prompts on this machine (a one-word reply and a 58-line tool
#     listing). A parse failure (a timeout truncated the file, or agy wrote
#     a non-JSON error) leaves <out_file> COMPLETELY UNTOUCHED — a caller's
#     own empty/error classification downstream sees exactly what it would
#     have without this wrapping.
#
# All three resolve CREWRIG_USAGE_ROOT (default ${HOME}/.crewrig/usage) AT
# CALL TIME — before any per-invocation `HOME=` override the caller applies
# to the CLI itself. Load-bearing: scripts/probe-extension-mcp-token.sh runs
# Copilot CLI under HOME="$isolated_home", and a record resolved after that
# override would be written inside a throwaway home and deleted with it.
#
# Usage (source this file, then call a function):
#   # shellcheck source=scripts/lib/usage-headless.sh
#   . "$REPO_DIR/scripts/lib/usage-headless.sh"
#
# Usage capture NEVER fails or blocks the wrapped run (same R15 contract as
# hooks/usage-capture.sh — a capture failure is swallowed, never surfaced).
# A wrapped run's own exit status is always preserved and returned unchanged.

# _usage_headless_submit_envelope_file <cli> <envelope_json_file> <launch_instant>
#
# Shared internal primitive: derives one run-total record from an
# already-written JSON envelope file via
# scripts/lib/usage-capture/adapters/headless-envelope.js and submits it.
# Written to a temp .js file rather than passed inline via `node -e`: the
# single-quoted-inside-single-quoted fragility that embedding carries (an
# apostrophe in a comment breaks the outer bash quoting) is not worth the
# risk here.
_usage_headless_submit_envelope_file() {
  local cli="$1" envelope_file="$2" launch_instant="$3"
  local usage_root="${CREWRIG_USAGE_ROOT:-${HOME}/.crewrig/usage}"

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  local headless_js="$script_dir/usage-capture/adapters/headless-envelope.js"

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

  rm -rf "$driver_dir"
}

usage_headless_run() {
  local cli="$1"; shift
  if [ "$1" = "--" ]; then shift; fi

  # Resolved BEFORE the wrapped command runs — see the header.
  local usage_root="${CREWRIG_USAGE_ROOT:-${HOME}/.crewrig/usage}"
  local launch_instant
  launch_instant="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  local out
  out="$(mktemp)"
  "$@" > "$out"
  local rc=$?

  cat "$out"

  CREWRIG_USAGE_ROOT="$usage_root" _usage_headless_submit_envelope_file "$cli" "$out" "$launch_instant"
  rm -f "$out"

  return "$rc"
}

# usage_headless_capture_usage_file <cli> <usage_output_file> <launch_instant>
#
# See the file header. Call AFTER the wrapped command (which must already
# have been invoked with --usage-output-file <usage_output_file>) completes.
# No-op when the file is missing or empty (a timeout or a preflight failure
# before the CLI wrote it).
usage_headless_capture_usage_file() {
  local cli="$1" usage_file="$2" launch_instant="$3"
  [ -s "$usage_file" ] || return 0
  _usage_headless_submit_envelope_file "$cli" "$usage_file" "$launch_instant"
}

# usage_headless_agy_rewrite_json_response <out_file> <launch_instant>
#
# See the file header. <out_file> must already hold the raw stdout of an
# `agy ... --output-format json` invocation (or be empty/partial on a
# timeout). Derives and submits one run-total record, then rewrites
# <out_file> to hold exactly its own `.response` field — proven live
# byte-identical to agy's plain-text-mode stdout. Leaves <out_file>
# UNTOUCHED if it is empty or does not parse as JSON with a string
# `.response` field.
usage_headless_agy_rewrite_json_response() {
  local out_file="$1" launch_instant="$2"
  [ -s "$out_file" ] || return 0

  local response_file
  response_file="$(mktemp)"

  local extractor_dir extractor
  extractor_dir="$(mktemp -d)"
  extractor="$extractor_dir/extract-response.js"
  cat > "$extractor" <<'NODE_EXTRACT_EOF'
const fs = require('fs');
const envelopeFile = process.argv[2];
const responseFile = process.argv[3];
let envelope;
try {
  envelope = JSON.parse(fs.readFileSync(envelopeFile, 'utf8'));
} catch (err) {
  process.exit(1);
}
if (typeof envelope.response !== 'string') {
  process.exit(1);
}
fs.writeFileSync(responseFile, envelope.response);
NODE_EXTRACT_EOF

  if node "$extractor" "$out_file" "$response_file" 2>/dev/null; then
    _usage_headless_submit_envelope_file antigravity "$out_file" "$launch_instant"
    mv "$response_file" "$out_file"
  fi

  rm -f "$response_file"
  rm -rf "$extractor_dir"
}
