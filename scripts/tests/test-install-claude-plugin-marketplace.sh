#!/bin/bash
# test-install-claude-plugin-marketplace.sh — Regression test for
# install-claude-plugin.sh (spec 0045, shared plugin marketplace).
#
# Guards the spec 0045 contract: the installed marketplace registry lives in a
# single shared, out-of-tree home — ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/
# local-marketplace/ — with one shared marketplace.json that upserts each
# extension by name, so multi-extension installs coexist and survive branch
# switches.
#
# Testability seams (the script calls real external tooling):
#   * `claude` CLI (marketplace add / install) is NOT available in CI. We stub
#     it with a no-op shim on PATH so the registry-building logic runs while the
#     CLI registration step is neutralised. `jq` stays REAL — the manifest
#     merge/upsert is the behavior under test.
#   * The build step resolves a real extension under extensions/<tier>/<name>/
#     and runs the real build-claude-plugin.sh. We use the shipped extension
#     extensions/core/hello-world as the install subject (no fabricated
#     fixtures inside the repo tree).
#   * The registry root is driven by a TEMP CLAUDE_CONFIG_DIR so the test never
#     touches the real $HOME/.claude. Everything is torn down on exit.
#
# Cases → spec 0045 scenarios:
#   1. Out-of-tree location          → R4 + "survives a branch switch" scenario
#   2. Coexistence / upsert          → R1 + R2 + "two extensions coexist"
#   3. Idempotent re-install         → R5 + "re-installing is idempotent"
#   4. Failed install leaves registry → "failed install leaves registry intact"
#
# Usage:
#   bash scripts/tests/test-install-claude-plugin-marketplace.sh
#
# -e is intentionally omitted: exit codes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/install-claude-plugin.sh"
EXT_SUBJECT="hello-world"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi
if [ ! -d "$REPO_DIR/extensions/core/$EXT_SUBJECT" ]; then
  echo "FATAL: expected real extension extensions/core/$EXT_SUBJECT is missing" >&2
  exit 2
fi
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required (and must stay real)" >&2; exit 2; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# --- Stub `claude` with a no-op shim, prepended to PATH for every run. -------
STUB_BIN="$TMP_ROOT/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/claude" <<'STUB'
#!/bin/bash
# No-op claude stub: the marketplace add/install steps are out of scope for
# this test; the registry-building logic before them is what we assert.
exit 0
STUB
chmod +x "$STUB_BIN/claude"

pass=0
fail=0

check() {
  # check <description> -- <command...>
  # The command after `--` is run; exit 0 = PASS, anything else = FAIL.
  local desc="$1"
  shift
  [ "$1" = "--" ] && shift
  if "$@"; then
    echo "PASS  $desc"
    pass=$((pass + 1))
  else
    echo "FAIL  $desc"
    fail=$((fail + 1))
  fi
}

# manifest_has <manifest> <name> — exit 0 iff a plugin with that name is listed.
manifest_has() {
  jq -e --arg n "$2" 'any(.plugins[]; .name == $n)' "$1" >/dev/null 2>&1
}

# both_zero <rc-a> <rc-b> — exit 0 iff both args are "0".
both_zero() {
  [ "$1" = "0" ] && [ "$2" = "0" ]
}

# fresh_config — return a brand-new temp CLAUDE_CONFIG_DIR for a case.
fresh_config() {
  mktemp -d "$TMP_ROOT/cfg.XXXXXX"
}

# manifest_path <config-dir> — the shared, out-of-tree marketplace manifest.
manifest_path() {
  echo "$1/local-marketplace/.claude-plugin/marketplace.json"
}

# run_install <config-dir> <ext-name> — invoke the script with the claude stub
# on PATH and the given temp config root. Echoes the exit code.
run_install() {
  local cfg="$1" ext="$2" rc=0
  (
    export CLAUDE_CONFIG_DIR="$cfg"
    export PATH="$STUB_BIN:$PATH"
    bash "$SCRIPT_UNDER_TEST" "$ext" >/dev/null 2>&1
  ) || rc=$?
  echo "$rc"
}

