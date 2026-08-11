#!/bin/bash
# test-antigravity-discovery-probe.sh — Regression tests for the discovery
# probe's R14 classifier and its bounded call (spec 0123, issue #761).
#
# Unit under test: scripts/probe-antigravity-discovery.sh, with `AGY_BIN`
# stubbed and `AGY_PROBE_TIMEOUT` set small.
#
# WHY THIS SUITE SPAWNS WHERE ITS SIBLING SOURCES. The probe carries top-level
# logic and cannot be sourced, so it must be spawned — and the bounded wait,
# whose Bash 3.2 behaviour this suite is the only runtime detector of, lives
# exactly there. Every spawn therefore uses `"${BASH:-bash}" "$SUBJECT"`, never
# a bare `bash`: a bare spawn would develop and verify this code at 5.3 while
# the harness banner printed 3.2, which is the failure mode
# `scripts/tests/test-component-tier-resolution.sh` shows at :318 (banner)
# against :437 (bare spawn). Measured across the suite directory: 0 of 68 suites
# propagate the interpreter to their subjects. This one does; sweeping the rest
# belongs to issue #798.
#
# THE PROBE ITSELF CANNOT RUN IN CI — it needs the vendor binary, a model-driven
# session and minutes of wall time, which spec 0123 -> "Out of scope" rules out.
# Its CLASSIFIER is what lands here, and that is hermetic.
#
# Contract asserted (spec 0123):
#   R13 — the procedure is re-runnable: it refuses to start on a name collision
#         and restores the pre-run tree exactly, including directories it did
#         NOT create.
#   R14 — three verdicts, and INDETERMINATE is distinct from NOT-FOUND in both
#         message and exit status. A sentinel with no answer line, an empty
#         answer, and a call that exceeds the bound are all INDETERMINATE.
#   Plus: nothing survives the bounded-out case — the only assertion that can
#         see a `kill` that reaches the wrapper instead of its process group.
#
# HERMETIC: `HOME` and `AGY_BIN` both point into a temp root. No `agy`, no
# network, no writes to the real home.
#
# Usage:
#   bash scripts/tests/test-antigravity-discovery-probe.sh

# -e intentionally omitted: the counters drive the harness and most runs of the
# subject are expected to exit non-zero.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SUBJECT="$REPO_DIR/scripts/probe-antigravity-discovery.sh"
[ -f "$SUBJECT" ] || { echo "FATAL: missing $SUBJECT" >&2; exit 2; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "Interpreter this harness runs on: $BASH_VERSION"
echo "Subject is spawned as: \"\${BASH:-bash}\" -> ${BASH:-bash}"
echo ""

HANG_MARKER="crewrig-761-probe-hang-marker"
PIDFILE="$TMP_ROOT/hang-pids"
: > "$PIDFILE"

STUB="$TMP_ROOT/agy-stub.sh"
cat > "$STUB" <<STUB_EOF
#!/bin/bash
# Stub vendor binary. STUB_MODE selects the failure shape under test.
if [ "\${1:-}" = "agents" ]; then
  printf '%s\n' "\${STUB_AGENTS_LISTING:-crewrig-probe-agent-dup}"
  exit 0
fi
prompt="\${2:-}"
case "\${STUB_MODE:-answer}" in
  hang)
    # Fork a child and block. A \`kill\` aimed at this wrapper leaves the child
    # running; only a process-group kill reaches it.
    ( exec -a "$HANG_MARKER" sleep 300 ) &
    echo \$! >> "$PIDFILE"
    wait
    ;;
  empty)
    : # answer nothing at all
    ;;
  *)
    printf '%s\n' "\$prompt" \
      | grep -oE 'crewrig-probe-[a-z-]+|agy-customizations' \
      | sort -u \
      | while read -r n; do
          if [ "\$n" = "\${STUB_OMIT:-}" ]; then continue; fi
          echo "\$n=\${STUB_VERDICT:-YES}"
        done
    ;;
esac
STUB_EOF
chmod +x "$STUB"

# run_probe <case-name> <shape> [VAR=VALUE ...]
# Spawns the subject with a fresh temp HOME. Sets RUN_OUT and RUN_ST.
run_probe() {
  local case_name="$1" shape="$2"; shift 2
  RUN_HOME="$TMP_ROOT/home-$case_name-$shape"
  mkdir -p "$RUN_HOME"
  RUN_OUT="$(env HOME="$RUN_HOME" AGY_BIN="$STUB" AGY_PROBE_TIMEOUT=1 \
    AGY_PROBE_ASK_SHAPE="$shape" "$@" \
    "${BASH:-bash}" "$SUBJECT" 2>&1)"
  RUN_ST=$?
}

