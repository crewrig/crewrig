#!/bin/bash
# test-usage-attribution.sh — the no-daemon suite for the usage-attribution
# contract (spec 0208 R25-R29, PLAN v3 step 10; plan/1171#3 APPROVE review;
# delta-01 R33's no-registered-store half, per the orchestrator's ownership
# note https://github.com/crewrig/crewrig/issues/1172#issuecomment-5776029958).
#
# CREWRIG_USAGE_ROOT is a fresh mktemp -d per case; MEMPALACE_PALACE_PATH is a
# temp path with no token file; CREWRIG_USAGE_CAPTURE_TEST=1;
# CREWRIG_USAGE_MIRROR=0. Offline, no daemon, no network. Every synthetic
# checkout is built entirely under a temp root from files this suite writes
# itself (including literal spec-file fixtures) — no remote ref is read and
# no real checkout of this machine is written to.
#
# Preflight: node on PATH, or a FATAL and exit 2 — never a silent pass.
#
# Mutation discipline: each of the six named mutations edits a tracked module
# IN PLACE, proves the property goes red, then restores with
# `git checkout -- <file>` — mirroring test-usage-storage.sh's own discipline.
#
# Usage:
#   bash scripts/tests/test-usage-attribution.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Preflight ---------------------------------------------------------------
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

# --- R28: capture a marker of $HOME/.crewrig/usage BEFORE anything runs -----
# (test-usage-storage.sh l. 62-79 idiom, applied to $HOME/.crewrig/usage
# rather than $HOME/.mempalace/server/: this suite never overrides HOME and
# must never write under the real usage root. Tolerates an absent path — the
# common case on a fresh CI runner, where `find` over a missing directory
# exits non-zero — but refuses rather than assumes if the path exists and is
# unreadable, since an unreadable directory cannot honestly be called empty.)
REAL_HOME_USAGE_DIR="$HOME/.crewrig/usage"
if [ -e "$REAL_HOME_USAGE_DIR" ]; then
  if [ ! -r "$REAL_HOME_USAGE_DIR" ]; then
    echo "FATAL: $REAL_HOME_USAGE_DIR exists but is not readable — refusing to assume it is empty." >&2
    exit 2
  fi
  HOME_USAGE_MARKER_BEFORE="$(find "$REAL_HOME_USAGE_DIR" -type f 2>/dev/null | LC_ALL=C sort)"
else
  HOME_USAGE_MARKER_BEFORE="<absent>"
fi

# --- Sandbox -------------------------------------------------------------
HELPERS_DIR="$(mktemp -d)"
SYN_PARENT="$(mktemp -d)"
MUTATION_GUARD_FILES="scripts/lib/usage-capture/attribution.js scripts/lib/usage-store/checkout.js scripts/lib/usage-store/journal.js scripts/lib/usage-store/prune.js scripts/lib/usage-store/rollup.js scripts/lib/usage-store/layout.js"
CASE_ROOTS=""

# shellcheck disable=SC2329  # invoked via trap cleanup EXIT, not dead
cleanup() {
  for f in $MUTATION_GUARD_FILES; do
    if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
      git -C "$REPO_DIR" checkout -- "$f" 2>/dev/null || true
    fi
  done
  rm -rf "$HELPERS_DIR" "$SYN_PARENT" 2>/dev/null || true
  for d in $CASE_ROOTS; do
    rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup EXIT

unset CREWRIG_USAGE_ROOT 2>/dev/null || true
export CREWRIG_USAGE_CAPTURE_TEST=1
export CREWRIG_USAGE_MIRROR=0
unset CREWRIG_USAGE_WING 2>/dev/null || true
unset CREWRIG_USAGE_ALLOW_PRUNED 2>/dev/null || true
unset CREWRIG_TASK 2>/dev/null || true
unset CREWRIG_SESSION_ID 2>/dev/null || true
unset CREWRIG_FORGE_HOSTS 2>/dev/null || true
unset CREWRIG_TASK_DECLARATION_TTL_MS 2>/dev/null || true

# Refuse to run against a dirty tree — the mutation-discipline phases below
# edit-then-restore tracked files, and a pre-existing diff would make
# "restore" ambiguous about which content is "clean".
for f in $MUTATION_GUARD_FILES; do
  if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
    echo "FATAL: $f has uncommitted changes — refusing to run mutation-discipline cases against a dirty tree." >&2
    exit 2
  fi
done

new_case_root() {
  local d
  d="$(mktemp -d)"
  CASE_ROOTS="$CASE_ROOTS $d"
  echo "$d"
}

FIXTURES_DIR="$SCRIPT_DIR/tests/fixtures/usage-attribution/records"

# --- Node driver -----------------------------------------------------------
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

function loadRecord(file) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.ATTR_PROJECT_ROOT_OVERRIDE !== undefined) {
    rec.identity.projectRoot = process.env.ATTR_PROJECT_ROOT_OVERRIDE;
  }
  return rec;
}

function ctxFromEnv() {
  const ctx = {
    now: process.env.ATTR_CTX_NOW ? Number(process.env.ATTR_CTX_NOW) : Date.now(),
    cwd: process.env.ATTR_CTX_CWD || undefined,
    declarations: process.env.ATTR_CTX_DECLARATIONS === '0' ? false : true,
    env: {},
    memo: new Map(),
  };
  if (process.env.ATTR_CTX_ENV_CREWRIG_TASK !== undefined) ctx.env.CREWRIG_TASK = process.env.ATTR_CTX_ENV_CREWRIG_TASK;
  if (process.env.ATTR_CTX_ENV_FORGE_HOSTS !== undefined) ctx.env.CREWRIG_FORGE_HOSTS = process.env.ATTR_CTX_ENV_FORGE_HOSTS;
  return ctx;
}

function cmdResolve() {
  const file = process.argv[3];
  const rec = loadRecord(file);
  const ctx = ctxFromEnv();
  const attribution = req('scripts/lib/usage-capture/attribution');
  console.log(JSON.stringify(attribution.resolveAttribution(rec, ctx)));
}

function cmdSubmit() {
  const file = process.argv[3];
  const rec = loadRecord(file);
  const ctx = ctxFromEnv();
  const index = req('scripts/lib/usage-capture/index');
  const layout = req('scripts/lib/usage-store/layout');
  const result = index.submit(rec, ctx);
  console.log(JSON.stringify({
    status: result.status,
    reason: result.reason || null,
    recordId: rec.recordId,
    cli: rec.provenance.cli,
    period: layout.period(rec),
  }));
}

function cmdCaptureThrow() {
  const cli = process.argv[3];
  const transcriptDir = process.argv[4];
  const cwdArg = process.argv[5];
  const index = req('scripts/lib/usage-capture/index');
  index.capture({ cli, event: 'test-throw', payload: { transcript_path: transcriptDir, cwd: cwdArg } });
  console.log('DONE');
}

function cmdPeriod() {
  const file = process.argv[3];
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const layout = req('scripts/lib/usage-store/layout');
  console.log(layout.period(rec));
}

function cmdSha256File() {
  console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[3])).digest('hex'));
}

function cmdLedgerAppend() {
  const entry = JSON.parse(process.argv[3]);
  const ledger = req('scripts/lib/usage-store/ledger');
  console.log(JSON.stringify(ledger.append(entry)));
}

