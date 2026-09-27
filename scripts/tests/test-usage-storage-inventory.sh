#!/bin/bash
# test-usage-storage-inventory.sh — the fake-daemon suite for the MemPalace
# usage-record drawer inventory and purge command (spec 0239, issue #1206;
# PLAN v1 step 8, extended per PLAN review finding v1-F1).
#
# The ONLY daemon this suite ever talks to is
# scripts/tests/fixtures/usage-storage/fake-mempalace-inventory-mcp.js, bound
# to a caller-picked ephemeral port — never the real daemon at
# 127.0.0.1:41893. This suite is DEDICATED to
# scripts/lib/usage-store/inventory.js's four tools (mempalace_list_wings,
# mempalace_list_drawers, mempalace_get_drawer, mempalace_delete_drawer) and
# does not extend fake-mempalace-mcp.js, which is scoped to mirror.js's own
# two tools (see that fixture's own header comment) — the same reasoning
# extends to this suite: a dedicated fixture and a dedicated suite, never
# entangled with test-usage-storage-mirror.sh's own fault-injection surface.
#
# Deliberately does NOT create CREWRIG_USAGE_ROOT at all: spec 0239 R1
# requires this command to produce a complete inventory when the local usage
# root, its journal, and its mirror markers under it are all absent, so this
# suite points CREWRIG_USAGE_ROOT at a path it never creates. Every drawer
# this suite works with is seeded DIRECTLY into the fixture's own store via
# its /control endpoint, never through mempalace_add_drawer or a local
# journal write — inventory.js's whole premise is that it never needs either.
#
# No ajv/node_modules preflight (unlike test-usage-storage-mirror.sh):
# inventory.js never runs the vendored validator or journal.js's write() path
# — confirmation is the narrow schemaVersion/provenance.cli check spec 0239
# R2 itself names, not full schema validation (see inventory.js's own header
# comment and PLAN v1's "Alternatives considered and rejected").
#
# No mutation-discipline cases: unlike test-usage-storage-mirror.sh, this
# suite makes no in-place edits to tracked source files.
#
# Covers, at minimum, spec 0239's ten named scenarios. Nine are asserted
# directly below (a-i); the tenth — "The closing check confirms against
# MemPalace itself" (docs/usage-organization.md's usage_mirror_gate third
# check) — is a KNOWN, STATED GAP in this suite (PLAN review finding v1-F1,
# recorded as non-blocking): that check is a bash function embedded in a
# Markdown code block with zero existing automated coverage in this
# repository today (confirmed at DEV time: no script under scripts/tests/
# referenced usage_mirror_gate before this ticket), and extracting and
# driving a doc-embedded bash function is a materially different testing
# problem than exercising this ticket's own script directly. Not fixed here;
# stated, per this repository's own convention of naming known gaps rather
# than leaving them implicit.
#
# Usage:
#   bash scripts/tests/test-usage-storage-inventory.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: a Node.js runtime is required to run this suite — install Node and re-run \`npm install\`." >&2
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
HELPERS_DIR="$(mktemp -d)"
PALACE_PARENT="$(mktemp -d)"
# Deliberately never created — proves R1 (works with the local usage root,
# its journal, and its mirror markers all absent).
USAGE_ROOT="$(mktemp -u)/nonexistent-usage-root"

FAKE_PID=""
REAL_HOME_DIRS_TO_CLEAN=""
register_real_home_dir_for_cleanup() {
  if [ -e "$1" ]; then
    echo "FATAL: $1 already exists — refusing to touch pre-existing state under \$HOME/.mempalace/." >&2
    exit 2
  fi
  REAL_HOME_DIRS_TO_CLEAN="$REAL_HOME_DIRS_TO_CLEAN $1"
}

# shellcheck disable=SC2329  # invoked from cleanup(), itself only reached via the EXIT trap
stop_fake() {
  if [ -n "$FAKE_PID" ] && kill -0 "$FAKE_PID" 2>/dev/null; then
    kill "$FAKE_PID" 2>/dev/null || true
    wait "$FAKE_PID" 2>/dev/null || true
  fi
  FAKE_PID=""
}

