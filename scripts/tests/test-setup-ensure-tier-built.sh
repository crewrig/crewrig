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
#       tier-install function (install_tier_to_home /
#       install_tier_skills_to_home / install_antigravity_tier_to_home)
#       already reads for the `library` tier — asserted by grepping both from
#       the actual source, never by hardcoding an assumed match.
#
#       Three of the four keep that function inline. Antigravity's lives in
#       scripts/lib/common.sh since spec 0123, so for that script the
#       assertion reads the two halves from two files and compares ACROSS the
#       boundary. The parity is not weakened by the move — it is what the move
#       makes worth checking, because a divergence between the path
#       ensure_tier_built builds and the path the installer reads is now a
#       cross-file edit nobody sees in one diff.
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
echo "4. Structural parity: the build target and staging path each setup declares for its library tier"
# ---------------------------------------------------------------------------
# Retargeted (spec 0256 R9, PR D1): the build target and the staging path are read from the
# DECLARATION of each setup (`tiers.build-target`, `tiers.gate` — the directory ensure_tier_built
# tests and the one the tier install reads — and `tiers.library-staging`), not from the
# ensure_tier_built call and the tier-install function of the shell. Pinned against the unchanged
# shell by scripts/tests/setup-retarget-others.test.ts ("ensure_tier_built ... equals the declared
# ..."), which reads the call and the install function and compares them ACROSS the file boundary
# (Antigravity's function lives in scripts/lib/common.sh), and by the golden cells `default-answers`
# (the library tier is built and installed) and `tier-install-failure` (Antigravity).
decl() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts" "$1"; }
fact() { printf '%s\n' "$2" | grep "^$1=" | head -1 | cut -d= -f2-; }

for expected_tool in gemini claude copilot antigravity; do
  # The tool names and the staging sub-directories stay verbatim literals on purpose — deriving them
  # from the declaration would make the assertion compare a value with itself.
  case "$expected_tool" in
    gemini)      expected_sub=".gemini" ;;
    claude)      expected_sub=".claude" ;;
    copilot)     expected_sub=".github/skills" ;;
    antigravity) expected_sub=".agents" ;;
  esac
  declared="$(decl "$expected_tool")" || declared=""
  if [ -z "$declared" ]; then
    bad "$expected_tool: empty declaration (vacuity guard)"
    continue
  fi
  build_target="$(fact tiers.build-target "$declared")"
  gate="$(fact tiers.gate "$declared")"
  library_staging="$(fact tiers.library-staging "$declared")"
  if [ -z "$build_target" ] || [ -z "$gate" ] || [ -z "$library_staging" ]; then
    bad "$expected_tool: the declaration lacks tiers.build-target / tiers.gate / tiers.library-staging"
    continue
  fi

  [ "$build_target" = "$expected_tool" ] \
    && ok "$expected_tool: declared build_target is '$expected_tool'" \
    || bad "$expected_tool: declared build_target was '$build_target', expected '$expected_tool'"

  # <TIER> is the declared tier placeholder: the automatic tier is `library`.
  declared_staging="${gate/<TIER>/library}"
  expected_staging="<REPO>/dist/library/$expected_sub"
  [ "$declared_staging" = "$expected_staging" ] \
    && ok "$expected_tool: declared staging path is the library tier's own ($declared_staging)" \
    || bad "$expected_tool: declared staging path '$declared_staging' != '$expected_staging'"

  # The library staging root is the gate directory's own root (Copilot's gate adds /skills).
  case "$declared_staging" in
    "$library_staging"|"$library_staging"/*)
      ok "$expected_tool: the declared staging path lies under the declared library staging root ($library_staging)" ;;
    *)
      bad "$expected_tool: declared staging path '$declared_staging' is outside the library staging root '$library_staging'" ;;
  esac
done

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