function cmdDeclarationWrite() {
  const opts = JSON.parse(process.argv[3]);
  const declaration = req('scripts/lib/usage-store/declaration');
  console.log(JSON.stringify(declaration.write(opts)));
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'resolve':
      return cmdResolve();
    case 'submit':
      return cmdSubmit();
    case 'capture-throw':
      return cmdCaptureThrow();
    case 'period':
      return cmdPeriod();
    case 'sha256-file':
      return cmdSha256File();
    case 'ledger-append':
      return cmdLedgerAppend();
    case 'declaration-write':
      return cmdDeclarationWrite();
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

# --- Path algebra mirrors (bash side, read-only mirrors of layout.js) -------
journal_entry_path() { echo "$1/journal/$2/$3/$4.json"; }
wing_sidecar_path() { echo "$1/journal/$2/$3/$4.wing.json"; }
attr_sidecar_path() { echo "$1/journal/$2/$3/$4.attr.json"; }

record_id_of() {
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).recordId)" "$1"
}

# --- Synthetic checkout builder ---------------------------------------------
# build_checkout <dir> <branch> [<remote-url>] [<remote-name>]
# Constructs a bare-minimum .git directory (HEAD + config) under <dir>. No
# real checkout of this machine is touched — every byte is written by this
# function or by a caller populating specs/<file>.md afterward.
build_checkout() {
  local dir="$1" branch="$2" remote_url="${3:-}" remote_name="${4:-origin}"
  mkdir -p "$dir/.git"
  printf 'ref: refs/heads/%s\n' "$branch" > "$dir/.git/HEAD"
  {
    echo "[core]"
    echo "	repositoryformatversion = 0"
    if [ -n "$remote_url" ]; then
      echo "[remote \"$remote_name\"]"
      echo "	url = $remote_url"
      echo "	fetch = +refs/heads/*:refs/remotes/$remote_name/*"
    fi
  } > "$dir/.git/config"
}

echo "=== usage-attribution no-daemon suite (spec 0208 R25-R29) ==="

# =============================================================================
# R25 — channels and precedence
# =============================================================================
echo
echo "=== R25 — four channel fixtures, malformed-at-channel-1, branch-shape cases ==="
R25_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$R25_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
NO_GIT_CWD="$(mktemp -d)"

# --- channel 1: explicit declaration ----------------------------------------
run_driver declaration-write '{"taskHandoffKey":"ch1-key","declaringChannel":"explicit","sessionId":"attr-ch1-session"}' >/dev/null
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" run_driver resolve "$FIXTURES_DIR/r25-ch1-explicit.json")"
if grep -qF '"channel":"explicit"' <<< "$out" && grep -qF '"taskHandoffKey":"ch1-key"' <<< "$out" && grep -qF '"outcome":"attributed"' <<< "$out"; then
  ok "R25 channel 1 (explicit): resolves to ch1-key via channel explicit"
else
  bad "R25 channel 1 (explicit) did NOT resolve as expected" "$out"
fi

# --- channel 2: CREWRIG_TASK -------------------------------------------------
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" ATTR_CTX_ENV_CREWRIG_TASK="ch2-key" run_driver resolve "$FIXTURES_DIR/r25-ch2-env.json")"
if grep -qF '"channel":"env"' <<< "$out" && grep -qF '"taskHandoffKey":"ch2-key"' <<< "$out" && grep -qF '"outcome":"attributed"' <<< "$out"; then
  ok "R25 channel 2 (env): resolves to ch2-key via channel env"
else
  bad "R25 channel 2 (env) did NOT resolve as expected" "$out"
fi

# --- channel 3: worktree-or-branch ------------------------------------------
CH3_CHECKOUT="$SYN_PARENT/ch3-checkout"
build_checkout "$CH3_CHECKOUT" "fix/0777-attr-ch3-probe" "git@github.com:crewrig/crewrig.git"
out="$(ATTR_CTX_CWD="$CH3_CHECKOUT" run_driver resolve "$FIXTURES_DIR/r25-ch3-worktree.json")"
if grep -qF '"channel":"worktree"' <<< "$out" && grep -qF '"taskHandoffKey":"777"' <<< "$out" && grep -qF '"outcome":"attributed"' <<< "$out"; then
  ok "R25 channel 3 (worktree): resolves to 777 via channel worktree"
else
  bad "R25 channel 3 (worktree) did NOT resolve as expected" "$out"
fi

# --- channel 4: protocol declaration -----------------------------------------
run_driver declaration-write '{"taskHandoffKey":"ch4-key","declaringChannel":"protocol","sessionId":"attr-ch4-session"}' >/dev/null
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" run_driver resolve "$FIXTURES_DIR/r25-ch4-protocol.json")"
if grep -qF '"channel":"protocol"' <<< "$out" && grep -qF '"taskHandoffKey":"ch4-key"' <<< "$out" && grep -qF '"outcome":"attributed"' <<< "$out"; then
  ok "R25 channel 4 (protocol): resolves to ch4-key via channel protocol"
else
  bad "R25 channel 4 (protocol) did NOT resolve as expected" "$out"
fi

# --- malformed at channel 1: unattributed, channel named, failure named, ----
#     CREWRIG_TASK (set to a VALID key) never consulted -----------------------
run_driver declaration-write '{"taskHandoffKey":"has a space","declaringChannel":"explicit","sessionId":"attr-malformed-session"}' >/dev/null
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" ATTR_CTX_ENV_CREWRIG_TASK="valid-env-key" run_driver resolve "$FIXTURES_DIR/r25-malformed-ch1.json")"
if grep -qF '"outcome":"unattributed"' <<< "$out" && grep -qF '"channel":"explicit"' <<< "$out" && grep -qiF 'invalid taskHandoffKey' <<< "$out"; then
  ok "R25 malformed channel 1: unattributed, channel named, failure named"
else
  bad "R25 malformed channel 1 did NOT report as expected" "$out"
fi
if grep -qF 'valid-env-key' <<< "$out"; then
  bad "R25 malformed channel 1: CREWRIG_TASK's valid key LEAKED into the result" "$out"
else
  ok "R25 malformed channel 1: CREWRIG_TASK was never consulted (absent from the result)"
fi

# --- (i) spec branch, positive: spec/0208-usage-attribution → 1171, never 208
BRANCH_I="$SYN_PARENT/branch-i"
build_checkout "$BRANCH_I" "spec/0208-usage-attribution"
mkdir -p "$BRANCH_I/specs"
cat > "$BRANCH_I/specs/0208-usage-attribution.md" <<'SPEC_0208_EOF'
---
id: "0208"
slug: usage-attribution
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1171
version: 1.0.0
---

# Usage attribution — declaration channels, an attribution ledger, and per-fidelity rollups
SPEC_0208_EOF
out="$(ATTR_CTX_CWD="$BRANCH_I" run_driver resolve "$FIXTURES_DIR/r25-branch-i.json")"
if grep -qF '"taskHandoffKey":"1171"' <<< "$out" && grep -qF '"channel":"worktree"' <<< "$out"; then
  ok "R25 (i) spec branch positive: resolves to 1171 via spec-file:related-issue, never 208"
else
  bad "R25 (i) spec branch positive did NOT resolve to 1171" "$out"
