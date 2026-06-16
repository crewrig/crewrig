#!/bin/bash
# check-extension-provenance.sh — Enforce extension provenance presence + routing.
#
# Per spec 0043 (extension-provenance-routing): every skill and agent shipped
# inside an UPSTREAM-OWNED extension tier MUST carry a self-contained
# `metadata.provenance` block (canonical / feedback / version), so a friction
# tagged against it while installed routes to the extension's OWN origin
# repository rather than to whichever project installed it.
#
# Carrier — HTML COMMENT, not frontmatter.
# Extension skills/agents are consumed IN PLACE with no render seam:
# `install-extension.sh` does `ln -s` / `cp -rf` of the whole extension dir,
# `link-extensions.sh` calls it, and `build-claude-plugin.sh` does `cp -r` of
# the skill dir — so Gemini and Claude read the SAME source bytes of SKILL.md /
# AGENT.md. Because Gemini CLI 0.42.0+ rejects any frontmatter key outside
# `name` / `description` (cli-matrix row 4b, issue #54), the provenance CANNOT
# ride in frontmatter on an in-place source. It rides instead on the HTML-comment
# carrier mandated by spec 0042 R5 and emitted by `gemini_provenance_comment`:
#
#   <!-- crewrig-provenance: version="…" canonical="…" feedback="…" -->
#
# placed as the FIRST BODY LINE (immediately after the frontmatter close),
# matching the shipped Gemini-agent contract pinned by
# `scripts/tests/test-gemini-agent-frontmatter.sh`.
#
# WHY A DEDICATED GUARD — no defense-in-depth with check-feedback-routing.sh.
# `scripts/check-feedback-routing.sh` (spec 0030) reads `metadata.provenance`
# from FRONTMATTER via `yq`. The greeter's provenance lives in a body COMMENT,
# NOT in frontmatter, so check-feedback-routing.sh's `has("provenance")`
# frontmatter test will SKIP the greeter forever — by design. That means R5
# (feedback == canonical) enforcement for extension skills/agents lives SOLELY
# here; there is no overlap with the spec-0030 guard backstopping it. State it
# plainly so a future reader does not assume the 0030 guard covers extensions.
#
# Upstream-owned tiers checked: extensions/core, extensions/library.
# Adopter-owned extensions/org is EXEMPT (consistent with the sibling guards):
# adopters own their tier and route feedback to their own configured repo.
#
# Failure conditions (per offender):
#   - missing carrier        — no `<!-- crewrig-provenance: … -->` first body line (R7 presence)
#   - incomplete fields      — carrier lacks version / canonical / feedback     (R1 completeness)
#   - feedback != canonical  — routing diverges from origin                     (R5 invariant)
#
# Usage:
#   bash scripts/check-extension-provenance.sh
#
# Exits 0 when every upstream-owned extension skill/agent carries a complete,
# self-routing provenance carrier; non-zero (with a per-offender list)
# otherwise. The check is static (not diff-based): it validates the whole tree
# on every run, so it is safe on both `push` and `pull_request`.

set -euo pipefail

# Upstream-owned extension tier roots. extensions/org is adopter-owned ⇒ EXEMPT.
TIER_ROOTS=(
  "extensions/core"
  "extensions/library"
)

# Extract the FIRST body line (first non-frontmatter line) of a Markdown file.
# Mirrors the awk used by test-gemini-agent-frontmatter.sh: skip the frontmatter
# block (first two `---` fences) and print the first non-empty line after it.
first_body_line() {
  awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$1"
}

# Extract a quoted field value from a crewrig-provenance carrier line.
#   carrier_field '<carrier line>' canonical  →  the value between the quotes
# Returns empty if the field is absent or empty.
carrier_field() {
  local line="$1" field="$2"
  printf '%s\n' "$line" \
    | sed -n "s/.*${field}=\"\([^\"]*\)\".*/\1/p"
}

checked=0
failures=()

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
  checked=$((checked + 1))
  carrier="$(first_body_line "$f")"

  # (R7 presence) — first body line must be the provenance carrier comment.
  case "$carrier" in
    "<!-- crewrig-provenance:"*"-->")
      ;;
    *)
      echo "  FAIL $f — missing crewrig-provenance carrier on first body line (R7)"
      failures+=("$f")
      continue
      ;;
  esac

  version="$(carrier_field "$carrier" version)"
  canonical="$(carrier_field "$carrier" canonical)"
  feedback="$(carrier_field "$carrier" feedback)"

  # (R1 completeness) — all three fields must be present and non-empty.
  missing=()
  [ -z "$version" ]   && missing+=("version")
  [ -z "$canonical" ] && missing+=("canonical")
  [ -z "$feedback" ]  && missing+=("feedback")
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "  FAIL $f — provenance carrier missing field(s): ${missing[*]} (R1)"
    failures+=("$f")
    continue
  fi

  # (R5 invariant) — upstream-owned tier ⇒ feedback must equal canonical.
  if [ "$feedback" != "$canonical" ]; then
    echo "  FAIL $f — feedback '$feedback' != canonical '$canonical' (R5)"
    failures+=("$f")
    continue
  fi

  echo "  OK   $f"
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo ""
  echo "FAILED: ${#failures[@]} upstream-owned extension component(s) violate the provenance contract:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "Per spec 0043, every skill/agent under an upstream-owned extension tier"
  echo "(extensions/core, extensions/library) MUST carry a crewrig-provenance"
  echo "carrier as its FIRST BODY LINE (an HTML comment, NOT frontmatter — Gemini"
  echo "0.42.0+ rejects non-name/description frontmatter keys on in-place sources):"
  echo ""
  echo '  <!-- crewrig-provenance: version="…" canonical="…" feedback="…" -->'
  echo ""
  echo "with all three fields present, canonical a LITERAL origin repo URL (not"
  echo '${CANONICAL_REPO} — a consumer cannot resolve a third-party origin), and'
  echo "feedback == canonical (upstream-owned tier routes feedback to canonical)."
  exit 1
fi

echo ""
echo "OK: ${checked} upstream-owned extension skill/agent(s) carry a complete, self-routing provenance carrier."
