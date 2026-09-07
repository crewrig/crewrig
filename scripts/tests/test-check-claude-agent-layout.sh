#!/bin/bash
# test-check-claude-agent-layout.sh — Regression tests for
# check-claude-agent-layout.sh (spec 0201 requirements 6, 7, 9, 31).
#
# Mirrors the test-check-core-paths.sh idiom: `set -uo pipefail`, mktemp -d +
# trap, a run_check helper that captures stdout/stderr to files (never a pipe
# into a reader that can exit first — R31), a PASS/FAIL report per assertion,
# and a closing summary that exits non-zero on any failure.
#
# Cases:
#   a. Flat-only fixture — exit 0.
#   b. Empty .claude/agents/ — exit 0, no offending path printed.
#   c. Absent .claude/agents/ — exit 0.
#   d. A flat developer.md plus a re-created developer/AGENT.md — exit
#      non-zero, naming both .claude/agents/developer and
#      .claude/agents/developer/AGENT.md.
#   e. A non-.md regular file directly inside — exit non-zero, named.
#   f. A symlink whose name ends in .md — exit non-zero, named (R6 requires a
#      *regular* file).
#   g. Three offenders at once — all three named.
#   h. The real repository tree — exit 0 (criterion A4).
#   i. Mutation leg (R9 / criterion A5) — a copy of the shipped guard, mutated
#      to accept a sub-directory, is asserted to differ from the original
#      (so a no-op sed cannot produce a vacuous pass) and then asserted to
#      exit 0 against the nested fixture where the shipped guard exits
#      non-zero.
#
# Usage:
#   bash scripts/tests/test-check-claude-agent-layout.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-claude-agent-layout.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# run_check <repo> [script] — run the guard (or an alternate script, for the
# mutation leg) against <repo>, capturing exit status, stdout and stderr.
run_check() {
  local repo="$1" script="${2:-$SCRIPT_UNDER_TEST}" out_file err_file
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  # `${BASH:-bash}`, not bare `bash` — see test-check-core-paths.sh:129-133.
  ( CREWRIG_REPO_DIR="$repo" "${BASH:-bash}" "$script" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

assert() {
  local label="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo "PASS  $label"
    pass=$((pass + 1))
  else
    echo "FAIL  $label"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case a — flat-only fixture.
# ---------------------------------------------------------------------------
repo_a="$TMP_ROOT/case-a"
mkdir -p "$repo_a/.claude/agents"
echo "content" > "$repo_a/.claude/agents/developer.md"
echo "content" > "$repo_a/.claude/agents/architect.md"
run_check "$repo_a"
assert "case-a: flat-only fixture exits 0" "$([ "$CHECK_EXIT" -eq 0 ] && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case b — empty .claude/agents/.
# ---------------------------------------------------------------------------
repo_b="$TMP_ROOT/case-b"
mkdir -p "$repo_b/.claude/agents"
run_check "$repo_b"
assert "case-b: empty .claude/agents/ exits 0" "$([ "$CHECK_EXIT" -eq 0 ] && echo true || echo false)"
assert "case-b: no offending path printed" "$(grep -qF 'FAILED:' <<< "$CHECK_STDERR" && echo false || echo true)"

# ---------------------------------------------------------------------------
# Case c — absent .claude/agents/.
# ---------------------------------------------------------------------------
repo_c="$TMP_ROOT/case-c"
mkdir -p "$repo_c"
run_check "$repo_c"
assert "case-c: absent .claude/agents/ exits 0" "$([ "$CHECK_EXIT" -eq 0 ] && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case d — flat developer.md plus a re-created developer/AGENT.md.
# ---------------------------------------------------------------------------
repo_d="$TMP_ROOT/case-d"
mkdir -p "$repo_d/.claude/agents/developer"
echo "content" > "$repo_d/.claude/agents/developer.md"
echo "old" > "$repo_d/.claude/agents/developer/AGENT.md"
run_check "$repo_d"
assert "case-d: re-created nested dir exits non-zero" "$([ "$CHECK_EXIT" -ne 0 ] && echo true || echo false)"
assert "case-d: names .claude/agents/developer" "$(grep -qF '.claude/agents/developer' <<< "$CHECK_STDERR" && echo true || echo false)"
assert "case-d: names .claude/agents/developer/AGENT.md" "$(grep -qF '.claude/agents/developer/AGENT.md' <<< "$CHECK_STDERR" && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case e — a non-.md regular file directly inside.
# ---------------------------------------------------------------------------
repo_e="$TMP_ROOT/case-e"
mkdir -p "$repo_e/.claude/agents"
echo "x" > "$repo_e/.claude/agents/README.txt"
run_check "$repo_e"
assert "case-e: non-.md regular file exits non-zero" "$([ "$CHECK_EXIT" -ne 0 ] && echo true || echo false)"
assert "case-e: names .claude/agents/README.txt" "$(grep -qF '.claude/agents/README.txt' <<< "$CHECK_STDERR" && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case f — a symlink whose name ends in .md.
# ---------------------------------------------------------------------------
repo_f="$TMP_ROOT/case-f"
mkdir -p "$repo_f/.claude/agents"
echo "real" > "$repo_f/.claude/agents/real.md"
ln -s real.md "$repo_f/.claude/agents/link.md"
run_check "$repo_f"
assert "case-f: symlink named *.md exits non-zero" "$([ "$CHECK_EXIT" -ne 0 ] && echo true || echo false)"
assert "case-f: names .claude/agents/link.md" "$(grep -qF '.claude/agents/link.md' <<< "$CHECK_STDERR" && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case g — three offenders at once.
# ---------------------------------------------------------------------------
repo_g="$TMP_ROOT/case-g"
mkdir -p "$repo_g/.claude/agents/nested-dir"
echo "content" > "$repo_g/.claude/agents/developer.md"
echo "x" > "$repo_g/.claude/agents/nested-dir/AGENT.md"
echo "x" > "$repo_g/.claude/agents/bad.txt"
ln -s bad.txt "$repo_g/.claude/agents/link.md"
run_check "$repo_g"
assert "case-g: three offenders exits non-zero" "$([ "$CHECK_EXIT" -ne 0 ] && echo true || echo false)"
assert "case-g: names .claude/agents/nested-dir" "$(grep -qF '.claude/agents/nested-dir' <<< "$CHECK_STDERR" && echo true || echo false)"
assert "case-g: names .claude/agents/bad.txt" "$(grep -qF '.claude/agents/bad.txt' <<< "$CHECK_STDERR" && echo true || echo false)"
assert "case-g: names .claude/agents/link.md" "$(grep -qF '.claude/agents/link.md' <<< "$CHECK_STDERR" && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case h — the real repository tree (criterion A4).
# ---------------------------------------------------------------------------
run_check "$REPO_DIR"
assert "case-h: the real repository tree exits 0" "$([ "$CHECK_EXIT" -eq 0 ] && echo true || echo false)"

# ---------------------------------------------------------------------------
# Case i — mutation leg (R9 / criterion A5). Mutate a copy of the shipped
# guard to accept a sub-directory, assert the mutant genuinely differs from
# the original (so a sed that silently matched nothing cannot produce a
# vacuous pass), then run the mutant against case d's nested fixture and
# assert it exits 0 where the shipped guard exits non-zero.
# ---------------------------------------------------------------------------
MUTANT="$TMP_ROOT/mutant.sh"
awk '{
  print
  if ($0 ~ /\[ "\$legal" -eq 1 \] && continue/) {
    print "  [ -d \"$entry\" ] && continue"
  }
}' "$SCRIPT_UNDER_TEST" > "$MUTANT"
chmod +x "$MUTANT"

assert "case-i: mutant differs from the shipped guard" \
  "$(diff -q "$SCRIPT_UNDER_TEST" "$MUTANT" >/dev/null 2>&1 && echo false || echo true)"

run_check "$repo_d" "$MUTANT"
assert "case-i: mutant exits 0 on the nested fixture the shipped guard rejects" \
  "$([ "$CHECK_EXIT" -eq 0 ] && echo true || echo false)"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
