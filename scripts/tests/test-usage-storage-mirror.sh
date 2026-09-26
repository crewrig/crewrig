#!/bin/bash
# test-usage-storage-mirror.sh — the fake-daemon suite for the usage-record
# storage contract's mirror path (spec 0207 R23, PLAN v3 step 11;
# plan/1170#3 review edits 3 and 6).
#
# The ONLY daemon this suite ever talks to is
# scripts/tests/fixtures/usage-storage/fake-mempalace-mcp.js, bound to a
# caller-picked ephemeral port. MEMPALACE_MCP_PORT is NEVER 41893 (the real
# daemon's port), MEMPALACE_PALACE_PATH is always a temp path, and the token
# file is one this suite writes itself. CREWRIG_USAGE_WING is pinned to a
# fixed literal for the whole suite so mirror-path assertions never depend on
# this machine's git state (wing DERIVATION is suite 1's job — R22 — not
# this suite's).
#
# Preflight: node on PATH and node_modules/ajv installed, or a FATAL and exit
# 2 — never a silent pass, and never the literal phrase "command not found"
# (see test-usage-storage.sh's own preflight for why).
#
# Mutation discipline (this suite's share of the brief's five named
# mutations): each is applied by editing a tracked module IN PLACE, proven
# red against the fake daemon, then restored with `git checkout -- <file>`
# before the suite continues. The entry guard below refuses to run against a
# tree that is ALREADY dirty on any MUTATION_GUARD_FILES entry; the EXIT
# trap's own checkout safety net only fires once that guard has confirmed a
# clean starting point (MUTATION_GUARD_CONFIRMED_CLEAN), so a caller's
# pre-existing uncommitted edits are refused, never silently discarded
# (#1250).
#
# Usage:
#   bash scripts/tests/test-usage-storage-mirror.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Preflight ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: a Node.js runtime is required to run this suite — install Node and re-run \`npm install\`." >&2
  exit 2
fi
if [ ! -d "$REPO_DIR/node_modules/ajv" ]; then
  echo "FATAL: node_modules/ajv is missing — run \`npm install\` first." >&2
  exit 2
fi

pass=0
fail=0

ok() {
  echo "PASS  $1"
  pass=$((pass + 1))
}

bad() {
  echo "FAIL  $1"
  if [ -n "${2:-}" ]; then
    printf '%s\n' "$2" | sed 's/^/      /'
  fi
  fail=$((fail + 1))
}

# --- Sandbox -----------------------------------------------------------------
USAGE_ROOT="$(mktemp -d)"
PALACE_PARENT="$(mktemp -d)"
HELPERS_DIR="$(mktemp -d)"
MUTATION_GUARD_FILES="scripts/lib/usage-store/mirror.js scripts/lib/usage-store/prune.js scripts/lib/usage-store/mcp.js"
# Set to 1 only once the entry dirty-tree guard below has confirmed every
# MUTATION_GUARD_FILES entry is clean at commit HEAD. cleanup()'s checkout
# loop is gated on this flag so that a caller's own pre-existing uncommitted
# edits to these files — the exact condition the entry guard refuses to run
# against — are never touched by the EXIT trap. Before this flag existed,
# the trap fired unconditionally on any exit (including the guard's own
# `exit 2` refusal) and `git checkout --`'d any dirty guard file it found,
# silently destroying uncommitted work the guard had just refused to run
# against (#1250).
MUTATION_GUARD_CONFIRMED_CLEAN=0

FAKE_PID=""
FAKE_LOG="$HELPERS_DIR/fake-calls.jsonl"
FAKE_DRAWERS="$HELPERS_DIR/fake-drawers.json"
: > "$FAKE_LOG"
echo '{}' > "$FAKE_DRAWERS"

stop_fake() {
  if [ -n "$FAKE_PID" ] && kill -0 "$FAKE_PID" 2>/dev/null; then
    kill "$FAKE_PID" 2>/dev/null || true
    wait "$FAKE_PID" 2>/dev/null || true
  fi
  FAKE_PID=""
}

# tokenPath() is hardcoded to $HOME/.mempalace/server/<hash>/token by both
# mcp.js and common.sh — there is no override, and this suite must not
# override HOME itself (the asdf node shim on this machine breaks under an
# empty/foreign HOME). Any such directory this suite creates under the REAL
# $HOME is registered here and removed in cleanup(), so nothing survives
# under ~/.mempalace/ once the suite exits.
REAL_HOME_DIRS_TO_CLEAN=""
register_real_home_dir_for_cleanup() {
  if [ -e "$1" ]; then
    echo "FATAL: $1 already exists — refusing to touch pre-existing state under \$HOME/.mempalace/." >&2
    exit 2
  fi
  REAL_HOME_DIRS_TO_CLEAN="$REAL_HOME_DIRS_TO_CLEAN $1"
}

# shellcheck disable=SC2329  # invoked via trap cleanup EXIT, not dead
cleanup() {
  stop_fake
  if [ "$MUTATION_GUARD_CONFIRMED_CLEAN" = "1" ]; then
    for f in $MUTATION_GUARD_FILES; do
      if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
        git -C "$REPO_DIR" checkout -- "$f" 2>/dev/null || true
      fi
    done
  fi
  for d in $REAL_HOME_DIRS_TO_CLEAN; do
    rm -rf "$d" 2>/dev/null || true
  done
  rm -rf "$USAGE_ROOT" "$PALACE_PARENT" "$HELPERS_DIR" 2>/dev/null || true
}
trap cleanup EXIT

export CREWRIG_USAGE_ROOT="$USAGE_ROOT"
export MEMPALACE_PALACE_PATH="$PALACE_PARENT/palace"
export CREWRIG_USAGE_WING="usage-storage-mirror-suite"
unset CREWRIG_USAGE_MIRROR 2>/dev/null || true # spawns must actually run in this suite
unset CREWRIG_USAGE_ALLOW_PRUNED 2>/dev/null || true

for f in $MUTATION_GUARD_FILES; do
  if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
    echo "FATAL: $f has uncommitted changes — refusing to run mutation-discipline cases against a dirty tree." >&2
    exit 2
  fi
done
MUTATION_GUARD_CONFIRMED_CLEAN=1

# --- Pick a free ephemeral port, never 41893 (the real daemon's port) ------
FAKE_PORT="$(node -e "
const net = require('net');
const s = net.createServer();
s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => console.log(p)); });
")"
if [ "$FAKE_PORT" = "41893" ]; then
  echo "FATAL: the OS handed back the real daemon's port (41893) for the fake — refusing to proceed." >&2
  exit 2
fi
export MEMPALACE_MCP_PORT="$FAKE_PORT"
FAKE_TOKEN="fake-mempalace-token-$$-$RANDOM"

FIXTURE="$SCRIPT_DIR/tests/fixtures/usage-storage/fake-mempalace-mcp.js"

start_fake() {
  node "$FIXTURE" "$FAKE_PORT" "$FAKE_TOKEN" "$FAKE_LOG" "$FAKE_DRAWERS" >/dev/null 2>"$HELPERS_DIR/fake-stderr.log" &
  FAKE_PID=$!
  local waited=0
  until curl -sf --max-time 1 "http://127.0.0.1:$FAKE_PORT/healthz" >/dev/null 2>&1 || [ "$waited" -ge 50 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if ! curl -sf --max-time 1 "http://127.0.0.1:$FAKE_PORT/healthz" >/dev/null 2>&1; then
    echo "FATAL: fake-mempalace-mcp.js failed to bind port $FAKE_PORT within 5s (pid $FAKE_PID)" >&2
    cat "$HELPERS_DIR/fake-stderr.log" >&2 2>/dev/null || true
    kill "$FAKE_PID" 2>/dev/null || true
    exit 1
  fi
}

fake_control() {
  # $1 = JSON body, e.g. '{"failDeleteAfter":1}'
  curl -sf --max-time 2 -X POST "http://127.0.0.1:$FAKE_PORT/control" \
    -H 'Content-Type: application/json' -d "$1" >/dev/null
}

# --- Node driver (same shape as test-usage-storage.sh's own) ---------------
DRIVER="$HELPERS_DIR/driver.js"
cat > "$DRIVER" <<'NODE_EOF'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_DIR = process.env.USAGE_TEST_REPO_DIR;
if (!REPO_DIR) {
  console.error('FATAL: USAGE_TEST_REPO_DIR not set');
  process.exit(2);
}

function req(rel) {
  return require(path.join(REPO_DIR, rel));
}

function deriveRecordId(sessionId, idempotencyKey) {
  return crypto.createHash('sha256').update(`${sessionId}\x1F${idempotencyKey}`).digest('hex');
}

function envOr(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function cmdMakeRecord() {
  const kind = envOr('MR_KIND', 'captured');
  const cli = envOr('MR_CLI', 'claude-code');
  const session = envOr('MR_SESSION', 'test-session');
  const idemKey = envOr('MR_IDEMKEY', 'test-idem-key');
  const projectRoot = envOr('MR_PROJECT_ROOT', '/home/agent/workspaces/crewrig');
  const requestInstant = envOr('MR_REQUEST_INSTANT', new Date().toISOString());
  const captureInstant = envOr('MR_CAPTURE_INSTANT', requestInstant);
  const fidelity = envOr('MR_FIDELITY', 'per-request');
  const recordId = deriveRecordId(session, idemKey);

  const record = {
    schemaVersion: '1.0.0',
    kind,
    fidelity,
    recordId,
    idempotencyKey: idemKey,
    provenance: {
      cli,
      cliVersion: '1.0.0',
      captureChannel: 'test-fixture',
      formatFingerprint: `sha256:${'0'.repeat(32)}`,
    },
    identity: {
      sessionId: session,
      parentSessionId: envOr('MR_PARENT_SESSION', null) || null,
      agentId: envOr('MR_AGENT_ID', null) || null,
      projectRoot,
    },
    timing: { requestInstant, captureInstant },
  };

  if (process.env.MR_CORRECTS) record.corrects = process.env.MR_CORRECTS;

  if (kind === 'captured') {
    record.modelId = envOr('MR_MODEL_ID', 'claude-sonnet-5');
    record.interaction = envOr('MR_INTERACTION', 'user-turn');
    record.tokens = {
      netInput: Number(envOr('MR_NET_INPUT', '100')),
      cacheRead: Number(envOr('MR_CACHE_READ', '0')),
      cacheWrite: Number(envOr('MR_CACHE_WRITE', '0')),
      output: Number(envOr('MR_OUTPUT', '50')),
      reasoning: Number(envOr('MR_REASONING', '0')),
    };
    record.raw = {
      vendor: 'test-fixture',
      usage: { input_tokens: record.tokens.netInput, output_tokens: record.tokens.output },
    };
    record.rawStatus = 'complete';
  } else {
    record.uncapturedReason = envOr('MR_UNCAPTURED_REASON', 'test-fixture uncaptured reason');
  }

  process.stdout.write(JSON.stringify(record));
}

function cmdWrite() {
  const file = process.argv[3];
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const journal = req('scripts/lib/usage-store/journal.js');
  const result = journal.write(record);
  console.log(`STATUS=${result.status}`);
  if (result.reason) console.log(`REASON=${result.reason}`);
}

// cmdCallAddDrawer() — issue #1240, case (i): a direct mcp.addDrawer() probe,
// bypassing journal.js/mirror.js entirely, so a test can assert the `kind`
// mcp.js's call() classifies a JSON-RPC error-code answer as, without any
// pending-marker or breaker interaction. Prints KIND=<res.kind|ok> and
// MESSAGE=<res.message> once the promise settles.
function cmdCallAddDrawer() {
  const mcp = req('scripts/lib/usage-store/mcp.js');
  const args = {
    wing: envOr('MR_WING', 'kind-classification-wing'),
    room: 'usage-records',
    content: envOr('MR_CONTENT', JSON.stringify({ probe: true })),
    source_file: envOr('MR_SOURCE_FILE', '/tmp/kind-classification-probe.json'),
    added_by: envOr('MR_ADDED_BY', 'test-fixture-probe'),
  };
  mcp.addDrawer(args).then((res) => {
    console.log(`KIND=${res.ok ? 'ok' : res.kind}`);
    console.log(`MESSAGE=${res.message || ''}`);
  });
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'make-record':
      return cmdMakeRecord();
    case 'write':
      return cmdWrite();
    case 'call-add-drawer':
      return cmdCallAddDrawer();
    default:
      console.error(`unknown driver command: ${cmd}`);
      process.exit(2);
  }
}

main();
NODE_EOF

export USAGE_TEST_REPO_DIR="$REPO_DIR"

run_driver() {
  node --disable-warning=ExperimentalWarning "$DRIVER" "$@"
}

# --- Path algebra mirrors (bash side) ---------------------------------------
journal_entry_path() { echo "$USAGE_ROOT/journal/$1/$2/$3.json"; }
wing_sidecar_path() { echo "$USAGE_ROOT/journal/$1/$2/$3.wing.json"; }
pending_marker_path() { echo "$USAGE_ROOT/mirror/pending/$1/$2/$3"; }
mirrored_marker_path() { echo "$USAGE_ROOT/mirror/mirrored/$1/$2/$3"; }
# shellcheck disable=SC2329  # kept for parity with layout.js's full path API and the sibling suite, which does call it
pruned_marker_path() { echo "$USAGE_ROOT/pruned/$1/$2.json"; }

# shellcheck disable=SC2329  # used by the sibling suite (test-usage-storage.sh); kept here for parity
wait_for_file() {
  local path="$1" tries="$2" n=0
  while [ "$n" -lt "$tries" ]; do
    [ -f "$path" ] && return 0
    sleep 0.1
    n=$((n + 1))
  done
  [ -f "$path" ]
}

wait_for_condition() {
  # $1 = tries (tenths of a second), $2.. = command to test (exit 0 = met)
  local tries="$1" n=0
  shift
  while [ "$n" -lt "$tries" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
    n=$((n + 1))
  done
  "$@" >/dev/null 2>&1
}

log_count() {
  # $1 = tool name substring to count in the fake's call log
  grep -cF "\"tool\":\"$1\"" "$FAKE_LOG" 2>/dev/null || true
}

drawer_count() {
  node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))).length)" "$FAKE_DRAWERS"
}

