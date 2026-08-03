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
#   R7  functional smoke test: an empty catalogue lets a real setup script's
#       selection sequence continue past the skipped step.
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
SETUP_DIR="$REPO_DIR/scripts"
SETUP_SCRIPTS=(setup-claude-interactive.sh setup-gemini-interactive.sh \
               setup-copilot-interactive.sh setup-antigravity-interactive.sh)

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

# extract_selection_block <script> <begin-marker> <end-marker>
# Prints the lines strictly between (not including) the two marker lines —
# the team/expertise/level selection body of one script — to stdout.
extract_selection_block() {
  local script="$1" begin="$2" end="$3"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { capture=1; next }
    $0 == end   { capture=0 }
    capture     { print }
  ' "$script"
}

for s in "${SETUP_SCRIPTS[@]}"; do
  path="$SETUP_DIR/$s"
  if [ ! -f "$path" ]; then
    bad "$s: script not found at $path"
    continue
  fi

  if [ "$s" = "setup-copilot-interactive.sh" ]; then
    # Copilot orders level -> expertise -> team and nests one level deeper
    # (spec 0096 explicitly preserves this pre-existing ordering/indent).
    block="$(extract_selection_block "$path" "  # Level" "  # Team")"
    block="$block
$(extract_selection_block "$path" "  # Team" "fi")"
  else
    block="$(extract_selection_block "$path" "# --- Team selection ---" "# --- Profile handling ---")"
  fi

  if [ -z "$block" ]; then
    bad "$s: could not extract the team/expertise/level selection block"
    continue
  fi

  if printf '%s\n' "$block" | grep -qE '^\s*exit 1\s*$'; then
    bad "$s: a bare 'exit 1' remains inside the selection block"
  else
    ok "$s: zero remaining 'exit 1' inside the selection block"
  fi

  for category in team expertise level; do
    if printf '%s\n' "$block" | grep -qE "rm -f \"[^\"]*\.selected_${category}\""; then
      ok "$s: $category skip branch removes the stale .selected_$category marker"
    else
      bad "$s: no 'rm -f .../.selected_$category' found on the $category skip branch"
    fi
  done

  if printf '%s\n' "$block" | grep -q "pick_catalogue_entry"; then
    ok "$s: uses the shared pick_catalogue_entry helper"
  else
    bad "$s: does not call pick_catalogue_entry"
  fi
done

# ---------------------------------------------------------------------------
echo "5. Functional smoke test: empty catalogue lets a real script continue (R2, R7)"
# ---------------------------------------------------------------------------
# Cold-review Finding 2 (folded into this PR): a structural 'no exit 1' grep
# alone cannot prove the skip actually falls through at runtime. This extracts
# the VERBATIM team/expertise/level block from setup-claude-interactive.sh
# and executes it for real, against:
#   - config/teams/     -> zero *.md files (the empty-catalogue path, R1/R2)
#   - config/expertise/ -> one *.md file, fzf stub declines it (R2 other cause)
#   - config/level/     -> one *.md file, fzf stub picks it (proves execution
#     reached and completed the THIRD category, i.e. it was never aborted)
# then asserts a marker placed immediately after the extracted block was
# reached, rather than only asserting the absence of the 'exit 1' string.

CLAUDE_SCRIPT="$SETUP_DIR/setup-claude-interactive.sh"
SMOKE_BLOCK="$(extract_selection_block "$CLAUDE_SCRIPT" "# --- Team selection ---" "# --- Profile handling ---")"

if [ -z "$SMOKE_BLOCK" ]; then
  bad "smoke test: could not extract the selection block from setup-claude-interactive.sh"
