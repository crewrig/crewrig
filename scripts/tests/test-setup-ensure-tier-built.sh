#!/bin/bash
# test-setup-ensure-tier-built.sh — Regression tests for the shared
# ensure_tier_built() auto-build helper (spec 0107, issue #618).
#
# Unit under test: ensure_tier_built() in scripts/lib/common.sh, driven
# through its hermetic surface (mktemp -d fixtures standing in for a repo
# checkout and its dist/ staging output, plus a stubbed
# scripts/build-components.sh). No network access, no fzf, no writes to any
# real CLI home, matching this repo's convention (see
# scripts/tests/test-setup-catalogue-picker.sh house style).
#
# Contract asserted (spec 0107):
#   (a) staging path already exists as a directory -> returns 0 immediately,
#       WITHOUT invoking build-components.sh at all.
#   (b) staging path missing, stubbed build-components.sh exits 0 -> returns 0.
#   (c) staging path missing, stubbed build-components.sh exits non-zero ->
#       returns 1, and the printed output names the failed build target.
#   (d) structural: each of the four setup-*-interactive.sh scripts passes
#       ensure_tier_built the exact same staging-path literal that its own
#       existing tier-install function (install_tier_to_home /
#       install_tier_skills_to_home) already reads for the `library` tier —
#       asserted by grepping both from the actual script source, never by
#       hardcoding an assumed match.
#
# HERMETIC: every operation runs against mktemp -d fixtures; nothing under
# the real repo's dist/ directory or scripts/build-components.sh is invoked.
#
# Usage:
#   bash scripts/tests/test-setup-ensure-tier-built.sh

# -e intentionally omitted: pass/fail counters control the harness, and some
# probes intentionally check a non-zero/empty result.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"
SETUP_DIR="$REPO_DIR/scripts"

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
echo "1. Staging path already built: returns 0, build-components.sh never invoked"
# ---------------------------------------------------------------------------

FAKE_REPO_1="$TMP_ROOT/fake-repo-1"
mkdir -p "$FAKE_REPO_1/scripts" "$FAKE_REPO_1/dist/library/.gemini"
cat > "$FAKE_REPO_1/scripts/build-components.sh" <<'EOF'
#!/bin/bash
# Would fail the test if ever invoked (proof the already-built short circuit
# never reaches the build call).
echo "STUB: build-components.sh was invoked" >&2
exit 1
EOF
chmod +x "$FAKE_REPO_1/scripts/build-components.sh"

rc=0
out="$(ensure_tier_built "$FAKE_REPO_1" gemini "$FAKE_REPO_1/dist/library/.gemini" 2>"$TMP_ROOT/stderr.1")" || rc=$?
[ "$rc" -eq 0 ] && ok "already-built: returns 0" || bad "already-built: returned $rc"
if grep -q "STUB: build-components.sh was invoked" "$TMP_ROOT/stderr.1"; then
  bad "already-built: build-components.sh was invoked despite the staging dir already existing"
else
  ok "already-built: build-components.sh was never invoked"
fi
[ -z "$out" ] && ok "already-built: no message printed to stdout" \
  || bad "already-built: unexpected stdout '$out'"

# ---------------------------------------------------------------------------
echo "2. Staging path missing, build succeeds: returns 0"
# ---------------------------------------------------------------------------

FAKE_REPO_2="$TMP_ROOT/fake-repo-2"
mkdir -p "$FAKE_REPO_2/scripts"
cat > "$FAKE_REPO_2/scripts/build-components.sh" <<'EOF'
#!/bin/bash
# Simulates a successful build by materializing the staging dir the caller
# expects to find afterward — mirroring what the real build-components.sh
# would do for --target gemini.
mkdir -p "$(dirname "$0")/../dist/library/.gemini"
exit 0
EOF
chmod +x "$FAKE_REPO_2/scripts/build-components.sh"

rc=0
out="$(ensure_tier_built "$FAKE_REPO_2" gemini "$FAKE_REPO_2/dist/library/.gemini" 2>"$TMP_ROOT/stderr.2")" || rc=$?
[ "$rc" -eq 0 ] && ok "missing + build succeeds: returns 0" || bad "missing + build succeeds: returned $rc"
if grep -q "not built" "$TMP_ROOT/stderr.2" 2>/dev/null || grep -q "not built" <<<"$out"; then
  ok "missing + build succeeds: a not-built message was printed"
else
  bad "missing + build succeeds: expected a not-built notice, found none"
fi

# ---------------------------------------------------------------------------
echo "3. Staging path missing, build fails: returns 1, names the failed target"
# ---------------------------------------------------------------------------

FAKE_REPO_3="$TMP_ROOT/fake-repo-3"
mkdir -p "$FAKE_REPO_3/scripts"
cat > "$FAKE_REPO_3/scripts/build-components.sh" <<'EOF'
#!/bin/bash
exit 1
EOF
chmod +x "$FAKE_REPO_3/scripts/build-components.sh"

