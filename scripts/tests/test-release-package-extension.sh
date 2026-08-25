#!/bin/bash
# test-release-package-extension.sh — Regression tests for
# scripts/release-package-extension.sh (spec 0183 R17/R21/R22, PLAN v2 step
# 39) and the R19 fix extracted into scripts/lib/extension-install.sh
# (ext_antigravity_resolve_tokens).
#
# Ruling A (maintainer arbitration, 2026-08-25): the archive root is
# build/extensions/<name> byte-for-byte. R18's equality is asserted
# DIRECTLY — extracted archive vs. a fresh local render — with no per-target
# re-basing (that re-basing only applies under the multi-tool Ruling B,
# which did not land).
#
# Sandboxed with the same idiom scripts/tests/test-build-extension.sh's
# make_sandbox() uses: a fresh mktemp'd copy of scripts/, extension-skeleton/
# and extensions/{core,library,org}/, so the real repository tree (and the
# real, gitignored build/ and dist/ directories a developer may have) is
# never touched.
#
# Usage:
#   bash scripts/tests/test-release-package-extension.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$SCRIPT_DIR/release-package-extension.sh" ]; then
  echo "FATAL: cannot find $SCRIPT_DIR/release-package-extension.sh" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# make_sandbox — a fresh mktemp'd copy of scripts/, extension-skeleton/ and
# extensions/{core,library,org}/ (the real committed trees, so hello-world's
# actual fixtures come along unchanged).
make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  cp -r "$REPO_DIR/extension-skeleton" "$sandbox/extension-skeleton"
  mkdir -p "$sandbox/extensions/core" "$sandbox/extensions/library" "$sandbox/extensions/org"
  cp -r "$REPO_DIR/extensions/core" "$sandbox/extensions/"
  cp -r "$REPO_DIR/extensions/library" "$sandbox/extensions/" 2>/dev/null || true
  cp -r "$REPO_DIR/extensions/org" "$sandbox/extensions/" 2>/dev/null || true
  echo "$sandbox"
}

# --- Case 1: baseline — packaging hello-world at its own committed version -
sandbox="$(make_sandbox)"
VERSION="$(jq -r '.version' "$sandbox/extensions/core/hello-world/extension.json")"
OUT1="$sandbox/release-out-1"
out1="$(cd "$sandbox" && bash scripts/release-package-extension.sh hello-world --version "$VERSION" --out "$OUT1" 2>&1)"
rc1=$?
archive1="$OUT1/hello-world-$VERSION.tar.gz"
if [ "$rc1" -eq 0 ] && [ -f "$archive1" ]; then
  ok "Case 1 — packaging succeeds and writes hello-world-$VERSION.tar.gz"
else
  ng "Case 1 — packaging failed (rc=$rc1):"$'\n'"$out1"
fi

# --- Case 2 (R17, R20): the archive root carries gemini-extension.json,
# --- with NO top-level wrapper directory ------------------------------------
# Pinned live by the R20 probe (docs/runbooks/extension-release-install-probe.md):
# a wrapper directory made the installed tool (Gemini CLI 0.46.0) fail
# install outright ("Configuration file not found"), contradicting its own
# bundled documentation's claim that one is tolerated.
if [ -f "$archive1" ] \
   && tar -tzf "$archive1" | grep -qE '^(\./)?gemini-extension\.json$' \
   && ! tar -tzf "$archive1" | grep -q "^hello-world/"; then
  ok "Case 2 — the archive root carries gemini-extension.json directly, with no top-level wrapper directory (R20-pinned form)"
else
  ng "Case 2 — gemini-extension.json is not at the archive root, or a wrapper directory survives:"$'\n'"$(tar -tzf "$archive1" 2>&1)"
fi

# --- Case 3 (R22): version match; a mismatch fails naming BOTH versions ----
OUT3="$sandbox/release-out-3"
out3="$(cd "$sandbox" && bash scripts/release-package-extension.sh hello-world --version 9.9.9 --out "$OUT3" 2>&1)"
rc3=$?
if [ "$rc3" -ne 0 ] && echo "$out3" | grep -q "$VERSION" && echo "$out3" | grep -q "9.9.9"; then
  ok "Case 3 — a version mismatch fails, naming both the built version and the requested one"
else
  ng "Case 3 — did not fail as expected (rc=$rc3):"$'\n'"$out3"
fi

# --- Case 4: exactly one asset — refuses to run into a non-empty out dir --
OUT4="$sandbox/release-out-4"
mkdir -p "$OUT4"
touch "$OUT4/stray-checksums.txt"
out4="$(cd "$sandbox" && bash scripts/release-package-extension.sh hello-world --version "$VERSION" --out "$OUT4" 2>&1)"
rc4=$?
if [ "$rc4" -ne 0 ] && [ "$(find "$OUT4" -type f | wc -l | tr -d ' ')" -eq 1 ]; then
  ok "Case 4 — refuses to package into an already-non-empty output directory (the one-asset constraint)"
else
  ng "Case 4 — did not refuse as expected (rc=$rc4):"$'\n'"$out4"
fi

# --- Case 5 (R18): extracted archive is byte-identical to a fresh render --
EXTRACT_DIR="$sandbox/extract-5"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$archive1" -C "$EXTRACT_DIR"
FRESH_BUILD="$sandbox/build/extensions/hello-world"
if diff -rq "$EXTRACT_DIR" "$FRESH_BUILD" >/tmp/r18-diff-$$.txt 2>&1; then
  ok "Case 5 — the extracted archive is byte-identical to a fresh local render (R18, Ruling A)"
else
  ng "Case 5 — extracted archive diverges from a fresh render:"$'\n'"$(cat /tmp/r18-diff-$$.txt)"
