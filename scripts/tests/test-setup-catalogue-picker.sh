#!/bin/bash
# test-setup-catalogue-picker.sh — Regression tests for the shared
# team/expertise/level catalogue picker (spec 0096, issue #603).
#
# Unit under test: pick_catalogue_entry() in scripts/lib/common.sh, driven
# through its hermetic surface (an empty fixture catalogue directory, and a
# stubbed `fzf` on PATH). The genuine interactive fzf UI is out of scope for
# an automated test, matching this repo's convention (see
# scripts/tests/test-setup-validation-backend.sh house style).
#
# Contract asserted (spec 0096):
#   R1  zero *.md files under a catalogue dir -> zero candidates offered to
#       fzf, no literal `*`/`*.md` placeholder, and fzf is never invoked at
#       all (nullglob short-circuit).
#   R2  an empty result (empty catalogue OR declined pick) lets the caller
#       continue rather than terminate the script.
#   R3  a skip removes any stale marker file from an earlier run.
#   R4  the message printed distinguishes an empty catalogue from a declined
#       pick, naming the affected category in both cases.
#   R5/R6 identical behavior across all three categories and all four
#       in-scope setup scripts — asserted structurally (no leftover
#       `exit 1` inside any team/expertise/level block, and a matching
#       `rm -f .../.selected_<category>` skip branch at all 12 call sites).
#   R7  functional smoke test: an empty catalogue lets a real setup's
#       selection sequence continue past the skipped step (the TypeScript
#       entry is run, section 5).
#
# HERMETIC: every operation runs against mktemp -d fixtures; nothing under
# the real repo's config/ directories or the real user's CLI home is read or
# written. PATH is temporarily prefixed with a directory holding stub
# binaries (fzf) for the calls that need one; the prefix is removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-catalogue-picker.sh

# -e intentionally omitted: pass/fail counters control the harness, and some
# probes intentionally check a non-zero/empty result.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"

if [ ! -f "$COMMON_LIB" ]; then
  echo "FATAL: missing $COMMON_LIB" >&2
  exit 2
fi

# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# run_ts_behaviour <test-name-pattern> <label> <expected passes> — runs the group of
# scripts/tests/setup-retarget-behaviour-a.test.ts the pattern names: it RUNS the TypeScript
# setup entry in the sandbox (spec 0256 requirement 9, PR D2). Linux only, like the golden suites
# (the sandbox drives systemd stubs): elsewhere it is reported as skipped, never as a pass.
# Vacuity guard: the expected number of tests must have passed, none failed, none skipped.
# The golden sandbox of the TypeScript setup needs these real tools on PATH and the repository's config/
# tree; a hermetic PATH or a partial repository copy (the install oracle's) lacks them, and the group is
# then skipped off CI, but FAILED when CI is set and non-empty (GitHub Actions and GitLab CI set CI=true;
# the install oracle's hermetic env scrubs it, which is exactly where the skip stays allowed): a missing
# prerequisite in CI must never pass silently (i1-F24).
# ts_sandbox_prereq_missing names the missing prerequisite in TS_MISSING and returns 0, or returns 1.
ts_sandbox_prereq_missing() {
  local t
  TS_MISSING=""
  if [ "$(uname -s)" != "Linux" ]; then TS_MISSING="Linux (this host is $(uname -s))"; return 0; fi
  for t in jq git diff ls sort uniq tee touch stat realpath comm paste od expr dd tty mv rmdir tac rev hostname whoami; do
    command -v "$t" >/dev/null 2>&1 || { TS_MISSING="the tool $t"; return 0; }
  done
  if [ ! -d "${REPO_DIR:-.}/config" ]; then TS_MISSING="the config/ tree of the repository"; return 0; fi
  return 1
}
run_ts_behaviour() {
  unset NODE_TEST_CONTEXT # a nested node --test must not see the parent runner's context
  local pattern="$1" label="$2" want="$3" out rc=0 n_pass n_fail n_skip
  if ts_sandbox_prereq_missing; then
    if [ -n "${CI:-}" ]; then
      bad "$label: the TypeScript setup sandbox cannot run on CI, missing prerequisite: $TS_MISSING"
    else
      echo "  skip: $label (the TypeScript setup sandbox needs $TS_MISSING)"
    fi
    return 0
  fi
  out="$(cd "$REPO_DIR" && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \
    --test-name-pattern="$pattern" scripts/tests/setup-retarget-behaviour-a.test.ts 2>&1)" || rc=$?
  n_pass="$(sed -n 's/^ℹ pass //p' <<< "$out")"
  n_fail="$(sed -n 's/^ℹ fail //p' <<< "$out")"
  n_skip="$(sed -n 's/^ℹ skipped //p' <<< "$out")"
  if [ "$rc" -eq 0 ] && [ "$n_pass" = "$want" ] && [ "$n_fail" = "0" ] && [ "$n_skip" = "0" ]; then
    ok "$label: $n_pass behavioural test(s) of the TypeScript entry passed"
  else
    bad "$label: expected $want passing test(s), got pass=$n_pass fail=$n_fail skipped=$n_skip rc=$rc"
    printf '%s\n' "$out" | grep -E '✖|Error' | head -10 >&2
  fi
}

