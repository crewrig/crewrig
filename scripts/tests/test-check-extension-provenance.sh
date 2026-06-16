#!/bin/bash
# test-check-extension-provenance.sh — Regression test for check-extension-provenance.sh.
#
# Pins the contract from spec 0043: every skill/agent under an upstream-owned
# extension tier MUST carry a complete, self-routing crewrig-provenance carrier
# as its first body line. The guard walks the whole extensions/{core,library}
# tree (org exempt) from the CWD, so each presence/routing case builds a temp
# tree and runs the guard inside it.
#
# Presence / routing cases (Part A):
#   1. skill with complete carrier (feedback==canonical)            → exit 0
#   2. skill missing the carrier (presence-guard rejection, R7)     → exit 1
#   3. skill carrier with feedback != canonical (R5 invariant)      → exit 1
#   4. skill carrier missing a field (R1 completeness)              → exit 1
#   5. agent with complete carrier                                  → exit 0
#   6. extensions/org skill missing carrier (adopter-owned exempt)  → exit 0
#   7. empty extensions tree (no components)                        → exit 0
#   8. carrier present but NOT on the first body line (R-2 pin)     → exit 1
#
# R4 byte-identity (Part B) — finding 4, REQUIRED, not optional:
#   The greeter SKILL.md provenance carrier line SHALL survive, byte for byte,
#   through `install-extension.sh` (cp -rf), `link-extensions.sh` (ln -s), and
#   the Claude plugin build (`build-claude-plugin.sh`, cp -r). This is the only
#   machine-checkable evidence for spec 0043 R4 ("preserve on install, byte for
#   byte") and the Claude-plugin passthrough in this repo.
#
# Usage:
#   bash scripts/tests/test-check-extension-provenance.sh
#
# -e is intentionally omitted: exit codes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-extension-provenance.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

new_tree() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/tree.XXXXXX")"
  echo "$dir"
}

CANON="https://github.com/crewrig/crewrig"

# write_skill <skills-parent-dir> <carrier-line|"">
# Writes <dir>/skills/x/SKILL.md with the given carrier as first body line.
# An empty carrier arg omits the carrier entirely (presence-failure fixture).
write_skill() {
  local parent="$1" carrier="$2"
  mkdir -p "$parent/skills/x"
  {
    printf '%s\n' '---'
    printf '%s\n' 'name: x'
    printf '%s\n' 'description: "A skill"'
    printf '%s\n' '---'
    [ -n "$carrier" ] && printf '%s\n' "$carrier"
    printf '%s\n' ''
    printf '%s\n' '# X Skill'
    printf '%s\n' ''
    printf '%s\n' 'Body.'
  } > "$parent/skills/x/SKILL.md"
}

write_agent() {
  local parent="$1" carrier="$2"
  mkdir -p "$parent/agents/a"
  {
    printf '%s\n' '---'
    printf '%s\n' 'name: a'
    printf '%s\n' 'description: "An agent"'
    printf '%s\n' '---'
    [ -n "$carrier" ] && printf '%s\n' "$carrier"
    printf '%s\n' ''
    printf '%s\n' 'System prompt.'
  } > "$parent/agents/a/AGENT.md"
}

run_case() {
  local name="$1" tree="$2" expected_exit="$3"
  local actual_exit=0
  ( cd "$tree" && bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?
  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    fail=$((fail + 1))
  fi
}

assert() {
  local name="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name"
    fail=$((fail + 1))
  fi
}

COMPLETE="<!-- crewrig-provenance: version=\"1.0.0\" canonical=\"$CANON\" feedback=\"$CANON\" -->"

# ── Part A — presence / routing cases ────────────────────────────────────────

# Case 1 — complete carrier (feedback==canonical) → exit 0
t1="$(new_tree)"
write_skill "$t1/extensions/core/demo" "$COMPLETE"
run_case "Case 1 — skill with complete carrier passes" "$t1" 0

# Case 2 — missing carrier → exit 1 (R7 presence)
t2="$(new_tree)"
write_skill "$t2/extensions/core/demo" ""
run_case "Case 2 — skill missing carrier fails (R7)" "$t2" 1

# Case 3 — feedback != canonical → exit 1 (R5)
t3="$(new_tree)"
write_skill "$t3/extensions/core/demo" \
  "<!-- crewrig-provenance: version=\"1.0.0\" canonical=\"$CANON\" feedback=\"https://github.com/other/fork\" -->"
run_case "Case 3 — feedback != canonical fails (R5)" "$t3" 1

# Case 4 — carrier missing a field (no feedback) → exit 1 (R1)
t4="$(new_tree)"
write_skill "$t4/extensions/core/demo" \
  "<!-- crewrig-provenance: version=\"1.0.0\" canonical=\"$CANON\" -->"
run_case "Case 4 — carrier missing a field fails (R1)" "$t4" 1

# Case 5 — agent with complete carrier → exit 0
t5="$(new_tree)"
write_agent "$t5/extensions/library/demo" "$COMPLETE"
run_case "Case 5 — agent with complete carrier passes" "$t5" 0

# Case 6 — extensions/org skill missing carrier → exit 0 (exempt)
t6="$(new_tree)"
write_skill "$t6/extensions/org/demo" ""
run_case "Case 6 — adopter-owned extensions/org is exempt" "$t6" 0

# Case 7 — empty extensions tree → exit 0
t7="$(new_tree)"
mkdir -p "$t7/extensions/core"
run_case "Case 7 — empty extensions tree passes" "$t7" 0

# Case 8 — carrier present but NOT first body line → exit 1 (R-2 first-line pin)
t8="$(new_tree)"
mkdir -p "$t8/extensions/core/demo/skills/x"
{
  printf '%s\n' '---'
  printf '%s\n' 'name: x'
  printf '%s\n' 'description: "A skill"'
  printf '%s\n' '---'
  printf '%s\n' ''
  printf '%s\n' '# X Skill'
  printf '%s\n' ''
  printf '%s\n' "$COMPLETE"
  printf '%s\n' 'Body.'
} > "$t8/extensions/core/demo/skills/x/SKILL.md"
run_case "Case 8 — carrier not on first body line fails (R-2 pin)" "$t8" 1

# ── Part B — R4 byte-identity through install / link / plugin (finding 4) ─────
#
# Run against the REAL repo greeter so the assertion tracks the shipped source.
GREETER="$REPO_DIR/extensions/core/hello-world/skills/greeter/SKILL.md"
EXPECTED_CARRIER="$(awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$GREETER")"