drawers_for_source() {
  # $1 = source_file (an absolute journal entry path)
  node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log(Object.values(d).filter((v) => v.source_file === process.argv[2]).length);
" "$FAKE_DRAWERS" "$1"
}

pending_count() {
  # every marker under pending/, across all CLIs and periods
  if [ -d "$USAGE_ROOT/mirror/pending" ]; then
    find "$USAGE_ROOT/mirror/pending" -type f | wc -l | tr -d ' '
  else
    echo 0
  fi
}

fake_tool_failure() {
  # $1 = tool name, $2 = shape name, or the bare word null to clear it
  local shape_json="null"
  [ "$2" = "null" ] || shape_json="\"$2\""
  fake_control "{\"toolFailure\":{\"tool\":\"$1\",\"shape\":$shape_json}}"
}

# fake_jsonrpc_error() — issue #1240, case (i): arms the raw JSON-RPC `error`
# envelope shape with a caller-chosen code, so a probe call can assert how
# mcp.js's call() classifies that exact code (tool-error vs tool-unavailable).
fake_jsonrpc_error() {
  # $1 = tool name, $2 = JSON-RPC error code (integer, may be negative)
  fake_control "{\"toolFailure\":{\"tool\":\"$1\",\"shape\":\"jsonrpc-error\",\"code\":$2}}"
}

# fake_tool_failure_for_sources() — issue #1240, case (j): poisons a SUBSET
# of records for a tool (matched by recordId, extracted from source_file's
# basename) while every other record answers normally — the fixture's
# `sourceToolFailure` control. Pass zero record ids to arm-with-nothing
# (equivalent to clearing); use fake_clear_source_tool_failure() to clear
# both tools at once.
fake_tool_failure_for_sources() {
  # $1 = tool name, $2 = shape name, $3.. = poisoned record ids
  local tool="$1" shape="$2"
  shift 2
  local ids_json
  ids_json="$(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "$@")"
  fake_control "{\"sourceToolFailure\":{\"tool\":\"$tool\",\"shape\":\"$shape\",\"recordIds\":$ids_json}}"
}

fake_clear_source_tool_failure() {
  fake_control '{"sourceToolFailure":null}'
}

# set_marker_mtime() — issue #1240, case (j): pins a pending marker's mtime
# to an exact, caller-chosen instant, so the backlog's initial
# listMarkers()-visible ordering is deterministic regardless of how fast (or
# slow) this suite creates the records — real wall-clock creation order is
# NOT relied upon for the pass-by-pass call-count math.
set_marker_mtime() {
  # $1 = marker path, $2 = epoch milliseconds
  node -e "
const fs = require('fs');
const t = new Date(Number(process.argv[2]));
fs.utimesSync(process.argv[1], t, t);
" "$1" "$2"
}

write_quiet_record() {
  # $1 = record file, $2 = cli, $3 = session, $4 = idempotency key,
  # $5 = request instant. Writes with CREWRIG_USAGE_MIRROR=0 (no detached
  # spawn races the case) and prints the recordId.
  MR_CLI="$2" MR_SESSION="$3" MR_IDEMKEY="$4" MR_REQUEST_INSTANT="$5" run_driver make-record > "$1"
  CREWRIG_USAGE_MIRROR=0 run_driver write "$1" >/dev/null
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$1"
}

# Create the token file at the derived path — this suite's mirror gate is
# meant to be OPEN throughout (unlike suite 1, whose job is the gate itself).
TOKEN_PATH="$(node -e "console.log(require(process.argv[1] + '/scripts/lib/usage-store/mcp.js').tokenPath())" "$REPO_DIR")"
register_real_home_dir_for_cleanup "$(dirname "$TOKEN_PATH")"
mkdir -p "$(dirname "$TOKEN_PATH")"
printf '%s' "$FAKE_TOKEN" > "$TOKEN_PATH"

echo "=== usage-store fake-daemon suite (R23) ==="
echo "USAGE_ROOT=$USAGE_ROOT"
echo "FAKE_PORT=$FAKE_PORT (never 41893)"
echo "TOKEN_PATH=$TOKEN_PATH"

# --- (a) N=6 records written with the fake DOWN --------------------------
echo
echo "=== (a) daemon down: all journaled, all pending, unreachable.stamp set ==="
DAEMON_DOWN_PHASE_CLI=claude-code
DAEMON_DOWN_INSTANT="2022-11-01T00:00:00.000Z"
DAEMON_DOWN_PERIOD="2022-11"

DOWN_RIDS_FILE="$HELPERS_DIR/down-rids.txt"
: > "$DOWN_RIDS_FILE"

write_down_record() {
  # $1 = session suffix, $2 = kind (captured|uncaptured)
  local f="$HELPERS_DIR/down-$1.json"
  MR_CLI="$DAEMON_DOWN_PHASE_CLI" MR_SESSION="down-session-$1" MR_IDEMKEY="down-key-$1" \
    MR_REQUEST_INSTANT="$DAEMON_DOWN_INSTANT" MR_KIND="$2" run_driver make-record > "$f"
  local rid
  rid="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$f")"
  echo "$rid" >> "$DOWN_RIDS_FILE"
  run_driver write "$f" >/dev/null
}

i=1
while [ "$i" -le 5 ]; do
  write_down_record "$i" captured
  i=$((i + 1))
done
write_down_record 6 uncaptured

wait_for_condition 50 test -f "$USAGE_ROOT/mirror/unreachable.stamp"
if [ -f "$USAGE_ROOT/mirror/unreachable.stamp" ]; then
  ok "unreachable.stamp exists after the detached child's failed attempt against the down fake"
else
  bad "unreachable.stamp never appeared even though the fake is down"
fi