fi

# --- (ii) spec branch, negative: file absent → channel 3 nothing, channel 4 --
BRANCH_II="$SYN_PARENT/branch-ii"
build_checkout "$BRANCH_II" "spec/0208-usage-attribution"
run_driver declaration-write '{"taskHandoffKey":"branch-ii-key","declaringChannel":"protocol","sessionId":"attr-branch-ii-session"}' >/dev/null
out="$(ATTR_CTX_CWD="$BRANCH_II" run_driver resolve "$FIXTURES_DIR/r25-branch-ii.json")"
if grep -qF '"channel":"protocol"' <<< "$out" && grep -qF '"taskHandoffKey":"branch-ii-key"' <<< "$out"; then
  ok "R25 (ii) spec branch negative: channel 3 yields nothing, channel 4's declaration supplies the key"
else
  bad "R25 (ii) spec branch negative did NOT fall through to channel 4 as expected" "$out"
fi

# --- (iii) session cwd in a subdirectory: declaration resolves + forge asset -
BRANCH_III="$SYN_PARENT/branch-iii"
build_checkout "$BRANCH_III" "fix/0900-subdir-case" "git@github.com:crewrig/crewrig.git"
BRANCH_III_SUBDIR="$BRANCH_III/a/b"
mkdir -p "$BRANCH_III_SUBDIR"
(cd "$BRANCH_III" && CREWRIG_USAGE_ROOT="$R25_ROOT" node --disable-warning=ExperimentalWarning "$REPO_DIR/scripts/lib/usage-store/declaration.js" set --channel explicit --task-key subdir-decl-key >/dev/null)
out="$(ATTR_PROJECT_ROOT_OVERRIDE="$BRANCH_III_SUBDIR" ATTR_CTX_CWD="$BRANCH_III_SUBDIR" run_driver resolve "$FIXTURES_DIR/r25-branch-iii.json")"
if grep -qF '"channel":"explicit"' <<< "$out" && grep -qF '"taskHandoffKey":"subdir-decl-key"' <<< "$out"; then
  ok "R25 (iii) subdirectory: the project-scoped declaration written at the checkout root resolves"
else
  bad "R25 (iii) subdirectory declaration did NOT resolve" "$out"
fi
(cd "$BRANCH_III" && CREWRIG_USAGE_ROOT="$R25_ROOT" node --disable-warning=ExperimentalWarning "$REPO_DIR/scripts/lib/usage-store/declaration.js" clear >/dev/null)
out="$(ATTR_PROJECT_ROOT_OVERRIDE="$BRANCH_III_SUBDIR" ATTR_CTX_CWD="$BRANCH_III_SUBDIR" run_driver resolve "$FIXTURES_DIR/r25-branch-iii.json")"
if grep -qF '"channel":"worktree"' <<< "$out" && grep -qF '"taskHandoffKey":"900"' <<< "$out" && grep -qF '"kind":"forge-issue"' <<< "$out" && grep -qF 'crewrig/crewrig#900' <<< "$out"; then
  ok "R25 (iii) subdirectory: with no declaration, channel 3 derives the ticket AND the forge asset from the subdirectory"
else
  bad "R25 (iii) subdirectory worktree-channel derivation did NOT resolve" "$out"
fi

# --- (iv) v2-F2 case: non-spec/ branch naming a spec (positive + negative) --
BRANCH_IV="$SYN_PARENT/branch-iv"
build_checkout "$BRANCH_IV" "feat/0203-probe-c-guidance-surface"
mkdir -p "$BRANCH_IV/specs"
cat > "$BRANCH_IV/specs/0203-probe-c-guidance-surface.md" <<'SPEC_0203_EOF'
---
id: "0203"
slug: probe-c-guidance-surface
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 1113
version: 1.0.0
---

# Probe C — guidance-surface prose vs Copilot reader, effort: frontmatter, and orchestrator guidance reliability
SPEC_0203_EOF
out="$(ATTR_CTX_CWD="$BRANCH_IV" run_driver resolve "$FIXTURES_DIR/r25-branch-iv.json")"
if grep -qF '"taskHandoffKey":"1113"' <<< "$out"; then
  ok "R25 (iv) v2-F2 positive: feat/0203-probe-c-guidance-surface resolves to 1113, never 203"
else
  bad "R25 (iv) v2-F2 positive did NOT resolve to 1113" "$out"
fi
rm -f "$BRANCH_IV/specs/0203-probe-c-guidance-surface.md"
out="$(ATTR_CTX_CWD="$BRANCH_IV" run_driver resolve "$FIXTURES_DIR/r25-branch-iv.json")"
if grep -qF '"taskHandoffKey":"203"' <<< "$out"; then
  ok "R25 (iv) v2-F2 negative: with the spec file absent, the same branch resolves to 203 (the pinned residue)"
else
  bad "R25 (iv) v2-F2 negative did NOT resolve to 203" "$out"
fi

# --- (v) residue: slug-mismatched branch resolves to the number as written -
BRANCH_V="$SYN_PARENT/branch-v"
build_checkout "$BRANCH_V" "fix/0054-delta01-md029"
out="$(ATTR_CTX_CWD="$BRANCH_V" run_driver resolve "$FIXTURES_DIR/r25-branch-v.json")"
if grep -qF '"taskHandoffKey":"54"' <<< "$out"; then
  ok "R25 (v) residue: fix/0054-delta01-md029 (slug-mismatched, no matching spec file) resolves to 54"
else
  bad "R25 (v) residue did NOT resolve to 54 via ticket-branch" "$out"
fi

# --- (vi) .worktrees/866/ path segment wins over the branch -----------------
BRANCH_VI="$SYN_PARENT/.worktrees/866"
build_checkout "$BRANCH_VI" "feat/9999-unrelated-branch-name"
out="$(ATTR_CTX_CWD="$BRANCH_VI" run_driver resolve "$FIXTURES_DIR/r25-branch-vi.json")"
if grep -qF '"taskHandoffKey":"866"' <<< "$out"; then
  ok "R25 (vi) .worktrees/866 path segment wins over the unrelated branch name"
else
  bad "R25 (vi) .worktrees/866 path segment did NOT win" "$out"
fi

# --- (vii) fix/0866-… → 866 with forge-issue crewrig/crewrig#866 -----------
BRANCH_VII="$SYN_PARENT/branch-vii"
build_checkout "$BRANCH_VII" "fix/0866-reclassify-harness-transcript-traffic" "git@github.com:crewrig/crewrig.git"
out="$(ATTR_CTX_CWD="$BRANCH_VII" run_driver resolve "$FIXTURES_DIR/r25-branch-vii.json")"
if grep -qF '"taskHandoffKey":"866"' <<< "$out" && grep -qF '"kind":"forge-issue"' <<< "$out" && grep -qF 'crewrig/crewrig#866' <<< "$out"; then
  ok "R25 (vii): fix/0866-… resolves to 866 with forge-issue crewrig/crewrig#866"
else
  bad "R25 (vii) did NOT resolve as expected" "$out"
fi

