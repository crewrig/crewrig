#!/bin/bash
# test-usage-storage.sh — the no-daemon suite for the usage-record storage
# contract (spec 0207 R22, PLAN v3 step 10; plan/1170#3 review edits 3 and 6).
#
# CREWRIG_USAGE_ROOT is a mktemp -d; MEMPALACE_PALACE_PATH is a temp path with
# no token file, so mcp.tokenPath() resolves but nothing under <root>/mirror/
# is ever created unless a case explicitly creates the token file.
# CREWRIG_USAGE_MIRROR=0 by default (a second belt on top of the no-token
# gate) — a case that needs the mirror path to actually spawn unsets it.
#
# Preflight: node on PATH and node_modules/ajv installed, or a FATAL and exit
# 2 — never a silent pass. The FATAL text deliberately avoids the literal
# phrase "command not found", which check-test-strays.sh greps for across
# every changeset-modified suite run from the no-Node test-wiring job.
#
# Mutation discipline (this suite's share of the brief's five named
# mutations): each is applied by editing a tracked module IN PLACE, proven
# red, then restored with `git checkout -- <file>` before the suite
# continues — never left mutated across cases.
#
# Usage:
#   bash scripts/tests/test-usage-storage.sh

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

# --- Sandbox -------------------------------------------------------------
USAGE_ROOT="$(mktemp -d)"
PALACE_PARENT="$(mktemp -d)"
HELPERS_DIR="$(mktemp -d)"
SYN_PARENT="$(mktemp -d)"
MUTATION_GUARD_FILES="scripts/lib/usage-store/journal.js scripts/lib/usage-store/mirror.js scripts/lib/usage-store/validator/validate.js scripts/lib/usage-store/query.js"

# tokenPath() is hardcoded to $HOME/.mempalace/server/<hash>/token by both
# mcp.js and common.sh's mcp_token_path — there is no override, and this
# suite must not override HOME itself (the asdf node shim on this machine
# breaks under an empty/foreign HOME). Any such directory this suite creates
# under the REAL $HOME is registered here and removed in cleanup(), so
# nothing survives under ~/.mempalace/ once the suite exits.
REAL_HOME_DIRS_TO_CLEAN=""
register_real_home_dir_for_cleanup() {
  # $1 = a directory under the real $HOME this suite is about to create.
  # Refuses (FATAL) if it already exists — this suite creates only fresh,
  # never-before-seen hash directories, and must never touch pre-existing
  # real-home state.
  if [ -e "$1" ]; then
    echo "FATAL: $1 already exists — refusing to touch pre-existing state under \$HOME/.mempalace/." >&2
    exit 2
  fi
  REAL_HOME_DIRS_TO_CLEAN="$REAL_HOME_DIRS_TO_CLEAN $1"
}

# shellcheck disable=SC2329  # invoked via trap cleanup EXIT, not dead
cleanup() {
  # Safety net: if a mutation phase was interrupted before its own restore
  # ran, never leave a tracked file mutated on disk.
  for f in $MUTATION_GUARD_FILES; do
    if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
      git -C "$REPO_DIR" checkout -- "$f" 2>/dev/null || true
    fi
  done
  for d in $REAL_HOME_DIRS_TO_CLEAN; do
    rm -rf "$d" 2>/dev/null || true
  done
  rm -rf "$USAGE_ROOT" "$PALACE_PARENT" "$HELPERS_DIR" "$SYN_PARENT" 2>/dev/null || true
}
trap cleanup EXIT

export CREWRIG_USAGE_ROOT="$USAGE_ROOT"
export MEMPALACE_PALACE_PATH="$PALACE_PARENT/palace"
export CREWRIG_USAGE_MIRROR=0
unset CREWRIG_USAGE_WING 2>/dev/null || true
unset CREWRIG_USAGE_ALLOW_PRUNED 2>/dev/null || true
unset CREWRIG_USAGE_DRAIN_BUDGET_MS 2>/dev/null || true
unset CREWRIG_USAGE_DRAIN_LOCK_STALE_MS 2>/dev/null || true
unset CREWRIG_USAGE_TMP_STALE_MS 2>/dev/null || true

# Refuse to run against a dirty tree — the mutation-discipline phases below
# edit-then-restore tracked files, and a pre-existing diff on those files
# would make "restore" ambiguous about which content is "clean".
for f in $MUTATION_GUARD_FILES; do
  if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
    echo "FATAL: $f has uncommitted changes — refusing to run mutation-discipline cases against a dirty tree." >&2
    exit 2
  fi
done

# --- Node driver -----------------------------------------------------------
# A small dispatcher over this ticket's own modules, written to a throwaway
# temp dir (never committed) so the bash cases below stay readable. It reads
# CREWRIG_USAGE_ROOT / MEMPALACE_PALACE_PATH / CREWRIG_USAGE_MIRROR etc. from
# its own process environment exactly as a real hook-fired write would.
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

// make-record — env-var driven synthetic usage record generator. recordId is
// always derived honestly (sha256(sessionId + U+001F + idempotencyKey)), per
// docs/usage-record-format.md, never hand-picked.
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

  const taskKey = process.env.MR_TASK_KEY;
  const assetKind = process.env.MR_ASSET_KIND;
  const assetRef = process.env.MR_ASSET_REF;
  if (taskKey || (assetKind && assetRef)) {
    record.attribution = {};
    if (taskKey) record.attribution.taskHandoffKey = taskKey;
    if (assetKind && assetRef) record.attribution.externalAsset = { kind: assetKind, ref: assetRef };
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

function cmdResolveWing() {
  const arg = process.argv[3];
  const mirror = req('scripts/lib/usage-store/mirror.js');
  const projectRoot = arg === '__ABSENT__' ? undefined : arg;
  const info = mirror.resolveWing(projectRoot);
  console.log(`WING=${info.wing}`);
  console.log(`DERIVATION=${info.wingDerivation}`);
}

function cmdTokenPath() {
  const mcp = req('scripts/lib/usage-store/mcp.js');
  console.log(mcp.tokenPath());
}

function cmdStatMtime() {
  console.log(String(fs.statSync(process.argv[3]).mtimeMs));
}

function cmdSha256File() {
  console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[3])).digest('hex'));
}

function cmdDrainAndSweep() {
  const journal = req('scripts/lib/usage-store/journal.js');
  journal.drainAndSweep();
  console.log('DONE');
}

function cmdRepairSidecar() {
  const [, , , cli, per, recordId, entryFile] = process.argv;
  const record = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
  const mirror = req('scripts/lib/usage-store/mirror.js');
  const info = mirror.readOrRepairSidecar(cli, per, recordId, record);
  console.log(`WING=${info.wing}`);
  console.log(`DERIVATION=${info.wingDerivation}`);
}