# shellcheck disable=SC2329  # invoked via trap cleanup EXIT, not dead
cleanup() {
  stop_fake
  for d in $REAL_HOME_DIRS_TO_CLEAN; do
    rm -rf "$d" 2>/dev/null || true
  done
  rm -rf "$HELPERS_DIR" "$PALACE_PARENT" 2>/dev/null || true
}
trap cleanup EXIT

export CREWRIG_USAGE_ROOT="$USAGE_ROOT"
export MEMPALACE_PALACE_PATH="$PALACE_PARENT/palace"

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
FAKE_TOKEN="fake-mempalace-inventory-token-$$-$RANDOM"

FIXTURE="$SCRIPT_DIR/tests/fixtures/usage-storage/fake-mempalace-inventory-mcp.js"

start_fake() {
  node "$FIXTURE" "$FAKE_PORT" "$FAKE_TOKEN" >/dev/null 2>"$HELPERS_DIR/fake-stderr.log" &
  FAKE_PID=$!
  local waited=0
  until curl -sf --max-time 1 "http://127.0.0.1:$FAKE_PORT/healthz" >/dev/null 2>&1 || [ "$waited" -ge 50 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if ! curl -sf --max-time 1 "http://127.0.0.1:$FAKE_PORT/healthz" >/dev/null 2>&1; then
    echo "FATAL: fake-mempalace-inventory-mcp.js failed to bind port $FAKE_PORT within 5s (pid $FAKE_PID)" >&2
    cat "$HELPERS_DIR/fake-stderr.log" >&2 2>/dev/null || true
    kill "$FAKE_PID" 2>/dev/null || true
    exit 1
  fi
}

# tokenPath() is hardcoded to $HOME/.mempalace/server/<hash>/token by both
# mcp.js and common.sh — there is no override, and this suite must not
# override HOME itself (see test-usage-storage-mirror.sh's own header for
# why). Any such directory this suite creates under the REAL $HOME is
# registered here and removed in cleanup().
TOKEN_PATH="$(node -e "console.log(require(process.argv[1] + '/scripts/lib/usage-store/mcp.js').tokenPath())" "$REPO_DIR")"
register_real_home_dir_for_cleanup "$(dirname "$TOKEN_PATH")"
mkdir -p "$(dirname "$TOKEN_PATH")"
printf '%s' "$FAKE_TOKEN" > "$TOKEN_PATH"

# --- Fixture control helpers -------------------------------------------------

fake_control() {
  curl -sf --max-time 2 -X POST "http://127.0.0.1:$FAKE_PORT/control" -H 'Content-Type: application/json' -d "$1"
}

reset_fake() {
  fake_control '{"reset":true}' >/dev/null
}

# make_content(cli, requestInstant, recordId) — a minimal, schema-conforming
# `uncaptured` usage record (block B of schemas/usage-record/v1.schema.json):
# only schemaVersion, provenance.cli, and timing.requestInstant are load-
# bearing for inventory.js's own confirmation (R2); `kind: 'uncaptured'`
# keeps the fixture content minimal (no tokens/modelId/rawStatus needed).
make_content() {
  node -e "
    const o = {
      schemaVersion: '1.0.0',
      kind: 'uncaptured',
      fidelity: 'per-request',
      recordId: process.argv[3],
      idempotencyKey: 'test-idem-' + process.argv[3].slice(0, 8),
      provenance: { cli: process.argv[1], cliVersion: '1.0.0', captureChannel: 'test-fixture', formatFingerprint: 'sha256:' + '0'.repeat(32) },
      identity: { sessionId: 'test-session-' + process.argv[3].slice(0, 8), projectRoot: '/tmp/test-project' },
      timing: { requestInstant: process.argv[2], captureInstant: process.argv[2] },
      uncapturedReason: 'test-fixture seeded record',
    };
    process.stdout.write(JSON.stringify(o));
  " "$1" "$2" "$3"
}

new_record_id() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

# seed_drawer(wing, content, [explicitDrawerId]) — prints the drawer id.
seed_drawer() {
  local wing="$1" content="$2" explicit="${3:-}"
  local payload
  payload="$(node -e "
    const o = { seedDrawer: { wing: process.argv[1], content: process.argv[2] } };
    if (process.argv[3]) o.seedDrawer.drawerId = process.argv[3];
    process.stdout.write(JSON.stringify(o));
  " "$wing" "$content" "$explicit")"
  fake_control "$payload" | node -e "
    let s = ''; process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => { try { process.stdout.write(JSON.parse(s).drawerId || ''); } catch (e) { process.stdout.write(''); } });
  "
}