# --- (viii) unrecognized host + CREWRIG_FORGE_HOSTS empty -------------------
BRANCH_VIII="$SYN_PARENT/branch-viii"
build_checkout "$BRANCH_VIII" "fix/0900-unrecognized-host-probe" "git@git.example.internal:org/repo.git"
out="$(ATTR_CTX_CWD="$BRANCH_VIII" ATTR_CTX_ENV_FORGE_HOSTS="" run_driver resolve "$FIXTURES_DIR/r25-branch-viii.json")"
if grep -qF '"taskHandoffKey":"900"' <<< "$out" && ! grep -qF 'externalAsset' <<< "$out" && grep -qiF 'no recognized forge host' <<< "$out"; then
  ok "R25 (viii): unrecognized host yields the task key alone plus a stated reason"
else
  bad "R25 (viii) did NOT report the unrecognized-host case as expected" "$out"
fi

# =============================================================================
# R26 — ledger at read time
# =============================================================================
echo
echo "=== R26 — ledger at read time: read returns the ledger key, --no-ledger the capture-time key ==="
R26_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$R26_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

submit_out="$(ATTR_CTX_ENV_CREWRIG_TASK="capture-time-key" run_driver submit "$FIXTURES_DIR/r26-record.json")"
if grep -qF '"status":"stored"' <<< "$submit_out"; then
  ok "R26 base record stored with capture-time key"
else
  bad "R26 base record did NOT store" "$submit_out"
fi
R26_PERIOD="$(run_driver period "$FIXTURES_DIR/r26-record.json")"
R26_ENTRY="$(journal_entry_path "$R26_ROOT" claude-code "$R26_PERIOD" attr-r26-key-recordid-placeholder)"
R26_RID="$(record_id_of "$FIXTURES_DIR/r26-record.json")"
R26_ENTRY="$(journal_entry_path "$R26_ROOT" claude-code "$R26_PERIOD" "$R26_RID")"

BEFORE_HASH="$(run_driver sha256-file "$R26_ENTRY")"

LEDGER_ENTRY_JSON='{"scope":{"session":"attr-r26-session"},"timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","author":"test-suite","reason":"R26 ledger-key override probe","taskHandoffKey":"ledger-time-key"}'
run_driver ledger-append "$LEDGER_ENTRY_JSON" >/dev/null

with_ledger="$(bash "$REPO_DIR/scripts/usage-query.sh" --session attr-r26-session)"
without_ledger="$(bash "$REPO_DIR/scripts/usage-query.sh" --session attr-r26-session --no-ledger)"

if grep -qF '"taskHandoffKey":"ledger-time-key"' <<< "$with_ledger"; then
  ok "R26: the default read returns the ledger's key"
else
  bad "R26: the default read did NOT return the ledger's key" "$with_ledger"
fi
if grep -qF '"taskHandoffKey":"capture-time-key"' <<< "$without_ledger"; then
  ok "R26: --no-ledger returns the capture-time key"
else
  bad "R26: --no-ledger did NOT return the capture-time key" "$without_ledger"
fi

AFTER_HASH="$(run_driver sha256-file "$R26_ENTRY")"
if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
  ok "R26: sha256 of the journal entry file is byte-identical before and after the ledger read"
else
  bad "R26: the journal entry file CHANGED after applying the ledger override" "before=$BEFORE_HASH after=$AFTER_HASH"
fi

# =============================================================================
# R27 — per-fidelity rollups
# =============================================================================
echo
echo "=== R27 — rollups: per-request/run-total sums, last-snapshot session-cumulative, mixed marker, uncapturedCount ==="
R27_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$R27_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

for f in r27-per-request-1 r27-per-request-2 r27-run-total-1 r27-session-cumulative-1 r27-session-cumulative-2 r27-session-cumulative-3 r27-uncaptured-1; do
  out="$(ATTR_CTX_ENV_CREWRIG_TASK="attr-r27-task" run_driver submit "$FIXTURES_DIR/$f.json")"
  if ! grep -qF '"status":"stored"' <<< "$out"; then
    bad "R27 fixture $f did NOT store" "$out"
  fi
done

rollup_out="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key attr-r27-task --rollup)"
combined_out="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key attr-r27-task --rollup --combined)"

pr_netinput="$(node -e "console.log(JSON.parse(process.argv[1]).byFidelity['per-request'].netInput)" "$rollup_out")"
rt_netinput="$(node -e "console.log(JSON.parse(process.argv[1]).byFidelity['run-total'].netInput)" "$rollup_out")"
sc_netinput="$(node -e "console.log(JSON.parse(process.argv[1]).byFidelity['session-cumulative'].netInput)" "$rollup_out")"
unc_count="$(node -e "console.log(JSON.parse(process.argv[1]).uncapturedCount)" "$rollup_out")"

if [ "$pr_netinput" = "300" ]; then
  ok "R27: per-request sum is 100+200=300"
else
  bad "R27: per-request sum is WRONG (expected 300)" "got netInput=$pr_netinput / $rollup_out"
fi
if [ "$rt_netinput" = "500" ]; then
  ok "R27: run-total sum is 500 (the one record)"
else
  bad "R27: run-total sum is WRONG (expected 500)" "got netInput=$rt_netinput / $rollup_out"
fi
if [ "$sc_netinput" = "3000" ]; then
  ok "R27: session-cumulative contributes ONLY the last snapshot (3000), never the sum of three (6000) or a delta"
else
  bad "R27: session-cumulative did NOT contribute only the last snapshot" "got netInput=$sc_netinput (expected 3000) / $rollup_out"
fi
if [ "$unc_count" = "1" ]; then
  ok "R27: uncapturedCount is 1, outside every sum"
else
  bad "R27: uncapturedCount is WRONG (expected 1)" "got $unc_count / $rollup_out"
fi
if grep -qF '"mixed"' <<< "$rollup_out"; then
  bad "R27: 'mixed' marker present WITHOUT --combined being requested" "$rollup_out"
else
  ok "R27: 'mixed' marker absent when --combined is not requested"
fi
mixed_list="$(node -e "console.log(JSON.stringify(JSON.parse(process.argv[1]).combined.mixed))" "$combined_out")"
if grep -qF 'per-request' <<< "$mixed_list" && grep -qF 'run-total' <<< "$mixed_list" && grep -qF 'session-cumulative' <<< "$mixed_list"; then
  ok "R27: --combined's 'mixed' marker names exactly the fidelities that contributed"
else
  bad "R27: --combined's 'mixed' marker is WRONG" "$mixed_list / $combined_out"
fi

# --- R27 failure-record case: an adapter that throws -------------------------
echo
echo "=== R27 (failure-record) — an adapter that throws still gets attributed and counted ==="
DIR_AS_TRANSCRIPT="$(mktemp -d)"
BEFORE_LIST="$(find "$R27_ROOT/journal/claude-code" -name '*.json' ! -name '*.wing.json' ! -name '*.attr.json' 2>/dev/null | LC_ALL=C sort)"
ATTR_CTX_ENV_CREWRIG_TASK="attr-r27-failure-task" CREWRIG_TASK="attr-r27-failure-task" run_driver capture-throw claude-code "$DIR_AS_TRANSCRIPT" /tmp >/dev/null
AFTER_LIST="$(find "$R27_ROOT/journal/claude-code" -name '*.json' ! -name '*.wing.json' ! -name '*.attr.json' 2>/dev/null | LC_ALL=C sort)"
NEW_ENTRY="$(comm -13 <(printf '%s\n' "$BEFORE_LIST") <(printf '%s\n' "$AFTER_LIST") | head -1)"

