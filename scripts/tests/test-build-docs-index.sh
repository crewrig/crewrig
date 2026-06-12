#!/bin/bash
# test-build-docs-index.sh — Regression test for build-docs-index.sh.
#
# Pins the contract from spec 0027 (docs/publication-contract.md):
#   - the generator emits a deterministic docs/index.json from per-page
#     crewrig-doc metadata blocks (published pages only, grouped by section);
#   - --check passes on a fresh tree and fails on drift;
#   - the lint pass fails on: a published page missing a required field, an
#     unknown section, an orphan manifest entry (path with no file), a value
#     containing a forbidden character, and a page with no metadata block.
#
# The script under test derives its repo root from its own location
# (dirname "$0"/..). Each case therefore builds a throwaway "repo" with a
# scripts/ + docs/ layout, copies the real generator in, and runs it there.
#
# Usage:
#   bash scripts/tests/test-build-docs-index.sh

# -e omitted on purpose: expected non-zero exits from the script under test
# are asserted explicitly, not allowed to abort the harness.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/build-docs-index.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# Build a throwaway repo skeleton; echo its root path on stdout.
new_tree() {
  local dir
  dir="$(mktemp -d "$TMP_ROOT/tree.XXXXXX")"
  mkdir -p "$dir/scripts" "$dir/docs"
  cp "$SCRIPT_UNDER_TEST" "$dir/scripts/build-docs-index.sh"
  echo "$dir"
}

# Write a minimal page with the given H1 and metadata block.
write_page() {
  local file="$1" h1="$2" block="$3"
  mkdir -p "$(dirname "$file")"
  {
    printf '# %s\n\n' "$h1"
    [ -n "$block" ] && printf '%s\n\n' "$block"
    printf 'Body.\n'
  } > "$file"
}

run() {
  # run <tree> [--check] -> sets RC
  local tree="$1"; shift
  RC=0
  ( cd "$tree" && bash scripts/build-docs-index.sh "$@" >/dev/null 2>&1 ) || RC=$?
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected '$expected', got '$actual')"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Case 1 — Happy path: published + unpublished pages, generate then --check.
# -------------------------------------------------------------------------
t1="$(new_tree)"
write_page "$t1/docs/a.md" "Alpha"  '<!-- crewrig-doc: section=reference nav_order=20 published=true title="Alpha" -->'
write_page "$t1/docs/b.md" "Beta"   '<!-- crewrig-doc: section=reference nav_order=10 published=true title="Beta" -->'
write_page "$t1/docs/c.md" "Gamma"  '<!-- crewrig-doc: published=false -->'
run "$t1"
assert_eq "Case 1a — generate succeeds" 0 "$RC"
# Only the 2 published pages appear, sorted by nav_order (Beta=10 before Alpha=20).
got_order="$(grep -oE '"path":[[:space:]]*"[^"]*"' "$t1/docs/index.json" | sed -E 's/.*"([^"]*)".*/\1/' | tr '\n' ',')"
assert_eq "Case 1b — published-only, nav_order sorted" "docs/b.md,docs/a.md," "$got_order"
run "$t1" --check
assert_eq "Case 1c — --check passes on fresh tree" 0 "$RC"

# -------------------------------------------------------------------------
# Case 2 — Determinism: a second generate is byte-identical.
# -------------------------------------------------------------------------
first="$(cat "$t1/docs/index.json")"
run "$t1"
second="$(cat "$t1/docs/index.json")"
if [ "$first" = "$second" ]; then
  echo "PASS  Case 2 — regeneration is byte-identical"
  pass=$((pass + 1))
else
  echo "FAIL  Case 2 — regeneration drifted"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 3 — Drift: mutate the committed index, --check must fail.
# -------------------------------------------------------------------------
t3="$(new_tree)"
write_page "$t3/docs/a.md" "Alpha" '<!-- crewrig-doc: section=reference nav_order=10 published=true title="Alpha" -->'
run "$t3"
printf 'drift\n' >> "$t3/docs/index.json"
run "$t3" --check
assert_eq "Case 3 — --check detects drift" 1 "$RC"

# -------------------------------------------------------------------------
# Case 4 — Lint: published page missing a required field (nav_order).
# -------------------------------------------------------------------------
t4="$(new_tree)"
write_page "$t4/docs/a.md" "Alpha" '<!-- crewrig-doc: section=reference published=true title="Alpha" -->'
run "$t4"
assert_eq "Case 4 — missing required field fails" 1 "$RC"

# -------------------------------------------------------------------------
# Case 5 — Lint: unknown section.
# -------------------------------------------------------------------------
t5="$(new_tree)"
write_page "$t5/docs/a.md" "Alpha" '<!-- crewrig-doc: section=nonsense nav_order=10 published=true title="Alpha" -->'
run "$t5"
assert_eq "Case 5 — unknown section fails" 1 "$RC"

# -------------------------------------------------------------------------
# Case 6 — Lint: orphan manifest entry (committed path with no file).
# -------------------------------------------------------------------------
t6="$(new_tree)"
write_page "$t6/docs/a.md" "Alpha" '<!-- crewrig-doc: section=reference nav_order=10 published=true title="Alpha" -->'
run "$t6"   # produces a valid index for docs/a.md
# Inject an orphan path into the committed manifest.
sed -i.bak 's#"docs/a.md"#"docs/ghost.md"#' "$t6/docs/index.json" && rm -f "$t6/docs/index.json.bak"
run "$t6" --check
assert_eq "Case 6 — orphan manifest entry fails" 1 "$RC"

# -------------------------------------------------------------------------
# Case 7 — Lint: page with no metadata block at all.
# -------------------------------------------------------------------------
t7="$(new_tree)"
write_page "$t7/docs/a.md" "Alpha" ''
run "$t7"
assert_eq "Case 7 — missing metadata block fails" 1 "$RC"

# -------------------------------------------------------------------------
# Case 8 — Lint: forbidden character in a value.
# -------------------------------------------------------------------------
t8="$(new_tree)"
# A bare value containing '>' (forbidden — would close the HTML comment).
write_page "$t8/docs/a.md" "Alpha" '<!-- crewrig-doc: section=reference nav_order=1>0 published=true title="Alpha" -->'
run "$t8"
assert_eq "Case 8 — forbidden '>' in value fails" 1 "$RC"

# -------------------------------------------------------------------------
# Case 9 — Anchoring: a decoy crewrig-doc line BEFORE the H1 is ignored; the
# real block after the H1 is the one parsed (guards the placement rule and the
# contract page's own in-body example blocks).
# -------------------------------------------------------------------------
t9="$(new_tree)"
{
  printf '<!-- crewrig-doc: section=concepts nav_order=5 published=true title="DECOY" -->\n\n'
  printf '# Real Page\n\n'
  printf '<!-- crewrig-doc: section=reference nav_order=30 published=true title="Real Page" -->\n\n'
  printf 'Body.\n'
} > "$t9/docs/real.md"
run "$t9"
assert_eq "Case 9a — generate succeeds with decoy before H1" 0 "$RC"
got_section="$(grep -oE '"section":[[:space:]]*"[a-z-]+"' "$t9/docs/index.json" | head -1 | sed -E 's/.*"([a-z-]+)".*/\1/')"
assert_eq "Case 9b — real block after H1 wins over pre-H1 decoy" "reference" "$got_section"
decoy_count="$(grep -c 'DECOY' "$t9/docs/index.json" || true)"
assert_eq "Case 9c — pre-H1 decoy absent from index" "0" "$decoy_count"

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