# count_drawers(wing) — prints how many drawers the fixture still holds for
# that wing's usage-records room.
count_drawers() {
  fake_control "{\"countDrawers\":{\"wing\":\"$1\"}}" | node -e "
    let s = ''; process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => { try { process.stdout.write(String(JSON.parse(s).count)); } catch (e) { process.stdout.write('parse-error'); } });
  "
}

# tool_failure(tool, shape, [code]) — shape 'null' clears the injected shape.
tool_failure() {
  local tool="$1" shape="$2" code="${3:-null}"
  local shape_json="null"
  [ "$shape" = "null" ] || shape_json="\"$shape\""
  fake_control "{\"toolFailure\":{\"tool\":\"$tool\",\"shape\":$shape_json,\"code\":$code}}" >/dev/null
}

# run_inventory(...) — runs the CLI under test; sets OUT (stdout) and EC
# (exit code) as globals. Never lets a non-zero exit trip this suite's own
# `set -e` (this is the CLI's job to report, not this suite's to survive).
run_inventory() {
  set +e
  OUT="$(bash "$REPO_DIR/scripts/usage-inventory.sh" "$@" 2>"$HELPERS_DIR/inv-stderr.log")"
  EC=$?
  set -e
}

# json_field(jsonText, dottedPath) — a minimal top-level(-ish) JSON field
# reader; array indices are plain numeric string segments (e.g.
# "selected.0.drawerId"). An object/array value is re-stringified; a missing
# path or unparseable input prints '' or 'PARSE_ERROR' respectively.
json_field() {
  node -e "
    try {
      const o = JSON.parse(process.argv[1]);
      const v = process.argv[2].split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), o);
      process.stdout.write(v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    } catch (e) {
      process.stdout.write('PARSE_ERROR');
    }
  " "$1" "$2"
}

echo "=== usage-storage inventory suite (spec 0239, issue #1206) ==="
echo "USAGE_ROOT=$USAGE_ROOT (deliberately never created)"
echo "FAKE_PORT=$FAKE_PORT (never 41893)"
echo "TOKEN_PATH=$TOKEN_PATH"

start_fake

# --- (a) a drawer orphaned by a lost journal entry (R1, R2, R12) -----------
echo
echo "=== (a) a drawer orphaned by a lost journal entry is found and confirmed from its own content alone ==="
reset_fake
if [ ! -e "$USAGE_ROOT" ]; then
  ok "setup: the local usage root genuinely does not exist"
else
  bad "setup: the local usage root unexpectedly exists"
fi

ORPHAN_RID="$(new_record_id)"
ORPHAN_CONTENT="$(make_content claude-code 2026-03-15T10:00:00.000Z "$ORPHAN_RID")"
ORPHAN_DRAWER_ID="$(seed_drawer wing-a "$ORPHAN_CONTENT")"

run_inventory --wing wing-a --json
if [ "$EC" -eq 0 ]; then
  ok "inventory exits 0 with no local usage root, journal, or mirror markers present"
else
  bad "inventory exited $EC with no local usage root present" "$(cat "$HELPERS_DIR/inv-stderr.log")"