if [ -n "$NEW_ENTRY" ] && grep -qF 'capture threw' "$NEW_ENTRY" && grep -qF '"kind":"uncaptured"' "$NEW_ENTRY"; then
  ok "R27 failure-record: the dispatcher's own catch produced exactly one new uncaptured entry naming the throw"
else
  bad "R27 failure-record: no matching uncaptured entry was found" "before=$BEFORE_LIST after=$AFTER_LIST"
fi
if [ -n "$NEW_ENTRY" ] && grep -qF '"attribution":{"taskHandoffKey":"attr-r27-failure-task"}' "$NEW_ENTRY"; then
  ok "R27 failure-record: the uncaptured record carries an attribution block"
else
  bad "R27 failure-record: the uncaptured record does NOT carry an attribution block" "$(cat "$NEW_ENTRY" 2>&1)"
fi
NEW_RID="$(basename "$NEW_ENTRY" .json)"
NEW_ATTR_SIDECAR="$(attr_sidecar_path "$R27_ROOT" claude-code "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).timing.requestInstant.slice(0,7))" "$NEW_ENTRY")" "$NEW_RID")"
if [ -f "$NEW_ATTR_SIDECAR" ] && grep -qF '"channel":"env"' "$NEW_ATTR_SIDECAR"; then
  ok "R27 failure-record: the .attr.json sidecar names channel 'env'"
else
  bad "R27 failure-record: the .attr.json sidecar is missing or does not name the channel" "$NEW_ATTR_SIDECAR"
fi
failure_rollup="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key attr-r27-failure-task --rollup)"
failure_unc_count="$(node -e "console.log(JSON.parse(process.argv[1]).uncapturedCount)" "$failure_rollup")"
if [ "$failure_unc_count" = "1" ]; then
  ok "R27 failure-record: the rollup for this task key reports uncapturedCount: 1"
else
  bad "R27 failure-record: the rollup did NOT report uncapturedCount: 1" "got $failure_unc_count / $failure_rollup"
fi

# =============================================================================
# R28 — root override
# =============================================================================
echo
echo "=== R28 — root override: \$HOME/.crewrig/usage untouched; ledger/declaration/rollup land under CREWRIG_USAGE_ROOT ==="
R28_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$R28_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

run_driver declaration-write '{"taskHandoffKey":"r28-decl-key","declaringChannel":"explicit","sessionId":"attr-r28-session"}' >/dev/null
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" run_driver submit "$FIXTURES_DIR/r28-record.json")"
if ! grep -qF '"status":"stored"' <<< "$out"; then
  bad "R28 base record did NOT store" "$out"
fi
R28_LEDGER_ENTRY_JSON='{"scope":{"session":"attr-r28-session"},"timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","author":"test-suite","reason":"R28 root-override probe","taskHandoffKey":"r28-ledger-key"}'
run_driver ledger-append "$R28_LEDGER_ENTRY_JSON" >/dev/null
rollup_out="$(bash "$REPO_DIR/scripts/usage-query.sh" --session attr-r28-session --rollup)"

if [ -e "$REAL_HOME_USAGE_DIR" ]; then
  HOME_USAGE_MARKER_AFTER="$(find "$REAL_HOME_USAGE_DIR" -type f 2>/dev/null | LC_ALL=C sort)"
else
  HOME_USAGE_MARKER_AFTER="<absent>"
fi
if [ "$HOME_USAGE_MARKER_BEFORE" = "$HOME_USAGE_MARKER_AFTER" ]; then
  ok "R28: \$HOME/.crewrig/usage marker is unchanged after the run"
else
  bad "R28: \$HOME/.crewrig/usage marker CHANGED — the suite wrote under the real root" "before=[$HOME_USAGE_MARKER_BEFORE] after=[$HOME_USAGE_MARKER_AFTER]"
fi

DECL_DIR_COUNT="$(find "$R28_ROOT/declarations" -type f 2>/dev/null | wc -l | tr -d ' ')"
LEDGER_DIR_COUNT="$(find "$R28_ROOT/ledger" -type f 2>/dev/null | wc -l | tr -d ' ')"
if [ "$DECL_DIR_COUNT" -ge 1 ] && [ "$LEDGER_DIR_COUNT" -ge 1 ] && grep -qF '"taskHandoffKey":"r28-ledger-key"' <<< "$rollup_out" || grep -qF '"uncapturedCount"' <<< "$rollup_out"; then
  ok "R28: the declaration and the ledger entry both landed under the relocated CREWRIG_USAGE_ROOT ($DECL_DIR_COUNT decl file(s), $LEDGER_DIR_COUNT ledger file(s))"
else
  bad "R28: declaration/ledger did NOT land under the relocated root as expected" "decl=$DECL_DIR_COUNT ledger=$LEDGER_DIR_COUNT rollup=$rollup_out"
fi
rollup_taskkey="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key r28-ledger-key --rollup)"
rollup_taskkey_unc="$(node -e "console.log(JSON.stringify(JSON.parse(process.argv[1]).byFidelity['per-request']))" "$rollup_taskkey")"
if grep -qF 'netInput' <<< "$rollup_taskkey_unc"; then
  ok "R28: the rollup queried against the ledger-relocated key resolves under CREWRIG_USAGE_ROOT"
else
  bad "R28: the rollup query for the ledger-relocated key returned nothing" "$rollup_taskkey"
fi

# =============================================================================
# R29 — cross-CLI identity
# =============================================================================
echo
echo "=== R29 — cross-CLI identity: three sessions, one checkout, byte-identical attribution ==="
R29_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$R29_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

R29_CHECKOUT="$SYN_PARENT/r29-checkout"
build_checkout "$R29_CHECKOUT" "fix/0920-cross-cli-identity" "git@github.com:crewrig/crewrig.git"

for f in r29-claude-code r29-gemini-cli r29-subagent; do
  out="$(ATTR_CTX_CWD="$R29_CHECKOUT" run_driver submit "$FIXTURES_DIR/$f.json")"
  if ! grep -qF '"status":"stored"' <<< "$out"; then
    bad "R29 fixture $f did NOT store" "$out"
  fi
done

R29_CC_RID="$(record_id_of "$FIXTURES_DIR/r29-claude-code.json")"
R29_GEMINI_RID="$(record_id_of "$FIXTURES_DIR/r29-gemini-cli.json")"
R29_SUB_RID="$(record_id_of "$FIXTURES_DIR/r29-subagent.json")"
R29_PERIOD="$(run_driver period "$FIXTURES_DIR/r29-claude-code.json")"

CC_ATTR="$(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).attribution))" "$(attr_sidecar_path "$R29_ROOT" claude-code "$R29_PERIOD" "$R29_CC_RID")")"
GEMINI_ATTR="$(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).attribution))" "$(attr_sidecar_path "$R29_ROOT" gemini-cli "$R29_PERIOD" "$R29_GEMINI_RID")")"
SUB_ATTR="$(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).attribution))" "$(attr_sidecar_path "$R29_ROOT" claude-code "$R29_PERIOD" "$R29_SUB_RID")")"