all_journaled=1
all_pending=1
none_mirrored=1
while IFS= read -r rid; do
  entry="$(journal_entry_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  pending="$(pending_marker_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  mirrored="$(mirrored_marker_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  [ -f "$entry" ] || all_journaled=0
  [ -f "$pending" ] || all_pending=0
  [ -f "$mirrored" ] && none_mirrored=0
done < "$DOWN_RIDS_FILE"

if [ "$all_journaled" -eq 1 ]; then ok "all 6 records are journaled"; else bad "at least one record is missing its journal entry"; fi
if [ "$all_pending" -eq 1 ]; then ok "all 6 records have a pending marker"; else bad "at least one record is missing a pending marker"; fi
if [ "$none_mirrored" -eq 1 ]; then ok "none of the 6 records has a mirrored marker (the fake never answered)"; else bad "a mirrored marker exists despite the fake being down"; fi

# --- (b) the fake comes UP; catch-up lands exactly N calls, all markers ----
#     move to mirrored/, slim() and added_by are asserted per drawer.
echo
echo "=== (b) fake up: catch-up mirrors exactly N=6 records ==="
start_fake

bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null

add_drawer_calls_after_b="$(log_count mempalace_add_drawer)"
if [ "$add_drawer_calls_after_b" -eq 6 ]; then
  ok "exactly 6 add_drawer calls landed"
else
  bad "expected exactly 6 add_drawer calls, found $add_drawer_calls_after_b"
fi

all_mirrored_now=1
while IFS= read -r rid; do
  mirrored="$(mirrored_marker_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  pending="$(pending_marker_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  [ -f "$mirrored" ] || all_mirrored_now=0
  [ -f "$pending" ] && all_mirrored_now=0
done < "$DOWN_RIDS_FILE"
if [ "$all_mirrored_now" -eq 1 ]; then
  ok "all 6 markers moved from pending/ to mirrored/"
else
  bad "at least one marker is still in pending/ (or both) after catch-up"
fi

if [ "$(drawer_count)" -eq 6 ]; then
  ok "the fake holds exactly 6 drawers"
else
  bad "the fake holds $(drawer_count) drawers, expected 6"
fi

wings_seen="$(node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log([...new Set(Object.values(d).map((v) => v.wing))].join(','));
" "$FAKE_DRAWERS")"
if [ "$wings_seen" = "usage-storage-mirror-suite" ]; then
  ok "every drawer's wing is the same (CREWRIG_USAGE_WING override)"
else
  bad "drawer wings are not uniform" "$wings_seen"
fi

added_by_seen="$(node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log([...new Set(Object.values(d).map((v) => v.added_by))].join(','));
" "$FAKE_DRAWERS")"
if [ "$added_by_seen" = "crewrig-usage-store/env-override" ]; then
  ok "added_by is crewrig-usage-store/<wingDerivation> (env-override)"
else
  bad "added_by does not match crewrig-usage-store/env-override" "$added_by_seen"
fi

# Per-record content checks: captured -> externalized+rawRef, no raw;
# uncaptured -> byte-identical to its journal entry, no rawStatus/rawRef.
# (the uncaptured record is singular, so its two checks below assert
# directly instead of accumulating into a summary variable.)
captured_checks_ok=1
i=1
while [ "$i" -le 5 ]; do
  rid="$(sed -n "${i}p" "$DOWN_RIDS_FILE")"
  entry="$(journal_entry_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  drawer_content="$(node -e "
    const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const hit = Object.values(d).find((v) => v.source_file === process.argv[2]);
    process.stdout.write(hit ? hit.content : '');
  " "$FAKE_DRAWERS" "$entry")"
  ok_this=1
  node -e "
    const c = JSON.parse(process.argv[1]);
    if (c.raw !== undefined) process.exit(1);
    if (c.rawStatus !== 'externalized') process.exit(1);
    if (typeof c.rawRef !== 'string' || c.rawRef.indexOf(c.recordId) === -1) process.exit(1);
  " "$drawer_content" || ok_this=0
  [ "$ok_this" -eq 1 ] || captured_checks_ok=0
  i=$((i + 1))
done
if [ "$captured_checks_ok" -eq 1 ]; then
  ok "all 5 captured drawers are externalized with rawRef naming their own entry, no raw"
else
  bad "at least one captured drawer failed the externalized/rawRef/no-raw check"
fi

UNCAPTURED_RID="$(sed -n '6p' "$DOWN_RIDS_FILE")"
UNCAPTURED_ENTRY="$(journal_entry_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$UNCAPTURED_RID")"
uncaptured_drawer_content="$(node -e "
  const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  const hit = Object.values(d).find((v) => v.source_file === process.argv[2]);
  process.stdout.write(hit ? hit.content : '');
" "$FAKE_DRAWERS" "$UNCAPTURED_ENTRY")"
entry_bytes="$(cat "$UNCAPTURED_ENTRY")"
if [ "$uncaptured_drawer_content" = "$entry_bytes" ]; then
  ok "the uncaptured drawer's content is byte-identical to its journal entry"
else
  bad "the uncaptured drawer's content differs from its journal entry"
fi
if node -e "const c=JSON.parse(process.argv[1]); if ('rawStatus' in c || 'rawRef' in c) process.exit(1);" "$uncaptured_drawer_content"; then
  ok "the uncaptured drawer carries neither rawStatus nor rawRef"
else
  bad "the uncaptured drawer unexpectedly carries rawStatus or rawRef"
fi

source_files_seen="$(node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log(Object.values(d).every((v) => require('path').isAbsolute(v.source_file)) ? 'ALL_ABSOLUTE' : 'NOT_ALL_ABSOLUTE');
" "$FAKE_DRAWERS")"
if [ "$source_files_seen" = "ALL_ABSOLUTE" ]; then
  ok "every drawer's source_file is an absolute journal entry path"
else
  bad "at least one drawer's source_file is not an absolute path"
fi

# A second catch-up adds zero new calls (idempotent, nothing pending).
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
add_drawer_calls_after_second="$(log_count mempalace_add_drawer)"
if [ "$add_drawer_calls_after_second" -eq 6 ]; then
  ok "a second catch-up with nothing pending adds zero new add_drawer calls"
else
  bad "a second catch-up added calls it should not have ($add_drawer_calls_after_second total, expected 6)"
fi

# --- (c) reconcile N-not-2N: the sidecar is what carries the guarantee ------
echo
echo "=== (c) --reconcile after losing mirror/: N drawers, not 2N ==="
DRAWER_IDS_BEFORE_RECONCILE="$(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))).sort().join(','))" "$FAKE_DRAWERS")"

rm -rf "$USAGE_ROOT/mirror"
bash "$REPO_DIR/scripts/usage-mirror.sh" --reconcile >/dev/null

calls_after_reconcile1="$(log_count mempalace_add_drawer)"
if [ "$calls_after_reconcile1" -eq 12 ]; then
  ok "the first --reconcile issues exactly 6 MORE add_drawer calls (12 total, not 18)"
else
  bad "expected 12 total add_drawer calls after the first reconcile, found $calls_after_reconcile1"
fi
if [ "$(drawer_count)" -eq 6 ]; then
  ok "the fake still holds exactly 6 drawers, not 12 (N, not 2N)"
else
  bad "the fake holds $(drawer_count) drawers after the first reconcile, expected 6"
fi
DRAWER_IDS_AFTER_RECONCILE="$(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))).sort().join(','))" "$FAKE_DRAWERS")"
if [ "$DRAWER_IDS_BEFORE_RECONCILE" = "$DRAWER_IDS_AFTER_RECONCILE" ]; then
  ok "every drawer id is unchanged after the reconcile"
else
  bad "drawer ids changed after the reconcile" "before: $DRAWER_IDS_BEFORE_RECONCILE
after:  $DRAWER_IDS_AFTER_RECONCILE"
fi
# The new calls this reconcile made must all be already_exists (a fresh line
# per new call; the log is append-only, so the LAST 6 lines are this pass's).
last6_already_exists="$(tail -n 6 "$FAKE_LOG" | grep -cF '"already_exists":true' || true)"
if [ "$last6_already_exists" -eq 6 ]; then
  ok "the reconcile's 6 new calls are all already_exists"
else
  bad "expected the reconcile's 6 new calls to all be already_exists, found $last6_already_exists/6"
fi
all_mirrored_after_reconcile1=1
while IFS= read -r rid; do
  [ -f "$(mirrored_marker_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")" ] || all_mirrored_after_reconcile1=0
done < "$DOWN_RIDS_FILE"
if [ "$all_mirrored_after_reconcile1" -eq 1 ]; then
  ok "all 6 markers are back in mirrored/ after the reconcile"
else
  bad "at least one marker is not back in mirrored/ after the reconcile"
fi

# The converse: lose mirror/ AND the sidecars, and change the wing — now the
# count DOES change, pinning that the sidecar (not luck) carries the
# guarantee.
rm -rf "$USAGE_ROOT/mirror"
while IFS= read -r rid; do
  rm -f "$(wing_sidecar_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
done < "$DOWN_RIDS_FILE"

CREWRIG_USAGE_WING="usage-storage-mirror-suite-CHANGED" bash "$REPO_DIR/scripts/usage-mirror.sh" --reconcile >/dev/null

calls_after_reconcile2="$(log_count mempalace_add_drawer)"
if [ "$calls_after_reconcile2" -eq 18 ]; then
  ok "the second reconcile (sidecars gone, wing changed) issues 6 MORE calls (18 total)"
else
  bad "expected 18 total add_drawer calls after the second reconcile, found $calls_after_reconcile2"
fi
if [ "$(drawer_count)" -eq 12 ]; then
  ok "the drawer count DOES grow (12, not still 6) once the sidecar is gone and the wing changes"
else
  bad "the drawer count is $(drawer_count) after the second reconcile, expected 12 — the sidecar's guarantee did not get exercised as intended"
fi

# --- (d) prune with drawers: N delete_by_source calls; refuses when the ----
#     daemon is unreachable and mirrored/ markers exist, leaving everything
#     in place.
echo
echo "=== (d) prune: N delete_by_source calls; refuses with the daemon down ==="

stop_fake
DOWN_PRUNE_ERR="$HELPERS_DIR/down-prune.err"
if bash "$REPO_DIR/scripts/usage-prune.sh" "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" >/dev/null 2>"$DOWN_PRUNE_ERR"; then
  bad "pruning a period with mirrored drawers should have refused while the daemon is down"
else
  ok "pruning a period with mirrored drawers refuses while the daemon is down"
fi
if grep -qF 'daemon is unreachable' "$DOWN_PRUNE_ERR"; then
  ok "the daemon-down refusal says the daemon is unreachable"
else
  bad "the daemon-down refusal does not say 'daemon is unreachable'" "$(cat "$DOWN_PRUNE_ERR")"
fi

still_all_present=1
while IFS= read -r rid; do
  entry="$(journal_entry_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  [ -f "$entry" ] || still_all_present=0
done < "$DOWN_RIDS_FILE"
if [ "$still_all_present" -eq 1 ]; then
  ok "every entry survives the refused (daemon-down) prune attempt"
else
  bad "at least one entry was removed despite the refused prune"
fi
if [ "$(drawer_count)" -eq 12 ]; then
  ok "the fake's drawer count is untouched by the refused prune"
else
  bad "the fake's drawer count changed despite the prune having refused"
fi

start_fake
delete_calls_before_d="$(log_count mempalace_delete_by_source)"

if bash "$REPO_DIR/scripts/usage-prune.sh" "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" >/dev/null 2>&1; then
  ok "pruning succeeds once the daemon is reachable again"
else
  bad "pruning still failed after the daemon came back up"
fi

delete_calls_after_d="$(log_count mempalace_delete_by_source)"
delete_calls_this_prune=$((delete_calls_after_d - delete_calls_before_d))
if [ "$delete_calls_this_prune" -eq 6 ]; then
  ok "exactly 6 delete_by_source calls were made, one per record"
else
  bad "expected 6 delete_by_source calls, got $delete_calls_this_prune"
fi

all_removed_locally=1
while IFS= read -r rid; do
  entry="$(journal_entry_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  sidecar="$(wing_sidecar_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  mirrored="$(mirrored_marker_path "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" "$rid")"
  [ -f "$entry" ] && all_removed_locally=0
  [ -f "$sidecar" ] && all_removed_locally=0
  [ -f "$mirrored" ] && all_removed_locally=0
done < "$DOWN_RIDS_FILE"
if [ "$all_removed_locally" -eq 1 ]; then
  ok "every entry, sidecar and mirrored marker is removed locally"
else
  bad "at least one entry/sidecar/marker survived the successful prune"
fi

if [ "$(drawer_count)" -eq 0 ]; then
  ok "the fake holds zero drawers (both wings' drawers removed via source_file matching)"
else
  bad "the fake still holds $(drawer_count) drawers after the prune, expected 0"
fi

# --- (e) an interrupted prune, re-run, completes idempotently --------------
echo
echo "=== (e) interrupted prune resumes and completes idempotently ==="
INTERRUPT_CLI=gemini-cli
INTERRUPT_INSTANT="2021-07-01T00:00:00.000Z"
INTERRUPT_PERIOD="2021-07"
INTERRUPT_RIDS_FILE="$HELPERS_DIR/interrupt-rids.txt"
: > "$INTERRUPT_RIDS_FILE"

i=1
while [ "$i" -le 3 ]; do
  f="$HELPERS_DIR/interrupt-$i.json"
  MR_CLI="$INTERRUPT_CLI" MR_SESSION="interrupt-session-$i" MR_IDEMKEY="interrupt-key-$i" \
    MR_REQUEST_INSTANT="$INTERRUPT_INSTANT" run_driver make-record > "$f"
  rid="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$f")"
  echo "$rid" >> "$INTERRUPT_RIDS_FILE"
  run_driver write "$f" >/dev/null
  i=$((i + 1))
done
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null

setup_ok=1
while IFS= read -r rid; do
  [ -f "$(mirrored_marker_path "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" "$rid")" ] || setup_ok=0
done < "$INTERRUPT_RIDS_FILE"
if [ "$setup_ok" -eq 1 ]; then
  ok "setup: all 3 records are mirrored before the interrupted prune"
else
  bad "setup: expected all 3 records mirrored before testing the interrupted prune"
fi

fake_control '{"failDeleteAfter":1}'
if bash "$REPO_DIR/scripts/usage-prune.sh" "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" >/dev/null 2>&1; then
  bad "the prune should have been interrupted by the injected failure"
else
  ok "the prune is interrupted by the injected failure (non-zero exit)"
fi

removed_count=0
remaining_count=0
while IFS= read -r rid; do
  if [ -f "$(journal_entry_path "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" "$rid")" ]; then
    remaining_count=$((remaining_count + 1))
  else
    removed_count=$((removed_count + 1))
  fi
done < "$INTERRUPT_RIDS_FILE"
if [ "$removed_count" -eq 1 ] && [ "$remaining_count" -eq 2 ]; then
  ok "exactly 1 record was removed before the interruption, 2 remain"
else
  bad "expected 1 removed / 2 remaining after the interruption, found $removed_count removed / $remaining_count remaining"
