#!/bin/bash
# check-extension-version-bump.sh — Enforce the version-bump rule on UPSTREAM
# extension skill/agent sources (spec 0044, R2/R3/R4).
#
# Mirrors scripts/check-skill-versions.sh, but for extension components. The
# artifacts guard greps the diff for an *added* `version:` frontmatter line;
# that primitive is WRONG for extension components because, per spec 0043, their
# `version` rides on an HTML-comment carrier (the first body line), not in
# frontmatter (Gemini 0.42.0+ rejects non-name/description frontmatter keys on
# in-place sources). So this guard parses the carrier on BOTH sides and compares
# the actual version VALUES — a bump is `new != old`, not "a version: line was
# added". The carrier parser is the shared scripts/lib/provenance-carrier.sh,
# the same one check-extension-provenance.sh uses, so the two guards cannot drift.
#
# Scope — upstream-owned tiers only (extensions/core, extensions/library), and
# skills/agents only. Commands carry no provenance/version per spec 0043, and
# extensions/org is adopter-owned (consistent with the sibling guards).
#
# Diff model — like check-skill-versions.sh:
#   - status A (added)    → new component, EXEMPT (R3); starts at 1.0.0.
#   - status M (modified) → subject to the bump rule (R2).
#   - status D (deleted)  → skipped.
#
# Per-modified-component decision (R4 / F2 — three OLD-side branches made
# explicit so a future reader does not collapse "absent carrier" and
# "empty version" into one path):
#   1. NEW-side carrier absent OR version empty       → hard FAIL.
#        Every upstream extension component MUST carry a non-empty version per
#        spec 0043; a missing/empty NEW carrier is corruption or a stripped bump.
#   2. OLD-side carrier WHOLLY absent (no crewrig-provenance first body line at
#      all on the BASE ref)                            → EXEMPT.
#        The component pre-dates the 0043 carrier; this very modification is the
#        one that gives it a carrier — there is nothing to bump *from*.
#   3. OLD-side carrier present but version field empty/missing → hard FAIL.
#        A real corruption or a no-bump masquerading as newly-provenance'd; do
#        NOT silently exempt it (distinct from branch 2).
#   4. Otherwise compare values: new == old → FAIL (no bump); new != old → OK.
#
# Usage:
#   bash scripts/check-extension-version-bump.sh [<base-ref>]
#
# Default base ref mirrors check-skill-versions.sh: probe remotes for crewrig or
# origin, fall back to the first remote, append /main. CI passes BASE_REF env
# pointing at the PR's *target* branch.
#
# Exits 0 if all modified extension sources include a version bump (or are
# exempt), non-zero (with a per-file failure list) otherwise.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/provenance-carrier.sh
source "$SCRIPT_DIR/lib/provenance-carrier.sh"

BASE_REF="${1:-${BASE_REF:-$(git remote | grep -E -m1 'crewrig|origin' || git remote | head -1)/main}}"

# Make sure the base is fetched. CI runners do shallow clones by default.
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  remote="${BASE_REF%%/*}"
  ref="${BASE_REF#*/}"
  git fetch --depth=50 "$remote" "$ref" >/dev/null 2>&1 || {
    echo "Error: cannot resolve base ref '$BASE_REF' and \`git fetch\` failed." >&2
    echo "       Pass a resolvable ref as the first argument or via BASE_REF." >&2
    exit 2
  }
fi

# carrier_version <file> — parse the carrier version from a working-tree file.
# Returns the version string (possibly empty) on stdout.
carrier_version() {
  carrier_field "$(first_body_line "$1")" version
}

# base_carrier_line <path> — the first body line of a file as it exists on
# $BASE_REF, via `git show`. Empty if the file/blob does not exist there.
base_carrier_line() {
  git show "$BASE_REF:$1" 2>/dev/null \
    | awk '/^---$/{c++; next} c==2 && NF{print; exit}'
}

# Collect changed extension skill/agent sources, keeping only status M.
# New files (A) are exempt (R3); deletions (D) are skipped. The M-filter runs
# BEFORE any `git show BASE:path`, so a status-A file is never resolved against
# a base it has no blob in.
# `while read` rather than `mapfile` for bash 3.2 compat (macOS default).
modified=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  status="${line%%$'\t'*}"
  file="${line#*$'\t'}"
  if [ "$status" = "M" ]; then
    modified+=("$file")
  fi
done < <(git diff --name-status "$BASE_REF" -- \
  'extensions/core/skills/*/SKILL.md' \
  'extensions/library/skills/*/SKILL.md' \
  'extensions/core/agents/*/AGENT.md' \
  'extensions/library/agents/*/AGENT.md' 2>/dev/null || true)

if [ "${#modified[@]}" -eq 0 ]; then
  echo "OK: no existing extension skill/agent sources modified vs $BASE_REF."
  exit 0
fi

echo "Checking version bumps on ${#modified[@]} modified extension skill/agent source(s)..."

failures=()
for f in "${modified[@]}"; do
  [ ! -f "$f" ] && continue  # deleted file: skip (deletions don't need a bump)

  new_version="$(carrier_version "$f")"

  # Branch 1 — NEW carrier absent or version empty → hard FAIL.
  if [ -z "$new_version" ]; then
    echo "  FAIL $f — no (or empty) crewrig-provenance version on the working tree (every upstream extension component must carry one per spec 0043)"
    failures+=("$f")
    continue
  fi

  old_line="$(base_carrier_line "$f")"

  # Branch 2 — OLD carrier WHOLLY absent → EXEMPT (component just gained a carrier).
  case "$old_line" in
    "<!-- crewrig-provenance:"*"-->")
      old_version="$(carrier_field "$old_line" version)"
      # Branch 3 — OLD carrier present but version empty/missing → hard FAIL.
      if [ -z "$old_version" ]; then
        echo "  FAIL $f — base carrier present but its version is empty/missing (corruption or masked no-bump; not exempt)"
        failures+=("$f")
        continue
      fi
      # Branch 4 — compare values.
      if [ "$new_version" = "$old_version" ]; then
        echo "  FAIL $f — version not bumped (still '$new_version')"
        failures+=("$f")
      else
        echo "  OK   $f ($old_version → $new_version)"
      fi
      ;;
    *)
      echo "  OK   $f — base had no provenance carrier; this modification adds one (exempt, pre-0043 component)"
      ;;
  esac
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo ""
  echo "FAILED: ${#failures[@]} extension source(s) changed without a version bump:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "Per AGENTS.md → Version Bump Convention and artifacts/FORMAT.md, bump the"
  echo "crewrig-provenance carrier version (the FIRST BODY LINE HTML comment, NOT"
  echo "frontmatter) in the same diff. SemVer:"
  echo "  PATCH (1.0.0 → 1.0.1) — friction fix / wording change"
  echo "  MINOR (1.0.0 → 1.1.0) — additive (new section, new field)"
  echo "  MAJOR (1.0.0 → 2.0.0) — breaking contract change"
  exit 1
fi

echo ""
echo "OK: all changed extension skill/agent sources include a version bump."
