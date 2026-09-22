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
# before the suite continues.
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
MUTATION_GUARD_FILES="scripts/lib/usage-store/mirror.js scripts/lib/usage-store/prune.js"

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

cleanup() {
  stop_fake
  for f in $MUTATION_GUARD_FILES; do
    if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
      git -C "$REPO_DIR" checkout -- "$f" 2>/dev/null || true
    fi
  done
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

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'make-record':
      return cmdMakeRecord();
    case 'write':
      return cmdWrite();
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
pruned_marker_path() { echo "$USAGE_ROOT/pruned/$1/$2.json"; }

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
captured_checks_ok=1
uncaptured_checks_ok=1
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
if bash "$REPO_DIR/scripts/usage-prune.sh" "$DAEMON_DOWN_PHASE_CLI" "$DAEMON_DOWN_PERIOD" >/dev/null 2>&1; then
  bad "pruning a period with mirrored drawers should have refused while the daemon is down"
else
  ok "pruning a period with mirrored drawers refuses while the daemon is down"
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
const marker = "const result = await mcp.deleteBySource({ source_file: entryPath, dry_run: false });\n    if (!result.ok) {\n      return { ok: false };\n    }";
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
MUTANT_LOCKRACE_CLI=codex-cli
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

echo
echo "=== Summary: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