# verdict_for <output> <sentinel> — the verdict token the table printed for it.
verdict_for() {
  printf '%s\n' "$1" | awk -v want="$2" '
    $2 == want { print $1; exit }
  '
}

# --- The classification matrix, driven through BOTH call shapes --------------
# The two shapes have different `set -e` behaviour on the bounded-out path — a
# direct top-level call aborts at 143 and loses the classification, while a
# command substitution completes and returns 0, which is blindness rather than
# safety. The implementation closes both with `wait "$pid" || st=$?`, and both
# are exercised here so no reader has to predict which symptom a given call site
# would show.
for shape in captured direct; do
  echo "=== call shape: $shape ==="

  # --- R14 verdict 1: YES -> FOUND -------------------------------------------
  run_probe yes "$shape" STUB_VERDICT=YES
  [ "$RUN_ST" -eq 0 ] && ok "[$shape] an all-YES answer exits 0" \
    || bad "[$shape] an all-YES answer exited $RUN_ST"
  [ "$(verdict_for "$RUN_OUT" crewrig-probe-skill-config)" = "FOUND" ] \
    && ok "[$shape] R14: YES classifies as FOUND" \
    || bad "[$shape] R14: YES did not classify as FOUND"

  # --- R14 verdict 2: NO -> NOT-FOUND ----------------------------------------
  run_probe no "$shape" STUB_VERDICT=NO
  [ "$RUN_ST" -eq 0 ] && ok "[$shape] an all-NO answer exits 0" \
    || bad "[$shape] an all-NO answer exited $RUN_ST"
  [ "$(verdict_for "$RUN_OUT" crewrig-probe-skill-config)" = "NOT-FOUND" ] \
    && ok "[$shape] R14: NO classifies as NOT-FOUND" \
    || bad "[$shape] R14: NO did not classify as NOT-FOUND"

  # --- R14 verdict 3a: an omitted line is a NON-ANSWER, not an absence -------
  # This is the whole reason the forced-choice shape exists. An open listing
  # cannot tell "the assistant does not have it" from "the assistant did not
  # answer", and reading the second as the first is the error already made once
  # on this ticket.
  run_probe omit "$shape" STUB_VERDICT=NO STUB_OMIT=crewrig-probe-skill-config
  [ "$(verdict_for "$RUN_OUT" crewrig-probe-skill-config)" = "INDETERMINATE" ] \
    && ok "[$shape] R14: a sentinel with no answer line is INDETERMINATE" \
    || bad "[$shape] R14: an omitted sentinel was folded into NOT-FOUND"
  [ "$(verdict_for "$RUN_OUT" crewrig-probe-skill-appdata)" = "NOT-FOUND" ] \
    && ok "[$shape] R14: the sentinels that WERE answered still classify" \
    || bad "[$shape] R14: an omission contaminated the answered sentinels"
  [ "$RUN_ST" -ne 0 ] \
    && ok "[$shape] R14: INDETERMINATE differs from NOT-FOUND in EXIT STATUS too" \
    || bad "[$shape] R14: an INDETERMINATE run exited 0, indistinguishable from a clean one"
  case "$RUN_OUT" in
    *"INDETERMINATE"*"re-run before recording"*) ok "[$shape] R14: the run says not to record an absence" ;;
    *) bad "[$shape] R14: no explanatory INDETERMINATE message" ;;
  esac

  # --- R14 verdict 3b: an empty answer ---------------------------------------
  run_probe empty "$shape" STUB_MODE=empty
  [ "$(verdict_for "$RUN_OUT" crewrig-probe-skill-config)" = "INDETERMINATE" ] \
    && ok "[$shape] R14: an empty answer is INDETERMINATE" \
    || bad "[$shape] R14: an empty answer was not INDETERMINATE"
  [ "$RUN_ST" -ne 0 ] && ok "[$shape] an empty answer exits non-zero" \
    || bad "[$shape] an empty answer exited 0"

  # --- R14 verdict 3c: the bound is exceeded ---------------------------------
  run_probe hang "$shape" STUB_MODE=hang
  [ "$(verdict_for "$RUN_OUT" crewrig-probe-skill-config)" = "INDETERMINATE" ] \
    && ok "[$shape] R14: a call that exceeds the bound is INDETERMINATE" \
    || bad "[$shape] R14: a bounded-out call was not INDETERMINATE"
  [ "$RUN_ST" -ne 0 ] && ok "[$shape] a bounded-out run exits non-zero" \
    || bad "[$shape] a bounded-out run exited 0 — the classification was lost or faked"

  # THE PROCESS-GROUP ASSERTION. `kill "$pid"` reaches the backgrounded wrapper,
  # not the process it forked, so a timed-out `agy` outlives the EXIT trap that
  # removes the sentinels and keeps reading them. Only a process-group kill
  # (`set -m` plus `kill -TERM -- "-$pid"`) takes the tree down, and this is the
  # only assertion in the repository that can see the difference.
  survivors="$(ps -A -o pid=,command= 2>/dev/null | grep "$HANG_MARKER" | grep -v grep || true)"
  if [ -z "$survivors" ]; then
    ok "[$shape] nothing survives the bounded-out case"
  else
    bad "[$shape] a forked child outlived the bound: $survivors"
    # Do not leave them behind for the next case to trip over.
    printf '%s\n' "$survivors" | awk '{print $1}' | while read -r p; do kill -9 "$p" 2>/dev/null; done
  fi
  echo ""