if [ "$CC_ATTR" = "$GEMINI_ATTR" ] && [ "$GEMINI_ATTR" = "$SUB_ATTR" ] && [ "$CC_ATTR" != "null" ]; then
  ok "R29: attribution JSON is byte-identical across the Claude Code session, the Gemini CLI session, and the subagent ($CC_ATTR)"
else
  bad "R29: attribution JSON diverged across the three records" "cc=$CC_ATTR gemini=$GEMINI_ATTR sub=$SUB_ATTR"
fi

R29_TASK_KEY="$(node -e "console.log(JSON.parse(process.argv[1]).taskHandoffKey)" "$CC_ATTR")"
combined_rollup="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key "$R29_TASK_KEY" --rollup)"
combined_netinput="$(node -e "console.log(JSON.parse(process.argv[1]).byFidelity['per-request'].netInput)" "$combined_rollup")"
if [ "$combined_netinput" = "666" ]; then
  ok "R29: one combined rollup sums all three records under the shared task key (111+222+333=666)"
else
  bad "R29: the combined rollup did NOT sum all three records" "got netInput=$combined_netinput (expected 666) / $combined_rollup"
fi

# =============================================================================
# Prune — 0208 R17, delta-01 R31/R32/R33 no-store half
# =============================================================================
echo
echo "=== Prune — R17 scenario, both registry arms, and the no-registered-store half ==="
PRUNE_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$PRUNE_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

# --- (a) both arms execute: register a synthetic cli-period member ---------
LAYOUT_JS="$REPO_DIR/scripts/lib/usage-store/layout.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = \"isEntry: isLedgerEntry,\n    },\n  ];\";
if (!src.includes(marker)) { console.error('FATAL: derivedStores() marker not found in layout.js'); process.exit(1); }
const addition = \"isEntry: isLedgerEntry,\n    },\n    {\n      id: 'test-store',\n      scope: 'cli-period',\n      dirFor: (cli, per) => path.join(resolveRoot(), 'test-cli-period-store', cli, per),\n      isEntry: (name) => /^test-entry-.*\\\\.json\$/.test(name),\n    },\n  ];\";
src = src.replace(marker, addition);
fs.writeFileSync(p, src);
" "$LAYOUT_JS"

# Populate both stores' partitions for the same past cli/period. The cli MUST
# match the fixture's own provenance.cli (claude-code, the generator's
# default) or the per-record loop and periodHasAnyJournalEntries() would
# target an empty partition and the ledger arm would (correctly) skip as
# "another CLI still holds this period" rather than exercising R17.
PRUNE_CLI="claude-code"
PRUNE_PERIOD="2024-08"
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" ATTR_CTX_ENV_CREWRIG_TASK="attr-prune-key" run_driver submit "$FIXTURES_DIR/prune-main-record.json")"
if ! grep -qF '"status":"stored"' <<< "$out"; then
  bad "Prune main record did NOT store" "$out"
fi
PRUNE_LEDGER_JSON='{"scope":{"session":"attr-prune-session"},"timestamp":"2024-08-20T00:00:00.000Z","author":"test-suite","reason":"Prune R17 scenario ledger entry","taskHandoffKey":"prune-ledger-key"}'
run_driver ledger-append "$PRUNE_LEDGER_JSON" >/dev/null

TEST_STORE_PARTITION="$PRUNE_ROOT/test-cli-period-store/$PRUNE_CLI/$PRUNE_PERIOD"
mkdir -p "$TEST_STORE_PARTITION"
echo '{"probe":true}' > "$TEST_STORE_PARTITION/test-entry-1.json"

PRUNE_RID="$(record_id_of "$FIXTURES_DIR/prune-main-record.json")"
PRUNE_ENTRY="$(journal_entry_path "$PRUNE_ROOT" "$PRUNE_CLI" "$PRUNE_PERIOD" "$PRUNE_RID")"
PRUNE_ATTR_SIDECAR="$(attr_sidecar_path "$PRUNE_ROOT" "$PRUNE_CLI" "$PRUNE_PERIOD" "$PRUNE_RID")"

prune_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" "$PRUNE_CLI" "$PRUNE_PERIOD" --force)"

if [ ! -f "$PRUNE_ENTRY" ] && [ ! -f "$PRUNE_ATTR_SIDECAR" ]; then
  ok "Prune: the journal entry and its .attr.json sidecar are both removed"
else
  bad "Prune: the journal entry or sidecar SURVIVED the prune" "entry_exists=$([ -f "$PRUNE_ENTRY" ] && echo yes || echo no) attr_exists=$([ -f "$PRUNE_ATTR_SIDECAR" ] && echo yes || echo no)"
fi
if [ -z "$(find "$PRUNE_ROOT/ledger/$PRUNE_PERIOD" -type f 2>/dev/null)" ]; then
  ok "Prune: the attribution-ledger's entries for this period are removed"
else
  bad "Prune: attribution-ledger entries SURVIVED the prune" "$(find "$PRUNE_ROOT/ledger/$PRUNE_PERIOD" -type f 2>/dev/null)"
fi
if grep -qF 'attribution-ledger' <<< "$prune_out" && grep -qiE 'attribution-ledger: [1-9]' <<< "$prune_out"; then
  ok "Prune: the report names attribution-ledger with its (non-zero) count"
else
  bad "Prune: the report did NOT name attribution-ledger with a count" "$prune_out"
fi
if [ ! -d "$TEST_STORE_PARTITION" ] && grep -qF 'test-store' <<< "$prune_out" && grep -qiE 'test-store: 1' <<< "$prune_out"; then
  ok "Prune: the cli-period arm unlinked the synthetic entry, rmdir'd the emptied partition, and reported { id: 'test-store', removed: 1 }"
else
  bad "Prune: the cli-period arm did NOT execute as expected" "partition_exists=$([ -d "$TEST_STORE_PARTITION" ] && echo yes || echo no) report=$prune_out"
fi

# --- (b) no registered store holds anything: no store named in the report --
NOSTORE_RID="$(record_id_of "$FIXTURES_DIR/prune-no-store-record.json")"
out="$(ATTR_CTX_CWD="$NO_GIT_CWD" run_driver submit "$FIXTURES_DIR/prune-no-store-record.json")"
if ! grep -qF '"status":"stored"' <<< "$out"; then
  bad "Prune no-store record did NOT store" "$out"
fi
NOSTORE_PERIOD="$(run_driver period "$FIXTURES_DIR/prune-no-store-record.json")"
NOSTORE_ENTRY="$(journal_entry_path "$PRUNE_ROOT" claude-code "$NOSTORE_PERIOD" "$NOSTORE_RID")"

nostore_prune_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$NOSTORE_PERIOD" --force)"

if [ ! -f "$NOSTORE_ENTRY" ]; then
  ok "Prune (no-store): the journal entry is still removed"
else
  bad "Prune (no-store): the journal entry SURVIVED" "$NOSTORE_ENTRY"
fi
if ! grep -qiF 'attribution-ledger' <<< "$nostore_prune_out" && ! grep -qiF 'test-store' <<< "$nostore_prune_out"; then
  ok "Prune (no-store): no derived store is named in the report — delta-01 R33's second clause, R32's pre-delta behaviour preserved"
else
  bad "Prune (no-store): a store with nothing to remove WAS named in the report" "$nostore_prune_out"
fi

