#!/bin/bash
# test-migrate-extension.sh — Regression tests for scripts/migrate-extension.sh
# (spec 0183 R15, PLAN step 13).
#
# The repository has no extension fixture convention beyond two TSV files
# under scripts/tests/fixtures/, so this follows the in-script `make_sandbox`
# pattern of scripts/tests/test-build-extension.sh: a fresh mktemp'd copy of
# scripts/ + extension-skeleton/, with extensions/{core,library,org} created
# empty, so every invocation under test runs against ITS OWN copy of
# scripts/lib/extension-legacy-shape.json (self-relative path resolution) —
# which is what makes the R12 growth mutation below possible without
# mutating the real repository's enumeration.
#
# Cases:
#   1. Conversion produces a tree that passes `bash scripts/build-extension.sh --check`.
#   2. A second run reports already-migrated and leaves a recursive checksum
#      of the tree unchanged (idempotence).
#   3. An unconvertible form (a components.<subject> entry enabled where a
#      top-level <subject> section already exists) fails loudly and leaves
#      the tree byte-identical.
#   4. R12 growth mutation: adding a synthetic old-shape form to a sandboxed
#      copy of scripts/lib/extension-legacy-shape.json makes a manifest
#      carrying that form BOTH fail a reader (ext_assert_current_shape, via
#      `build-extension.sh --check`) AND get acted on (converted) by
#      scripts/migrate-extension.sh — proving the enumeration is genuinely
#      single-sourced rather than duplicated between reader and tool.
#
# Usage:
#   bash scripts/tests/test-migrate-extension.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE="$SCRIPT_DIR/migrate-extension.sh"

if [ ! -f "$MIGRATE" ]; then
  echo "FATAL: cannot find $MIGRATE" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# make_sandbox — a fresh mktemp'd copy of scripts/ + extension-skeleton/,
# mirroring scripts/tests/test-build-extension.sh's own helper: every
# invocation run against this sandbox resolves its OWN copy of
# scripts/lib/extension-legacy-shape.json.
make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  cp -r "$REPO_DIR/extension-skeleton" "$sandbox/extension-skeleton"
  mkdir -p "$sandbox/extensions/core" "$sandbox/extensions/library" "$sandbox/extensions/org"
  echo "$sandbox"
}

checksum_tree() {
  find "$1" -type f -exec cksum {} \; | sort
}

# --- Case 1: conversion produces a tree that passes --check ---------------
sandbox="$(make_sandbox)"
ext_dir="$sandbox/extensions/core/oldshape"
mkdir -p "$ext_dir/commands" "$ext_dir/agents/demo/"
cat > "$ext_dir/extension.json" <<'EOF'
{
  "name": "oldshape",
  "version": "0.1.0",
  "description": "fixture",
  "components": {
    "commands": {"enabled": true, "location": "commands/"},
    "skills": {"enabled": false, "location": "skills/"},
    "agents": {"enabled": true, "location": "agents/"},
    "hooks": {"enabled": false, "location": "hooks/"}
  },
  "claude": {
    "author": {"name": "test"},
    "skills": ["skills/*/SKILL.md"],
    "agents": [],
    "rules": [],
    "defaultAllowedTools": []
  },
  "copilot": {"pluginName": "oldshape"},
  "antigravity": {"pluginName": "oldshape"}
}
EOF
cat > "$ext_dir/commands/hello.md" <<'EOF'
---
name: hello
description: "hello command"
type: command
---
Hello.
EOF
cat > "$ext_dir/agents/demo/AGENT.md" <<'EOF'
---
name: demo
description: "demo agent"
type: agent
---
Demo.
EOF

out="$(bash "$sandbox/scripts/migrate-extension.sh" "$ext_dir" 2>&1)"
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "Case 1 — migration exits 0"
else
  ng "Case 1 — migration failed (rc=$rc):"$'\n'"$out"
fi

chk_out="$(cd "$sandbox" && bash scripts/build-extension.sh --check oldshape 2>&1)"
chk_rc=$?
if [ "$chk_rc" -eq 0 ]; then
  ok "Case 1 — the converted tree passes 'bash scripts/build-extension.sh --check'"
else
  ng "Case 1 — --check failed on the converted tree (rc=$chk_rc):"$'\n'"$chk_out"
fi

# --- Case 2: idempotence — second run reports already-migrated, tree unchanged
before_sum="$(checksum_tree "$ext_dir")"
out2="$(bash "$sandbox/scripts/migrate-extension.sh" "$ext_dir" 2>&1)"
rc2=$?
after_sum="$(checksum_tree "$ext_dir")"
if [ "$rc2" -eq 0 ] && echo "$out2" | grep -qi "already migrated"; then
  ok "Case 2 — a second run reports already-migrated"