function cmdBackdate() {
  const file = process.argv[3];
  const deltaMs = Number(process.argv[4]);
  const past = new Date(Date.now() - deltaMs);
  fs.utimesSync(file, past, past);
  console.log('OK');
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'make-record':
      return cmdMakeRecord();
    case 'write':
      return cmdWrite();
    case 'resolve-wing':
      return cmdResolveWing();
    case 'token-path':
      return cmdTokenPath();
    case 'stat-mtime':
      return cmdStatMtime();
    case 'sha256-file':
      return cmdSha256File();
    case 'drain-and-sweep':
      return cmdDrainAndSweep();
    case 'backdate':
      return cmdBackdate();
    case 'repair-sidecar':
      return cmdRepairSidecar();
    case 'state-dir':
      return console.log(req('scripts/lib/usage-store/layout.js').stateDir());
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

# --- Path algebra mirrors (bash side) ----------------------------------------
# layout.js is the single source of truth; these are read-only mirrors of its
# deterministic string joins, used only to locate files this suite asserts on
# — never to decide behavior.
journal_entry_path() { echo "$USAGE_ROOT/journal/$1/$2/$3.json"; }
wing_sidecar_path() { echo "$USAGE_ROOT/journal/$1/$2/$3.wing.json"; }
partition_dir() { echo "$USAGE_ROOT/journal/$1/$2"; }
pending_marker_path() { echo "$USAGE_ROOT/mirror/pending/$1/$2/$3"; }
# shellcheck disable=SC2329  # kept for parity with layout.js's full path API and the sibling mirror suite, which does call it
mirrored_marker_path() { echo "$USAGE_ROOT/mirror/mirrored/$1/$2/$3"; }
pruned_marker_path() { echo "$USAGE_ROOT/pruned/$1/$2.json"; }
drain_lock_path() { echo "$USAGE_ROOT/locks/drain.lock"; }

echo "=== usage-store no-daemon suite (R22) ==="
echo "USAGE_ROOT=$USAGE_ROOT"
echo "MEMPALACE_PALACE_PATH=$MEMPALACE_PALACE_PATH (no token file yet)"

VALIDATOR="$SCRIPT_DIR/lib/usage-record-validator.js"

# --- (a) a batch of schema-valid records: entries re-validate, one sidecar each ---
echo
echo "=== (a) schema-valid batch: re-validation + exactly one sidecar per entry ==="
SAMPLES_DIR="$REPO_DIR/schemas/usage-record/samples"
sample_count=0
for f in "$SAMPLES_DIR"/*.json; do
  [ -f "$f" ] || continue
  sample_count=$((sample_count + 1))
  cli="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).provenance.cli)" "$f")"
  per="$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const d=new Date(r.timing.requestInstant); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))" "$f")"
  rid="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$f")"
  name="$(basename "$f")"

  out="$(run_driver write "$f")"
  if grep -qF 'STATUS=stored' <<< "$out"; then
    ok "sample $name written (stored)"
  else
    bad "sample $name did not report stored" "$out"
  fi

  entry="$(journal_entry_path "$cli" "$per" "$rid")"
  sidecar="$(wing_sidecar_path "$cli" "$per" "$rid")"

  if [ -f "$entry" ]; then
    ok "sample $name has a journal entry at ${entry#"$USAGE_ROOT"/}"
  else
    bad "sample $name has NO journal entry at ${entry#"$USAGE_ROOT"/}"
  fi

  if [ -f "$sidecar" ]; then
    ok "sample $name has exactly one sidecar at ${sidecar#"$USAGE_ROOT"/}"
  else
    bad "sample $name has NO sidecar at ${sidecar#"$USAGE_ROOT"/}"
  fi

  set +e
  val_out="$(node "$VALIDATOR" "$entry" 2>&1)"; val_rc=$?
  set -e
  if [ "$val_rc" -eq 0 ] && grep -qF ': OK' <<< "$val_out"; then
    ok "sample $name's journal entry re-validates through the merged 0205 validator"
  else
    bad "sample $name's journal entry FAILED re-validation (exit $val_rc)" "$val_out"
  fi
done
if [ "$sample_count" -eq 0 ]; then
  bad "samples directory has zero files — refusing to pass vacuously ($SAMPLES_DIR)"
fi

# --- (b) rewriting the batch adds zero entries and returns duplicate --------
echo
echo "=== (b) rewriting the same batch: zero new entries, all duplicate ==="
for f in "$SAMPLES_DIR"/*.json; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  out="$(run_driver write "$f")"
  if grep -qF 'STATUS=duplicate' <<< "$out"; then
    ok "rewriting sample $name returns duplicate"
  else
    bad "rewriting sample $name did NOT return duplicate" "$out"
  fi
done

# --- (c) a correction adds an entry; the corrected entry's bytes/mtime hold --
echo
echo "=== (c) correction: corrected entry's bytes and mtime are untouched ==="
BASE_CLI=claude-code
read -r BASE_INSTANT BASE_PERIOD <<< "$(node -e "
const d = new Date();
console.log(d.toISOString() + ' ' + d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0'));
")"
BASE_FILE="$HELPERS_DIR/base-record.json"
MR_KIND=captured MR_CLI="$BASE_CLI" MR_SESSION="correction-base-session" MR_IDEMKEY="correction-base-key" \
  MR_REQUEST_INSTANT="$BASE_INSTANT" run_driver make-record > "$BASE_FILE"
BASE_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$BASE_FILE")"
base_out="$(run_driver write "$BASE_FILE")"
if grep -qF 'STATUS=stored' <<< "$base_out"; then
  ok "correction base record stored"
else
  bad "correction base record did NOT store" "$base_out"
fi

BASE_ENTRY="$(journal_entry_path "$BASE_CLI" "$BASE_PERIOD" "$BASE_RID")"
BEFORE_HASH="$(run_driver sha256-file "$BASE_ENTRY")"
BEFORE_MTIME="$(run_driver stat-mtime "$BASE_ENTRY")"

CORRECTION_FILE="$HELPERS_DIR/correction-record.json"
MR_KIND=captured MR_CLI="$BASE_CLI" MR_SESSION="correction-base-session" MR_IDEMKEY="correction-base-key-corr-01" \
  MR_REQUEST_INSTANT="$BASE_INSTANT" MR_CORRECTS="$BASE_RID" run_driver make-record > "$CORRECTION_FILE"
corr_out="$(run_driver write "$CORRECTION_FILE")"
if grep -qF 'STATUS=stored' <<< "$corr_out"; then
  ok "correction record stored as a new entry"
else
  bad "correction record did NOT store" "$corr_out"
fi

AFTER_HASH="$(run_driver sha256-file "$BASE_ENTRY")"
AFTER_MTIME="$(run_driver stat-mtime "$BASE_ENTRY")"
if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
  ok "corrected entry's bytes are unchanged after the correction"
else
  bad "corrected entry's bytes CHANGED after the correction"
fi
if [ "$BEFORE_MTIME" = "$AFTER_MTIME" ]; then
  ok "corrected entry's mtime is unchanged after the correction"
else
  bad "corrected entry's mtime CHANGED after the correction ($BEFORE_MTIME -> $AFTER_MTIME)"
fi

# --- (d) every mutant is rejected, and leaves zero files under journal/mirror --
echo
echo "=== (d) mutants: rejected with a reason, zero files under journal/ and mirror/ ==="
MUTANTS_DIR="$SCRIPT_DIR/tests/fixtures/usage-records/mutants"
before_journal_count="$(find "$USAGE_ROOT/journal" -type f 2>/dev/null | wc -l | tr -d ' ' || true)"
before_mirror_count="$(find "$USAGE_ROOT/mirror" -type f 2>/dev/null | wc -l | tr -d ' ' || true)"
mutant_count=0
for f in "$MUTANTS_DIR"/*.json; do
  [ -f "$f" ] || continue
  mutant_count=$((mutant_count + 1))
  name="$(basename "$f")"
  out="$(run_driver write "$f")"
  if grep -qF 'STATUS=rejected' <<< "$out" && grep -qF 'REASON=' <<< "$out"; then
    ok "mutant $name is rejected with a reason"
  else
    bad "mutant $name was NOT rejected with a reason" "$out"
  fi
done
if [ "$mutant_count" -eq 0 ]; then
  bad "mutants directory has zero files — refusing to pass vacuously ($MUTANTS_DIR)"
fi
after_journal_count="$(find "$USAGE_ROOT/journal" -type f 2>/dev/null | wc -l | tr -d ' ' || true)"
after_mirror_count="$(find "$USAGE_ROOT/mirror" -type f 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$before_journal_count" = "$after_journal_count" ]; then
  ok "rejected mutants added zero files under journal/"
else
  bad "journal/ file count changed while rejecting mutants ($before_journal_count -> $after_journal_count)"
fi
if [ "$before_mirror_count" = "$after_mirror_count" ]; then
  ok "rejected mutants added zero files under mirror/"
else
  bad "mirror/ file count changed while rejecting mutants ($before_mirror_count -> $after_mirror_count)"
fi

# --- (e) read selectors: --session, --agent+--parent, --period[+--cli], -----
#         --task-key, --asset, --fidelity narrowing; schemaVersion always
#         present; no sidecar ever returned.
echo
echo "=== (e) read selectors return exactly the expected set, no sidecar leaks ==="
QUERY_INSTANT="2021-03-10T12:00:00.000Z"
QUERY_PERIOD="2021-03"

assert_no_sidecar_and_schema_version() {
  # $1 = description, $2 = JSONL output
  local desc="$1" out="$2" line ok_all=1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if ! printf '%s' "$line" | jq -e 'has("schemaVersion") and (has("wingDerivation") | not)' >/dev/null 2>&1; then
      ok_all=0
    fi
  done <<< "$out"
  if [ "$ok_all" -eq 1 ]; then
    ok "$desc: every line carries schemaVersion and none is a sidecar"
  else
    bad "$desc: a returned line is missing schemaVersion or looks like a sidecar" "$out"
  fi
}

R1_FILE="$HELPERS_DIR/query-r1.json"
MR_CLI=claude-code MR_SESSION="query-session-1" MR_IDEMKEY="query-key-1" MR_REQUEST_INSTANT="$QUERY_INSTANT" \
  MR_FIDELITY="per-request" run_driver make-record > "$R1_FILE"
R1_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$R1_FILE")"
run_driver write "$R1_FILE" >/dev/null

R2_FILE="$HELPERS_DIR/query-r2.json"
MR_CLI=gemini-cli MR_SESSION="query-session-2" MR_IDEMKEY="query-key-2" MR_REQUEST_INSTANT="$QUERY_INSTANT" \
  MR_AGENT_ID="query-agent-1" MR_PARENT_SESSION="query-parent-1" run_driver make-record > "$R2_FILE"
R2_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$R2_FILE")"
run_driver write "$R2_FILE" >/dev/null

R3_FILE="$HELPERS_DIR/query-r3.json"
MR_CLI=copilot-cli MR_SESSION="query-session-3" MR_IDEMKEY="query-key-3" MR_REQUEST_INSTANT="$QUERY_INSTANT" \
  MR_TASK_KEY="query-task-key-1" run_driver make-record > "$R3_FILE"
R3_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$R3_FILE")"
run_driver write "$R3_FILE" >/dev/null

R4_FILE="$HELPERS_DIR/query-r4.json"
MR_CLI=antigravity MR_SESSION="query-session-4" MR_IDEMKEY="query-key-4" MR_REQUEST_INSTANT="$QUERY_INSTANT" \
  MR_ASSET_KIND="forge-issue" MR_ASSET_REF="crewrig/crewrig#9999" run_driver make-record > "$R4_FILE"
R4_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$R4_FILE")"
run_driver write "$R4_FILE" >/dev/null

R5_FILE="$HELPERS_DIR/query-r5.json"
MR_CLI=claude-code MR_SESSION="query-session-5" MR_IDEMKEY="query-key-5" MR_REQUEST_INSTANT="$QUERY_INSTANT" \
  MR_FIDELITY="run-total" run_driver make-record > "$R5_FILE"
R5_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$R5_FILE")"
run_driver write "$R5_FILE" >/dev/null

qout="$(bash "$REPO_DIR/scripts/usage-query.sh" --session "query-session-1")"
ids="$(printf '%s\n' "$qout" | jq -r '.recordId' | sort)"
if [ "$ids" = "$R1_RID" ]; then ok "--session returns exactly R1"; else bad "--session did not return exactly R1" "$qout"; fi
assert_no_sidecar_and_schema_version "--session" "$qout"

qout="$(bash "$REPO_DIR/scripts/usage-query.sh" --agent "query-agent-1" --parent "query-parent-1")"
ids="$(printf '%s\n' "$qout" | jq -r '.recordId' | sort)"
if [ "$ids" = "$R2_RID" ]; then ok "--agent+--parent returns exactly R2"; else bad "--agent+--parent did not return exactly R2" "$qout"; fi
assert_no_sidecar_and_schema_version "--agent+--parent" "$qout"

qout="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key "query-task-key-1")"
ids="$(printf '%s\n' "$qout" | jq -r '.recordId' | sort)"
if [ "$ids" = "$R3_RID" ]; then ok "--task-key returns exactly R3"; else bad "--task-key did not return exactly R3" "$qout"; fi
assert_no_sidecar_and_schema_version "--task-key" "$qout"

qout="$(bash "$REPO_DIR/scripts/usage-query.sh" --asset "forge-issue:crewrig/crewrig#9999")"
ids="$(printf '%s\n' "$qout" | jq -r '.recordId' | sort)"
if [ "$ids" = "$R4_RID" ]; then ok "--asset returns exactly R4"; else bad "--asset did not return exactly R4" "$qout"; fi
assert_no_sidecar_and_schema_version "--asset" "$qout"

qout="$(bash "$REPO_DIR/scripts/usage-query.sh" --period "$QUERY_PERIOD" --cli claude-code)"
ids="$(printf '%s\n' "$qout" | jq -r '.recordId' | sort)"
expected="$(printf '%s\n%s\n' "$R1_RID" "$R5_RID" | sort)"
if [ "$ids" = "$expected" ]; then ok "--period+--cli returns exactly R1+R5"; else bad "--period+--cli did not return exactly R1+R5" "$qout"; fi
assert_no_sidecar_and_schema_version "--period+--cli" "$qout"

qout="$(bash "$REPO_DIR/scripts/usage-query.sh" --period "$QUERY_PERIOD" --cli claude-code --fidelity per-request)"
ids="$(printf '%s\n' "$qout" | jq -r '.recordId' | sort)"
if [ "$ids" = "$R1_RID" ]; then
  ok "--fidelity narrows --period+--cli down to R1 only"
else
  bad "--fidelity did not narrow to exactly R1" "$qout"
fi
assert_no_sidecar_and_schema_version "--fidelity narrowing" "$qout"

if bash "$REPO_DIR/scripts/usage-query.sh" --agent "query-agent-1" >/dev/null 2>&1; then
  bad "--agent without --parent should be refused (R15 pairing)"
else
  ok "--agent without --parent is refused (R15 pairing enforcement)"
fi

# Composed selectors (#1205): every selector given is ANDed, and --period
# stays the primary read. All five R1-R5 records sit in QUERY_PERIOD, so the
# --period-plus-walking cases below prove the walking selector narrows the
# period read; the cross-month half (a walking selector must not drop
# --period) lives in test-usage-attribution.sh's delta-01 block. Red on main
# (first selector wins): every case but the --cli claude-code pin.
# query_ids <args...> — the sorted recordIds usage:query returns.
query_ids() {
  { bash "$REPO_DIR/scripts/usage-query.sh" "$@" || true; } | jq -r '.recordId' | sort
}
composed_case() {
  # $1 = description, $2 = expected sorted ids, rest = usage:query args
  local desc="$1" want="$2" got
  shift 2
  got="$(query_ids "$@")"
  if [ "$got" = "$want" ]; then ok "$desc"; else bad "$desc" "got: $(printf '%s' "$got" | tr '\n' ' ')"; fi
}
composed_case "--period+--task-key returns exactly R3" "$R3_RID" \
  --period "$QUERY_PERIOD" --task-key "query-task-key-1"
composed_case "--period+--asset returns exactly R4" "$R4_RID" \
  --period "$QUERY_PERIOD" --asset "forge-issue:crewrig/crewrig#9999"
composed_case "--period+--session returns exactly R1" "$R1_RID" \
  --period "$QUERY_PERIOD" --session "query-session-1"
composed_case "--period+--agent+--parent returns exactly R2" "$R2_RID" \
  --period "$QUERY_PERIOD" --agent "query-agent-1" --parent "query-parent-1"
composed_case "--session+--cli gemini-cli returns nothing (R1 is claude-code)" "" \
  --session "query-session-1" --cli gemini-cli
composed_case "--session+--cli claude-code returns exactly R1" "$R1_RID" \
  --session "query-session-1" --cli claude-code

set +e
bad_asset_out="$(bash "$REPO_DIR/scripts/usage-query.sh" --period "$QUERY_PERIOD" --asset bad 2>&1)"
bad_asset_rc=$?
set -e
if [ "$bad_asset_rc" -eq 2 ] && grep -qF -- '--asset must be <kind>:<ref>' <<< "$bad_asset_out"; then
  ok "--period+--asset bad exits 2 with the <kind>:<ref> error (a malformed --asset is never silently ignored)"
else
  bad "--period+--asset bad did not exit 2 with the <kind>:<ref> error" "rc=$bad_asset_rc / $bad_asset_out"
fi

# --- (f) concurrency (R26): 8 simultaneous writers to ONE partition ---------
echo
echo "=== (f) concurrency: 8 simultaneous writers to one partition ==="
CONC_CLI=gemini-cli
CONC_INSTANT="2022-06-01T00:00:00.000Z"
CONC_PERIOD="2022-06"

conc_record_file() { echo "$HELPERS_DIR/conc-w$1.json"; }
CONC_RIDS_FILE="$HELPERS_DIR/conc-rids.txt"
: > "$CONC_RIDS_FILE"
i=1
while [ "$i" -le 8 ]; do
  f="$(conc_record_file "$i")"
  MR_CLI="$CONC_CLI" MR_SESSION="conc-session-$i" MR_IDEMKEY="conc-key-$i" MR_REQUEST_INSTANT="$CONC_INSTANT" \
    run_driver make-record > "$f"
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$f" >> "$CONC_RIDS_FILE"
  i=$((i + 1))
done

WAVE1_OUT_DIR="$HELPERS_DIR/wave1-out"
mkdir -p "$WAVE1_OUT_DIR"
i=1
while [ "$i" -le 8 ]; do
  f="$(conc_record_file "$i")"
  (run_driver write "$f" > "$WAVE1_OUT_DIR/w$i.out" 2>&1) &
  i=$((i + 1))
done
wait

wave1_stored=0
i=1
while [ "$i" -le 8 ]; do
  if grep -qF 'STATUS=stored' "$WAVE1_OUT_DIR/w$i.out"; then
    wave1_stored=$((wave1_stored + 1))
  else
    bad "concurrent writer $i did not report stored" "$(cat "$WAVE1_OUT_DIR/w$i.out")"
  fi
  i=$((i + 1))
done
if [ "$wave1_stored" -eq 8 ]; then
  ok "all 8 concurrent writers report stored"
else
  bad "only $wave1_stored/8 concurrent writers reported stored"
fi

conc_partition="$(partition_dir "$CONC_CLI" "$CONC_PERIOD")"
entry_count="$(find "$conc_partition" -maxdepth 1 -type f -name '*.json' ! -name '*.wing.json' 2>/dev/null | wc -l | tr -d ' ' || true)"
sidecar_count="$(find "$conc_partition" -maxdepth 1 -type f -name '*.wing.json' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$entry_count" -eq 8 ]; then ok "partition holds exactly 8 entries after wave 1"; else bad "partition holds $entry_count entries, expected 8"; fi
if [ "$sidecar_count" -eq 8 ]; then ok "partition holds exactly 8 sidecars after wave 1"; else bad "partition holds $sidecar_count sidecars, expected 8"; fi

# Every entry must parse whole (linkSync atomicity: no reader ever observes a
# torn write) and its filename must name its own recordId.
whole_ok=1
for ef in "$conc_partition"/*.json; do
  base="$(basename "$ef")"
  case "$base" in *.wing.json) continue ;; esac
  rid_from_name="${base%.json}"
  rid_from_content="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)}catch(e){console.log('PARSE_ERROR')}" "$ef")"
  if [ "$rid_from_name" != "$rid_from_content" ]; then
    whole_ok=0
    bad "entry $base parses to a different/garbled recordId ($rid_from_content)"
  fi
done
if [ "$whole_ok" -eq 1 ]; then
  ok "every wave-1 entry parses whole and names its own recordId"
fi

# --- Wave 2: replay 2 of the 8 (duplicate) alongside 6 brand-new records ----
# concurrently — proving idempotency and fresh-write handling both hold under
# contention, not only sequentially.
WAVE2_OUT_DIR="$HELPERS_DIR/wave2-out"
mkdir -p "$WAVE2_OUT_DIR"

i=1
while [ "$i" -le 2 ]; do
  f="$(conc_record_file "$i")"
  (run_driver write "$f" > "$WAVE2_OUT_DIR/replay$i.out" 2>&1) &
  i=$((i + 1))
done
j=1
while [ "$j" -le 6 ]; do
  nf="$HELPERS_DIR/conc-new-$j.json"
  MR_CLI="$CONC_CLI" MR_SESSION="conc-new-session-$j" MR_IDEMKEY="conc-new-key-$j" MR_REQUEST_INSTANT="$CONC_INSTANT" \
    run_driver make-record > "$nf"
  (run_driver write "$nf" > "$WAVE2_OUT_DIR/new$j.out" 2>&1) &
  j=$((j + 1))
done
wait

wave2_dup=0
i=1
while [ "$i" -le 2 ]; do
  grep -qF 'STATUS=duplicate' "$WAVE2_OUT_DIR/replay$i.out" && wave2_dup=$((wave2_dup + 1))
  i=$((i + 1))
done
wave2_stored=0
j=1
while [ "$j" -le 6 ]; do
  grep -qF 'STATUS=stored' "$WAVE2_OUT_DIR/new$j.out" && wave2_stored=$((wave2_stored + 1))
  j=$((j + 1))
done
if [ "$wave2_dup" -eq 2 ]; then ok "wave 2: exactly 2 duplicate outcomes on replay"; else bad "wave 2: expected 2 duplicate, got $wave2_dup" "$(cat "$WAVE2_OUT_DIR"/replay*.out)"; fi
if [ "$wave2_stored" -eq 6 ]; then ok "wave 2: exactly 6 stored outcomes for the new records"; else bad "wave 2: expected 6 stored, got $wave2_stored" "$(cat "$WAVE2_OUT_DIR"/new*.out)"; fi

entry_count2="$(find "$conc_partition" -maxdepth 1 -type f -name '*.json' ! -name '*.wing.json' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$entry_count2" -eq 14 ]; then
  ok "partition holds exactly 14 entries after wave 2 (8 + 6 new, 2 replays added nothing)"
else
  bad "partition holds $entry_count2 entries after wave 2, expected 14"
fi

# --- (g) the no-MemPalace gate: no token file -> mirror/ never created -----
echo
echo "=== (g) no-MemPalace gate + backoff ==="

# A usage-mirror.sh stub on PATH that touches a sentinel the gate must never
# trigger while no token file exists.
STUB_BIN_DIR="$HELPERS_DIR/stub-bin"
mkdir -p "$STUB_BIN_DIR"
SENTINEL="$HELPERS_DIR/mirror-spawned.sentinel"
rm -f "$SENTINEL"
cat > "$STUB_BIN_DIR/bash" <<STUB_EOF
#!/bin/sh
# stub 'bash' — only intercepts a usage-mirror.sh invocation; anything else
# is forwarded to the real bash so the rest of the driver keeps working.
case "\$*" in
  *usage-mirror.sh*) touch "$SENTINEL" ;;
  *) exec /bin/bash "\$@" ;;
esac
STUB_EOF
chmod +x "$STUB_BIN_DIR/bash"

GATE_FILE="$HELPERS_DIR/gate-record.json"
MR_CLI=claude-code MR_SESSION="gate-session-1" MR_IDEMKEY="gate-key-1" run_driver make-record > "$GATE_FILE"
PATH="$STUB_BIN_DIR:$PATH" CREWRIG_USAGE_MIRROR='' run_driver write "$GATE_FILE" >/dev/null

if [ -d "$USAGE_ROOT/mirror" ]; then
  bad "mirror/ was created even though no token file exists"
else
  ok "mirror/ is never created while no token file exists"
fi
if [ -f "$SENTINEL" ]; then
  bad "usage-mirror.sh was spawned even though no token file exists"
else
  ok "no usage-mirror.sh spawn while no token file exists"
fi

# Now create the token file at the derived path: the next write must create
# exactly one pending marker (and, per (ii), no spawn while an unreachable
# stamp is still fresh — CREWRIG_USAGE_MIRROR=0 stays the gate we rely on for
# "no spawn" from here on, since this suite must never touch a real daemon).
TOKEN_PATH="$(run_driver token-path)"
register_real_home_dir_for_cleanup "$(dirname "$TOKEN_PATH")"
mkdir -p "$(dirname "$TOKEN_PATH")"
printf 'test-token-value\n' > "$TOKEN_PATH"

GATE_FILE2="$HELPERS_DIR/gate-record-2.json"
MR_CLI=claude-code MR_SESSION="gate-session-2" MR_IDEMKEY="gate-key-2" run_driver make-record > "$GATE_FILE2"
GATE2_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$GATE_FILE2")"
GATE2_PERIOD="$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const d=new Date(r.timing.requestInstant); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))" "$GATE_FILE2")"
run_driver write "$GATE_FILE2" >/dev/null

PENDING_MARKER="$(pending_marker_path claude-code "$GATE2_PERIOD" "$GATE2_RID")"
if [ -f "$PENDING_MARKER" ]; then
  ok "with a token file present, a write creates exactly one pending marker"
else
  bad "no pending marker was created despite a token file being present ($PENDING_MARKER)"
fi
pending_count="$(find "$USAGE_ROOT/mirror/pending" -type f 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$pending_count" -eq 1 ]; then
  ok "exactly one pending marker exists (CREWRIG_USAGE_MIRROR=0 suppressed the spawn)"
else
  bad "expected exactly 1 pending marker, found $pending_count"
fi
mirrored_count="$(find "$USAGE_ROOT/mirror/mirrored" -type f 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$mirrored_count" -eq 0 ]; then
  ok "no mirrored/ marker exists — CREWRIG_USAGE_MIRROR=0 prevented any real daemon contact"
else
  bad "a mirrored/ marker exists — this suite must never talk to a real daemon"
fi

# --- (h) token-path parity: Node tokenPath() === bash mcp_token_path -------
echo
echo "=== (h) token-path parity (mcp.js vs common.sh) ==="
NODE_TOKEN_PATH="$(run_driver token-path)"
BASH_TOKEN_PATH="$(bash -c ". '$REPO_DIR/scripts/lib/common.sh'; mcp_token_path")"
if [ "$NODE_TOKEN_PATH" = "$BASH_TOKEN_PATH" ]; then
  ok "tokenPath() matches mcp_token_path (existing MEMPALACE_PALACE_PATH)"
else
  bad "tokenPath() diverges from mcp_token_path" "node: $NODE_TOKEN_PATH
bash: $BASH_TOKEN_PATH"
fi

FRESH_PALACE_PARENT="$(mktemp -d)"
FRESH_PALACE="$FRESH_PALACE_PARENT/does-not-exist-yet"
NODE_TOKEN_PATH2="$(MEMPALACE_PALACE_PATH="$FRESH_PALACE" run_driver token-path)"
BASH_TOKEN_PATH2="$(MEMPALACE_PALACE_PATH="$FRESH_PALACE" bash -c ". '$REPO_DIR/scripts/lib/common.sh'; mcp_token_path")"
if [ "$NODE_TOKEN_PATH2" = "$BASH_TOKEN_PATH2" ]; then
  ok "tokenPath() matches mcp_token_path (not-yet-existing MEMPALACE_PALACE_PATH)"
else
  bad "tokenPath() diverges from mcp_token_path for a not-yet-existing palace path" "node: $NODE_TOKEN_PATH2
bash: $BASH_TOKEN_PATH2"
fi
rm -rf "$FRESH_PALACE_PARENT"

# --- (g continued) backoff: a fresh unreachable.stamp suppresses the spawn, -
#     a stale one does not. Never touches a real daemon: the PATH-shadowing
#     'bash' stub intercepts usage-mirror.sh before its real body ever runs.
echo
echo "=== (g) backoff: fresh stamp suppresses the spawn, stale stamp allows it ==="

wait_for_file() {
  # $1 = path, $2 = timeout in tenths of a second
  local path="$1" tries="$2" n=0
  while [ "$n" -lt "$tries" ]; do
    [ -f "$path" ] && return 0
    sleep 0.1
    n=$((n + 1))
  done
  [ -f "$path" ]
}

UNREACHABLE_STAMP="$USAGE_ROOT/mirror/unreachable.stamp"
mkdir -p "$USAGE_ROOT/mirror"
: > "$UNREACHABLE_STAMP"

BACKOFF_FILE1="$HELPERS_DIR/backoff-record-1.json"
MR_CLI=claude-code MR_SESSION="backoff-session-1" MR_IDEMKEY="backoff-key-1" run_driver make-record > "$BACKOFF_FILE1"
rm -f "$SENTINEL"
PATH="$STUB_BIN_DIR:$PATH" CREWRIG_USAGE_MIRROR=1 run_driver write "$BACKOFF_FILE1" >/dev/null
if wait_for_file "$SENTINEL" 5; then
  bad "a fresh unreachable.stamp did NOT suppress the spawn"
else
  ok "a fresh unreachable.stamp suppresses the spawn"
fi

run_driver backdate "$UNREACHABLE_STAMP" 900000 >/dev/null # 15 min, past the 10 min default backoff

BACKOFF_FILE2="$HELPERS_DIR/backoff-record-2.json"
MR_CLI=claude-code MR_SESSION="backoff-session-2" MR_IDEMKEY="backoff-key-2" run_driver make-record > "$BACKOFF_FILE2"
rm -f "$SENTINEL"
PATH="$STUB_BIN_DIR:$PATH" CREWRIG_USAGE_MIRROR=1 run_driver write "$BACKOFF_FILE2" >/dev/null
if wait_for_file "$SENTINEL" 30; then
  ok "a stale unreachable.stamp allows the spawn"
else
  bad "a stale (back-dated) unreachable.stamp still suppressed the spawn"
fi
rm -f "$UNREACHABLE_STAMP" "$SENTINEL"

# --- (i) wing derivation: a synthetic git repo + linked worktree ------------
# (PLAN v3 step 10(iii)) — hermetic, never the real crewrig checkout, so this
# suite carries no machine-specific path (check-no-machine-paths.sh).
echo
echo "=== (i) wing derivation (resolveWing(), edit 6's memoization narrowing) ==="

SYN_REPO="$SYN_PARENT/synrepo"
mkdir -p "$SYN_REPO"
git init -q "$SYN_REPO"
git -C "$SYN_REPO" config user.email test@example.com
git -C "$SYN_REPO" config user.name "Test"
echo x > "$SYN_REPO/README.md"
git -C "$SYN_REPO" add .
git -C "$SYN_REPO" commit -q -m init
SYN_REPO_BASENAME="$(basename "$SYN_REPO")"

LINKED_WORKTREE="$SYN_REPO/.worktrees/linked-worktree"
git -C "$SYN_REPO" worktree add -q "$LINKED_WORKTREE" -b linked-branch >/dev/null

CACHE_WINGS_DIR="$USAGE_ROOT/cache/wings"
cache_count() { find "$CACHE_WINGS_DIR" -type f 2>/dev/null | wc -l | tr -d ' ' || true; }

# 1. Live checkout, repo root -> git-common-dir.
out="$(run_driver resolve-wing "$SYN_REPO")"
if grep -qF "WING=$SYN_REPO_BASENAME" <<< "$out" && grep -qF "DERIVATION=git-common-dir" <<< "$out"; then
  ok "repo root resolves to git-common-dir with wing=$SYN_REPO_BASENAME"
else
  bad "repo root did not resolve to git-common-dir/$SYN_REPO_BASENAME" "$out"
fi
count_after_root="$(cache_count)"
if [ "$count_after_root" -eq 1 ]; then
  ok "the on-disk wing memo now holds exactly 1 file (repo root)"
else
  bad "expected exactly 1 memo file after the repo-root derivation, found $count_after_root"
fi

# 2. A subdirectory of the same repo -> same wing, git-common-dir, a SECOND
#    (distinct-key) memo file.
SUBDIR="$SYN_REPO/some/nested/subdir"
mkdir -p "$SUBDIR"
out="$(run_driver resolve-wing "$SUBDIR")"
if grep -qF "WING=$SYN_REPO_BASENAME" <<< "$out" && grep -qF "DERIVATION=git-common-dir" <<< "$out"; then
  ok "a subdirectory of the repo resolves to the same wing via git-common-dir"
else
  bad "subdirectory did not resolve to git-common-dir/$SYN_REPO_BASENAME" "$out"
fi
count_after_subdir="$(cache_count)"
if [ "$count_after_subdir" -eq 2 ]; then
  ok "a distinct projectRoot key adds a second memo file (2 total)"
else
  bad "expected exactly 2 memo files after the subdirectory derivation, found $count_after_subdir"
fi

# 3. The linked worktree, while it exists -> same wing via git-common-dir too
#    (a THIRD distinct-key memo, since its own path differs from #1 and #2).
out="$(run_driver resolve-wing "$LINKED_WORKTREE")"
if grep -qF "WING=$SYN_REPO_BASENAME" <<< "$out" && grep -qF "DERIVATION=git-common-dir" <<< "$out"; then
  ok "the live linked worktree resolves to the same wing via git-common-dir"
else
  bad "the live linked worktree did not resolve via git-common-dir" "$out"
fi
count_after_worktree="$(cache_count)"
if [ "$count_after_worktree" -eq 3 ]; then
  ok "a third distinct projectRoot key adds a third memo file (3 total)"
else
  bad "expected exactly 3 memo files after the live-worktree derivation, found $count_after_worktree"
fi

# 4. Remove the linked worktree's directory (simulating a merged ticket's
#    .worktrees/<ticket>/ being deleted) -> git-common-dir-ancestor, same
#    wing, and NO new memo file (only git-common-dir memoizes — named edit 6).
rm -rf "$LINKED_WORKTREE"
REMOVED_SUBPATH="$LINKED_WORKTREE/sub/dir"
out="$(run_driver resolve-wing "$REMOVED_SUBPATH")"
if grep -qF "WING=$SYN_REPO_BASENAME" <<< "$out" && grep -qF "DERIVATION=git-common-dir-ancestor" <<< "$out"; then
  ok "a removed in-repo path resolves via git-common-dir-ancestor to the same wing"
else
  bad "removed in-repo path did not resolve via git-common-dir-ancestor" "$out"
fi
count_after_ancestor="$(cache_count)"
if [ "$count_after_ancestor" -eq 3 ]; then
  ok "git-common-dir-ancestor does NOT write a memo file (still 3)"
else
  bad "expected memo count to stay at 3 after the ancestor derivation, found $count_after_ancestor"
fi

# 5. projectRoot 'unknown' with cwd inside the repo -> process-cwd, same wing,
#    no memo.
out="$(cd "$SYN_REPO" && node --disable-warning=ExperimentalWarning "$DRIVER" resolve-wing "unknown")"
if grep -qF "WING=$SYN_REPO_BASENAME" <<< "$out" && grep -qF "DERIVATION=process-cwd" <<< "$out"; then
  ok "'unknown' with cwd inside the repo resolves via process-cwd to the same wing"
else
  bad "'unknown' with cwd inside the repo did not resolve via process-cwd" "$out"
fi

# 6. projectRoot 'unknown' with cwd OUTSIDE any git tree -> unknown-residual,
#    literal wing 'unknown', no memo.
NONGIT_CWD="$(mktemp -d)"
out="$(cd "$NONGIT_CWD" && node --disable-warning=ExperimentalWarning "$DRIVER" resolve-wing "unknown")"
if grep -qF "WING=unknown" <<< "$out" && grep -qF "DERIVATION=unknown-residual" <<< "$out"; then
  ok "'unknown' with a non-repository cwd resolves to the literal wing 'unknown' (unknown-residual)"
else
  bad "'unknown' with a non-repository cwd did not resolve to unknown-residual" "$out"
fi
rmdir "$NONGIT_CWD" 2>/dev/null || true

# 7. A /tmp-rooted nonexistent path -> basename-fallback (of the ORIGINAL
#    path, not the ancestor).
NONEXISTENT_TMP="/tmp/crewrig-usage-storage-test-nonexistent-$$/nested"
out="$(run_driver resolve-wing "$NONEXISTENT_TMP")"
if grep -qF "WING=nested" <<< "$out" && grep -qF "DERIVATION=basename-fallback" <<< "$out"; then
  ok "a nonexistent /tmp-rooted path resolves to basename-fallback (wing=nested)"
else
  bad "nonexistent /tmp-rooted path did not resolve to basename-fallback/nested" "$out"
fi

# 8. CREWRIG_USAGE_WING wins everywhere, including inside the synthetic repo.
out="$(CREWRIG_USAGE_WING=override-wing run_driver resolve-wing "$SYN_REPO")"
if grep -qF "WING=override-wing" <<< "$out" && grep -qF "DERIVATION=env-override" <<< "$out"; then
  ok "CREWRIG_USAGE_WING overrides the repo-root derivation"
else
  bad "CREWRIG_USAGE_WING did not override the repo-root derivation" "$out"
fi
count_after_override="$(cache_count)"
if [ "$count_after_override" -eq 3 ]; then
  ok "env-override does NOT write a memo file (still 3)"
else
  bad "expected memo count to stay at 3 after env-override, found $count_after_override"
fi

# --- (j) sidecar repair (named edit 3): missing -> re-derived and written; --
#     truncated -> treated as missing, repaired via rename(2), never a
#     linkSync EEXIST failure.
echo
echo "=== (j) sidecar repair: missing and truncated sidecars ==="
REPAIR_CLI=claude-code
# Reuse the claude-code.json sample entry written back in case (a).
REPAIR_SAMPLE="$REPO_DIR/schemas/usage-record/samples/claude-code.json"
REPAIR_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$REPAIR_SAMPLE")"
read -r REPAIR_INSTANT_YEAR_MONTH <<< "$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const d=new Date(r.timing.requestInstant); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))" "$REPAIR_SAMPLE")"
REPAIR_ENTRY_PATH="$(journal_entry_path "$REPAIR_CLI" "$REPAIR_INSTANT_YEAR_MONTH" "$REPAIR_RID")"
REPAIR_SIDECAR_PATH="$(wing_sidecar_path "$REPAIR_CLI" "$REPAIR_INSTANT_YEAR_MONTH" "$REPAIR_RID")"

if [ ! -f "$REPAIR_ENTRY_PATH" ]; then
  bad "setup: expected an existing journal entry at $REPAIR_ENTRY_PATH from case (a)"
else
  EXPECTED_WING_OUT="$(run_driver resolve-wing "/home/agent/workspaces/crewrig")"
  EXPECTED_WING="$(grep -oE 'WING=.*' <<< "$EXPECTED_WING_OUT" | cut -d= -f2)"

  # Missing sidecar -> re-derived once and written.
  rm -f "$REPAIR_SIDECAR_PATH"
  repair_out="$(run_driver repair-sidecar "$REPAIR_CLI" "$REPAIR_INSTANT_YEAR_MONTH" "$REPAIR_RID" "$REPAIR_ENTRY_PATH")"
  if [ -f "$REPAIR_SIDECAR_PATH" ]; then
    ok "a missing sidecar is re-derived and written by the repair path"
  else
    bad "the repair path did NOT (re)create a missing sidecar"
  fi
  if grep -qF "WING=$EXPECTED_WING" <<< "$repair_out"; then
    ok "the repaired sidecar names the correct wing"
  else
    bad "the repaired sidecar names the wrong wing" "$repair_out (expected WING=$EXPECTED_WING)"
  fi
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$REPAIR_SIDECAR_PATH" 2>/dev/null; then
    ok "the repaired (previously missing) sidecar parses as whole JSON"
  else
    bad "the repaired sidecar does not parse as JSON"
  fi

  # Truncated sidecar -> treated as missing, repaired via rename(2), not a
  # linkSync EEXIST failure (the property named edit 3 exists to fix).
  full_size="$(node -e "console.log(require('fs').statSync(process.argv[1]).size)" "$REPAIR_SIDECAR_PATH")"
  half_size=$((full_size / 2))
  node -e "
    const fs = require('fs');
    const buf = fs.readFileSync(process.argv[1]);
    fs.writeFileSync(process.argv[1], buf.subarray(0, Number(process.argv[2])));
  " "$REPAIR_SIDECAR_PATH" "$half_size"
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$REPAIR_SIDECAR_PATH" 2>/dev/null; then
    bad "setup: the truncated sidecar unexpectedly still parses as JSON"
  else
    ok "setup: the sidecar is now torn (does not parse) — a real truncation"
  fi

  repair_out2="$(run_driver repair-sidecar "$REPAIR_CLI" "$REPAIR_INSTANT_YEAR_MONTH" "$REPAIR_RID" "$REPAIR_ENTRY_PATH")"
  if grep -qF "WING=$EXPECTED_WING" <<< "$repair_out2"; then
    ok "a truncated sidecar is treated as missing and re-derives the correct wing"
  else
    bad "a truncated sidecar did not re-derive the correct wing" "$repair_out2"
  fi
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$REPAIR_SIDECAR_PATH" 2>/dev/null; then
    ok "the truncated sidecar is rewritten whole and now parses cleanly"
  else
    bad "the sidecar still does not parse after repair — the torn file was not replaced"
  fi
fi

# --- (k) drain: spooled records, spool/ dotfile strays, tmp/ staleness -----
echo
echo "=== (k) drain and sweep ==="
SPOOL_DIR="$USAGE_ROOT/spool"
TMP_DIR="$USAGE_ROOT/tmp"
mkdir -p "$SPOOL_DIR" "$TMP_DIR"

DRAIN_INSTANT="2023-02-01T00:00:00.000Z"

drain_record_id() {
  MR_CLI=gemini-cli MR_SESSION="$1" MR_IDEMKEY="$2" MR_REQUEST_INSTANT="$DRAIN_INSTANT" run_driver make-record \
    > "$HELPERS_DIR/drain-$1.json"
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$HELPERS_DIR/drain-$1.json"
}

SPOOL_RID_1="$(drain_record_id drain-a drain-key-a)"
cp "$HELPERS_DIR/drain-drain-a.json" "$SPOOL_DIR/$SPOOL_RID_1.json"
SPOOL_RID_2="$(drain_record_id drain-b drain-key-b)"
cp "$HELPERS_DIR/drain-drain-b.json" "$SPOOL_DIR/$SPOOL_RID_2.json"

# A spooled record that fails schema validation: the filename only needs to
# match layout.isEntry()'s 64-hex shape, not its own (invalid) content.
INVALID_SPOOL_NAME="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
cp "$SCRIPT_DIR/tests/fixtures/usage-records/mutants/missing-fidelity.json" "$SPOOL_DIR/$INVALID_SPOOL_NAME.json"

# A stale tmp/ file (mtime - 2h) the sweep must reclaim.
STALE_TMP_FILE="$TMP_DIR/stale-temp-file.tmp"
echo x > "$STALE_TMP_FILE"
run_driver backdate "$STALE_TMP_FILE" 7200000 >/dev/null

# A stale spool/ dotfile stray (0206's own temp naming) the sweep must
# reclaim, and a FRESH one it must leave alone (age-gated, not blanket).
STALE_STRAY_HEX="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
STALE_STRAY="$SPOOL_DIR/.$STALE_STRAY_HEX.12345.999999999.tmp"
echo x > "$STALE_STRAY"
run_driver backdate "$STALE_STRAY" 7200000 >/dev/null

FRESH_STRAY_HEX="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
FRESH_STRAY="$SPOOL_DIR/.$FRESH_STRAY_HEX.12345.999999999.tmp"
echo x > "$FRESH_STRAY"

# The triggering write — any fresh record; drainAndSweep() runs once per
# process, before this process's own write.
DRAIN_TRIGGER_FILE="$HELPERS_DIR/drain-trigger.json"
MR_CLI=gemini-cli MR_SESSION="drain-trigger" MR_IDEMKEY="drain-trigger-key" MR_REQUEST_INSTANT="$DRAIN_INSTANT" \
  run_driver make-record > "$DRAIN_TRIGGER_FILE"
run_driver write "$DRAIN_TRIGGER_FILE" >/dev/null

DRAIN_ENTRY_1="$(journal_entry_path gemini-cli 2023-02 "$SPOOL_RID_1")"
DRAIN_ENTRY_2="$(journal_entry_path gemini-cli 2023-02 "$SPOOL_RID_2")"
DRAIN_SIDECAR_1="$(wing_sidecar_path gemini-cli 2023-02 "$SPOOL_RID_1")"
DRAIN_SIDECAR_2="$(wing_sidecar_path gemini-cli 2023-02 "$SPOOL_RID_2")"

if [ -f "$DRAIN_ENTRY_1" ] && [ -f "$DRAIN_ENTRY_2" ]; then
  ok "both spooled records are drained into the journal"
else
  bad "one or both spooled records were NOT drained into the journal"
fi
if [ -f "$DRAIN_SIDECAR_1" ] && [ -f "$DRAIN_SIDECAR_2" ]; then
  ok "both drained records have a sidecar"
else
  bad "one or both drained records are missing a sidecar"
fi
if [ ! -f "$SPOOL_DIR/$SPOOL_RID_1.json" ] && [ ! -f "$SPOOL_DIR/$SPOOL_RID_2.json" ]; then
  ok "both drained spool files are gone"
else
  bad "a drained spool file is still present under spool/"
fi
if [ -f "$SPOOL_DIR/$INVALID_SPOOL_NAME.json" ]; then
  ok "the schema-invalid spooled record is left in place (destroying the only copy is never acceptable)"
else
  bad "the schema-invalid spooled record was removed — a rejected spooled record must never be destroyed"
fi
if [ -f "$STALE_TMP_FILE" ]; then
  bad "the stale tmp/ file was NOT swept"
else
  ok "the stale tmp/ file is swept"
fi
if [ -f "$STALE_STRAY" ]; then
  bad "the stale spool/ dotfile stray was NOT swept"
else
  ok "the stale spool/ dotfile stray is swept"
fi
if [ -f "$FRESH_STRAY" ]; then
  ok "a FRESH spool/ dotfile stray is left alone (age-gated, not a blanket sweep)"
else
  bad "a fresh spool/ dotfile stray was swept — the age gate is not being honoured"
fi
rm -f "$FRESH_STRAY"

undrained_out="$(bash "$REPO_DIR/scripts/usage-query.sh" --undrained)"
if grep -qF "$INVALID_SPOOL_NAME" <<< "$undrained_out" && grep -qF 'spooled-record' <<< "$undrained_out"; then
  ok "--undrained lists the rejected spooled record, classed distinctly"
else
  bad "--undrained did not list the rejected spooled record" "$undrained_out"
fi
rm -f "$SPOOL_DIR/$INVALID_SPOOL_NAME.json"

# --- (k continued) drain budget bounds one call; the remainder drains on ---
#     the NEXT write.
echo
echo "=== (k) drain budget bounds one call, the remainder drains next time ==="
BUDGET_RIDS_FILE="$HELPERS_DIR/budget-rids.txt"
: > "$BUDGET_RIDS_FILE"
i=1
while [ "$i" -le 5 ]; do
  rid="$(drain_record_id "budget-$i" "budget-key-$i")"
  cp "$HELPERS_DIR/drain-budget-$i.json" "$SPOOL_DIR/$rid.json"
  echo "$rid" >> "$BUDGET_RIDS_FILE"
  i=$((i + 1))
done

BUDGET_TRIGGER_1="$HELPERS_DIR/budget-trigger-1.json"
MR_CLI=gemini-cli MR_SESSION="budget-trigger-1" MR_IDEMKEY="budget-trigger-key-1" MR_REQUEST_INSTANT="$DRAIN_INSTANT" \
  run_driver make-record > "$BUDGET_TRIGGER_1"
CREWRIG_USAGE_DRAIN_BUDGET_MS=1 run_driver write "$BUDGET_TRIGGER_1" >/dev/null

remaining_after_budget="$(find "$SPOOL_DIR" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$remaining_after_budget" -gt 0 ]; then
  ok "a 1ms drain budget leaves records undrained for the next write ($remaining_after_budget remaining)"
else
  bad "a 1ms drain budget somehow drained all 5 records in one call — the budget is not bounding anything"
fi

BUDGET_TRIGGER_2="$HELPERS_DIR/budget-trigger-2.json"
MR_CLI=gemini-cli MR_SESSION="budget-trigger-2" MR_IDEMKEY="budget-trigger-key-2" MR_REQUEST_INSTANT="$DRAIN_INSTANT" \
  run_driver make-record > "$BUDGET_TRIGGER_2"
run_driver write "$BUDGET_TRIGGER_2" >/dev/null # unbounded (default 2000ms is plenty for 5 tiny records)

remaining_after_second="$(find "$SPOOL_DIR" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [ "$remaining_after_second" -eq 0 ]; then
  ok "the remainder is fully drained by the next write"
else
  bad "$remaining_after_second spooled record(s) still undrained after the second write"
fi

all_budget_present=1
while IFS= read -r rid; do
  [ -f "$(journal_entry_path gemini-cli 2023-02 "$rid")" ] || all_budget_present=0
done < "$BUDGET_RIDS_FILE"
if [ "$all_budget_present" -eq 1 ]; then
  ok "all 5 budget-seeded records eventually reached the journal"
else
  bad "at least one budget-seeded record never reached the journal"
fi

# spool/ removal is best-effort: once truly empty, it should be gone.
if [ -d "$SPOOL_DIR" ]; then
  bad "spool/ still exists after becoming empty (rmdir best-effort should have removed it)"
else
  ok "spool/ is removed (best-effort rmdir) once empty"
fi

# --- (l) drain lock: released after a normal drain, reclaimed when stale, ---
#     never blocks the process's OWN write when a live peer holds it (R4).
echo
echo "=== (l) drain lock: release, stale reclaim, live-peer skip ==="
DRAIN_LOCK="$(drain_lock_path)"
mkdir -p "$SPOOL_DIR"

LIVE_PEER_RID="$(drain_record_id lock-live lock-live-key)"
cp "$HELPERS_DIR/drain-lock-live.json" "$SPOOL_DIR/$LIVE_PEER_RID.json"

mkdir -p "$(dirname "$DRAIN_LOCK")"
: > "$DRAIN_LOCK" # fresh mtime — simulates a live peer holding the lock

LOCK_TEST_FILE_1="$HELPERS_DIR/lock-test-1.json"
MR_CLI=gemini-cli MR_SESSION="lock-test-1" MR_IDEMKEY="lock-test-key-1" MR_REQUEST_INSTANT="$DRAIN_INSTANT" \
  run_driver make-record > "$LOCK_TEST_FILE_1"
lock_out1="$(run_driver write "$LOCK_TEST_FILE_1")"
if grep -qF 'STATUS=stored' <<< "$lock_out1"; then
  ok "a write proceeds and completes even while a live peer holds locks/drain.lock (R4: never blocked)"
else
  bad "a write was blocked by a live peer holding locks/drain.lock" "$lock_out1"
fi
if [ -f "$SPOOL_DIR/$LIVE_PEER_RID.json" ]; then
  ok "the spooled record is left untouched — the drain was skipped, not attempted"
else
  bad "the spooled record was drained despite a live peer holding the lock"
fi
if [ -f "$DRAIN_LOCK" ]; then
  ok "the live peer's lock file is left in place (this process never touched it)"
else
  bad "locks/drain.lock disappeared even though this process should have skipped it entirely"
fi

# Back-date the lock past the stale threshold: the next write reclaims it,
# runs the drain, and releases the lock afterward.
run_driver backdate "$DRAIN_LOCK" 1200000 >/dev/null # 20 min, past the 15 min default

LOCK_TEST_FILE_2="$HELPERS_DIR/lock-test-2.json"
MR_CLI=gemini-cli MR_SESSION="lock-test-2" MR_IDEMKEY="lock-test-key-2" MR_REQUEST_INSTANT="$DRAIN_INSTANT" \
  run_driver make-record > "$LOCK_TEST_FILE_2"
lock_out2="$(run_driver write "$LOCK_TEST_FILE_2")"
if grep -qF 'STATUS=stored' <<< "$lock_out2"; then
  ok "the write after a reclaimed stale lock still completes"
else
  bad "the write after reclaiming a stale lock did not complete" "$lock_out2"
fi
if [ -f "$SPOOL_DIR/$LIVE_PEER_RID.json" ]; then
  bad "the spooled record was NOT drained after the stale lock was reclaimed"
else
  ok "a stale lock is reclaimed and the drain runs"
fi
if [ -f "$DRAIN_LOCK" ]; then
  bad "locks/drain.lock is still present after a normal drain — it must be released"
else
  ok "locks/drain.lock is released after the drain completes"
fi

# --- (m) prune: refuses the current period, removes a closed one with no ---
#     daemon contact (pending-only markers), gates re-writes, --unprune
#     restores writability only.
echo
echo "=== (m) prune / unprune ==="

read -r PRUNE_CURRENT_INSTANT PRUNE_CURRENT_PERIOD <<< "$(node -e "
const d = new Date();
console.log(d.toISOString() + ' ' + d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0'));
")"
read -r PRUNE_CLOSED_INSTANT PRUNE_CLOSED_PERIOD <<< "$(node -e "
const d = new Date();
d.setUTCMonth(d.getUTCMonth() - 13);
console.log(d.toISOString() + ' ' + d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0'));
")"

# The current period refuses without --force, and proceeds with it.
CURRENT_FILE="$HELPERS_DIR/prune-current.json"
MR_CLI=claude-code MR_SESSION="prune-current-session" MR_IDEMKEY="prune-current-key" \
  MR_REQUEST_INSTANT="$PRUNE_CURRENT_INSTANT" run_driver make-record > "$CURRENT_FILE"
CURRENT_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$CURRENT_FILE")"
run_driver write "$CURRENT_FILE" >/dev/null
CURRENT_ENTRY="$(journal_entry_path claude-code "$PRUNE_CURRENT_PERIOD" "$CURRENT_RID")"

if bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$PRUNE_CURRENT_PERIOD" >/dev/null 2>&1; then
  bad "pruning the current period without --force should have been refused"
else
  ok "pruning the current period without --force is refused"
fi
if [ -f "$CURRENT_ENTRY" ]; then
  ok "the current period's entry survives the refused prune"
else
  bad "the current period's entry was removed despite the refusal"
fi
if bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$PRUNE_CURRENT_PERIOD" --force >/dev/null 2>&1; then
  ok "--force allows pruning the current period"
else
  bad "--force did not allow pruning the current period"
fi
if [ -f "$CURRENT_ENTRY" ]; then
  bad "the current period's entry survived a --force prune"
else
  ok "the current period's entry is removed by the --force prune"
fi

# A closed period holding pending-only markers: prune removes entries,
# sidecars and markers with NO daemon contact (this suite's token file
# exists since case (g), CREWRIG_USAGE_MIRROR=0 keeps every marker in
# pending/ forever, so a successful prune here proves R8/R19's "no daemon
# needed for a pending-only period" without ever dialing a real daemon).
PRUNE_FILE_1="$HELPERS_DIR/prune-closed-1.json"
MR_CLI=claude-code MR_SESSION="prune-closed-session-1" MR_IDEMKEY="prune-closed-key-1" \
  MR_REQUEST_INSTANT="$PRUNE_CLOSED_INSTANT" run_driver make-record > "$PRUNE_FILE_1"
PRUNE_RID_1="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$PRUNE_FILE_1")"
run_driver write "$PRUNE_FILE_1" >/dev/null

PRUNE_FILE_2="$HELPERS_DIR/prune-closed-2.json"
MR_CLI=claude-code MR_SESSION="prune-closed-session-2" MR_IDEMKEY="prune-closed-key-2" \
  MR_REQUEST_INSTANT="$PRUNE_CLOSED_INSTANT" run_driver make-record > "$PRUNE_FILE_2"
PRUNE_RID_2="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$PRUNE_FILE_2")"
run_driver write "$PRUNE_FILE_2" >/dev/null

PRUNE_ENTRY_1="$(journal_entry_path claude-code "$PRUNE_CLOSED_PERIOD" "$PRUNE_RID_1")"
PRUNE_ENTRY_2="$(journal_entry_path claude-code "$PRUNE_CLOSED_PERIOD" "$PRUNE_RID_2")"
PRUNE_SIDECAR_1="$(wing_sidecar_path claude-code "$PRUNE_CLOSED_PERIOD" "$PRUNE_RID_1")"
PRUNE_MARKER_1="$(pending_marker_path claude-code "$PRUNE_CLOSED_PERIOD" "$PRUNE_RID_1")"
PRUNE_MARKER_2="$(pending_marker_path claude-code "$PRUNE_CLOSED_PERIOD" "$PRUNE_RID_2")"

if [ -f "$PRUNE_ENTRY_1" ] && [ -f "$PRUNE_ENTRY_2" ] && [ -f "$PRUNE_MARKER_1" ] && [ -f "$PRUNE_MARKER_2" ]; then
  ok "setup: the closed period holds 2 entries with pending-only markers"
else
  bad "setup: expected 2 entries with pending markers before pruning"
fi

if bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$PRUNE_CLOSED_PERIOD" >/dev/null 2>&1; then
  ok "pruning a closed, pending-only period succeeds with no daemon contact"
else
  bad "pruning a closed, pending-only period unexpectedly failed"
fi
if [ ! -f "$PRUNE_ENTRY_1" ] && [ ! -f "$PRUNE_ENTRY_2" ]; then
  ok "both entries are removed by the prune"
else
  bad "an entry survived the prune"
fi
if [ ! -f "$PRUNE_SIDECAR_1" ]; then
  ok "the sidecar is removed with its entry"
else
  bad "a sidecar survived the prune"
fi
if [ ! -f "$PRUNE_MARKER_1" ] && [ ! -f "$PRUNE_MARKER_2" ]; then
  ok "both pending markers are removed by the prune"
else
  bad "a pending marker survived the prune"
fi
PRUNED_MARKER_FILE="$(pruned_marker_path claude-code "$PRUNE_CLOSED_PERIOD")"
if [ -f "$PRUNED_MARKER_FILE" ]; then
  ok "the pruned-period marker is written"
else
  bad "no pruned-period marker was written at $PRUNED_MARKER_FILE"
fi

# A subsequent write for the pruned period is rejected...
PRUNE_REWRITE="$HELPERS_DIR/prune-rewrite.json"
MR_CLI=claude-code MR_SESSION="prune-rewrite-session" MR_IDEMKEY="prune-rewrite-key" \
  MR_REQUEST_INSTANT="$PRUNE_CLOSED_INSTANT" run_driver make-record > "$PRUNE_REWRITE"
rewrite_out="$(run_driver write "$PRUNE_REWRITE")"
if grep -qF 'STATUS=rejected' <<< "$rewrite_out" && grep -qF 'REASON=period-pruned' <<< "$rewrite_out"; then
  ok "a write for the pruned period is rejected with reason period-pruned"
else
  bad "a write for the pruned period was NOT rejected as period-pruned" "$rewrite_out"
fi

# ...unless CREWRIG_USAGE_ALLOW_PRUNED=1 explicitly overrides the gate.
allow_out="$(CREWRIG_USAGE_ALLOW_PRUNED=1 run_driver write "$PRUNE_REWRITE")"
if grep -qF 'STATUS=stored' <<< "$allow_out"; then
  ok "CREWRIG_USAGE_ALLOW_PRUNED=1 overrides the period-pruned gate"
else
  bad "CREWRIG_USAGE_ALLOW_PRUNED=1 did NOT override the gate" "$allow_out"
fi

# --unprune restores writability only — it does not resurrect the deleted
# entries/sidecars/markers from before.
bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$PRUNE_CLOSED_PERIOD" --unprune >/dev/null 2>&1
if [ -f "$PRUNED_MARKER_FILE" ]; then
  bad "--unprune did not remove the pruned-period marker"
else
  ok "--unprune removes the pruned-period marker"
fi
if [ -f "$PRUNE_ENTRY_1" ]; then
  bad "--unprune resurrected a deleted entry — it must restore writability ONLY"
else
  ok "--unprune does not resurrect deleted entries"
fi

UNPRUNE_REWRITE="$HELPERS_DIR/unprune-rewrite.json"
MR_CLI=claude-code MR_SESSION="unprune-rewrite-session" MR_IDEMKEY="unprune-rewrite-key" \
  MR_REQUEST_INSTANT="$PRUNE_CLOSED_INSTANT" run_driver make-record > "$UNPRUNE_REWRITE"
unprune_write_out="$(run_driver write "$UNPRUNE_REWRITE")"
if grep -qF 'STATUS=stored' <<< "$unprune_write_out"; then
  ok "a plain write (no ALLOW_PRUNED) succeeds again after --unprune restores writability"
else
  bad "a plain write still fails after --unprune" "$unprune_write_out"
fi

# --- (o) node scripts/build-usage-validator.js --check ----------------------
echo
echo "=== (o) build-usage-validator.js --check: clean, then a named drift reason ==="
VALIDATE_JS="$REPO_DIR/scripts/lib/usage-store/validator/validate.js"

if (cd "$REPO_DIR" && node scripts/build-usage-validator.js --check >/dev/null 2>&1); then
  ok "--check exits 0 against the committed (unedited) validator output"
else
  bad "--check unexpectedly failed against the committed validator output"
fi

# Mutation: edit the committed validate.js in place (append a byte to its
# generator-notice header, which the drift diff — not the generator-version
# fast path — must catch), confirm --check goes red and NAMES a reason, then
# restore via `git checkout --`. Never left mutated past this block.
printf '\n// mutation-discipline probe — must never survive as drift-free\n' >> "$VALIDATE_JS"
set +e
check_out="$(cd "$REPO_DIR" && node scripts/build-usage-validator.js --check 2>&1)"; check_rc=$?
set -e
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/validator/validate.js

if [ "$check_rc" -ne 0 ]; then
  ok "MUTATION RED: --check exits non-zero against a deliberately edited validate.js"
else
  bad "MUTATION not red: --check still exited 0 against an edited validate.js" "$check_out"
fi
if grep -qF 'validate.js' <<< "$check_out" && grep -qiF 'drift' <<< "$check_out"; then
  ok "MUTATION RED: --check names validate.js and drift as the reason"
else
  bad "MUTATION RED but the reason does not name validate.js/drift" "$check_out"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/validator/validate.js; then
  ok "validate.js is restored to its committed content after the mutation probe"
else
  bad "validate.js was NOT fully restored after the mutation probe"
fi

# --- Mutation discipline: this suite's share of the brief's named mutations -
# Each edits a tracked module IN PLACE, proves the property goes red, then
# restores with `git checkout --` before the suite continues. Recorded in
# the logbook note alongside suite 2's three.
echo
echo "=== MUTATION: journal.write() skipping the sidecar link (e') ==="
JOURNAL_JS="$REPO_DIR/scripts/lib/usage-store/journal.js"

node -e "
const fs = require('fs');
const path = process.argv[1];
let src = fs.readFileSync(path, 'utf8');
const marker = \"const wingInfo = mirror.resolveWing(record.identity.projectRoot);\";
if (!src.includes(marker)) { console.error('FATAL: sidecar-link marker not found in journal.js'); process.exit(1); }
src = src.replace(marker, 'const wingInfo = mirror.resolveWing(record.identity.projectRoot); return { status };');
fs.writeFileSync(path, src);
" "$JOURNAL_JS"

MUTANT_SIDECAR_FILE="$HELPERS_DIR/mutant-sidecar-record.json"
# A cli/period no prune test above ever touched (claude-code's CURRENT
# period was --force-pruned in case (m); a fresh, untouched partition keeps
# this mutation's own property — the missing sidecar — the only variable.
MR_CLI=gemini-cli MR_SESSION="mutant-sidecar-session" MR_IDEMKEY="mutant-sidecar-key" \
  MR_REQUEST_INSTANT="2024-08-01T00:00:00.000Z" run_driver make-record > "$MUTANT_SIDECAR_FILE"
MUTANT_SIDECAR_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$MUTANT_SIDECAR_FILE")"
MUTANT_SIDECAR_PERIOD="$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const d=new Date(r.timing.requestInstant); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))" "$MUTANT_SIDECAR_FILE")"
mutant_out="$(run_driver write "$MUTANT_SIDECAR_FILE" 2>&1)"
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/journal.js

mutant_sidecar_path="$(wing_sidecar_path gemini-cli "$MUTANT_SIDECAR_PERIOD" "$MUTANT_SIDECAR_RID")"
if grep -qF 'STATUS=stored' <<< "$mutant_out" && [ ! -f "$mutant_sidecar_path" ]; then
  ok "MUTATION RED: skipping the sidecar link stores the entry with NO sidecar"
else
  bad "MUTATION not red: sidecar-skip mutation did not reproduce a missing sidecar" "$mutant_out"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/journal.js; then
  ok "journal.js is restored to its committed content after the mutation"
else
  bad "journal.js was NOT fully restored after the sidecar mutation"
fi

echo
echo "=== MUTATION: the no-MemPalace gate ignoring the token check ==="
MIRROR_JS="$REPO_DIR/scripts/lib/usage-store/mirror.js"

node -e "
const fs = require('fs');
const path = process.argv[1];
let src = fs.readFileSync(path, 'utf8');
const marker = 'if (!fs.existsSync(mcp.tokenPath())) {\n    return;\n  }';
if (!src.includes(marker)) { console.error('FATAL: gate marker not found in mirror.js'); process.exit(1); }
src = src.replace(marker, 'if (false) {\n    return;\n  }');
fs.writeFileSync(path, src);
" "$MIRROR_JS"

MUTANT_GATE_ROOT="$(mktemp -d)"
MUTANT_GATE_PALACE_PARENT="$(mktemp -d)"
MUTANT_GATE_FILE="$HELPERS_DIR/mutant-gate-record.json"
MR_CLI=claude-code MR_SESSION="mutant-gate-session" MR_IDEMKEY="mutant-gate-key" run_driver make-record > "$MUTANT_GATE_FILE"
MUTANT_GATE_RID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$MUTANT_GATE_FILE")"
MUTANT_GATE_PERIOD="$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const d=new Date(r.timing.requestInstant); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))" "$MUTANT_GATE_FILE")"

CREWRIG_USAGE_ROOT="$MUTANT_GATE_ROOT" MEMPALACE_PALACE_PATH="$MUTANT_GATE_PALACE_PARENT/palace" \
  run_driver write "$MUTANT_GATE_FILE" >/dev/null

git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/mirror.js

MUTANT_GATE_MARKER="$MUTANT_GATE_ROOT/mirror/pending/claude-code/$MUTANT_GATE_PERIOD/$MUTANT_GATE_RID"
if [ -f "$MUTANT_GATE_MARKER" ]; then
  ok "MUTATION RED: with the token gate neutralized, a pending marker is created despite no token file existing"
else
  bad "MUTATION not red: no pending marker appeared even with the gate neutralized" "$(find "$MUTANT_GATE_ROOT" -type f)"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/mirror.js; then
  ok "mirror.js is restored to its committed content after the gate mutation"
else
  bad "mirror.js was NOT fully restored after the gate mutation"
fi
rm -rf "$MUTANT_GATE_ROOT" "$MUTANT_GATE_PALACE_PARENT"

# (a) of #1205's step 10: run()'s final filter by the whole selection turned
# into a no-op. run() still narrows on the ledger-invariant clauses (identity,
# --cli, --fidelity) BEFORE the ledger, so the --period+--session,
# --period+--agent+--parent and --session+--cli cases stay green under this
# mutation by design; only the attribution clauses (--task-key, --asset),
# which can only be tested after the ledger, go red. Re-uses section (e)'s
# R1-R5 fixture, still in CREWRIG_USAGE_ROOT's 2021-03 partitions.
echo
echo "=== MUTATION: query.run() skipping its final filter by the selection (#1205) ==="
QUERY_JS="$REPO_DIR/scripts/lib/usage-store/query.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = '  return records.filter(pred);\n}';
if (!src.includes(marker)) { console.error('FATAL: run() final-filter marker not found in usage-store/query.js'); process.exit(1); }
src = src.replace(marker, '  return records;\n}');
fs.writeFileSync(p, src);
" "$QUERY_JS"
mut_task_ids="$(query_ids --period "$QUERY_PERIOD" --task-key "query-task-key-1")"
mut_asset_ids="$(query_ids --period "$QUERY_PERIOD" --asset "forge-issue:crewrig/crewrig#9999")"
git -C "$REPO_DIR" checkout -- scripts/lib/usage-store/query.js
if [ "$mut_task_ids" != "$R3_RID" ] && [ "$mut_asset_ids" != "$R4_RID" ]; then
  ok "MUTATION RED: without the final filter, --period+--task-key and --period+--asset return more than R3 / R4"
else
  bad "MUTATION not red: --period+--task-key / --period+--asset still narrowed without the final filter" \
    "task-key: $(printf '%s' "$mut_task_ids" | tr '\n' ' ') / asset: $(printf '%s' "$mut_asset_ids" | tr '\n' ' ')"
fi
if git -C "$REPO_DIR" diff --quiet -- scripts/lib/usage-store/query.js; then
  ok "query.js is restored to its committed content after the final-filter mutation"
else
  bad "query.js was NOT fully restored after the final-filter mutation"
fi

# --- (n) state/ is exported by layout.js and touched by nothing here -------
echo
echo "=== (n) state/ is exported but never touched by this module tree ==="
STATE_DIR_FROM_DRIVER="$(run_driver state-dir)"
EXPECTED_STATE_DIR="$USAGE_ROOT/state"
if [ "$STATE_DIR_FROM_DRIVER" = "$EXPECTED_STATE_DIR" ]; then
  ok "layout.js exports stateDir() at the expected path"
else
  bad "stateDir() returned an unexpected path" "$STATE_DIR_FROM_DRIVER"
fi
if [ -d "$USAGE_ROOT/state" ]; then
  bad "<root>/state/ exists — no code path in this module tree may create it"
else
  ok "<root>/state/ does not exist after the entire suite's writes/drains/prunes"
fi

echo
echo "=== Summary: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