git -C "$REPO_DIR" checkout -- "$LAYOUT_JS"
if git -C "$REPO_DIR" diff --quiet -- "$LAYOUT_JS"; then
  ok "layout.js is restored to its committed content after the synthetic cli-period member registration"
else
  bad "layout.js was NOT fully restored after the synthetic registration"
fi

# =============================================================================
# No-network / no-subprocess grep
# =============================================================================
echo
echo "=== No-network / no-subprocess grep over the attribution-resolution modules ==="
grep_out="$(grep -n -E "child_process|execSync|spawnSync|fetch\(|https?://" \
  "$REPO_DIR/scripts/lib/usage-capture/attribution.js" \
  "$REPO_DIR/scripts/lib/usage-store/checkout.js" \
  "$REPO_DIR/scripts/lib/usage-store/declaration.js" 2>&1 || true)"
if [ -z "$grep_out" ]; then
  ok "no-network/no-subprocess grep: zero hits across attribution.js, checkout.js, declaration.js"
else
  bad "no-network/no-subprocess grep found a hit" "$grep_out"
fi

# =============================================================================
# Mutation discipline
# =============================================================================
echo
echo "=== MUTATION 1/6: writeInner() skipping the .attr.json link (e'') ==="
MUT_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$MUT_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

JOURNAL_JS="$REPO_DIR/scripts/lib/usage-store/journal.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = 'if (meta !== undefined) {';
if (!src.includes(marker)) { console.error('FATAL: (e\'\') marker not found in journal.js'); process.exit(1); }
src = src.replace(marker, 'if (false && meta !== undefined) {');
fs.writeFileSync(p, src);
" "$JOURNAL_JS"

mut1_out="$(ATTR_CTX_CWD="$NO_GIT_CWD" ATTR_CTX_ENV_CREWRIG_TASK="mut1-key" run_driver submit "$FIXTURES_DIR/r25-ch2-env.json")"
git -C "$REPO_DIR" checkout -- "$JOURNAL_JS"

MUT1_RID="$(record_id_of "$FIXTURES_DIR/r25-ch2-env.json")"
MUT1_PERIOD="$(run_driver period "$FIXTURES_DIR/r25-ch2-env.json")"
MUT1_ATTR_SIDECAR="$(attr_sidecar_path "$MUT_ROOT" claude-code "$MUT1_PERIOD" "$MUT1_RID")"
if grep -qF '"status":"stored"' <<< "$mut1_out" && [ ! -f "$MUT1_ATTR_SIDECAR" ]; then
  ok "MUTATION 1 RED: skipping (e'') stores the entry with NO .attr.json sidecar"
else
  bad "MUTATION 1 not red: sidecar-skip mutation did not reproduce a missing sidecar" "$mut1_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$JOURNAL_JS"; then
  ok "journal.js is restored to its committed content after MUTATION 1"
else
  bad "journal.js was NOT fully restored after MUTATION 1"
fi

echo
echo "=== MUTATION 2/6: the resolver consulting channel 2 after a malformed channel 1 ==="
ATTRIBUTION_JS="$REPO_DIR/scripts/lib/usage-capture/attribution.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = 'if (candidate !== null) {\n      return validateCandidate(candidate);\n    }';
if (!src.includes(marker)) { console.error('FATAL: resolver-loop marker not found in attribution.js'); process.exit(1); }
const replacement = 'if (candidate !== null) {\n      const validated = validateCandidate(candidate);\n      if (validated.outcome === \'unattributed\') continue; // MUTATION-2\n      return validated;\n    }';
src = src.replace(marker, replacement);
fs.writeFileSync(p, src);
" "$ATTRIBUTION_JS"

run_driver declaration-write '{"taskHandoffKey":"has a space","declaringChannel":"explicit","sessionId":"attr-malformed-session"}' >/dev/null
mut2_out="$(ATTR_CTX_CWD="$NO_GIT_CWD" ATTR_CTX_ENV_CREWRIG_TASK="valid-env-key" run_driver resolve "$FIXTURES_DIR/r25-malformed-ch1.json")"
git -C "$REPO_DIR" checkout -- "$ATTRIBUTION_JS"

if grep -qF 'valid-env-key' <<< "$mut2_out"; then
  ok "MUTATION 2 RED: CREWRIG_TASK's valid key now LEAKS through after a malformed channel 1"
else
  bad "MUTATION 2 not red: the malformed-channel-1 case did not fall through to channel 2" "$mut2_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$ATTRIBUTION_JS"; then
  ok "attribution.js is restored to its committed content after MUTATION 2"
else
  bad "attribution.js was NOT fully restored after MUTATION 2"
fi

echo
echo "=== MUTATION 3/6: dropping the spec/ file lookup so feat/0203-… yields 203 ==="
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = 'const specShape = branch.match(/^([a-z]+)\\\\/(\\\\d{4})-([a-z0-9][a-z0-9-]*?)(?:-delta-(\\\\d{2}))?\$/);';
if (!src.includes(marker)) { console.error('FATAL: specShape marker not found in attribution.js'); process.exit(1); }
src = src.replace(marker, 'const specShape = null; // MUTATION-3: drop the spec-file lookup entirely');
fs.writeFileSync(p, src);
" "$ATTRIBUTION_JS"

mut3_out="$(ATTR_CTX_CWD="$BRANCH_IV" run_driver resolve "$FIXTURES_DIR/r25-branch-iv.json")"
git -C "$REPO_DIR" checkout -- "$ATTRIBUTION_JS"

if grep -qF '"taskHandoffKey":"203"' <<< "$mut3_out"; then
  ok "MUTATION 3 RED: with the spec-file lookup dropped, feat/0203-… regresses to 203 instead of 1113"
else
  bad "MUTATION 3 not red: feat/0203-… did not regress to 203" "$mut3_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$ATTRIBUTION_JS"; then
  ok "attribution.js is restored to its committed content after MUTATION 3"
else
  bad "attribution.js was NOT fully restored after MUTATION 3"
fi

echo
echo "=== MUTATION 4/6: checkoutRootFor() returning projectRoot unchanged (subdirectory loses the asset) ==="
CHECKOUT_JS="$REPO_DIR/scripts/lib/usage-store/checkout.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = 'if (memo.has(real)) return memo.get(real);';
if (!src.includes(marker)) { console.error('FATAL: checkoutRootFor marker not found in checkout.js'); process.exit(1); }
src = src.replace(marker, 'if (memo.has(real)) return memo.get(real);\n  return real; // MUTATION-4: no upward walk');
fs.writeFileSync(p, src);
" "$CHECKOUT_JS"

mut4_out="$(ATTR_PROJECT_ROOT_OVERRIDE="$BRANCH_III_SUBDIR" ATTR_CTX_CWD="$BRANCH_III_SUBDIR" run_driver resolve "$FIXTURES_DIR/r25-branch-iii.json")"
git -C "$REPO_DIR" checkout -- "$CHECKOUT_JS"

if grep -qF '"outcome":"unattributed"' <<< "$mut4_out" || ! grep -qF 'forge-issue' <<< "$mut4_out"; then
  ok "MUTATION 4 RED: with checkoutRootFor() not walking up, the subdirectory case loses the asset"
else
  bad "MUTATION 4 not red: the subdirectory case still derived the asset" "$mut4_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$CHECKOUT_JS"; then
  ok "checkout.js is restored to its committed content after MUTATION 4"
