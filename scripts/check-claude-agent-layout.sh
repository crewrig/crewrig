#!/bin/bash
# check-claude-agent-layout.sh — Keep the compiled Claude Code agent tree flat.
#
# Per spec 0201 (requirements 6-7), continuous integration MUST fail a pull
# request in which the committed .claude/agents/ directory holds any entry
# that is not a regular file whose name ends in .md, directly inside it. The
# compiled agent build (scripts/build-components.sh --check) cannot catch a
# re-appearing nested per-agent directory on its own: it compares each
# expected output and never enumerates the directory, so a hand-recreated
# .claude/agents/<name>/AGENT.md beside the flat .claude/agents/<name>.md
# leaves --check green. This guard exists because that hole is real.
#
# An entry is legal iff it is a regular file (not a symlink) whose basename
# matches *.md. Everything else is an offender: a directory (the retired
# per-agent layout), a non-.md regular file, or a symlink. When an offender
# is a directory, every file beneath it is also named, so the guard's report
# satisfies both the requirement's own wording ("any entry ... directly
# inside it") and the spec's scenario, which expects the deeper path
# .claude/agents/developer/AGENT.md to be named alongside .claude/agents/developer.
#
# An absent or empty .claude/agents/ directory is a permitted state, not a
# violation (requirement 7).
#
# Usage:
#   bash scripts/check-claude-agent-layout.sh
#
# Override the repository root with CREWRIG_REPO_DIR, mirroring the sibling
# check-*.sh guards.
#
# Exits 0 when .claude/agents/ is absent, empty, or holds only flat *.md
# regular files. Exits non-zero, naming every offending path, otherwise.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
AGENTS_DIR="$REPO_DIR/.claude/agents"

if [ ! -d "$AGENTS_DIR" ]; then
  echo "OK: $AGENTS_DIR is absent — nothing to check."
  exit 0
fi

offenders=()
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  legal=0
  case "$(basename "$entry")" in
    *.md)
      if [ -f "$entry" ] && [ ! -L "$entry" ]; then
        legal=1
      fi
      ;;
  esac
  [ "$legal" -eq 1 ] && continue
  offenders+=("${entry#"$REPO_DIR/"}")
  if [ -d "$entry" ] && [ ! -L "$entry" ]; then
    while IFS= read -r nested; do
      [ -z "$nested" ] && continue
      offenders+=("${nested#"$REPO_DIR/"}")
    done < <(find "$entry" -mindepth 1 \( -type f -o -type l \) | sort)
  fi
done < <(find "$AGENTS_DIR" -mindepth 1 -maxdepth 1 | sort)

if [ "${#offenders[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#offenders[@]} offending entr(y/ies) under .claude/agents:" >&2
  for p in ${offenders[@]+"${offenders[@]}"}; do
    echo "  - $p" >&2
  done
  echo "" >&2
  echo "The compiled Claude Code agent tree must hold only regular files named" >&2
  echo "<name>.md directly inside .claude/agents/ (spec 0201 requirements 1-2, 6)." >&2
  exit 1
fi

echo "OK: .claude/agents/ holds only flat *.md files."