# ---------------------------------------------------------------------------
echo "1. Empty catalogue: zero candidates, no fzf invocation, exit 0 (R1)"
# ---------------------------------------------------------------------------

EMPTY_DIR="$TMP_ROOT/empty-catalogue"
mkdir -p "$EMPTY_DIR"

# Scrub fzf from PATH entirely for this call: if pick_catalogue_entry ever
# tried to invoke fzf on an empty catalogue, the call would fail with
# "command not found" (or, under `set -e` in a caller, abort) rather than
# returning cleanly — that failure mode is the proof fzf was never reached.
STRIPPED_PATH="$(printf '%s' "$PATH" | tr ':' '\n' \
  | while IFS= read -r p; do [ -x "$p/fzf" ] || printf '%s\n' "$p"; done \
  | tr '\n' ':')"
STRIPPED_PATH="${STRIPPED_PATH%:}"

out=""
rc=0
out="$(PATH="$STRIPPED_PATH" pick_catalogue_entry "$EMPTY_DIR" "team" 2>"$TMP_ROOT/stderr.1")" || rc=$?
[ "$rc" -eq 0 ] && ok "empty catalogue: returns 0" || bad "empty catalogue: returned $rc"
[ -z "$out" ] && ok "empty catalogue: stdout is empty" || bad "empty catalogue: stdout was '$out'"
if grep -qi "command not found" "$TMP_ROOT/stderr.1"; then
  bad "empty catalogue: fzf was invoked despite zero candidates (PATH had no fzf)"
else
  ok "empty catalogue: fzf was never invoked"
fi
if grep -q "No team catalogue entries found" "$TMP_ROOT/stderr.1"; then
  ok "empty catalogue: message names the category and the empty-catalogue cause"
else
  bad "empty catalogue: expected empty-catalogue message not found in stderr"
fi

# ---------------------------------------------------------------------------
echo "2. Non-empty catalogue: no literal '*'/'*.md' placeholder ever reaches fzf (R1)"
# ---------------------------------------------------------------------------

ONE_ENTRY_DIR="$TMP_ROOT/one-entry"
mkdir -p "$ONE_ENTRY_DIR"
echo "# fixture" > "$ONE_ENTRY_DIR/backend.md"

STUB_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUB_DIR"
cat > "$STUB_DIR/fzf" <<'EOF'
#!/bin/bash
# Records every candidate line fed on stdin, then declines (prints nothing,
# exits 1) so the caller can be probed for the declined-pick path (R2/R4).
cat > "$FZF_STDIN_CAPTURE"
exit 1
EOF
chmod +x "$STUB_DIR/fzf"

export FZF_STDIN_CAPTURE="$TMP_ROOT/fzf-stdin.txt"
out=""
rc=0
out="$(PATH="$STUB_DIR:$PATH" pick_catalogue_entry "$ONE_ENTRY_DIR" "expertise" 2>"$TMP_ROOT/stderr.2")" || rc=$?
[ "$rc" -eq 0 ] && ok "declined pick: returns 0 (fzf exit 1 neutralized by '|| true')" \
  || bad "declined pick: returned $rc"
[ -z "$out" ] && ok "declined pick: stdout is empty" || bad "declined pick: stdout was '$out'"
if grep -qE '^\*$|\*\.md' "$FZF_STDIN_CAPTURE"; then
  bad "declined pick: a literal '*'/'*.md' placeholder was fed to fzf"
else
  ok "declined pick: no literal '*'/'*.md' placeholder fed to fzf"
fi
[ "$(cat "$FZF_STDIN_CAPTURE")" = "backend" ] \
  && ok "declined pick: fzf received exactly the real candidate 'backend'" \
  || bad "declined pick: fzf stdin was '$(cat "$FZF_STDIN_CAPTURE")', expected 'backend'"
if grep -q "No expertise selected" "$TMP_ROOT/stderr.2"; then
  ok "declined pick: message names the category and the declined-pick cause"
else
  bad "declined pick: expected declined-pick message not found in stderr"
fi
unset FZF_STDIN_CAPTURE

# ---------------------------------------------------------------------------
echo "3. Normal pick: chosen basename reaches stdout (golden path)"
# ---------------------------------------------------------------------------

cat > "$STUB_DIR/fzf" <<'EOF'
#!/bin/bash
cat > /dev/null
echo "backend"
EOF
chmod +x "$STUB_DIR/fzf"

out=""
rc=0
out="$(PATH="$STUB_DIR:$PATH" pick_catalogue_entry "$ONE_ENTRY_DIR" "expertise" 2>/dev/null)" || rc=$?
[ "$rc" -eq 0 ] && ok "golden path: returns 0" || bad "golden path: returned $rc"
[ "$out" = "backend" ] && ok "golden path: stdout is the chosen basename" \
  || bad "golden path: stdout was '$out', expected 'backend'"