fi
if [ "$(json_field "$OUT" outcome)" = "inventory" ]; then
  ok "outcome is 'inventory'"
else
  bad "outcome is not 'inventory'" "$OUT"
fi
if [ "$(json_field "$OUT" confirmedTotal)" = "1" ]; then
  ok "exactly 1 confirmed drawer (the orphan)"
else
  bad "expected confirmedTotal=1" "$OUT"
fi
FOUND_ID="$(json_field "$OUT" selected.0.drawerId)"
if [ "$FOUND_ID" = "$ORPHAN_DRAWER_ID" ]; then
  ok "the orphaned drawer is identified solely by its own MemPalace drawer id"
else
  bad "expected drawerId=$ORPHAN_DRAWER_ID, got $FOUND_ID" "$OUT"
fi

# --- (b) an unrecognized room member is never counted or deleted (R2) ------
echo
echo "=== (b) an unrecognized room member is excluded from every count/listing and is never deleted ==="
reset_fake
GOOD_RID="$(new_record_id)"
GOOD_CONTENT="$(make_content gemini-cli 2026-04-01T00:00:00.000Z "$GOOD_RID")"
seed_drawer wing-b "$GOOD_CONTENT" >/dev/null
BAD_ID="$(seed_drawer wing-b "not json at all, and no schemaVersion either")"

run_inventory --wing wing-b --json
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" confirmedTotal)" = "1" ] && [ "$(json_field "$OUT" excludedTotal)" = "1" ]; then
  ok "the unrecognized member is excluded from the count (confirmed=1, excluded=1)"
else
  bad "expected confirmedTotal=1, excludedTotal=1" "$OUT"
fi

run_inventory delete --wing wing-b --commit --json
if [ "$EC" -eq 0 ]; then
  ok "the delete run (only the recognized drawer selected) succeeds"
else
  bad "delete run failed" "$(cat "$HELPERS_DIR/inv-stderr.log")"
fi
if [ "$(count_drawers wing-b)" = "1" ]; then
  ok "exactly 1 drawer remains in wing-b — the unrecognized one, never deleted"
else
  bad "expected 1 drawer remaining in wing-b" "$(count_drawers wing-b)"
fi
REMAINING="$(fake_control '{"countDrawers":{"wing":"wing-b"}}')"
if printf '%s' "$REMAINING" | grep -qF "$BAD_ID"; then
  ok "the surviving drawer is the unrecognized one, by id"
else
  bad "the surviving drawer is not the expected unrecognized one" "$REMAINING"
fi

# --- (c) dry run is the default (R7) ----------------------------------------
echo
echo "=== (c) dry run is the default: reports what would delete, deletes nothing ==="
reset_fake
DRY_RID="$(new_record_id)"
DRY_CONTENT="$(make_content claude-code 2026-05-01T00:00:00.000Z "$DRY_RID")"
seed_drawer wing-c "$DRY_CONTENT" >/dev/null

run_inventory delete --wing wing-c --json
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" outcome)" = "dry-run" ]; then
  ok "a delete run without --commit reports outcome=dry-run and exits 0"
else
  bad "expected outcome=dry-run, exit 0" "EC=$EC OUT=$OUT"
fi
if [ "$(json_field "$OUT" selectedTotal)" = "1" ]; then
  ok "the dry run reports exactly 1 drawer it would delete"
else
  bad "expected selectedTotal=1" "$OUT"
fi
if [ "$(count_drawers wing-c)" = "1" ]; then
  ok "the drawer is still present in MemPalace after the dry run"
else
  bad "the dry run deleted something — expected 1 drawer still present" "$(count_drawers wing-c)"
fi

# --- (d) a wide deletion requires an added confirmation (R16) --------------
echo
echo "=== (d) a wide deletion requires an added confirmation beyond --commit ==="
reset_fake
i=1
while [ "$i" -le 3 ]; do
  rid="$(new_record_id)"
  content="$(make_content claude-code "2026-06-0${i}T00:00:00.000Z" "$rid")"
  seed_drawer wing-d "$content" >/dev/null
  i=$((i + 1))