fi
rm -f /tmp/r18-diff-$$.txt

# --- Case 6 (R17): a source-only candidate is refused, naming what it lacks
# Stub build-extension.sh in a SEPARATE sandbox to simulate a render that
# reports success without producing gemini-extension.json — a scenario the
# real render cannot reach today (it always writes the manifest on success),
# but R17's own text ("An artifact carrying only the extension's committed
# source tree SHALL NOT be published") is a property of the PACKAGING
# script's own assertion, not of the render's current correctness, so this
# proves the packaging script itself refuses rather than trusting the
# render's exit code alone.
sandbox6="$(make_sandbox)"
cat > "$sandbox6/scripts/build-extension.sh" <<'EOF'
#!/bin/bash
# Stub: reports success but writes only the (already-existing) source tree,
# no rendered gemini-extension.json — for Case 6 of
# test-release-package-extension.sh. Always invoked as
# `build-extension.sh --target gemini <name>` by release-package-extension.sh,
# so the extension name is always the third argument ($3).
set -e
NAME="$3"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$REPO_DIR/build/extensions/$NAME"
cp -r "$REPO_DIR/extensions/core/$NAME/." "$REPO_DIR/build/extensions/$NAME/" 2>/dev/null || true
exit 0
EOF
chmod +x "$sandbox6/scripts/build-extension.sh"
out6="$(cd "$sandbox6" && bash scripts/release-package-extension.sh hello-world --version "$VERSION" --out "$sandbox6/release-out-6" 2>&1)"
rc6=$?
if [ "$rc6" -ne 0 ] && echo "$out6" | grep -q "gemini-extension.json"; then
  ok "Case 6 — a source-only candidate (no rendered gemini-extension.json) is refused, naming what it lacks"
else
  ng "Case 6 — did not refuse as expected (rc=$rc6):"$'\n'"$out6"
fi

# ---------------------------------------------------------------------------
# R19, both halves (ext_antigravity_resolve_tokens, scripts/lib/extension-install.sh)
# ---------------------------------------------------------------------------

# Case 7 — locate half: a plugin.json with an absent/empty .name fails,
# naming plugin.json, rather than silently falling back to the source
# directory's basename (the pre-fix behaviour v1-F3 found).
fixture_out="$TMP_ROOT/r19-case7"
mkdir -p "$fixture_out"
echo '{}' > "$fixture_out/plugin.json"
echo '{"default":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}' > "$fixture_out/mcp_config.json"
out7="$(bash -c '
  source "'"$SCRIPT_DIR"'/lib/extension-install.sh"
  ext_antigravity_resolve_tokens "'"$fixture_out"'"
' 2>&1)"
rc7=$?
if [ "$rc7" -ne 0 ] && echo "$out7" | grep -q "plugin.json"; then
  ok "Case 7 (R19, locate half) — an absent/empty plugin.json .name fails, naming plugin.json, with no basename fallback"
else
  ng "Case 7 (R19, locate half) — did not fail as expected (rc=$rc7):"$'\n'"$out7"
fi

# Case 8 — assert half: a valid identity, but the expected installed file is
# absent (simulating an install that did not land where the identity says
# it should) fails naming the expected file.
fixture_home="$TMP_ROOT/r19-case8-home"
mkdir -p "$fixture_home/.gemini/config/plugins"
fixture_out8="$TMP_ROOT/r19-case8-out"
mkdir -p "$fixture_out8"
echo '{"name":"probe-plugin"}' > "$fixture_out8/plugin.json"
echo '{"default":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}' > "$fixture_out8/mcp_config.json"
# Deliberately do NOT create $fixture_home/.gemini/config/plugins/probe-plugin/ —
# the identity resolves, but nothing is installed there.
out8="$(HOME="$fixture_home" bash -c '
  source "'"$SCRIPT_DIR"'/lib/extension-install.sh"
  ext_antigravity_resolve_tokens "'"$fixture_out8"'"
' 2>&1)"
rc8=$?
if [ "$rc8" -ne 0 ] && echo "$out8" | grep -q "probe-plugin"; then
  ok "Case 8 (R19, assert half) — a valid identity with no installed file at the resolved location fails, naming the expected file"
else
  ng "Case 8 (R19, assert half) — did not fail as expected (rc=$rc8):"$'\n'"$out8"
fi

# Case 9 — the successful path: a valid identity AND the installed file
# present resolves the token in place.
fixture_home9="$TMP_ROOT/r19-case9-home"
mkdir -p "$fixture_home9/.gemini/config/plugins/probe-plugin9"
echo '{"default":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}' > "$fixture_home9/.gemini/config/plugins/probe-plugin9/mcp_config.json"
fixture_out9="$TMP_ROOT/r19-case9-out"
mkdir -p "$fixture_out9"
echo '{"name":"probe-plugin9"}' > "$fixture_out9/plugin.json"
echo '{"default":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}' > "$fixture_out9/mcp_config.json"
out9="$(HOME="$fixture_home9" bash -c '
  source "'"$SCRIPT_DIR"'/lib/extension-install.sh"
  ext_antigravity_resolve_tokens "'"$fixture_out9"'"
' 2>&1)"
rc9=$?
resolved9="$(jq -r '.default.args[0]' "$fixture_home9/.gemini/config/plugins/probe-plugin9/mcp_config.json" 2>/dev/null)"
if [ "$rc9" -eq 0 ] && [ "$resolved9" = "$fixture_home9/.gemini/config/plugins/probe-plugin9/dist/index.js" ]; then
  ok "Case 9 (R19, happy path) — a valid identity with the installed file present resolves \${extensionRoot} in place"
else
  ng "Case 9 (R19, happy path) — did not resolve as expected (rc=$rc9, resolved='$resolved9'):"$'\n'"$out9"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