fi

fake_control '{"failDeleteAfter":null}'
if bash "$REPO_DIR/scripts/usage-prune.sh" "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" >/dev/null 2>&1; then
  ok "the re-run completes successfully once the injected failure is cleared"
else
  bad "the re-run still failed after clearing the injected failure"
fi

all_gone=1
while IFS= read -r rid; do
  [ -f "$(journal_entry_path "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" "$rid")" ] && all_gone=0
  [ -f "$(wing_sidecar_path "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" "$rid")" ] && all_gone=0
  [ -f "$(mirrored_marker_path "$INTERRUPT_CLI" "$INTERRUPT_PERIOD" "$rid")" ] && all_gone=0
done < "$INTERRUPT_RIDS_FILE"
if [ "$all_gone" -eq 1 ]; then
  ok "the re-run completes idempotently: all 3 records are now fully removed"
else
  bad "at least one entry/sidecar/marker survived the completed re-run"
fi

# --- (f) mempalace_search is never called -----------------------------------
echo
echo "=== (f) mempalace_search is never called (v2-F2 retired the only caller) ==="
search_calls="$(log_count mempalace_search)"
if [ "$search_calls" -eq 0 ]; then
  ok "zero mempalace_search calls appear in the fake's log across the whole suite so far"
else
  bad "mempalace_search was called $search_calls time(s) — v2-F2 removed its only caller"
fi

# --- (g) delete_by_source tool-level failures keep the record (#1211) ------
#     MemPalace answers, but does not confirm the deletion: every shape must
#     refuse the prune with the "did not confirm" wording (never the
#     "unreachable" one), after exactly one delete call, keeping the mirrored
#     marker, the entry, the wing sidecar and the drawer. The period is in the
#     past because prune() refuses the current and later periods without
#     --force.
echo
echo "=== (g) delete_by_source tool-level failures: prune refuses, record kept ==="
TOOLFAIL_DEL_CLI=gemini-cli
TOOLFAIL_DEL_PERIOD="2019-03"
TOOLFAIL_DEL_RID="$(write_quiet_record "$HELPERS_DIR/toolfail-del.json" "$TOOLFAIL_DEL_CLI" \
  "toolfail-del-session" "toolfail-del-key" "2019-03-01T00:00:00.000Z")"
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null

TOOLFAIL_DEL_ENTRY="$(journal_entry_path "$TOOLFAIL_DEL_CLI" "$TOOLFAIL_DEL_PERIOD" "$TOOLFAIL_DEL_RID")"
TOOLFAIL_DEL_SIDECAR="$(wing_sidecar_path "$TOOLFAIL_DEL_CLI" "$TOOLFAIL_DEL_PERIOD" "$TOOLFAIL_DEL_RID")"
TOOLFAIL_DEL_MIRRORED="$(mirrored_marker_path "$TOOLFAIL_DEL_CLI" "$TOOLFAIL_DEL_PERIOD" "$TOOLFAIL_DEL_RID")"
if [ -f "$TOOLFAIL_DEL_MIRRORED" ] && [ "$(drawers_for_source "$TOOLFAIL_DEL_ENTRY")" -eq 1 ]; then
  ok "setup: the (g) record is mirrored and its drawer exists"
else
  bad "setup: expected the (g) record mirrored with exactly one drawer before injecting delete failures"
fi

TOOLFAIL_DEL_ERR="$HELPERS_DIR/toolfail-del.err"
for shape in success-false dry-run no-success-key is-error not-json-text no-text-content no-result; do
  fake_tool_failure mempalace_delete_by_source "$shape"
  deletes_before="$(log_count mempalace_delete_by_source)"
  if bash "$REPO_DIR/scripts/usage-prune.sh" "$TOOLFAIL_DEL_CLI" "$TOOLFAIL_DEL_PERIOD" >/dev/null 2>"$TOOLFAIL_DEL_ERR"; then
    bad "[$shape] the prune exited 0 although MemPalace did not confirm the deletion"
  else
    ok "[$shape] the prune exits non-zero"
  fi
  deletes_delta=$(($(log_count mempalace_delete_by_source) - deletes_before))
  if [ "$deletes_delta" -eq 1 ]; then
    ok "[$shape] exactly one delete_by_source call was made"
  else
    bad "[$shape] expected exactly one delete_by_source call, got $deletes_delta"
  fi
  if grep -qF 'did not confirm' "$TOOLFAIL_DEL_ERR" && ! grep -qF 'unreachable' "$TOOLFAIL_DEL_ERR"; then
    ok "[$shape] the FATAL line says MemPalace did not confirm, and never 'unreachable'"
  else
    bad "[$shape] the FATAL line is not the 'did not confirm' refusal" "$(cat "$TOOLFAIL_DEL_ERR")"
  fi
  if [ -f "$TOOLFAIL_DEL_MIRRORED" ] && [ -f "$TOOLFAIL_DEL_ENTRY" ] && [ -f "$TOOLFAIL_DEL_SIDECAR" ]; then
    ok "[$shape] the mirrored marker, the entry and the wing sidecar are kept"
  else
    bad "[$shape] the refused prune removed the mirrored marker, the entry or the wing sidecar"
  fi
  if [ "$(drawers_for_source "$TOOLFAIL_DEL_ENTRY")" -eq 1 ]; then
    ok "[$shape] the drawer is still in the fake"
  else
    bad "[$shape] the drawer for the record is gone although the prune refused"
  fi
done

fake_tool_failure mempalace_delete_by_source null
if bash "$REPO_DIR/scripts/usage-prune.sh" "$TOOLFAIL_DEL_CLI" "$TOOLFAIL_DEL_PERIOD" >/dev/null 2>&1; then
  ok "recovery: the prune succeeds once MemPalace confirms the deletion"
else
  bad "recovery: the prune still failed after clearing the injected delete failure"
fi
if [ ! -f "$TOOLFAIL_DEL_ENTRY" ] && [ ! -f "$TOOLFAIL_DEL_SIDECAR" ] && [ ! -f "$TOOLFAIL_DEL_MIRRORED" ]; then
  ok "recovery: the entry, the wing sidecar and the mirrored marker are removed"
else
  bad "recovery: the entry, the wing sidecar or the mirrored marker survived the successful prune"
fi
if [ "$(drawers_for_source "$TOOLFAIL_DEL_ENTRY")" -eq 0 ]; then
  ok "recovery: zero drawers remain for the record's source_file"
else
  bad "recovery: $(drawers_for_source "$TOOLFAIL_DEL_ENTRY") drawer(s) remain for the record's source_file"
fi

# --- (h) add_drawer failures: the pass continues or stops (#1211, v1-F1) ---
#     success: false is one record's failure — log it, try the next record.
#     Anything else MemPalace answers without success: true means the tool
#     cannot serve any call — stop after that ONE call, without the
#     unreachable stamp (the daemon did answer). The call counts are the
#     contract: 2 versus 1.
echo
echo "=== (h) add_drawer failures: per-record continues, palace-wide stops ==="
TOOLFAIL_ADD_CLI=copilot-cli
TOOLFAIL_ADD_PERIOD="2019-04"
TOOLFAIL_ADD_STAMP="$USAGE_ROOT/mirror/unreachable.stamp"
rm -f "$TOOLFAIL_ADD_STAMP"

TOOLFAIL_ADD_RID_1="$(write_quiet_record "$HELPERS_DIR/toolfail-add-1.json" "$TOOLFAIL_ADD_CLI" \
  "toolfail-add-session-1" "toolfail-add-key-1" "2019-04-01T00:00:00.000Z")"
TOOLFAIL_ADD_RID_2="$(write_quiet_record "$HELPERS_DIR/toolfail-add-2.json" "$TOOLFAIL_ADD_CLI" \
  "toolfail-add-session-2" "toolfail-add-key-2" "2019-04-01T00:00:00.000Z")"
TOOLFAIL_ADD_ENTRY_1="$(journal_entry_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_1")"
TOOLFAIL_ADD_ENTRY_2="$(journal_entry_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_2")"

toolfail_add_both_pending() {
  [ -f "$(pending_marker_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_1")" ] &&
    [ -f "$(pending_marker_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_2")" ] &&
    [ ! -f "$(mirrored_marker_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_1")" ] &&
    [ ! -f "$(mirrored_marker_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_2")" ]
}

if toolfail_add_both_pending && [ "$(pending_count)" -eq 2 ]; then
  ok "setup: pending/ holds exactly the two (h) markers"
else
  bad "setup: expected pending/ to hold exactly the two (h) markers, found $(pending_count)"
fi

TOOLFAIL_ADD_ERR="$HELPERS_DIR/toolfail-add.err"
# shape:expected add_drawer calls for the pass
for spec in success-false:2 no-success-key:1 not-json-text:1; do
  shape="${spec%%:*}"
  expected_calls="${spec##*:}"
  fake_tool_failure mempalace_add_drawer "$shape"
  adds_before="$(log_count mempalace_add_drawer)"
  if bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>"$TOOLFAIL_ADD_ERR"; then
    ok "[$shape] usage-mirror.sh exits 0"
  else
    bad "[$shape] usage-mirror.sh exited non-zero" "$(cat "$TOOLFAIL_ADD_ERR")"
  fi
  adds_delta=$(($(log_count mempalace_add_drawer) - adds_before))
  if [ "$adds_delta" -eq "$expected_calls" ]; then
    ok "[$shape] the pass made exactly $expected_calls add_drawer call(s)"
  else
    bad "[$shape] expected $expected_calls add_drawer call(s) in the pass, got $adds_delta"
  fi
  if toolfail_add_both_pending; then
    ok "[$shape] both markers stay in pending/"
  else
    bad "[$shape] a marker left pending/ although MemPalace did not report success"
  fi
  if [ "$shape" = "success-false" ]; then
    failed_lines="$(grep -cF 'failed:' "$TOOLFAIL_ADD_ERR" || true)"
    if [ "$failed_lines" -eq 2 ]; then
      ok "[$shape] stderr holds one 'failed:' line per record (2)"
    else
      bad "[$shape] expected 2 'failed:' lines on stderr, got $failed_lines" "$(cat "$TOOLFAIL_ADD_ERR")"
    fi
  else
    if grep -qF 'stopping this pass' "$TOOLFAIL_ADD_ERR"; then
      ok "[$shape] stderr says the pass is stopping"
    else
      bad "[$shape] stderr does not say 'stopping this pass'" "$(cat "$TOOLFAIL_ADD_ERR")"
    fi
  fi
  if [ ! -f "$TOOLFAIL_ADD_STAMP" ]; then
    ok "[$shape] no unreachable.stamp is written (the daemon answered)"
  else
    bad "[$shape] unreachable.stamp was written although the daemon answered"
    rm -f "$TOOLFAIL_ADD_STAMP"
  fi
  if [ "$(drawers_for_source "$TOOLFAIL_ADD_ENTRY_1")" -eq 0 ] && [ "$(drawers_for_source "$TOOLFAIL_ADD_ENTRY_2")" -eq 0 ]; then
    ok "[$shape] no drawer exists for either record"
  else
    bad "[$shape] a drawer exists for an (h) record although add_drawer failed"
  fi
done

fake_tool_failure mempalace_add_drawer null
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
if [ -f "$(mirrored_marker_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_1")" ] &&
  [ -f "$(mirrored_marker_path "$TOOLFAIL_ADD_CLI" "$TOOLFAIL_ADD_PERIOD" "$TOOLFAIL_ADD_RID_2")" ]; then
  ok "recovery: both markers move to mirrored/ once add_drawer succeeds"
else
  bad "recovery: at least one (h) marker did not reach mirrored/"