# seed_manifest <config-dir> — pre-seed the shared manifest with a synthetic
# prior plugin entry ("other-ext"), simulating a previously-installed extension.
seed_manifest() {
  local cfg="$1" dir
  dir="$cfg/local-marketplace/.claude-plugin"
  mkdir -p "$dir"
  cat > "$dir/marketplace.json" <<'SEED'
{
  "name": "seeded-local",
  "owner": { "name": "crewrig contributors" },
  "plugins": [
    {
      "name": "other-ext",
      "description": "Synthetic prior install",
      "author": { "name": "seed" },
      "source": "./other-ext"
    }
  ]
}
SEED
}

# ---------------------------------------------------------------------------
# Case 1 — Out-of-tree location (R4 + branch-switch durability).
# After one install, the shared manifest exists at the out-of-tree path under
# CLAUDE_CONFIG_DIR, and NO dist-claude-plugin/ directory was created inside the
# repository working tree (registration does not depend on the working tree).
# ---------------------------------------------------------------------------
cfg1="$(fresh_config)"
rc1="$(run_install "$cfg1" "$EXT_SUBJECT")"
mf1="$(manifest_path "$cfg1")"

check "Case 1 — install exits 0 with stubbed claude" -- [ "$rc1" -eq 0 ]
check "Case 1 — shared manifest exists at out-of-tree path under CLAUDE_CONFIG_DIR" \
  -- [ -f "$mf1" ]
check "Case 1 — manifest lists the installed extension" \
  -- manifest_has "$mf1" "$EXT_SUBJECT"
# Branch-switch durability proxy: the registry is off the working tree, so no
# dist-claude-plugin/ build output may appear anywhere under the repo.
stray="$(find "$REPO_DIR" -name 'dist-claude-plugin' -not -path '*/.git/*' 2>/dev/null)"
check "Case 1 — no dist-claude-plugin/ created inside the repository working tree" \
  -- [ -z "$stray" ]

# ---------------------------------------------------------------------------
# Case 2 — Coexistence / upsert (R1 + R2).
# With a prior "other-ext" entry pre-seeded into the shared manifest, installing
# hello-world must leave BOTH entries present — the prior install is not
# unregistered.
# ---------------------------------------------------------------------------
cfg2="$(fresh_config)"
seed_manifest "$cfg2"
rc2="$(run_install "$cfg2" "$EXT_SUBJECT")"
mf2="$(manifest_path "$cfg2")"

check "Case 2 — install exits 0 over a pre-seeded manifest" -- [ "$rc2" -eq 0 ]
check "Case 2 — prior 'other-ext' entry survives the new install (R1 coexistence)" \
  -- manifest_has "$mf2" "other-ext"
check "Case 2 — newly installed '$EXT_SUBJECT' entry is present (R2 shared listing)" \
  -- manifest_has "$mf2" "$EXT_SUBJECT"

# ---------------------------------------------------------------------------
# Case 3 — Idempotent re-install (R5).
# Installing the same extension twice yields EXACTLY ONE entry for it.
# ---------------------------------------------------------------------------
cfg3="$(fresh_config)"
rc3a="$(run_install "$cfg3" "$EXT_SUBJECT")"
rc3b="$(run_install "$cfg3" "$EXT_SUBJECT")"
mf3="$(manifest_path "$cfg3")"
count3="$(jq --arg n "$EXT_SUBJECT" '[.plugins[] | select(.name == $n)] | length' "$mf3" 2>/dev/null)"

check "Case 3 — both installs exit 0" -- both_zero "$rc3a" "$rc3b"
check "Case 3 — exactly one '$EXT_SUBJECT' entry after a re-install (R5 idempotent)" \
  -- [ "$count3" = "1" ]

# ---------------------------------------------------------------------------
# Case 4 — Failed install leaves the shared registry intact.
# A bogus extension name resolves to no extension: the script must exit non-zero
# AND leave the pre-seeded manifest byte-for-byte unchanged.
# ---------------------------------------------------------------------------
cfg4="$(fresh_config)"
seed_manifest "$cfg4"
mf4="$(manifest_path "$cfg4")"
before4="$(shasum "$mf4" | awk '{print $1}')"
rc4="$(run_install "$cfg4" "definitely-not-an-extension")"
after4="$(shasum "$mf4" | awk '{print $1}')"

check "Case 4 — install of a bogus extension name exits non-zero" \
  -- [ "$rc4" -ne 0 ]
check "Case 4 — pre-seeded manifest is byte-for-byte unchanged after the failure" \
  -- [ "$before4" = "$after4" ]

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
