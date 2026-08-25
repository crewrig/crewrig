#!/bin/bash
# test-create-extension-combinations.sh — spec 0183 R2 (PLAN v2 step 30):
# for EVERY combination of components the scaffolding tool offers, the tree
# it produces SHALL render for every supported command-line tool and SHALL
# pass the single check capability with NO edit by the contributor, and no
# placeholder literal SHALL remain anywhere in the produced tree.
#
# The scaffolding tool offers six components (mcp-server, command, skill,
# agent, hook, theme), so "every combination" is the 64 subsets of that set
# (including the empty subset — a base-only scaffold). Driven through the
# SAME fzf stub scripts/tests/test-build-extension.sh uses: one
# `fzf --multi` call at create-extension.sh's own invocation site, one
# CREWRIG_TEST_FZF_SELECTION value per case — no new non-interactive entry
# point is added by this test.
#
# Every assertion that keys on the extension name reads it with
# `jq -r '.name'` from the produced manifest, never assumes the NAME env
# value: a defensive habit this suite keeps even now that step 25 (the
# NUL-byte substitution predicate) has landed in this same commit, because a
# future regression in substitution should fail the assertion that reads the
# manifest, not silently pass because the test trusted its own input.
#
# Usage:
#   bash scripts/tests/test-create-extension-combinations.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CREATE_EXTENSION="$SCRIPT_DIR/create-extension.sh"

if [ ! -f "$CREATE_EXTENSION" ]; then
  echo "FATAL: cannot find $CREATE_EXTENSION" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# make_sandbox — a fresh mktemp'd copy of scripts/ + extension-skeleton/,
# mirroring scripts/tests/test-build-extension.sh's own helper.
make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  cp -r "$REPO_DIR/extension-skeleton" "$sandbox/extension-skeleton"
  mkdir -p "$sandbox/extensions/core" "$sandbox/extensions/library" "$sandbox/extensions/org"
  echo "$sandbox"
}

FZF_STUB_DIR="$TMP_ROOT/fzf-stub"
mkdir -p "$FZF_STUB_DIR"
cat > "$FZF_STUB_DIR/fzf" <<'EOF'
#!/bin/bash
cat > /dev/null
printf '%s' "$CREWRIG_TEST_FZF_SELECTION"
EOF
chmod +x "$FZF_STUB_DIR/fzf"

# The six offered components, in create-extension.sh's own printed order.
COMPONENTS_LIST="mcp-server command skill agent hook theme"

# subset_selection <mask> — echoes the newline-separated component list
# CREWRIG_TEST_FZF_SELECTION expects for bitmask <mask> (0-63), one bit per
# COMPONENTS_LIST position (bit 0 = mcp-server, ... bit 5 = theme).
subset_selection() {
  local mask="$1" i=0 bit=1 comp selection=""
  for comp in $COMPONENTS_LIST; do
    if [ $(((mask / bit) % 2)) -eq 1 ]; then
      if [ -z "$selection" ]; then
        selection="$comp"
      else
        selection="$selection
$comp"
      fi
    fi
    bit=$((bit * 2))
    i=$((i + 1))
  done
  printf '%s' "$selection"
}

START_TS="$(date +%s)"

mask=0
while [ "$mask" -le 63 ]; do
  selection="$(subset_selection "$mask")"
  sandbox="$(make_sandbox)"
  scaffold_out="$(cd "$sandbox" && NAME="combo$mask" TIER=org CREWRIG_TEST_FZF_SELECTION="$selection" \
    PATH="$FZF_STUB_DIR:$PATH" bash scripts/create-extension.sh 2>&1)"
  scaffold_rc=$?

  if [ "$scaffold_rc" -ne 0 ]; then
    ng "combo $mask ($selection) — scaffold failed (rc=$scaffold_rc):"$'\n'"$scaffold_out"
    mask=$((mask + 1))
    continue
  fi

  ext_dir="$sandbox/extensions/org/combo$mask"
  manifest="$ext_dir/extension.json"
  if [ ! -f "$manifest" ]; then
    ng "combo $mask ($selection) — no extension.json produced"
    mask=$((mask + 1))
    continue
  fi
  real_name="$(jq -r '.name' "$manifest" 2>/dev/null)"

  # No placeholder literal survives ANYWHERE in the produced tree — an
  # independent re-check of the same claim create-extension.sh's own R3
  # assertion already made, reading the tree rather than trusting the
  # tool's exit code alone.
  placeholder_hits="$(grep -rlF '${SKELETON_' "$ext_dir" 2>/dev/null)"
  if [ -z "$placeholder_hits" ]; then
    ok "combo $mask ($selection) — no placeholder literal survives in the produced tree"
  else
    ng "combo $mask ($selection) — placeholder literal(s) survive:"$'\n'"$placeholder_hits"
  fi

  # ONE combined assertion, not two: --check's own arm (b) (RENDER-FAIL)
  # already forces a fresh --target all render and asserts it succeeds, with
  # its own self-contained cleanup_stray_plugin_dist trap. A SEPARATE,
  # preceding `--target all` invocation would leave dist-claude-plugin/
  # inside the extension's own source tree (its bare-invocation default
  # staging location) for --check's arm (a) to then find and charge as an
  # undeclared tool-designated file — a false failure of this test's own
  # making, not of the scaffold. --check alone proves both claims (render +
  # check) exactly as a contributor running it once would experience.
  check_out="$(cd "$sandbox" && bash scripts/build-extension.sh --check "$real_name" 2>&1)"
  check_rc=$?
  if [ "$check_rc" -eq 0 ]; then
    ok "combo $mask ($selection) — renders for every target and passes --check with no edit"
  else
    ng "combo $mask ($selection) — --check failed (rc=$check_rc):"$'\n'"$check_out"
  fi

  mask=$((mask + 1))