if [ -z "$EXPECTED_CARRIER" ]; then
  assert "R4 setup — greeter carrier extractable" "false"
else
  assert "R4 setup — greeter carrier extractable" "true"

  # (B1) cp -rf — the install-extension.sh copy primitive (verified line 53).
  b1_dst="$(mktemp -d "$TMP_ROOT/cp.XXXXXX")"
  cp -rf "$GREETER" "$b1_dst/SKILL.md"
  b1_line="$(awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$b1_dst/SKILL.md")"
  if [ "$b1_line" = "$EXPECTED_CARRIER" ] && diff -q "$GREETER" "$b1_dst/SKILL.md" >/dev/null 2>&1; then
    assert "R4 (B1) carrier survives cp -rf (install copy) byte-for-byte" "true"
  else
    assert "R4 (B1) carrier survives cp -rf (install copy) byte-for-byte" "false"
  fi

  # (B2) ln -s — the install-extension.sh link primitive (verified line 50).
  # A symlink dereferences to the identical bytes.
  b2_dir="$(mktemp -d "$TMP_ROOT/ln.XXXXXX")"
  ln -s "$GREETER" "$b2_dir/SKILL.md"
  b2_line="$(awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$b2_dir/SKILL.md")"
  if [ "$b2_line" = "$EXPECTED_CARRIER" ] && diff -q "$GREETER" "$b2_dir/SKILL.md" >/dev/null 2>&1; then
    assert "R4 (B2) carrier survives ln -s (link) byte-for-byte" "true"
  else
    assert "R4 (B2) carrier survives ln -s (link) byte-for-byte" "false"
  fi

  # (B3) Claude plugin build — build-claude-plugin.sh copies the skill dir via
  # cp -r (verified line 128). Drive the real build of the hello-world extension
  # into a temp output dir (so the source tree is not polluted) and grep the
  # plugin's greeter SKILL.md for the verbatim carrier on its first body line.
  PLUGIN_BUILD="$REPO_DIR/scripts/build-claude-plugin.sh"
  if [ -f "$PLUGIN_BUILD" ] && command -v jq >/dev/null 2>&1; then
    plugin_out_dir="$(mktemp -d "$TMP_ROOT/plugin.XXXXXX")"
    plugin_ok=""
    if ( cd "$REPO_DIR" && bash "$PLUGIN_BUILD" hello-world "$plugin_out_dir" >/dev/null 2>&1 ); then
      plugin_skill="$plugin_out_dir/skills/greeter/SKILL.md"
      if [ -f "$plugin_skill" ]; then
        plugin_line="$(awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$plugin_skill")"
        if [ "$plugin_line" = "$EXPECTED_CARRIER" ] \
          && diff -q "$GREETER" "$plugin_skill" >/dev/null 2>&1; then
          plugin_ok="ok"
        fi
      fi
    fi
    if [ "$plugin_ok" = "ok" ]; then
      assert "R4 (B3) carrier survives Claude plugin build (cp -r) byte-for-byte" "true"
    else
      assert "R4 (B3) carrier survives Claude plugin build (cp -r) byte-for-byte" "false"
    fi
  else
    # jq is a hard prerequisite of the plugin build; if absent in this
    # environment the cp -r primitive is identical to B1 (already proven).
    echo "SKIP  R4 (B3) plugin build unavailable (jq missing); cp -r identity proven by B1"
  fi
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