else
  bad "checkout.js was NOT fully restored after MUTATION 4"
fi

echo
echo "=== MUTATION 5/6: prune() skipping the period arm, then the cli-period arm ==="
MUT5_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$MUT5_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = \"isEntry: isLedgerEntry,\n    },\n  ];\";
if (!src.includes(marker)) { console.error('FATAL: derivedStores() marker not found in layout.js'); process.exit(1); }
const addition = \"isEntry: isLedgerEntry,\n    },\n    {\n      id: 'test-store',\n      scope: 'cli-period',\n      dirFor: (cli, per) => path.join(resolveRoot(), 'test-cli-period-store', cli, per),\n      isEntry: (name) => /^test-entry-.*\\\\.json\$/.test(name),\n    },\n  ];\";
src = src.replace(marker, addition);
fs.writeFileSync(p, src);
" "$LAYOUT_JS"

MUT5_CLI="claude-code"
MUT5_PERIOD="2024-08"
run_driver declaration-write '{"taskHandoffKey":"mut5-decl","declaringChannel":"explicit","sessionId":"attr-prune-session"}' >/dev/null
ATTR_CTX_CWD="$NO_GIT_CWD" run_driver submit "$FIXTURES_DIR/prune-main-record.json" >/dev/null
MUT5_LEDGER_JSON='{"scope":{"session":"attr-prune-session"},"timestamp":"2024-08-20T00:00:00.000Z","author":"test-suite","reason":"MUTATION-5 probe","taskHandoffKey":"mut5-ledger-key"}'
run_driver ledger-append "$MUT5_LEDGER_JSON" >/dev/null
MUT5_TEST_STORE_PARTITION="$MUT5_ROOT/test-cli-period-store/$MUT5_CLI/$MUT5_PERIOD"
mkdir -p "$MUT5_TEST_STORE_PARTITION"
echo '{"probe":true}' > "$MUT5_TEST_STORE_PARTITION/test-entry-1.json"

PRUNE_JS="$REPO_DIR/scripts/lib/usage-store/prune.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = \"if (store.scope === 'period') {\n      dir = store.dirFor(per);\";
if (!src.includes(marker)) { console.error('FATAL: period-arm marker not found in prune.js'); process.exit(1); }
src = src.replace(marker, \"if (store.scope === 'period' && false) { // MUTATION-5a: skip the period arm\n      dir = store.dirFor(per);\");
fs.writeFileSync(p, src);
" "$PRUNE_JS"
mut5a_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" "$MUT5_CLI" "$MUT5_PERIOD" --force)"
git -C "$REPO_DIR" checkout -- "$PRUNE_JS"
if ! grep -qiF 'attribution-ledger' <<< "$mut5a_out"; then
  ok "MUTATION 5a RED: skipping the period arm leaves the attribution-ledger UNreported (still holding entries)"
else
  bad "MUTATION 5a not red: attribution-ledger was still reported despite the period arm being skipped" "$mut5a_out"
fi
if [ -n "$(find "$MUT5_ROOT/ledger" -type f 2>/dev/null)" ]; then
  ok "MUTATION 5a RED: the ledger entries physically survive the prune with the period arm skipped"
else
  bad "MUTATION 5a not red: ledger entries were removed despite the period arm being skipped"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRUNE_JS"; then
  ok "prune.js is restored to its committed content after MUTATION 5a"
else
  bad "prune.js was NOT fully restored after MUTATION 5a"
fi

# Mutation 5a's own (unmutated) cli-period arm already consumed the
# test-store partition populated above — re-populate it so 5b's assertion
# (that the cli-period arm is skipped) has something to skip.
mkdir -p "$MUT5_TEST_STORE_PARTITION"
echo '{"probe":true}' > "$MUT5_TEST_STORE_PARTITION/test-entry-1.json"

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = \"} else if (store.scope === 'cli-period') {\n      dir = store.dirFor(cli, per);\";
if (!src.includes(marker)) { console.error('FATAL: cli-period-arm marker not found in prune.js'); process.exit(1); }
src = src.replace(marker, \"} else if (store.scope === 'cli-period' && false) { // MUTATION-5b: skip the cli-period arm\n      dir = store.dirFor(cli, per);\");
fs.writeFileSync(p, src);
" "$PRUNE_JS"
mut5b_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" "$MUT5_CLI" "$MUT5_PERIOD" --force)"
git -C "$REPO_DIR" checkout -- "$PRUNE_JS"
if ! grep -qiF 'test-store' <<< "$mut5b_out" && [ -d "$MUT5_TEST_STORE_PARTITION" ]; then
  ok "MUTATION 5b RED: skipping the cli-period arm leaves the synthetic test-store UNreported and its partition intact"
else
  bad "MUTATION 5b not red: the cli-period arm still executed despite being skipped" "report=$mut5b_out partition_exists=$([ -d "$MUT5_TEST_STORE_PARTITION" ] && echo yes || echo no)"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRUNE_JS"; then
  ok "prune.js is restored to its committed content after MUTATION 5b"
else
  bad "prune.js was NOT fully restored after MUTATION 5b"
fi

git -C "$REPO_DIR" checkout -- "$LAYOUT_JS"
if git -C "$REPO_DIR" diff --quiet -- "$LAYOUT_JS"; then
  ok "layout.js is restored to its committed content after MUTATION 5's synthetic registration"
else
  bad "layout.js was NOT fully restored after MUTATION 5's synthetic registration"
fi

echo
echo "=== MUTATION 6/6: contributingRecords() summing the three cumulative snapshots ==="
ROLLUP_JS="$REPO_DIR/scripts/lib/usage-store/rollup.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = \"'session-cumulative': lastSnapshots(captured),\";
if (!src.includes(marker)) { console.error('FATAL: contributingRecords marker not found in rollup.js'); process.exit(1); }
src = src.replace(marker, \"'session-cumulative': captured.filter((r) => r.fidelity === 'session-cumulative'), // MUTATION-6\");
fs.writeFileSync(p, src);
" "$ROLLUP_JS"

export CREWRIG_USAGE_ROOT="$R27_ROOT"
mut6_rollup="$(bash "$REPO_DIR/scripts/usage-query.sh" --task-key attr-r27-task --rollup)"
git -C "$REPO_DIR" checkout -- "$ROLLUP_JS"
mut6_sc_netinput="$(node -e "console.log(JSON.parse(process.argv[1]).byFidelity['session-cumulative'].netInput)" "$mut6_rollup")"

if [ "$mut6_sc_netinput" = "6000" ]; then
  ok "MUTATION 6 RED: session-cumulative now sums all three snapshots (6000) instead of the last one (3000)"
else
  bad "MUTATION 6 not red: session-cumulative did not regress to the sum of three" "got $mut6_sc_netinput (expected 6000) / $mut6_rollup"
fi
if git -C "$REPO_DIR" diff --quiet -- "$ROLLUP_JS"; then
  ok "rollup.js is restored to its committed content after MUTATION 6"
else
  bad "rollup.js was NOT fully restored after MUTATION 6"
fi

# =============================================================================
# Summary
# =============================================================================
echo
echo "=== Summary ==="
echo "PASS: $pass  FAIL: $fail"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