else
  ng "Case 2 — second run did not report already-migrated as expected (rc=$rc2):"$'\n'"$out2"
fi
if [ "$before_sum" = "$after_sum" ]; then
  ok "Case 2 — the tree's recursive checksum is unchanged by the second run"
else
  ng "Case 2 — the tree changed on the already-migrated run"
fi

# --- Case 3: an unconvertible form fails loudly, tree left byte-identical -
sandbox3="$(make_sandbox)"
conflict_dir="$sandbox3/extensions/core/conflict"
mkdir -p "$conflict_dir"
cat > "$conflict_dir/extension.json" <<'EOF'
{
  "name": "conflict",
  "version": "0.1.0",
  "description": "fixture: components.commands.enabled=true AND a top-level commands section both present",
  "commands": {"location": "commands/"},
  "components": {
    "commands": {"enabled": true, "location": "commands/", "convertToSkills": true}
  }
}
EOF
before3="$(checksum_tree "$conflict_dir")"
out3="$(bash "$sandbox3/scripts/migrate-extension.sh" "$conflict_dir" 2>&1)"
rc3=$?
after3="$(checksum_tree "$conflict_dir")"
if [ "$rc3" -ne 0 ] && [ "$before3" = "$after3" ]; then
  ok "Case 3 — an unconvertible form fails loudly and leaves the tree byte-identical"
else
  ng "Case 3 — did not fail-and-preserve as expected (rc=$rc3):"$'\n'"$out3"
fi

# --- Case 4: R12 growth mutation -------------------------------------------
# Add a synthetic per-CLI key form to THIS sandbox's own copy of the
# enumeration, then assert a manifest carrying it is (a) failed by a reader
# and (b) converted by the migration tool — proving neither carries its own
# list. The synthetic key is ALSO added to the sandbox's per-CLI admissibility
# allowlist (extension-percli-keys.json) as admissible, so the pre-existing,
# UNRELATED inadmissible-key check cannot be the reason the reader fails —
# isolating the assertion to ext_assert_current_shape's use of the
# legacy-shape enumeration.
sandbox4="$(make_sandbox)"
shape_file="$sandbox4/scripts/lib/extension-legacy-shape.json"
jq '.perCliKeys += ["claude.syntheticGrowthKey"]' "$shape_file" > "$shape_file.tmp" && mv "$shape_file.tmp" "$shape_file"
allowlist_file="$sandbox4/scripts/lib/extension-percli-keys.json"
jq '. += [{"key": "claude.syntheticGrowthKey", "reason": "cli-only-concept", "evidence": "test fixture"}]' \
  "$allowlist_file" > "$allowlist_file.tmp" && mv "$allowlist_file.tmp" "$allowlist_file"

growth_dir="$sandbox4/extensions/core/growth"
mkdir -p "$growth_dir"
cat > "$growth_dir/extension.json" <<'EOF'
{
  "name": "growth",
  "version": "0.1.0",
  "description": "fixture carrying the synthetic growth-mutation key",
  "claude": {
    "author": {"name": "test"},
    "syntheticGrowthKey": "should be rejected and stripped",
    "defaultAllowedTools": []
  }
}
EOF

reader_out="$(cd "$sandbox4" && bash scripts/build-extension.sh --check growth 2>&1)"
reader_rc=$?
if [ "$reader_rc" -ne 0 ]; then
  ok "Case 4 (reader) — a manifest carrying the synthetic growth-mutation key is failed by --check"
else
  ng "Case 4 (reader) — --check did NOT fail on the synthetic growth-mutation key (rc=$reader_rc):"$'\n'"$reader_out"
fi

migrate_out="$(bash "$sandbox4/scripts/migrate-extension.sh" "$growth_dir" 2>&1)"
migrate_rc=$?
still_present="$(jq -e '.claude // {} | has("syntheticGrowthKey")' "$growth_dir/extension.json" 2>/dev/null)"
if [ "$migrate_rc" -eq 0 ] && [ "$still_present" = "false" ]; then
  ok "Case 4 (tool) — the migration tool acts on the synthetic growth-mutation key (stripped it) with no code change of its own"
else
  ng "Case 4 (tool) — the migration tool did not convert the synthetic key as expected (rc=$migrate_rc, still_present=$still_present):"$'\n'"$migrate_out"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