done

export CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD=2
run_inventory delete --wing wing-d --commit --json
unset CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD
if [ "$EC" -ne 0 ] && [ "$(json_field "$OUT" outcome)" = "confirmation-required" ]; then
  ok "3 confirmed drawers over a threshold of 2 refuses without --confirm-count (non-zero exit)"
else
  bad "expected outcome=confirmation-required, non-zero exit" "EC=$EC OUT=$OUT"
fi
if [ "$(count_drawers wing-d)" = "3" ]; then
  ok "nothing was deleted by the refused wide-deletion attempt"
else
  bad "expected all 3 drawers still present after the refusal" "$(count_drawers wing-d)"
fi

REQUIRED_COUNT="$(json_field "$OUT" requiredConfirmCount)"
export CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD=2
run_inventory delete --wing wing-d --commit --confirm-count "$REQUIRED_COUNT" --json
unset CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" outcome)" = "deleted" ]; then
  ok "supplying the exact --confirm-count reported allows the wide deletion to proceed"
else
  bad "expected outcome=deleted once the correct --confirm-count is supplied" "EC=$EC OUT=$OUT"
fi
if [ "$(count_drawers wing-d)" = "0" ]; then
  ok "all 3 drawers are deleted once the added confirmation matches"
else
  bad "expected 0 drawers remaining in wing-d" "$(count_drawers wing-d)"
fi

# --- (e) MemPalace unreachable: fail-closed (R8, R9) ------------------------
echo
echo "=== (e) MemPalace unreachable: fail-closed, unconfirmed, deletes nothing ==="
reset_fake
UNREACH_RID="$(new_record_id)"
UNREACH_CONTENT="$(make_content claude-code 2026-07-01T00:00:00.000Z "$UNREACH_RID")"
seed_drawer wing-e "$UNREACH_CONTENT" >/dev/null

# transport-500 simulates an unreachable daemon WITHOUT stopping this
# process, so the fixture's in-memory store (and the seeded drawer) survives
# the simulated outage — see the fixture's own header comment for why this
# is preferred over an actual stop/restart here.
tool_failure mempalace_list_drawers transport-500

run_inventory --wing wing-e --json
if [ "$EC" -ne 0 ] && [ "$(json_field "$OUT" outcome)" = "unconfirmed" ]; then
  ok "inventory reports outcome=unconfirmed and exits non-zero when MemPalace is unreachable"
else
  bad "expected outcome=unconfirmed, non-zero exit, with the daemon down" "EC=$EC OUT=$OUT"
fi

run_inventory delete --wing wing-e --commit --json
if [ "$EC" -ne 0 ] && [ "$(json_field "$OUT" outcome)" = "unconfirmed" ]; then
  ok "a --commit delete run also reports unconfirmed (never 'deleted' or empty) when MemPalace is unreachable"
else
  bad "expected outcome=unconfirmed, non-zero exit, for a delete attempt with the daemon down" "EC=$EC OUT=$OUT"
fi

tool_failure mempalace_list_drawers null
if [ "$(count_drawers wing-e)" = "1" ]; then
  ok "the drawer survives entirely — nothing was deleted while MemPalace was unreachable"
else
  bad "expected 1 drawer still present after the daemon-down attempts" "$(count_drawers wing-e)"
fi

# --- (f) grouped, filtered inventory across many wings (R3) -----------------
echo
echo "=== (f) grouped, filtered inventory across many wings, many CLIs, many periods ==="
reset_fake
seed_drawer wing-f1 "$(make_content claude-code 2026-01-10T00:00:00.000Z "$(new_record_id)")" >/dev/null
seed_drawer wing-f1 "$(make_content gemini-cli 2026-01-15T00:00:00.000Z "$(new_record_id)")" >/dev/null
seed_drawer wing-f2 "$(make_content claude-code 2026-02-10T00:00:00.000Z "$(new_record_id)")" >/dev/null
seed_drawer wing-f2 "$(make_content copilot-cli 2026-02-20T00:00:00.000Z "$(new_record_id)")" >/dev/null