fi
if [ "$(drawers_for_source "$TOOLFAIL_ADD_ENTRY_1")" -eq 1 ] && [ "$(drawers_for_source "$TOOLFAIL_ADD_ENTRY_2")" -eq 1 ]; then
  ok "recovery: exactly one drawer per (h) record"
else
  bad "recovery: expected exactly one drawer per (h) record"
fi
if [ "$(pending_count)" -eq 0 ]; then
  ok "recovery: pending/ is empty (the rename mutation's drawer delta relies on it)"
else
  bad "recovery: pending/ still holds $(pending_count) marker(s)"
fi

# --- (i) JSON-RPC error-code classification (#1240) -------------------------
#     mcp.js's call() classifies a raw JSON-RPC `error` answer through a
#     CLOSED allow-list: -32000 and -32602 stay `tool-error` (a per-call
#     failure — log and move on); every other code, including the palace's
#     own preflight-refusal codes -32001/-32002/-32003 and a code this suite
#     has never seen before (-32099), is `tool-unavailable` (the daemon
#     answered, but the tool cannot serve ANY call right now). Driven
#     directly through mcp.addDrawer() (the driver's call-add-drawer
#     command), bypassing mirror.js entirely — this is a classification
#     unit, not a catch-up scenario, and asserting it this way keeps it
#     independent of anything mirror.js does with the `kind` afterward.
echo
echo "=== (i) JSON-RPC error-code classification (#1240) ==="

assert_jsonrpc_kind() {
  # $1 = JSON-RPC error code, $2 = expected mcp.js `kind`
  local code="$1" expected="$2" out kind
  fake_jsonrpc_error mempalace_add_drawer "$code"
  out="$(MR_SOURCE_FILE="$HELPERS_DIR/jsonrpc-probe-${code}.json" run_driver call-add-drawer)"
  kind="$(printf '%s\n' "$out" | sed -n 's/^KIND=//p')"
  if [ "$kind" = "$expected" ]; then
    ok "[$code] classified as $expected"
  else
    bad "[$code] expected kind '$expected', got '$kind'" "$out"
  fi
}

for code in -32000 -32602; do
  assert_jsonrpc_kind "$code" "tool-error"
done
for code in -32001 -32002 -32003 -32099; do
  assert_jsonrpc_kind "$code" "tool-unavailable"
done

fake_tool_failure mempalace_add_drawer null

# --- (j) breaker + ordering fix, end-to-end through mirror.js (#1240) -------
#     A backlog of 3 chronically-poisoned ("poisoned") records and 2 healthy
#     ones, laid out in this INITIAL pending order (oldest first): the 3
#     poisoned markers, THEN the 2 healthy ones — explicit mtimes below,
#     never real wall-clock creation order (this suite creates all 5 within
#     the same fraction of a second). CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER
#     is pinned to 3 for this case: a small, explicit override for a fast and
#     fully deterministic test (the shipped default is 5 — this suite never
#     exercises that literal default value; case (i) tests classification,
#     not the breaker, and this case only needs SOME cap that evenly divides
#     the poisoned group's size).
#
#     ASSUMPTION this case depends on (double-check once mirror.js's real
#     diff lands): a breaker trip stops the WHOLE catchUp()/drainPending()
#     run for that invocation — not just the current internal walkPending()
#     — deferring the rest of the backlog to the NEXT catch-up pass. If
#     instead drainPending() keeps looping internally after a trip (only
#     stopping on "no progress", as it already does today for unrelated
#     reasons), a single `usage-mirror.sh` invocation would chain multiple
#     internal walkPending() calls together and the call counts below
#     (3 / 5 / 3) would need to become (3 / 8 / 3) with pass 2 and pass 3
#     collapsed into one invocation — see this case's own header note in the
#     handback report.
#
#     Given that, three successive `usage-mirror.sh` invocations play out
#     exactly as follows (poisoned records are interchangeable with each
#     other, and healthy records are interchangeable with each other, so
#     this shape does not depend on which specific record lands in which
#     position within its own group):
#       pass 1 (3 calls): the 3 poisoned markers, oldest — 3 consecutive
#         tool-error answers trips the breaker on the 3rd call, before the 2
#         healthy markers are ever reached. Each poisoned marker's mtime is
#         bumped (touchPendingMarkerMtime()), sorting all 3 behind
#         everything else for the next listMarkers().
#       pass 2 (5 calls): the 2 healthy markers (now the oldest) succeed and
#         move to mirrored/, THEN the 3 poisoned markers (freshly
#         re-sorted-last) are hit again — 3 more consecutive tool-error
#         answers trips the breaker again, on this pass's 5th call overall.
#         This IS the starvation fix: the healthy backlog is delayed until
#         the next catch-up pass runs — a subsequent write's spawn or an
#         explicit operator run (see Risks: nothing in this repository
#         re-triggers the mirror on a schedule), never permanently stuck
#         behind the SAME poisoned records the way D1h's literal
#         breaker-without-ordering proposal would have caused.
#       pass 3 (3 calls): only the 3 poisoned markers remain pending; the
#         breaker trips again on the 3rd call, same shape as pass 1 — the
#         backlog's new steady state.
#     A final pass reconfirms that steady state: the 2 healthy records stay
#     mirrored, the 3 poisoned ones stay pending, forever — never lost,
#     never silently retried without bound.
echo
echo "=== (j) breaker + ordering fix, end-to-end through mirror.js (#1240) ======"
JBREAKER_CLI=claude-code
JBREAKER_PERIOD="2018-08"
JBREAKER_BASE_MS=100000000000         # far in the past — the 3 poisoned markers
JBREAKER_HEALTHY_BASE_MS=100001000000 # later than the poisoned base, still far in the past — the 2 healthy markers

JBREAKER_POISON_RIDS_FILE="$HELPERS_DIR/jbreaker-poison-rids.txt"
JBREAKER_HEALTHY_RIDS_FILE="$HELPERS_DIR/jbreaker-healthy-rids.txt"
: > "$JBREAKER_POISON_RIDS_FILE"
: > "$JBREAKER_HEALTHY_RIDS_FILE"

i=1
while [ "$i" -le 3 ]; do
  f="$HELPERS_DIR/jbreaker-poison-$i.json"
  rid="$(write_quiet_record "$f" "$JBREAKER_CLI" "jbreaker-poison-session-$i" "jbreaker-poison-key-$i" "2018-08-01T00:00:00.000Z")"
  echo "$rid" >>"$JBREAKER_POISON_RIDS_FILE"
  set_marker_mtime "$(pending_marker_path "$JBREAKER_CLI" "$JBREAKER_PERIOD" "$rid")" "$((JBREAKER_BASE_MS + i))"
  i=$((i + 1))
done

i=1
while [ "$i" -le 2 ]; do
  f="$HELPERS_DIR/jbreaker-healthy-$i.json"
  rid="$(write_quiet_record "$f" "$JBREAKER_CLI" "jbreaker-healthy-session-$i" "jbreaker-healthy-key-$i" "2018-08-01T00:00:00.000Z")"
  echo "$rid" >>"$JBREAKER_HEALTHY_RIDS_FILE"
  set_marker_mtime "$(pending_marker_path "$JBREAKER_CLI" "$JBREAKER_PERIOD" "$rid")" "$((JBREAKER_HEALTHY_BASE_MS + i))"
  i=$((i + 1))
done

JBREAKER_POISON_IDS="$(tr '\n' ' ' <"$JBREAKER_POISON_RIDS_FILE")"
# shellcheck disable=SC2086  # word-splitting the space-separated record ids is intentional here
fake_tool_failure_for_sources mempalace_add_drawer success-false $JBREAKER_POISON_IDS

jbreaker_all_healthy_mirrored() {
  local rid all=1
  while IFS= read -r rid; do
    [ -f "$(mirrored_marker_path "$JBREAKER_CLI" "$JBREAKER_PERIOD" "$rid")" ] || all=0
  done <"$JBREAKER_HEALTHY_RIDS_FILE"
  echo "$all"
}

jbreaker_all_poisoned_pending() {
  local rid all=1
  while IFS= read -r rid; do
    [ -f "$(pending_marker_path "$JBREAKER_CLI" "$JBREAKER_PERIOD" "$rid")" ] || all=0
    [ -f "$(mirrored_marker_path "$JBREAKER_CLI" "$JBREAKER_PERIOD" "$rid")" ] && all=0
  done <"$JBREAKER_POISON_RIDS_FILE"
  echo "$all"
}

JBREAKER_ERR="$HELPERS_DIR/jbreaker.err"

before="$(log_count mempalace_add_drawer)"
CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=3 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>"$JBREAKER_ERR"
pass1_calls=$(($(log_count mempalace_add_drawer) - before))
if [ "$pass1_calls" -eq 3 ]; then
  ok "pass 1: exactly 3 add_drawer calls (the 3 poisoned markers, breaker trips on the 3rd)"
else
  bad "pass 1: expected exactly 3 add_drawer calls, got $pass1_calls"
fi
if grep -qF 'breaker tripped' "$JBREAKER_ERR"; then
  ok "pass 1: stderr says the breaker tripped"
else
  bad "pass 1: stderr does not say the breaker tripped" "$(cat "$JBREAKER_ERR")"
fi
if [ "$(jbreaker_all_healthy_mirrored)" -eq 0 ] && [ "$(jbreaker_all_poisoned_pending)" -eq 1 ]; then
  ok "pass 1: the 2 healthy markers are not reached yet — still pending behind the poisoned head"
else
  bad "pass 1: expected the 2 healthy markers still pending and the 3 poisoned markers still pending"
fi

before="$(log_count mempalace_add_drawer)"
CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=3 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>"$JBREAKER_ERR"
pass2_calls=$(($(log_count mempalace_add_drawer) - before))
if [ "$pass2_calls" -eq 5 ]; then
  ok "pass 2: exactly 5 add_drawer calls (2 healthy now sorted first, then the 3 poisoned again)"
else
  bad "pass 2: expected exactly 5 add_drawer calls, got $pass2_calls"
fi
if [ "$(jbreaker_all_healthy_mirrored)" -eq 1 ]; then
  ok "pass 2: THE FIX — the 2 healthy markers are mirrored, no longer starved behind the poisoned records"
else
  bad "pass 2: expected the 2 healthy markers mirrored once the reordering took effect"
fi
if [ "$(jbreaker_all_poisoned_pending)" -eq 1 ]; then
  ok "pass 2: the 3 poisoned markers are still pending (never lost, never silently dropped)"
else
  bad "pass 2: expected the 3 poisoned markers still pending"
fi

before="$(log_count mempalace_add_drawer)"
CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=3 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>"$JBREAKER_ERR"
pass3_calls=$(($(log_count mempalace_add_drawer) - before))
if [ "$pass3_calls" -eq 3 ]; then
  ok "pass 3: exactly 3 add_drawer calls (only the 3 poisoned markers remain — the new steady state)"
else
  bad "pass 3: expected exactly 3 add_drawer calls, got $pass3_calls"
fi

before="$(log_count mempalace_add_drawer)"
CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=3 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>"$JBREAKER_ERR"
pass4_calls=$(($(log_count mempalace_add_drawer) - before))
if [ "$pass4_calls" -eq 3 ] && [ "$(jbreaker_all_healthy_mirrored)" -eq 1 ] && [ "$(jbreaker_all_poisoned_pending)" -eq 1 ]; then
  ok "recovery: a final pass confirms the steady state — healthy fully mirrored, poisoned still pending, the breaker still bounding every pass"
else
  bad "recovery: expected the steady state (3 calls, healthy mirrored, poisoned pending) to hold on a final pass"
fi

fake_clear_source_tool_failure