done

# --- R13: the procedure is safely re-runnable --------------------------------
echo "=== re-runnability (R13) ==="

# It must refuse to start rather than remove something it did not write.
COLLIDE_HOME="$TMP_ROOT/home-collide"
mkdir -p "$COLLIDE_HOME/.gemini/config/skills/crewrig-probe-skill-config"
echo "someone else's file" > "$COLLIDE_HOME/.gemini/config/skills/crewrig-probe-skill-config/SKILL.md"
COLLIDE_OUT="$(env HOME="$COLLIDE_HOME" AGY_BIN="$STUB" AGY_PROBE_TIMEOUT=1 \
  "${BASH:-bash}" "$SUBJECT" 2>&1)"
COLLIDE_ST=$?
[ "$COLLIDE_ST" -eq 1 ] && ok "a pre-existing sentinel name aborts with the precondition status" \
  || bad "a name collision exited $COLLIDE_ST, not 1"
[ -f "$COLLIDE_HOME/.gemini/config/skills/crewrig-probe-skill-config/SKILL.md" ] \
  && ok "the colliding path is left untouched" \
  || bad "the probe removed a path it did not write"
case "$COLLIDE_OUT" in
  *"refusing to run"*) ok "the refusal explains itself" ;;
  *) bad "no explanatory refusal — got: $COLLIDE_OUT" ;;
esac

# It must restore the pre-run tree EXACTLY — including a directory that was
# already there. `~/.gemini/antigravity-cli/agents/` exists and is empty on any
# machine set up under the superseded installer, and removing it would be a
# state change the probe has no business making.
CLEAN_HOME="$TMP_ROOT/home-clean"
mkdir -p "$CLEAN_HOME/.gemini/antigravity-cli/agents" "$CLEAN_HOME/.gemini/skills/user-owned"
echo "mine" > "$CLEAN_HOME/.gemini/skills/user-owned/SKILL.md"
BEFORE="$(cd "$CLEAN_HOME" && find . | sort)"
env HOME="$CLEAN_HOME" AGY_BIN="$STUB" AGY_PROBE_TIMEOUT=1 STUB_VERDICT=YES \
  "${BASH:-bash}" "$SUBJECT" >/dev/null 2>&1
AFTER="$(cd "$CLEAN_HOME" && find . | sort)"
[ "$BEFORE" = "$AFTER" ] && ok "the tree is byte-identical before and after a clean run" \
  || bad "the probe changed the tree: $(diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") | tr '\n' ' ')"
[ -d "$CLEAN_HOME/.gemini/antigravity-cli/agents" ] \
  && ok "a pre-existing EMPTY directory survives the cleanup" \
  || bad "the cleanup removed a directory that was already there"
[ -f "$CLEAN_HOME/.gemini/skills/user-owned/SKILL.md" ] \
  && ok "user content under a probed root survives" \
  || bad "the probe destroyed user content"

# --- The suite must actually be spawning the subject at 3.2 when asked -------
echo ""
echo "=== interpreter propagation ==="
grep -q '"\${BASH:-bash}" "\$SUBJECT"' "$0" \
  && ok "this suite propagates its own interpreter to the subject" \
  || bad "this suite spawns the subject with a bare bash — the 3.2 claim would be false"

echo ""
echo "======================================"
echo "  passed: $pass    failed: $fail"
echo "======================================"
[ "$fail" -eq 0 ] || exit 1
exit 0