done

END_TS="$(date +%s)"
ELAPSED=$((END_TS - START_TS))
echo ""
echo "Wall-clock for all 64 combinations: ${ELAPSED}s"
if [ "$ELAPSED" -gt 300 ]; then
  echo "WARNING: exceeds the 5-minute PLAN budget — see PLAN v2 step 30's Risk on CI runtime." >&2
fi

# ---------------------------------------------------------------------------
# Non-vacuity on step 26's gap derivation (spec 0183 R2, PLAN step 30's own
# named gap): an EMPTY derived accepted-gaps.json passes --check identically
# to a correct, populated one, so presence alone proves nothing. Neither
# `hook` nor `mcp-server` produces a real gap against this skeleton's OWN
# example content today (the skeleton's hook event, PreToolUse, is the
# "maps-everywhere" anchor per docs/extension-hook-events.md, and every
# target's extension-targets.json row carries mcpDelivery: true) — so this
# case forces a REAL gap via a sandboxed extension-targets.json mutation
# (mirroring the growth-mutation idiom scripts/tests/test-build-extension.sh
# already uses) rather than asserting on content that would otherwise always
# be empty by construction.
# ---------------------------------------------------------------------------
gap_sandbox="$(make_sandbox)"
targets_copy="$gap_sandbox/scripts/lib/extension-targets.json"
jq '.copilot.mcpDelivery = false' "$targets_copy" > "$targets_copy.tmp" && mv "$targets_copy.tmp" "$targets_copy"

gap_out="$(cd "$gap_sandbox" && NAME=gapcombo TIER=org CREWRIG_TEST_FZF_SELECTION="mcp-server" \
  PATH="$FZF_STUB_DIR:$PATH" bash scripts/create-extension.sh 2>&1)"
gap_rc=$?
gap_ext_dir="$gap_sandbox/extensions/org/gapcombo"
gap_file="$gap_ext_dir/accepted-gaps.json"

if [ "$gap_rc" -eq 0 ] && [ -f "$gap_file" ] \
   && [ "$(jq -e '[.[] | select(.subject == "mcpServers" and .target == "copilot")] | length' "$gap_file" 2>/dev/null)" = "1" ]; then
  ok "gap derivation — a selection whose declaration cannot map on copilot (forced via a sandboxed extension-targets.json mutation) gets a derived accepted-gaps.json naming subject=mcpServers, target=copilot"
else
  ng "gap derivation — did not derive the expected gap content (rc=$gap_rc):"$'\n'"$gap_out"$'\n'"file contents: $(cat "$gap_file" 2>/dev/null || echo '<missing>')"
fi

gap_check_out="$(cd "$gap_sandbox" && bash scripts/build-extension.sh --check gapcombo 2>&1)"
gap_check_rc=$?
if [ "$gap_check_rc" -eq 0 ]; then
  ok "gap derivation — --check passes on the derived (non-empty) accepted-gaps.json"
else
  ng "gap derivation — --check unexpectedly failed on the derived gap file (rc=$gap_check_rc):"$'\n'"$gap_check_out"
fi

# Mutation (red): corrupt the derived file's content (drop the accepted
# entry) and prove --check now fails GAP-UNDECLARED — the non-vacuity half
# that distinguishes "a derived file with the right content" from "a derived
# file that merely exists".
echo '[]' > "$gap_file"
gap_corrupt_out="$(cd "$gap_sandbox" && bash scripts/build-extension.sh --check gapcombo 2>&1)"
gap_corrupt_rc=$?
if [ "$gap_corrupt_rc" -ne 0 ] && echo "$gap_corrupt_out" | grep -q "GAP-UNDECLARED"; then
  ok "gap derivation (mutation) — emptying the derived accepted-gaps.json turns --check red (GAP-UNDECLARED), proving content — not mere presence — is what --check verifies"
else
  ng "gap derivation (mutation) — did not turn red as expected (rc=$gap_corrupt_rc):"$'\n'"$gap_corrupt_out"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