# --- Mutation discipline: this suite's share of the brief's named mutations -
# Each edits a tracked module IN PLACE, proves the property goes red against
# the fake daemon, then restores with `git checkout --` before continuing.
MIRROR_JS="$REPO_DIR/scripts/lib/usage-store/mirror.js"
PRUNE_JS="$REPO_DIR/scripts/lib/usage-store/prune.js"

echo
echo "=== MUTATION: --reconcile re-deriving the wing instead of reading the sidecar ==="
MUTANT_RECONCILE_CLI=claude-code
MUTANT_RECONCILE_PERIOD="2020-02"
MUTANT_RECONCILE_FILE="$HELPERS_DIR/mutant-reconcile.json"
MR_CLI="$MUTANT_RECONCILE_CLI" MR_SESSION="mutant-reconcile-session" MR_IDEMKEY="mutant-reconcile-key" \
  MR_REQUEST_INSTANT="2020-02-01T00:00:00.000Z" CREWRIG_USAGE_MIRROR=0 run_driver make-record > "$MUTANT_RECONCILE_FILE"
MUTANT_RECONCILE_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$MUTANT_RECONCILE_FILE")"
CREWRIG_USAGE_MIRROR=0 run_driver write "$MUTANT_RECONCILE_FILE" >/dev/null

MUTANT_RECONCILE_SIDECAR="$(wing_sidecar_path "$MUTANT_RECONCILE_CLI" "$MUTANT_RECONCILE_PERIOD" "$MUTANT_RECONCILE_RID")"
node -e "
const fs = require('fs');
const p = process.argv[1];
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
s.wing = 'sidecar-original-wing';
s.wingDerivation = 'test-fixture';
fs.writeFileSync(p, JSON.stringify(s));
" "$MUTANT_RECONCILE_SIDECAR"

MUTATOR_1="$HELPERS_DIR/mutator-reconcile.js"
cat > "$MUTATOR_1" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = "if (parsed && typeof parsed.wing === 'string' && typeof parsed.wingDerivation === 'string') {\n    return { wing: parsed.wing, wingDerivation: parsed.wingDerivation };\n  }";
if (!src.includes(marker)) {
  console.error('FATAL: sidecar-read fast-path marker not found in mirror.js');
  process.exit(1);
}
src = src.split(marker).join('if (false) {\n    return { wing: parsed.wing, wingDerivation: parsed.wingDerivation };\n  }');
fs.writeFileSync(path, src);
MUTATOR_EOF
node "$MUTATOR_1" "$MIRROR_JS"

bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mirror.js

mutant_reconcile_wing="$(node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const hit = Object.values(d).find((v) => v.source_file === process.argv[2]);
process.stdout.write(hit ? hit.wing : 'NOT_FOUND');
" "$FAKE_DRAWERS" "$(journal_entry_path "$MUTANT_RECONCILE_CLI" "$MUTANT_RECONCILE_PERIOD" "$MUTANT_RECONCILE_RID")")"
if [ "$mutant_reconcile_wing" = "usage-storage-mirror-suite" ]; then
  ok "MUTATION RED: with the sidecar-read fast path disabled, the wing is re-derived (env-override), not read from the sidecar (sidecar-original-wing)"
else
  bad "MUTATION not red: expected the re-derived wing, got '$mutant_reconcile_wing'"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mirror.js; then
  ok "mirror.js is restored to its committed content after the reconcile mutation"
else
  bad "mirror.js was NOT fully restored after the reconcile mutation"
fi

echo
echo "=== MUTATION: dropping the rename() from the pending->mirrored transition ==="
MUTANT_RENAME_CLI=copilot-cli
MUTANT_RENAME_PERIOD="2020-03"
MUTANT_RENAME_FILE="$HELPERS_DIR/mutant-rename.json"
MR_CLI="$MUTANT_RENAME_CLI" MR_SESSION="mutant-rename-session" MR_IDEMKEY="mutant-rename-key" \
  MR_REQUEST_INSTANT="2020-03-01T00:00:00.000Z" CREWRIG_USAGE_MIRROR=0 run_driver make-record > "$MUTANT_RENAME_FILE"
MUTANT_RENAME_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$MUTANT_RENAME_FILE")"
CREWRIG_USAGE_MIRROR=0 run_driver write "$MUTANT_RENAME_FILE" >/dev/null

drawers_before_rename_mutation="$(drawer_count)"

MUTATOR_2="$HELPERS_DIR/mutator-rename.js"
cat > "$MUTATOR_2" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = 'fs.renameSync(pendingPath, mirroredPath);';
if (!src.includes(marker)) {
  console.error('FATAL: pending->mirrored rename marker not found in mirror.js');
  process.exit(1);
}
src = src.split(marker).join('/* mutation: rename dropped */');
fs.writeFileSync(path, src);
MUTATOR_EOF
node "$MUTATOR_2" "$MIRROR_JS"

bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mirror.js

drawers_after_rename_mutation="$(drawer_count)"
MUTANT_RENAME_PENDING="$(pending_marker_path "$MUTANT_RENAME_CLI" "$MUTANT_RENAME_PERIOD" "$MUTANT_RENAME_RID")"
MUTANT_RENAME_MIRRORED="$(mirrored_marker_path "$MUTANT_RENAME_CLI" "$MUTANT_RENAME_PERIOD" "$MUTANT_RENAME_RID")"

if [ "$drawers_after_rename_mutation" -eq $((drawers_before_rename_mutation + 1)) ]; then
  ok "the add_drawer call still happened (the drawer exists)"
else
  bad "expected exactly one new drawer, went from $drawers_before_rename_mutation to $drawers_after_rename_mutation"
fi
if [ -f "$MUTANT_RENAME_PENDING" ] && [ ! -f "$MUTANT_RENAME_MIRRORED" ]; then
  ok "MUTATION RED: without the rename(), the marker stays in pending/ despite a successful mirror"
else
  bad "MUTATION not red: the marker transitioned to mirrored/ even with the rename() dropped"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mirror.js; then
  ok "mirror.js is restored to its committed content after the rename mutation"
else
  bad "mirror.js was NOT fully restored after the rename mutation"
fi

echo
echo "=== MUTATION: prune skipping mempalace_delete_by_source ==="
MUTANT_PRUNE_CLI=antigravity
MUTANT_PRUNE_PERIOD="2020-04"
MUTANT_PRUNE_FILE="$HELPERS_DIR/mutant-prune.json"
MR_CLI="$MUTANT_PRUNE_CLI" MR_SESSION="mutant-prune-session" MR_IDEMKEY="mutant-prune-key" \
  MR_REQUEST_INSTANT="2020-04-01T00:00:00.000Z" CREWRIG_USAGE_MIRROR=0 run_driver make-record > "$MUTANT_PRUNE_FILE"
MUTANT_PRUNE_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$MUTANT_PRUNE_FILE")"
CREWRIG_USAGE_MIRROR=0 run_driver write "$MUTANT_PRUNE_FILE" >/dev/null
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null

MUTANT_PRUNE_ENTRY="$(journal_entry_path "$MUTANT_PRUNE_CLI" "$MUTANT_PRUNE_PERIOD" "$MUTANT_PRUNE_RID")"
if [ -f "$(mirrored_marker_path "$MUTANT_PRUNE_CLI" "$MUTANT_PRUNE_PERIOD" "$MUTANT_PRUNE_RID")" ]; then
  ok "setup: the prune-mutation record is mirrored before pruning"
else
  bad "setup: expected the prune-mutation record to be mirrored before testing the mutation"
fi
drawers_before_prune_mutation="$(drawer_count)"

MUTATOR_3="$HELPERS_DIR/mutator-prune.js"
cat > "$MUTATOR_3" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = "const result = await mcp.deleteBySource({ source_file: entryPath, dry_run: false });\n    if (!result.ok) {\n      return { ok: false, kind: result.kind, message: result.message };\n    }";
if (!src.includes(marker)) {
  console.error('FATAL: delete_by_source call marker not found in prune.js');
  process.exit(1);
}
src = src.split(marker).join('/* mutation: delete_by_source skipped */');
fs.writeFileSync(path, src);
MUTATOR_EOF
node "$MUTATOR_3" "$PRUNE_JS"

if bash "$REPO_DIR/scripts/usage-prune.sh" "$MUTANT_PRUNE_CLI" "$MUTANT_PRUNE_PERIOD" >/dev/null 2>&1; then
  mutant_prune_rc=0
else
  mutant_prune_rc=1
fi
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/prune.js

drawers_after_prune_mutation="$(drawer_count)"
if [ "$mutant_prune_rc" -eq 0 ] && [ ! -f "$MUTANT_PRUNE_ENTRY" ]; then
  ok "the prune still reports success and removes the local entry"
else
  bad "setup assumption broken: the mutated prune did not behave as a local no-op success"
fi
if [ "$drawers_after_prune_mutation" -eq "$drawers_before_prune_mutation" ]; then
  ok "MUTATION RED: skipping delete_by_source orphans the drawer — the fake's drawer count is unchanged"
else
  bad "MUTATION not red: the drawer was removed even though delete_by_source was skipped"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/prune.js; then
  ok "prune.js is restored to its committed content after the mutation"
else
  bad "prune.js was NOT fully restored after the mutation"
fi

echo
echo "=== MUTATION: explicit catch-up losing a contended-lock race (i1-F2) ==="
MUTANT_LOCKRACE_CLI=claude-code
MUTANT_LOCKRACE_PERIOD="2020-05"
MUTANT_LOCKRACE_RIDS_FILE="$HELPERS_DIR/lockrace-rids.txt"
: > "$MUTANT_LOCKRACE_RIDS_FILE"

i=1
while [ "$i" -le 3 ]; do
  f="$HELPERS_DIR/lockrace-$i.json"
  MR_CLI="$MUTANT_LOCKRACE_CLI" MR_SESSION="lockrace-session-$i" MR_IDEMKEY="lockrace-key-$i" \
    MR_REQUEST_INSTANT="2020-05-01T00:00:00.000Z" CREWRIG_USAGE_MIRROR=0 run_driver make-record > "$f"
  rid="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$f")"
  echo "$rid" >> "$MUTANT_LOCKRACE_RIDS_FILE"
  # CREWRIG_USAGE_MIRROR=0: keep write-time detached spawns out of this
  # scenario entirely — the only catch-up in flight must be the one this
  # case drives itself, or the simulated lock-hold below is meaningless.
  CREWRIG_USAGE_MIRROR=0 run_driver write "$f" >/dev/null
  i=$((i + 1))
done

MIRROR_LOCK="$USAGE_ROOT/locks/mirror.lock"
mkdir -p "$(dirname "$MIRROR_LOCK")"

lockrace_all_mirrored() {
  local rid all=1
  while IFS= read -r rid; do
    [ -f "$(mirrored_marker_path "$MUTANT_LOCKRACE_CLI" "$MUTANT_LOCKRACE_PERIOD" "$rid")" ] || all=0
  done < "$MUTANT_LOCKRACE_RIDS_FILE"
  echo "$all"
}

# --- (i) fixed behavior: hold locks/mirror.lock ourselves (simulating a
#     live peer catch-up), release it after a short, bounded delay, and
#     confirm the explicit foreground catch-up WAITS instead of losing the
#     race — the exact shape of the CI flake this fixes (a live peer holds
#     the lock when the explicit `usage-mirror.sh` in test (e)'s setup
#     runs right after a batch of writes).
: > "$MIRROR_LOCK" # fresh mtime — simulates a live peer holding the lock
( sleep 0.5; rm -f "$MIRROR_LOCK" ) &
releaser_pid="$!"
CREWRIG_USAGE_MIRROR_WAIT_MS=5000 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
wait "$releaser_pid" 2>/dev/null || true