else
  SMOKE_HOME="$TMP_ROOT/smoke-claude-home"
  SMOKE_REPO="$TMP_ROOT/smoke-repo"
  mkdir -p "$SMOKE_HOME" "$SMOKE_REPO/config/teams" "$SMOKE_REPO/config/expertise" "$SMOKE_REPO/config/level"
  echo "# fixture" > "$SMOKE_REPO/config/expertise/backend.md"
  echo "# fixture" > "$SMOKE_REPO/config/level/junior.md"
  # config/teams/ is left empty on purpose (R1 empty-catalogue path).

  # Pre-seed stale markers from a "prior run" to prove R3 (skip removes them).
  echo "stale-team" > "$SMOKE_HOME/.selected_team"
  echo "stale-expertise" > "$SMOKE_HOME/.selected_expertise"

  SMOKE_STUB_DIR="$TMP_ROOT/smoke-stubs"
  mkdir -p "$SMOKE_STUB_DIR"
  SMOKE_COUNTER="$TMP_ROOT/smoke-fzf-count"
  echo 0 > "$SMOKE_COUNTER"
  cat > "$SMOKE_STUB_DIR/fzf" <<EOF
#!/bin/bash
# Call 1 = expertise (decline: empty catalogue never reaches fzf at all, so
# the FIRST real fzf call is expertise) -> prints nothing, exit 1.
# Call 2 = level -> prints the fixture's only entry.
cat > /dev/null
n="\$(cat "$SMOKE_COUNTER")"
n=\$((n + 1))
echo "\$n" > "$SMOKE_COUNTER"
if [ "\$n" -eq 1 ]; then
  exit 1
else
  echo "junior"
fi
EOF
  chmod +x "$SMOKE_STUB_DIR/fzf"

  SMOKE_SCRIPT="$TMP_ROOT/smoke-run.sh"
  {
    echo "#!/bin/bash"
    echo "set -e"
    echo "source '$COMMON_LIB'"
    echo "REPO_DIR='$SMOKE_REPO'"
    echo "CLAUDE_HOME='$SMOKE_HOME'"
    echo "CLAUDE_RULES=\"\${CLAUDE_HOME}/rules\""
    echo "mkdir -p \"\$CLAUDE_RULES\""
    printf '%s\n' "$SMOKE_BLOCK"
    echo 'echo "SMOKE_TEST_CONTINUED_PAST_SKIP"'
  } > "$SMOKE_SCRIPT"

  smoke_out=""
  smoke_rc=0
  smoke_out="$(PATH="$SMOKE_STUB_DIR:$PATH" bash "$SMOKE_SCRIPT" 2>"$TMP_ROOT/smoke-stderr.txt")" || smoke_rc=$?

  [ "$smoke_rc" -eq 0 ] && ok "smoke test: extracted block exits 0 under an empty team catalogue" \
    || bad "smoke test: extracted block exited $smoke_rc (should have continued, not aborted)"

  if printf '%s' "$smoke_out" | grep -q "SMOKE_TEST_CONTINUED_PAST_SKIP"; then
    ok "smoke test: execution continued past the team/expertise skips to the trailing marker"
  else
    bad "smoke test: trailing marker not reached — script likely aborted on the empty catalogue"
  fi

  if printf '%s' "$smoke_out" | grep -q "Level: junior"; then
    ok "smoke test: level selection (third category) still ran and installed 'junior'"
  else
    bad "smoke test: level selection output not found — third category was not reached"
  fi

  [ ! -e "$SMOKE_HOME/.selected_team" ] \
    && ok "smoke test: stale .selected_team marker removed on the empty-catalogue skip (R3)" \
    || bad "smoke test: .selected_team marker still present after skip"
  [ ! -e "$SMOKE_HOME/.selected_expertise" ] \
    && ok "smoke test: stale .selected_expertise marker removed on the declined-pick skip (R3)" \
    || bad "smoke test: .selected_expertise marker still present after skip"
  [ -f "$SMOKE_HOME/.selected_level" ] && [ "$(cat "$SMOKE_HOME/.selected_level")" = "junior" ] \
    && ok "smoke test: .selected_level marker written for the actually-selected entry" \
    || bad "smoke test: .selected_level marker missing or wrong content"
  [ -f "$SMOKE_HOME/rules/10-level.md" ] \
    && ok "smoke test: level rule file installed to rules/10-level.md" \
    || bad "smoke test: level rule file was not installed"
fi

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
