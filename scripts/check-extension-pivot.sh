#!/bin/bash
# check-extension-pivot.sh — Enforce the extension pivot-source invariant.
#
# Per spec 0042 (extension-pivot-render) R1/R7: every skill, agent, and command
# shipped inside an UPSTREAM-OWNED extension tier MUST be authored in the single
# pivot source format used by artifacts/ components, never as a
# command-line-tool-native source. This static guard fails the build when an
# extension component is authored CLI-native instead of pivot.
#
# Upstream-owned extension tiers checked:
#
#   extensions/core     extensions/library
#
# Adopter-owned extensions/org is EXEMPT (consistent with check-feedback-routing.sh),
# since adopters own their tier and may author however they wish there.
#
# v1 failure conditions (spec 0042 PLAN v2, finding 4 — explicitly scoped):
#
#   (a) command-native  — any commands/<stem>.toml with NO sibling
#                         commands/<stem>.md. The .toml is a GENERATED Gemini
#                         output (build-extension-pivot.sh); an orphan .toml with
#                         no pivot .md source is an authored-native command.
#   (b) agent structural — any directory under agents/ that lacks an AGENT.md
#                         (the canonical pivot agent shape per artifacts/FORMAT.md).
#                         No extension ships an agent today, so there is no live
#                         agent fixture and no confirmed canonical native-agent
#                         filename to enumerate. This check is STRUCTURAL, not an
#                         exhaustive native-agent-format detector; a stricter
#                         enumeration would be a NEW requirement (delta-spec), not
#                         a gap in this guard.
#
# Skills need no extra check: the pivot skill shape (skills/<name>/SKILL.md) is
# already the only shape the build and the existing tooling recognize, and the
# greeter skill is already in that shape.
#
# Usage:
#   bash scripts/check-extension-pivot.sh
#
# Exits 0 when every upstream-owned extension component is pivot-authored;
# non-zero (with a per-offender list) otherwise. The check is static (not
# diff-based): it validates the whole tree on every run, so it is safe on both
# `push` and `pull_request`.

set -euo pipefail

# Upstream-owned extension tier roots. extensions/org is adopter-owned and
# therefore EXEMPT.
TIER_ROOTS=(
  "extensions/core"
  "extensions/library"
)

failures=()
checked_commands=0
checked_agents=0

for root in "${TIER_ROOTS[@]}"; do
  [ -d "$root" ] || continue

  # --- (a) command-native: orphan .toml with no sibling .md ---
  while IFS= read -r toml_file; do
    [ -z "$toml_file" ] && continue
    checked_commands=$((checked_commands + 1))
    stem="$(basename "$toml_file" .toml)"
    dir="$(dirname "$toml_file")"
    if [ ! -f "$dir/$stem.md" ]; then
      echo "  FAIL $toml_file — generated Gemini .toml has no pivot sibling commands/$stem.md (authored-native command)"
      failures+=("$toml_file")
    else
      echo "  OK   $toml_file (pivot sibling present)"
    fi
  done < <(find "$root" -type f -path '*/commands/*.toml' 2>/dev/null | sort)

  # --- (b) agent structural: agents/<x>/ dir lacking AGENT.md ---
  while IFS= read -r agent_dir; do
    [ -z "$agent_dir" ] && continue
    checked_agents=$((checked_agents + 1))
    if [ ! -f "$agent_dir/AGENT.md" ]; then
      echo "  FAIL ${agent_dir%/} — agent directory lacks the pivot source AGENT.md"
      failures+=("$agent_dir")
    else
      echo "  OK   ${agent_dir%/} (AGENT.md present)"
    fi
  done < <(
    # Direct child dirs of any agents/ directory under the tier.
    find "$root" -type d -path '*/agents/*' -not -path '*/agents/*/*' 2>/dev/null | sort
  )
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo ""
  echo "FAILED: ${#failures[@]} extension component(s) are authored CLI-native instead of pivot:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "Per spec 0042 R1/R7, every skill, agent, and command under an upstream-owned"
  echo "extension tier (extensions/core, extensions/library) MUST be authored in the"
  echo "pivot source format:"
  echo "  - command → commands/<name>.md  (the .toml is a GENERATED Gemini output:"
  echo "    run 'bash scripts/build-extension-pivot.sh' to regenerate it)"
  echo "  - agent   → agents/<name>/AGENT.md"
  echo "  - skill   → skills/<name>/SKILL.md"
  exit 1
fi

echo ""
echo "OK: every upstream-owned extension component is pivot-authored (${checked_commands} command .toml, ${checked_agents} agent dir checked)."