if [ "$(lockrace_all_mirrored)" -eq 1 ]; then
  ok "FIXED: the explicit catch-up waited out a contended lock and mirrored all 3 records"
else
  bad "FIXED: the explicit catch-up should have waited out the contended lock and mirrored all 3 records"
fi

# --- (ii) mutant: revert fix (a) alone — the explicit caller falls back to
#     the same single non-blocking attempt as the write-time detached
#     spawn — and repeat the identical scenario on a freshly-pending copy
#     of the SAME 3 records.
while IFS= read -r rid; do
  rm -f "$(mirrored_marker_path "$MUTANT_LOCKRACE_CLI" "$MUTANT_LOCKRACE_PERIOD" "$rid")"
  pm="$(pending_marker_path "$MUTANT_LOCKRACE_CLI" "$MUTANT_LOCKRACE_PERIOD" "$rid")"
  mkdir -p "$(dirname "$pm")"
  : > "$pm"
done < "$MUTANT_LOCKRACE_RIDS_FILE"

MUTATOR_4="$HELPERS_DIR/mutator-lockrace.js"
cat > "$MUTATOR_4" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = "const acquired = explicit\n    ? await acquireLockWaiting(lockFile, staleMs, envMs('CREWRIG_USAGE_MIRROR_WAIT_MS', staleMs))\n    : tryAcquireLock(lockFile, staleMs);";
if (!src.includes(marker)) {
  console.error('FATAL: explicit-wait lock-acquisition marker not found in mirror.js');
  process.exit(1);
}
src = src.split(marker).join('const acquired = tryAcquireLock(lockFile, staleMs); // mutation: explicit wait dropped');
fs.writeFileSync(path, src);
MUTATOR_EOF
node "$MUTATOR_4" "$MIRROR_JS"

: > "$MIRROR_LOCK" # fresh mtime — simulates a live peer holding the lock again
( sleep 0.5; rm -f "$MIRROR_LOCK" ) &
releaser_pid_2="$!"
CREWRIG_USAGE_MIRROR_WAIT_MS=5000 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
wait "$releaser_pid_2" 2>/dev/null || true
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mirror.js

if [ "$(lockrace_all_mirrored)" -eq 0 ]; then
  ok "MUTATION RED: without fix (a), the explicit catch-up loses the contended-lock race and leaves records unmirrored"
else
  bad "MUTATION not red: the explicit catch-up mirrored everything even with fix (a) reverted"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mirror.js; then
  ok "mirror.js is restored to its committed content after the lock-race mutation"
else
  bad "mirror.js was NOT fully restored after the lock-race mutation"
fi

# Tidy: mirror the 3 records for real so they don't linger pending for the
# rest of the suite. The lock is uncontended by now (both releasers ran).
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null || true

MCP_JS="$REPO_DIR/scripts/lib/usage-store/mcp.js"

echo
echo "=== MUTATION: mcp.js accepting a tool-level failure as acknowledged (#1211) ==="
MUTANT_ACK_CLI=antigravity
MUTANT_ACK_PERIOD="2019-05"
MUTANT_ACK_RID="$(write_quiet_record "$HELPERS_DIR/mutant-ack.json" "$MUTANT_ACK_CLI" \
  "mutant-ack-session" "mutant-ack-key" "2019-05-01T00:00:00.000Z")"
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
MUTANT_ACK_ENTRY="$(journal_entry_path "$MUTANT_ACK_CLI" "$MUTANT_ACK_PERIOD" "$MUTANT_ACK_RID")"
MUTANT_ACK_MIRRORED="$(mirrored_marker_path "$MUTANT_ACK_CLI" "$MUTANT_ACK_PERIOD" "$MUTANT_ACK_RID")"
if [ -f "$MUTANT_ACK_MIRRORED" ] && [ "$(drawers_for_source "$MUTANT_ACK_ENTRY")" -eq 1 ]; then
  ok "setup: the acknowledgment-mutation record is mirrored with one drawer"
else
  bad "setup: expected the acknowledgment-mutation record mirrored with one drawer"
fi

MUTATOR_5="$HELPERS_DIR/mutator-require-success.js"
cat > "$MUTATOR_5" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = "if (payload && typeof payload === 'object' && payload.success === true) return res;";
if (!src.includes(marker)) {
  console.error('FATAL: requireSuccess acknowledgment marker not found in mcp.js');
  process.exit(1);
}
src = src.split(marker).join('return res; // mutation: any answer counts as acknowledged');
fs.writeFileSync(path, src);
MUTATOR_EOF

fake_tool_failure mempalace_delete_by_source success-false
node "$MUTATOR_5" "$MCP_JS"
if bash "$REPO_DIR/scripts/usage-prune.sh" "$MUTANT_ACK_CLI" "$MUTANT_ACK_PERIOD" >/dev/null 2>&1; then
  mutant_ack_rc=0
else
  mutant_ack_rc=1
fi
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mcp.js
fake_tool_failure mempalace_delete_by_source null

if [ "$mutant_ack_rc" -eq 0 ] && [ ! -f "$MUTANT_ACK_MIRRORED" ] && [ "$(drawers_for_source "$MUTANT_ACK_ENTRY")" -eq 1 ]; then
  ok "MUTATION RED: without requireSuccess, a success:false delete is taken as done — the marker is gone while the drawer survives"
else
  bad "MUTATION not red: expected exit 0, marker gone and drawer kept (rc=$mutant_ack_rc)"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mcp.js; then
  ok "mcp.js is restored to its committed content after the acknowledgment mutation"
else
  bad "mcp.js was NOT fully restored after the acknowledgment mutation"
fi

echo
echo "=== MUTATION: prune.js dropping dry_run: false from delete_by_source (#1211, v1-F2) ==="
MUTANT_DRYRUN_CLI=antigravity
MUTANT_DRYRUN_PERIOD="2019-06"
MUTANT_DRYRUN_RID="$(write_quiet_record "$HELPERS_DIR/mutant-dryrun.json" "$MUTANT_DRYRUN_CLI" \
  "mutant-dryrun-session" "mutant-dryrun-key" "2019-06-01T00:00:00.000Z")"
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
MUTANT_DRYRUN_ENTRY="$(journal_entry_path "$MUTANT_DRYRUN_CLI" "$MUTANT_DRYRUN_PERIOD" "$MUTANT_DRYRUN_RID")"
MUTANT_DRYRUN_MIRRORED="$(mirrored_marker_path "$MUTANT_DRYRUN_CLI" "$MUTANT_DRYRUN_PERIOD" "$MUTANT_DRYRUN_RID")"
if [ -f "$MUTANT_DRYRUN_MIRRORED" ] && [ "$(drawers_for_source "$MUTANT_DRYRUN_ENTRY")" -eq 1 ]; then
  ok "setup: the dry-run-mutation record is mirrored with one drawer"
else
  bad "setup: expected the dry-run-mutation record mirrored with one drawer"
fi

MUTATOR_6="$HELPERS_DIR/mutator-dry-run.js"
cat > "$MUTATOR_6" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = 'mcp.deleteBySource({ source_file: entryPath, dry_run: false })';
if (!src.includes(marker)) {
  console.error('FATAL: delete_by_source dry_run: false marker not found in prune.js');
  process.exit(1);
}
src = src.split(marker).join('mcp.deleteBySource({ source_file: entryPath })');
fs.writeFileSync(path, src);
MUTATOR_EOF

MUTANT_DRYRUN_ERR="$HELPERS_DIR/mutant-dryrun.err"
node "$MUTATOR_6" "$PRUNE_JS"
if bash "$REPO_DIR/scripts/usage-prune.sh" "$MUTANT_DRYRUN_CLI" "$MUTANT_DRYRUN_PERIOD" >/dev/null 2>"$MUTANT_DRYRUN_ERR"; then
  mutant_dryrun_rc=0
else
  mutant_dryrun_rc=1
fi
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/prune.js

last_delete_line="$(grep -F '"tool":"mempalace_delete_by_source"' "$FAKE_LOG" | tail -n 1)"
if [ "$mutant_dryrun_rc" -eq 1 ] && grep -qF 'dry run' "$MUTANT_DRYRUN_ERR"; then
  ok "MUTATION RED: without dry_run: false, the server's default dry run makes the prune refuse, naming the dry run"
else
  bad "MUTATION not red: expected a non-zero prune naming the dry run (rc=$mutant_dryrun_rc)" "$(cat "$MUTANT_DRYRUN_ERR")"
fi
if [ -f "$MUTANT_DRYRUN_MIRRORED" ] && [ -f "$MUTANT_DRYRUN_ENTRY" ] && [ "$(drawers_for_source "$MUTANT_DRYRUN_ENTRY")" -eq 1 ]; then
  ok "MUTATION RED: the mirrored marker, the entry and the drawer are all kept after the dry run"
else
  bad "MUTATION: the dry-run prune removed the marker, the entry or the drawer"
fi
if grep -qF '"dry_run":true' <<< "$last_delete_line"; then
  ok "the fake's last delete call was resolved as a dry run (absent dry_run is the server default)"
else
  bad "the fake's last delete call was not a dry run" "$last_delete_line"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/prune.js; then
  ok "prune.js is restored to its committed content after the dry-run mutation"
else
  bad "prune.js was NOT fully restored after the dry-run mutation"
fi
if bash "$REPO_DIR/scripts/usage-prune.sh" "$MUTANT_DRYRUN_CLI" "$MUTANT_DRYRUN_PERIOD" >/dev/null 2>&1 &&
  [ ! -f "$MUTANT_DRYRUN_ENTRY" ] && [ "$(drawers_for_source "$MUTANT_DRYRUN_ENTRY")" -eq 0 ]; then
  ok "the unmutated prune then succeeds and removes the entry and the drawer"
else
  bad "the unmutated prune did not complete after the dry-run mutation was restored"
fi

echo
echo "=== FAULT INJECTION: the decoder throws inside the response handler (#1211, v1-F3) ==="
# Green by design: its red is a build without call()'s catch-all, where the
# throw is an uncaught listener exception that kills the catch-up before its
# finally, leaving mirror.lock behind until it goes stale.
FAULT_CLI=claude-code
FAULT_PERIOD="2019-07"
FAULT_RID="$(write_quiet_record "$HELPERS_DIR/fault.json" "$FAULT_CLI" \
  "fault-session" "fault-key" "2019-07-01T00:00:00.000Z")"
FAULT_PENDING="$(pending_marker_path "$FAULT_CLI" "$FAULT_PERIOD" "$FAULT_RID")"
FAULT_MIRRORED="$(mirrored_marker_path "$FAULT_CLI" "$FAULT_PERIOD" "$FAULT_RID")"
if [ -f "$FAULT_PENDING" ]; then
  ok "setup: the fault-injection record is pending"
else
  bad "setup: expected the fault-injection record to be pending"
fi

MUTATOR_7="$HELPERS_DIR/mutator-decoder-throws.js"
cat > "$MUTATOR_7" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const marker = 'function decodeToolResult(parsed) {';
if (!src.includes(marker)) {
  console.error('FATAL: decodeToolResult signature marker not found in mcp.js');
  process.exit(1);
}
src = src.split(marker).join("function decodeToolResult(parsed) { throw new Error('fault injection');");
fs.writeFileSync(path, src);
MUTATOR_EOF

FAULT_ERR="$HELPERS_DIR/fault.err"
node "$MUTATOR_7" "$MCP_JS"
if bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>"$FAULT_ERR"; then
  fault_rc=0
else
  fault_rc=$?
fi
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mcp.js

if [ "$fault_rc" -eq 0 ]; then
  ok "a throwing decoder does not crash the catch-up (exit 0)"
else
  bad "a throwing decoder crashed the catch-up (exit $fault_rc)" "$(cat "$FAULT_ERR")"
