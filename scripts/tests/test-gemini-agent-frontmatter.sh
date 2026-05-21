#!/bin/bash
# test-gemini-agent-frontmatter.sh — Regression for issue #54.
#
# Gemini CLI 0.42.0 rejects unknown frontmatter keys in `.gemini/agents/*.md`
# with an "Unrecognized key(s): type, metadata" error. The build pipeline now
# strips `type:` and `metadata:` from Gemini agent frontmatter and emits a
# `<!-- crewrig-provenance: ... -->` HTML comment as the first body line so
# provenance is preserved without poisoning the schema.
#
# This script pins three properties of the built Gemini agents:
#   1. The YAML frontmatter contains no `metadata:` or `type:` top-level keys.
#   2. The first body line is a `<!-- crewrig-provenance: ... -->` comment
#      carrying at least `version=` and `canonical=`.
#   3. The sibling targets (`.claude/agents/`, `.github/agents/`) still ship
#      the `metadata:` block — the stripping is Gemini-specific.
#
# It does NOT assert idempotency of the bundler (covered elsewhere) nor the
# canonical_repo URL contract (covered by test-build-components.sh).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
GEMINI_DIR="$REPO_DIR/.gemini/agents"
CLAUDE_DIR="$REPO_DIR/.claude/agents"
COPILOT_DIR="$REPO_DIR/.github/agents"

PASS=0
FAIL=0

report() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    [ -n "$detail" ] && printf '%s\n' "$detail" | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

# Extract the YAML frontmatter block (between the first two `---` fences).
extract_frontmatter() {
  awk '/^---$/{c++; next} c==1{print} c==2{exit}' "$1"
}

# --- (1) Gemini agents: no metadata: / type: in frontmatter ---
offenders=""
for f in "$GEMINI_DIR"/*.md; do
  fm=$(extract_frontmatter "$f")
  if printf '%s\n' "$fm" | grep -Eq '^(metadata|type):'; then
    offenders="$offenders\n  $f"
  fi
done
if [ -z "$offenders" ]; then
  report "(1) no metadata:/type: in .gemini/agents frontmatter" "true"
else
  report "(1) no metadata:/type: in .gemini/agents frontmatter" "false" "$(printf '%b' "$offenders")"
fi

# --- (2) Gemini agents: provenance comment present and well-formed ---
offenders=""
for f in "$GEMINI_DIR"/*.md; do
  # First line after the closing `---` of frontmatter.
  first_body=$(awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$f")
  case "$first_body" in
    "<!-- crewrig-provenance: "*"version=\""*"\""*"canonical=\""*"\""*"-->")
      ;;
    *)
      offenders="$offenders\n  $f  -> $first_body"
      ;;
  esac
done
if [ -z "$offenders" ]; then
  report "(2) crewrig-provenance comment on first body line of every Gemini agent" "true"
else
  report "(2) crewrig-provenance comment on first body line of every Gemini agent" "false" "$(printf '%b' "$offenders")"
fi

# --- (3) Claude + Copilot agents: metadata: block still shipped ---
# Layout differs by CLI:
#   - Claude:  .claude/agents/<name>/AGENT.md  (nested directory per agent)
#   - Copilot: .github/agents/<name>.md        (flat)
# Use `find` so the same loop works for both shapes.
for spec in "claude:$CLAUDE_DIR" "copilot:$COPILOT_DIR"; do
  name="${spec%%:*}"
  dir="${spec#*:}"
  missing=""
  count=0
  while IFS= read -r f; do
    count=$((count + 1))
    fm=$(extract_frontmatter "$f")
    if ! printf '%s\n' "$fm" | grep -q '^metadata:'; then
      missing="$missing\n  $f"
    fi
  done < <(find "$dir" -type f -name '*.md')
  if [ "$count" -eq 0 ]; then
    report "(3-$name) metadata: still present in every $name agent" "false" "no .md files found under $dir"
  elif [ -z "$missing" ]; then
    report "(3-$name) metadata: still present in every $name agent ($count files)" "true"
  else
    report "(3-$name) metadata: still present in every $name agent" "false" "$(printf '%b' "$missing")"
  fi
done

echo ""
echo "==========================================="
echo "  Result: $PASS passed, $FAIL failed"
echo "==========================================="
[ "$FAIL" -eq 0 ] || exit 1
