#!/bin/bash
# check-feedback-routing.sh — Enforce the upstream-tier feedback-routing invariant.
#
# Per spec 0030 (feedback-routing-upstream-tiers) and artifacts/FORMAT.md →
# Provenance & Forks, every component source whose home is an UPSTREAM-OWNED
# tier MUST route harness feedback to the canonical repository — never to a
# fork's configured `feedback_repo`. The upstream-owned tiers are:
#
#   artifacts/core      artifacts/library
#   extensions/core     extensions/library   (prospective — no-op until a
#                                             provenance block appears there)
#
# Adopter-owned tiers (artifacts/community, artifacts/org, extensions/org) are
# deliberately EXEMPT: their `feedback` field is governed by `feedback_repo`.
#
# Enforcement mechanism — RAW-STRING equality, not resolved values.
# The guard compares the unresolved `metadata.provenance.feedback` declaration
# against the unresolved `metadata.provenance.canonical` declaration, exactly
# as written in the source. It does NOT consult crewrig.config.toml. This is
# load-bearing: the canonical repo currently sets
# `feedback_repo == canonical_repo`, so a resolved-value comparison would be
# blind to a `${FEEDBACK_REPO}` regression (both placeholders resolve to the
# same URL in this fork). Raw-string equality is config-independent — identical
# unresolved strings resolve identically in every fork, and a `${FEEDBACK_REPO}`
# declaration is rejected regardless of how this fork happens to be configured.
# yq reads the literal YAML value and performs no shell substitution, so the
# extracted strings are the unresolved declarations.
#
# Usage:
#   bash scripts/check-feedback-routing.sh
#
# Exits 0 if every upstream-owned source with a provenance block routes
# feedback to canonical; non-zero (with a per-file offender list) otherwise.
# The check is static (not diff-based): it validates the whole tree on every
# run, so it is safe to run on both `push` and `pull_request`.

set -euo pipefail

command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required. Install with: brew install yq" >&2
  exit 2
}

# Upstream-owned tier roots. extensions/{core,library} are listed for
# forward-compat with spec 0030 R6 — they carry no provenance block today, so
# the per-file provenance check below makes them a genuine no-op until one is
# added, at which point it inherits the routing guarantee with no further code
# change.
TIER_ROOTS=(
  "artifacts/core"
  "artifacts/library"
  "extensions/core"
  "extensions/library"
)

# Extract the YAML frontmatter (between the first two `---` fences). Mirrors
# extract_frontmatter() in scripts/build-components.sh.
extract_frontmatter() {
  awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$1"
}

checked=0
skipped=0
failures=()

# Collect every SKILL.md / AGENT.md source under the upstream-owned tiers.
# `while read` rather than `mapfile` for bash 3.2 compat (macOS default).
sources=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  sources+=("$f")
done < <(
  for root in "${TIER_ROOTS[@]}"; do
    [ -d "$root" ] || continue
    find "$root" -type f \( -name 'SKILL.md' -o -name 'AGENT.md' \) 2>/dev/null
  done | sort
)

for f in "${sources[@]}"; do
  frontmatter=$(extract_frontmatter "$f")

  # Skip sources with no metadata.provenance block — nothing to enforce.
  has_prov=$(printf '%s\n' "$frontmatter" | yq -r '.metadata // {} | has("provenance")' 2>/dev/null || echo "false")
  if [ "$has_prov" != "true" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  # Skip sources with no feedback field declared (provenance block present but
  # feedback omitted — routing falls back to canonical by absence, nothing to
  # diverge).
  feedback=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.feedback // ""' 2>/dev/null)
  if [ -z "$feedback" ] || [ "$feedback" = "null" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  canonical=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.canonical // ""' 2>/dev/null)
  checked=$((checked + 1))

  if [ "$feedback" = "$canonical" ]; then
    echo "  OK   $f"
  else
    echo "  FAIL $f — feedback '$feedback' != canonical '$canonical'"
    failures+=("$f")
  fi
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo ""
  echo "FAILED: ${#failures[@]} upstream-owned source(s) route feedback away from canonical:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "Per spec 0030, every source under an upstream-owned tier"
  echo "(artifacts/core, artifacts/library, extensions/core, extensions/library)"
  echo "MUST declare metadata.provenance.feedback equal to"
  echo "metadata.provenance.canonical (i.e. \"\${CANONICAL_REPO}\"), so harness"
  echo "feedback on upstream components always reaches upstream regardless of a"
  echo "fork's feedback_repo. Replace \"\${FEEDBACK_REPO}\" (or any divergent"
  echo "literal) with \"\${CANONICAL_REPO}\" in the offending source(s)."
  exit 1
fi

echo ""
echo "OK: ${checked} upstream-owned source(s) route feedback to canonical (${skipped} without a feedback declaration skipped)."