fi
if [ ! -e "$USAGE_ROOT/locks/mirror.lock" ]; then
  ok "mirror.lock is released after the throwing decoder"
else
  bad "mirror.lock was left behind by the throwing decoder"
  rm -f "$USAGE_ROOT/locks/mirror.lock"
fi
if [ -f "$FAULT_PENDING" ] && [ ! -f "$FAULT_MIRRORED" ]; then
  ok "the marker stays pending after the throwing decoder"
else
  bad "the marker left pending/ although the response could not be decoded"
fi
if grep -qF 'stopping this pass' "$FAULT_ERR"; then
  ok "stderr says the pass is stopping"
else
  bad "stderr does not say 'stopping this pass'" "$(cat "$FAULT_ERR")"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mcp.js; then
  ok "mcp.js is restored to its committed content after the fault injection"
else
  bad "mcp.js was NOT fully restored after the fault injection"
fi
bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
if [ -f "$FAULT_MIRRORED" ] && [ "$(pending_count)" -eq 0 ]; then
  ok "recovery: the fault-injection record is mirrored and pending/ is empty"
else
  bad "recovery: the fault-injection record is not mirrored, or pending/ still holds $(pending_count) marker(s)"
fi

echo
echo "=== MUTATION: breaker cap removed (#1240, case j's load-bearing proof) ==="
# Simulated via CONFIG, not a source-code splice: the K-consecutive-failure
# cap is exposed as the documented env var CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER
# (spelled out verbatim in this ticket's own brief), so setting it absurdly
# high is a guaranteed-correct way to disable the cap against ANY conforming
# implementation — unlike a literal-marker source patch, it cannot go stale
# if mirror.js's internal variable/function names differ from this suite's
# guess. No git-tracked file is touched, so there is nothing to restore.
#
# A fresh copy of case (j)'s exact backlog shape (3 poisoned oldest, 2
# healthy newer, same mtimes). With the cap removed, a SINGLE invocation
# must reach every marker (no early stop protects the pass), so both healthy
# markers are mirrored after just ONE run — case (j) itself needed 2 runs
# (pass 1 stopped at 3 calls before ever reaching the healthy pair). That
# contrast is the load-bearing proof: without the cap, nothing bounds a pass
# short of exhausting (or making zero progress against) the whole backlog.
MUTANT_NOCAP_CLI=gemini-cli
MUTANT_NOCAP_PERIOD="2018-09"
MUTANT_NOCAP_BASE_MS=100000000000
MUTANT_NOCAP_HEALTHY_BASE_MS=100001000000
MUTANT_NOCAP_POISON_RIDS_FILE="$HELPERS_DIR/mutant-nocap-poison-rids.txt"
MUTANT_NOCAP_HEALTHY_RIDS_FILE="$HELPERS_DIR/mutant-nocap-healthy-rids.txt"
: >"$MUTANT_NOCAP_POISON_RIDS_FILE"
: >"$MUTANT_NOCAP_HEALTHY_RIDS_FILE"

i=1
while [ "$i" -le 3 ]; do
  f="$HELPERS_DIR/mutant-nocap-poison-$i.json"
  rid="$(write_quiet_record "$f" "$MUTANT_NOCAP_CLI" "mutant-nocap-poison-session-$i" "mutant-nocap-poison-key-$i" "2018-09-01T00:00:00.000Z")"
  echo "$rid" >>"$MUTANT_NOCAP_POISON_RIDS_FILE"
  set_marker_mtime "$(pending_marker_path "$MUTANT_NOCAP_CLI" "$MUTANT_NOCAP_PERIOD" "$rid")" "$((MUTANT_NOCAP_BASE_MS + i))"
  i=$((i + 1))
done
i=1
while [ "$i" -le 2 ]; do
  f="$HELPERS_DIR/mutant-nocap-healthy-$i.json"
  rid="$(write_quiet_record "$f" "$MUTANT_NOCAP_CLI" "mutant-nocap-healthy-session-$i" "mutant-nocap-healthy-key-$i" "2018-09-01T00:00:00.000Z")"
  echo "$rid" >>"$MUTANT_NOCAP_HEALTHY_RIDS_FILE"
  set_marker_mtime "$(pending_marker_path "$MUTANT_NOCAP_CLI" "$MUTANT_NOCAP_PERIOD" "$rid")" "$((MUTANT_NOCAP_HEALTHY_BASE_MS + i))"
  i=$((i + 1))
done

MUTANT_NOCAP_POISON_IDS="$(tr '\n' ' ' <"$MUTANT_NOCAP_POISON_RIDS_FILE")"
# shellcheck disable=SC2086  # word-splitting the space-separated record ids is intentional here
fake_tool_failure_for_sources mempalace_add_drawer success-false $MUTANT_NOCAP_POISON_IDS

mutant_nocap_all_healthy_mirrored() {
  local rid all=1
  while IFS= read -r rid; do
    [ -f "$(mirrored_marker_path "$MUTANT_NOCAP_CLI" "$MUTANT_NOCAP_PERIOD" "$rid")" ] || all=0
  done <"$MUTANT_NOCAP_HEALTHY_RIDS_FILE"
  echo "$all"
}

CREWRIG_USAGE_MIRROR_TOOL_ERROR_BREAKER=999999 bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>&1
if [ "$(mutant_nocap_all_healthy_mirrored)" -eq 1 ]; then
  ok "MUTATION RED: with the cap effectively removed, a single pass reaches and mirrors both healthy records — case (j) needed 2 passes for the same shape"
else
  bad "MUTATION not red: expected both healthy records mirrored after one uncapped pass"
fi

fake_clear_source_tool_failure

echo
echo "=== MUTATION: mtime-touch removed — reproduces D1h's starvation flaw (#1240) ==="
# Regex-based (not exact-literal-line) source mutation: comments out any
# call site of touchPendingMarkerMtime(...), regardless of its exact
# argument list — this only assumes the FUNCTION NAME the brief specifies
# verbatim, not its call shape, so it survives small formatting differences
# in the developer's actual diff. If the marker genuinely cannot be found
# (the function was named something else), this is reported as a single
# clearly-labeled setup failure instead of aborting the whole suite.
#
# Same backlog shape as case (j) (3 poisoned oldest, 2 healthy newer) but
# with the mtime bump disabled: the poisoned markers' mtimes never change,
# so they stay at the HEAD of listMarkers()'s ascending order forever. Pass
# 1 hits them, trips the breaker, and stops before ever reaching the 2
# healthy markers — same as case (j)'s real pass 1. But pass 2 (and every
# pass after it) sees the IDENTICAL order, because nothing moved the
# poisoned markers out of the way: the healthy pair is stuck behind the same
# 3 poisoned records forever. This is D1h's exact starvation flaw.
MUTANT_NOTOUCH_CLI=copilot-cli
MUTANT_NOTOUCH_PERIOD="2018-10"
MUTANT_NOTOUCH_BASE_MS=100000000000
MUTANT_NOTOUCH_HEALTHY_BASE_MS=100001000000
MUTANT_NOTOUCH_POISON_RIDS_FILE="$HELPERS_DIR/mutant-notouch-poison-rids.txt"
MUTANT_NOTOUCH_HEALTHY_RIDS_FILE="$HELPERS_DIR/mutant-notouch-healthy-rids.txt"
: >"$MUTANT_NOTOUCH_POISON_RIDS_FILE"
: >"$MUTANT_NOTOUCH_HEALTHY_RIDS_FILE"

i=1
while [ "$i" -le 3 ]; do
  f="$HELPERS_DIR/mutant-notouch-poison-$i.json"
  rid="$(write_quiet_record "$f" "$MUTANT_NOTOUCH_CLI" "mutant-notouch-poison-session-$i" "mutant-notouch-poison-key-$i" "2018-10-01T00:00:00.000Z")"
  echo "$rid" >>"$MUTANT_NOTOUCH_POISON_RIDS_FILE"
  set_marker_mtime "$(pending_marker_path "$MUTANT_NOTOUCH_CLI" "$MUTANT_NOTOUCH_PERIOD" "$rid")" "$((MUTANT_NOTOUCH_BASE_MS + i))"
  i=$((i + 1))
done
i=1
while [ "$i" -le 2 ]; do
  f="$HELPERS_DIR/mutant-notouch-healthy-$i.json"
  rid="$(write_quiet_record "$f" "$MUTANT_NOTOUCH_CLI" "mutant-notouch-healthy-session-$i" "mutant-notouch-healthy-key-$i" "2018-10-01T00:00:00.000Z")"
  echo "$rid" >>"$MUTANT_NOTOUCH_HEALTHY_RIDS_FILE"
  set_marker_mtime "$(pending_marker_path "$MUTANT_NOTOUCH_CLI" "$MUTANT_NOTOUCH_PERIOD" "$rid")" "$((MUTANT_NOTOUCH_HEALTHY_BASE_MS + i))"
  i=$((i + 1))
done

MUTANT_NOTOUCH_POISON_IDS="$(tr '\n' ' ' <"$MUTANT_NOTOUCH_POISON_RIDS_FILE")"
# shellcheck disable=SC2086  # word-splitting the space-separated record ids is intentional here
fake_tool_failure_for_sources mempalace_add_drawer success-false $MUTANT_NOTOUCH_POISON_IDS

mutant_notouch_all_healthy_mirrored() {
  local rid all=1
  while IFS= read -r rid; do
    [ -f "$(mirrored_marker_path "$MUTANT_NOTOUCH_CLI" "$MUTANT_NOTOUCH_PERIOD" "$rid")" ] || all=0
  done <"$MUTANT_NOTOUCH_HEALTHY_RIDS_FILE"
  echo "$all"
}

MUTATOR_8="$HELPERS_DIR/mutator-touch-removed.js"
cat >"$MUTATOR_8" <<'MUTATOR_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');
const re = /^(\s*)touchPendingMarkerMtime\([^)]*\)\s*;\s*$/m;
if (!re.test(src)) {
  console.error('FATAL: no touchPendingMarkerMtime(...) call site found in mirror.js');
  process.exit(1);
}
src = src.replace(re, '$1// mutation: touchPendingMarkerMtime() call disabled');
fs.writeFileSync(path, src);
MUTATOR_EOF

if node "$MUTATOR_8" "$MIRROR_JS"; then
  bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>&1
  bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null 2>&1
  git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mirror.js

  if [ "$(mutant_notouch_all_healthy_mirrored)" -eq 0 ]; then
    ok "MUTATION RED: without touchPendingMarkerMtime(), the healthy pair is starved behind the same 3 poisoned records across repeated passes (D1h's flaw)"
  else
    bad "MUTATION not red: the healthy pair got mirrored even with the mtime-touch disabled"
  fi
  if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mirror.js; then
    ok "mirror.js is restored to its committed content after the mtime-touch mutation"
  else
    bad "mirror.js was NOT fully restored after the mtime-touch mutation"
  fi

  fake_clear_source_tool_failure
  bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
  bash "$REPO_DIR/scripts/usage-mirror.sh" >/dev/null
  if [ "$(mutant_notouch_all_healthy_mirrored)" -eq 1 ]; then
    ok "the unmutated mirror.js then recovers: the healthy pair reaches mirrored/ once the touch is restored"
  else
    bad "the unmutated mirror.js did not recover the healthy pair after the mtime-touch mutation was restored"
  fi
else
  bad "MUTATION SETUP: no touchPendingMarkerMtime(...) call site found in mirror.js — this test's assumed function name does not match the landed diff; update scripts/tests/test-usage-storage-mirror.sh's MUTATOR_8 regex to match"
  git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mirror.js 2>/dev/null || true
  fake_clear_source_tool_failure
fi

echo
echo "=== Summary: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