# ---------------------------------------------------------------------------
echo "4. Structural parity across all four setup scripts (R5/R6)"
# ---------------------------------------------------------------------------

# Retargeted (spec 0256 requirement 9, PR D1): the structure of the selection step is read
# from the DECLARATION of each TypeScript setup, not from the text of the four shells.
#   - the helper and the categories: the `rules-selection` step offers a `catalogue.<category>`
#     prompt per category, each over a catalogue directory (`<config/...>` options);
#   - R5/R6 "no remaining exit 1": a skipped or declined pick is a decline (`cancel=decline`),
#     never an abort;
#   - R3 "a skip removes the stale marker": the step declares the marker of each category
#     (`rules.marker.<category>`), which is the file the skip removes.
# Pin of each property against the unchanged shell while it exists: the golden cell
# setup-golden/<cli>/empty-catalogue-stale-markers (claude, gemini, copilot, antigravity: an empty
# catalogue with stale markers on disk ends with the markers removed and the run completing) and
# scripts/tests/setup-retarget-catalogue-picker.test.ts (reads the shell blocks AND the declaration
# and asserts they agree; retired with the shell). The functional smoke (section 5) is a run of the TypeScript entry (D2).
PRINT_DECL=(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts")
for cli in claude gemini copilot antigravity; do
  decl="$("${PRINT_DECL[@]+"${PRINT_DECL[@]}"}" "$cli" 2>/dev/null)" || decl=""
  if [ -z "$decl" ]; then
    bad "$cli: the declaration printer failed or printed nothing (vacuous)"
    continue
  fi
  order="$(grep '^rules\.pick-order=' <<< "$decl" | cut -d= -f2-)"
  if [ -z "$order" ]; then
    bad "$cli: the declaration carries no rules.pick-order fact (vacuous)"
    continue
  fi
  if grep -qx 'step [0-9]*: rules-selection' <<< "$decl"; then
    ok "$cli: the declaration has a rules-selection step"
  else
    bad "$cli: the declaration has no rules-selection step"
  fi
  if [ "$(printf '%s\n' "$order" | tr ',' '\n' | sort | tr '\n' ',')" = "expertise,level,team," ]; then
    ok "$cli: the selection step covers the three categories (order: $order)"
  else
    bad "$cli: the selection step does not cover team/expertise/level exactly once (got: $order)"
  fi

  for category in team expertise level; do
    cancel="$(printf '%s\n' "$decl" | grep "^prompt\.catalogue\.$category\.cancel=" | cut -d= -f2-)"
    options="$(printf '%s\n' "$decl" | grep "^prompt\.catalogue\.$category\.options=" | cut -d= -f2-)"
    marker="$(printf '%s\n' "$decl" | grep "^rules\.marker\.$category=" | cut -d= -f2-)"
    if [ "$cancel" = "decline" ]; then
      ok "$cli: the $category pick is a decline on cancel or empty (no abort)"
    else
      bad "$cli: the $category pick cancel behaviour is '$cancel', expected 'decline'"
    fi
    case "$options" in
      "<config/"*">") ok "$cli: the $category pick reads a catalogue directory ($options)" ;;
      *) bad "$cli: the $category pick has no catalogue-directory options (got: '$options')" ;;
    esac
    case "$marker" in
      */.selected_"$category") ok "$cli: the $category skip clears the declared stale marker (${marker##*/})" ;;
      *) bad "$cli: the $category marker is '$marker', expected .../.selected_$category" ;;
    esac
  done
done

# ---------------------------------------------------------------------------
echo "5. Functional smoke test: empty catalogue lets a real setup continue (R2, R7)"
# ---------------------------------------------------------------------------
# Retargeted (spec 0256 requirement 9, PR D2): the block extracted from the TEXT of
# setup-claude-interactive.sh and executed under `set -e` is replaced by RUNNING the TypeScript
# entry of each of the four setups (scripts/tests/setup-retarget-behaviour-a.test.ts, with the
# fzf decisions translated to `--answer`): an EMPTY team catalogue, a DECLINED expertise pick and
# a PICKED level. Per CLI the run must exit 0 (R2: a skip continues), print the empty-catalogue
# and declined-pick notices naming their category (R4), still reach the third category (the level
# marker holds the pick and the level rule is installed), and remove the stale team and expertise
# markers (R3). Vacuity guard: the exact number of passing tests (4) is required. Pin against the
# unchanged shell: the golden cells setup-golden/<cli>/empty-catalogue,
# empty-catalogue-stale-markers and declined-catalogue-pick (catalogue-pick-declined for claude and
# gemini). RETIRED with the extraction: "the block ends at the trailing marker" (a `set -e`
# survival of shell text; the run exiting 0 and reaching the level step is the behavioural form).
run_ts_behaviour "catalogue-picker" "empty team + declined expertise + picked level, four CLIs" 4

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