run_inventory --wing wing-f1,wing-f2 --period 2026-02 --json
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" selectedTotal)" = "2" ]; then
  ok "a period filter across many wings selects only that month's confirmed drawers (2 of 4)"
else
  bad "expected selectedTotal=2 for the 2026-02 filter" "$OUT"
fi
BY_WING="$(json_field "$OUT" byWing)"
if printf '%s' "$BY_WING" | grep -qF '"wing-f2":2' && ! printf '%s' "$BY_WING" | grep -qF 'wing-f1'; then
  ok "the filtered result is grouped by wing correctly (only wing-f2, count 2)"
else
  bad "expected byWing grouping to show only wing-f2:2" "$BY_WING"
fi
BY_CLI="$(json_field "$OUT" byCli)"
if printf '%s' "$BY_CLI" | grep -qF '"claude-code":1' && printf '%s' "$BY_CLI" | grep -qF '"copilot-cli":1'; then
  ok "the filtered result is grouped by CLI correctly (claude-code:1, copilot-cli:1)"
else
  bad "expected byCli grouping to show claude-code:1 and copilot-cli:1" "$BY_CLI"
fi

# --- (g) deleting exactly one confirmed drawer by its own id (R5,R6,R12) ---
echo
echo "=== (g) deleting exactly one confirmed drawer, addressed by its own MemPalace drawer id ==="
reset_fake
ONE_ID="$(seed_drawer wing-g "$(make_content claude-code 2026-03-01T00:00:00.000Z "$(new_record_id)")")"

run_inventory delete --wing wing-g --commit --json
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" outcome)" = "deleted" ]; then
  ok "the delete run succeeds and reports outcome=deleted"
else
  bad "expected outcome=deleted" "EC=$EC OUT=$OUT"
fi
DELETED_IDS="$(json_field "$OUT" deletedDrawerIds)"
if [ "$DELETED_IDS" = "[\"$ONE_ID\"]" ]; then
  ok "exactly one drawer was deleted, addressed by its own drawer id"
else
  bad "expected deletedDrawerIds=[\"$ONE_ID\"]" "$DELETED_IDS"
fi
if [ "$(count_drawers wing-g)" = "0" ]; then
  ok "wing-g now holds zero drawers"
else
  bad "expected 0 drawers remaining in wing-g" "$(count_drawers wing-g)"
fi

# --- (h) a wing-scoped removal never reaches another wing (R14) -------------
echo
echo "=== (h) a wing-scoped removal never reaches a confirmed drawer in another wing ==="
reset_fake
seed_drawer wing-h1 "$(make_content claude-code 2026-03-05T00:00:00.000Z "$(new_record_id)")" >/dev/null
seed_drawer wing-h2 "$(make_content claude-code 2026-03-05T00:00:00.000Z "$(new_record_id)")" >/dev/null

run_inventory delete --wing wing-h1 --commit --json
if [ "$EC" -eq 0 ]; then
  ok "the wing-h1-scoped delete run succeeds"
else
  bad "wing-h1-scoped delete run failed" "$(cat "$HELPERS_DIR/inv-stderr.log")"
fi
if [ "$(count_drawers wing-h1)" = "0" ]; then
  ok "wing-h1's confirmed drawer is deleted"
else
  bad "expected 0 drawers remaining in wing-h1" "$(count_drawers wing-h1)"
fi
if [ "$(count_drawers wing-h2)" = "1" ]; then
  ok "wing-h2's confirmed drawer is untouched despite sitting in the same room"
else
  bad "expected wing-h2 to still hold its 1 drawer" "$(count_drawers wing-h2)"
fi