rc=0
out="$(ensure_tier_built "$FAKE_REPO_3" claude "$FAKE_REPO_3/dist/library/.claude" 2>"$TMP_ROOT/stderr.3")" || rc=$?
[ "$rc" -eq 1 ] && ok "missing + build fails: returns 1" || bad "missing + build fails: returned $rc"
if grep -qE "ERROR:.*claude" "$TMP_ROOT/stderr.3"; then
  ok "missing + build fails: ERROR line names the failed build target 'claude'"
else
  bad "missing + build fails: no ERROR line naming the failed target found in stderr"
fi
[ ! -d "$FAKE_REPO_3/dist/library/.claude" ] \
  && ok "missing + build fails: staging dir still absent (build genuinely failed, not partially applied)" \
  || bad "missing + build fails: staging dir unexpectedly present"

# ---------------------------------------------------------------------------
echo "4. Structural parity: ensure_tier_built staging arg matches each script's own install-fn staging path (library tier)"
# ---------------------------------------------------------------------------

# extract_ensure_call <script>
# Prints the literal 3rd-argument (staging path) passed to ensure_tier_built
# in <script>, exactly as it appears in source (unexpanded $REPO_DIR/$tier).
extract_ensure_staging_arg() {
  local script="$1" line
  line="$(grep -oE 'ensure_tier_built "\$REPO_DIR" [A-Za-z0-9_]+ "[^"]*"' "$script" | head -1)"
  [ -z "$line" ] && return 1
  printf '%s\n' "$line" | awk -F'"' '{print $4}'
}

# extract_ensure_tool <script>
# Prints the build_target (2nd argument) passed to ensure_tier_built.
extract_ensure_tool() {
  local script="$1" line
  line="$(grep -oE 'ensure_tier_built "\$REPO_DIR" [A-Za-z0-9_]+ "[^"]*"' "$script" | head -1)"
  [ -z "$line" ] && return 1
  printf '%s\n' "$line" | awk '{print $3}'
}

# extract_install_tier_arg <script>
# Prints the tier literal (e.g. "library") passed to whichever tier-install
# function (install_tier_to_home / install_tier_skills_to_home) the script
# calls for its automatic tier.
extract_install_tier_arg() {
  local script="$1" line
  line="$(grep -oE 'install_tier(_skills)?_to_home [a-zA-Z0-9_]+' "$script" | head -1)"
  [ -z "$line" ] && return 1
  printf '%s\n' "$line" | awk '{print $NF}'
}

# extract_install_fn_staging_pattern <script>
# Prints the literal (unexpanded) RHS of the install function's
# `local staging="..."` assignment, e.g. '$REPO_DIR/dist/$tier/.gemini'.
extract_install_fn_staging_pattern() {
  local script="$1" line
  line="$(grep -oE 'local staging="[^"]*"' "$script" | head -1)"
  [ -z "$line" ] && return 1
  printf '%s\n' "$line" | sed -E 's/^local staging="(.*)"$/\1/'
}

declare -A EXPECTED_TOOLS=(
  [setup-gemini-interactive.sh]=gemini
  [setup-claude-interactive.sh]=claude
  [setup-copilot-interactive.sh]=copilot
  [setup-antigravity-interactive.sh]=antigravity
)

for s in setup-gemini-interactive.sh setup-claude-interactive.sh \
         setup-copilot-interactive.sh setup-antigravity-interactive.sh; do
  path="$SETUP_DIR/$s"
  if [ ! -f "$path" ]; then
    bad "$s: script not found at $path"
    continue
  fi

  ensure_staging="$(extract_ensure_staging_arg "$path")"
  ensure_tool="$(extract_ensure_tool "$path")"
  install_tier_arg="$(extract_install_tier_arg "$path")"
  install_pattern="$(extract_install_fn_staging_pattern "$path")"

  if [ -z "$ensure_staging" ]; then
    bad "$s: no ensure_tier_built call found"
    continue
  fi
  if [ -z "$install_pattern" ]; then
    bad "$s: no 'local staging=' assignment found in its tier-install function"
    continue
  fi

  [ "$ensure_tool" = "${EXPECTED_TOOLS[$s]}" ] \
    && ok "$s: ensure_tier_built build_target is '${EXPECTED_TOOLS[$s]}'" \
    || bad "$s: ensure_tier_built build_target was '$ensure_tool', expected '${EXPECTED_TOOLS[$s]}'"

  # Substitute the literal '$tier' token in the install function's pattern
  # with the literal tier argument the script actually passes to its
  # install function ("library" for all four scripts today) — derived from
  # the script itself, not assumed.
  expected_staging="${install_pattern/\$tier/$install_tier_arg}"

  [ "$ensure_staging" = "$expected_staging" ] \
    && ok "$s: ensure_tier_built staging path matches the install function's own staging path ($ensure_staging)" \
    || bad "$s: ensure_tier_built staging path '$ensure_staging' != install function's '$expected_staging'"
done

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