# --- (i) an all-wings sweep is the actual default (R4) ----------------------
echo
echo "=== (i) an all-wings sweep is the actual default when no --wing is given ==="
reset_fake
seed_drawer wing-i1 "$(make_content claude-code 2026-03-10T00:00:00.000Z "$(new_record_id)")" >/dev/null
seed_drawer wing-i2 "$(make_content claude-code 2026-03-10T00:00:00.000Z "$(new_record_id)")" >/dev/null

run_inventory --json
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" scope)" = "all" ]; then
  ok "the default scope is reported as 'all'"
else
  bad "expected scope=all with no --wing given" "$OUT"
fi
WINGS_SWEPT="$(json_field "$OUT" wingsSwept)"
if printf '%s' "$WINGS_SWEPT" | grep -qF 'wing-i1' && printf '%s' "$WINGS_SWEPT" | grep -qF 'wing-i2'; then
  ok "both wings are named in the swept scope"
else
  bad "expected both wing-i1 and wing-i2 in wingsSwept" "$WINGS_SWEPT"
fi
if [ "$(json_field "$OUT" confirmedTotal)" = "2" ]; then
  ok "both seeded drawers are confirmed in the all-wings sweep"
else
  bad "expected confirmedTotal=2" "$OUT"
fi

# An all-wings scope is itself "wide" (R16), regardless of drawer count.
run_inventory delete --commit --json
if [ "$EC" -ne 0 ] && [ "$(json_field "$OUT" outcome)" = "confirmation-required" ]; then
  ok "an all-wings deletion refuses without --confirm-count, even below the drawer-count threshold"
else
  bad "expected outcome=confirmation-required for an uncommitted-confirmation all-wings delete" "EC=$EC OUT=$OUT"
fi
REQUIRED_ALL="$(json_field "$OUT" requiredConfirmCount)"
run_inventory delete --commit --confirm-count "$REQUIRED_ALL" --json
if [ "$EC" -eq 0 ] && [ "$(json_field "$OUT" outcome)" = "deleted" ]; then
  ok "supplying the exact --confirm-count for the all-wings scope allows the deletion to proceed"
else
  bad "expected outcome=deleted for the all-wings deletion with the correct --confirm-count" "EC=$EC OUT=$OUT"
fi

# --- (extra) R13: a plain inventory run writes nothing -----------------------
echo
echo "=== (extra) a plain inventory run makes no write of any kind (R13) ==="
reset_fake
seed_drawer wing-r13 "$(make_content claude-code 2026-03-20T00:00:00.000Z "$(new_record_id)")" >/dev/null
BEFORE_COUNT="$(count_drawers wing-r13)"
run_inventory --wing wing-r13 --json >/dev/null
run_inventory --wing wing-r13 --json >/dev/null
AFTER_COUNT="$(count_drawers wing-r13)"
if [ "$BEFORE_COUNT" = "$AFTER_COUNT" ] && [ "$AFTER_COUNT" = "1" ]; then
  ok "two plain inventory runs leave the drawer count unchanged"
else
  bad "expected the drawer count to stay at 1 across plain inventory runs" "before=$BEFORE_COUNT after=$AFTER_COUNT"
fi

# --- (extra) text-mode output and CLI plumbing sanity ------------------------
echo
echo "=== (extra) text-mode output and basic CLI plumbing ==="
reset_fake
seed_drawer wing-text "$(make_content claude-code 2026-03-21T00:00:00.000Z "$(new_record_id)")" >/dev/null
run_inventory --wing wing-text
if [ "$EC" -eq 0 ] && printf '%s' "$OUT" | grep -qF 'scope: explicit'; then
  ok "text-mode output (no --json) reports the scope in plain text"
else
  bad "expected text-mode output to mention the scope" "EC=$EC OUT=$OUT"
fi

run_inventory --unrecognized-flag
if [ "$EC" -eq 2 ]; then
  ok "an unrecognized CLI argument exits with status 2"
else
  bad "expected exit 2 for an unrecognized argument" "EC=$EC OUT=$OUT"
fi

echo
echo "=== Summary: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
