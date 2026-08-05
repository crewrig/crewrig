#!/bin/bash
# check-bash32-portability.sh — Reject Bash 4+ constructs in governed scripts.
#
# Per spec 0111 (Requirements 1-5, 10), continuous integration MUST fail a pull
# request in which a governed script uses a shell construct that the Bash shipped
# with macOS (3.2.57) does not understand. Such a script aborts on its first use
# of the construct, and because the abort can leave a zero exit status it does not
# announce itself: six of this repository's own test suites reported passing
# counts on that shell while silently never running their later cases. This guard
# catches the reintroduction before it reaches the canonical branch.
#
# The declared set (requirement 2) lives in ci/bash32-forbidden.txt, not here, so
# that one file is the single authority this guard and docs/scripting-conventions.md
# Rule 5 both refer to — and so that this script can match the literal tokens
# without flagging its own source, which sits inside the tree it scans.
#
# Use versus mention (requirement 4). A construct counts as *used* only when it
# stands in command position on a line that is not itself a comment. So a comment
# documenting the prohibition — or explaining that a construct was deliberately
# avoided — is not a violation. Concretely, a line is reported when:
#   - its first non-blank character is not `#`; and
#   - the token stands at line start, or after a command separator
#     (`;` `&` `|` `(` `)` `{` `}`), or after a shell keyword (`if`, `while`,
#     `until`, `then`, `do`, `else`, `elif`, `time`, `!`); and
#   - the line does not carry the `acknowledged-exception:` marker (requirement
#     10, the documented escape hatch for a script that deliberately requires a
#     newer shell).
# `declare`/`typeset`/`local`/`readonly` are matched when their flag cluster
# contains a declared uppercase flag letter, so `-Ag` and `-rA` are caught while
# `-a` is not.
#
# Like the CI grep pass it joins, this check is intentionally lightweight and
# does not try to be a full linter: indirect use (`eval "…"`, a construct built
# by string concatenation) is not detected, and a heredoc body or trailing
# comment that happens to open with a declared token in command position is a
# false positive answered by the escape-hatch marker.
#
# Scope (requirement 5): scripts/ and hooks/, the same tree the sibling
# scripting-convention grep steps cover — the repository's own test scripts
# included, on the same terms as the scripts it ships.
#
# Usage:
#   bash scripts/check-bash32-portability.sh
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test
# against temporary fixtures), mirroring the sibling check-*.sh guards.
#
# Exits 0 when no governed script uses a declared construct, non-zero (naming
# every offending file and line) otherwise.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
FORBIDDEN="$REPO_DIR/ci/bash32-forbidden.txt"

if [ ! -f "$FORBIDDEN" ]; then
  echo "Error: declared-set file not found: $FORBIDDEN" >&2
  exit 2
fi

# --- Parse the declared set -------------------------------------------------
# Accumulated into `|`-joined ERE alternation strings rather than arrays. That is
# deliberate and not a style preference: Bash 3.2 treats an empty array as an
# unset variable, so under `set -u` an accumulator array would abort this guard
# on exactly the path where it has nothing to report — the clean path. That is
# the failure class this script exists to catch, and it would be invisible to
# both the grep rule below (not grep-detectable) and CI (which runs Bash 5).
# `while read` rather than the Bash 4 line-reading builtin, for the same reason.
CMD_ALT=""
FLAG_ALT=""
declared=0

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"                       # tolerate CRLF
  [[ -z "$line" || "$line" == \#* ]] && continue
  kind="${line%%[[:space:]]*}"               # first whitespace field
  rest="${line#"$kind"}"
  rest="${rest#"${rest%%[![:space:]]*}"}"    # ltrim
  token="${rest%%[[:space:]]*}"              # second whitespace field
  if [ -z "$token" ]; then
    echo "Error: $FORBIDDEN: entry of kind '$kind' declares no token." >&2
    exit 2
  fi
  case "$kind" in
    command)      CMD_ALT="${CMD_ALT:+$CMD_ALT|}$token" ;;
    declare-flag) FLAG_ALT="${FLAG_ALT:+$FLAG_ALT|}$token" ;;
    *)
      echo "Error: $FORBIDDEN: unknown kind '$kind'" >&2
      echo "       (expected 'command' or 'declare-flag')" >&2
      exit 2
      ;;
  esac
  declared=$((declared + 1))
done < "$FORBIDDEN"

if [ "$declared" -eq 0 ]; then
  echo "Error: $FORBIDDEN declares no construct — the guard would pass vacuously." >&2
  exit 2
fi

# --- Compose the match pattern ----------------------------------------------
# Command-position anchor, shared by both patterns: line start (optionally
# indented), a command separator, or a shell keyword. No `\b` and no `grep -P`,
# so the behaviour is identical under BSD grep on macOS and GNU grep on CI.
ANCHOR='(^[[:space:]]*|[;&|(){}][[:space:]]*|(^|[[:space:]])(if|while|until|then|do|else|elif|time|!)[[:space:]]+)'

PATTERN=""
if [ -n "$CMD_ALT" ]; then
  PATTERN="${ANCHOR}(${CMD_ALT})([[:space:]]|\$)"
fi
if [ -n "$FLAG_ALT" ]; then
  PATTERN="${PATTERN:+$PATTERN|}${ANCHOR}(declare|typeset|local|readonly)[[:space:]]+-[a-zA-Z]*(${FLAG_ALT})"
fi

# --- Scan the governed tree -------------------------------------------------
SCAN_TARGETS=""
for d in scripts hooks; do
  if [ -d "$REPO_DIR/$d" ]; then
    SCAN_TARGETS="${SCAN_TARGETS:+$SCAN_TARGETS }$d"
  fi
done

if [ -z "$SCAN_TARGETS" ]; then
  echo "Error: neither scripts/ nor hooks/ exists under $REPO_DIR — nothing to scan." >&2
  exit 2
fi

# Surface the size of the input actually scanned (docs/scripting-conventions.md
# Rule 4): a wedge that makes this guard see zero files must not read as a pass.
scanned="$( (cd "$REPO_DIR" && find $SCAN_TARGETS -type f 2>/dev/null | wc -l) | tr -d '[:space:]' )"
if [ "$scanned" -eq 0 ]; then
  echo "Error: scanned 0 files under $SCAN_TARGETS in $REPO_DIR — refusing to pass vacuously." >&2
  exit 2
fi

# Drop full-line comments (use versus mention, requirement 4), then lines
# carrying the acknowledged-exception marker (requirement 10).
HITS="$( (cd "$REPO_DIR" && grep -rnE "$PATTERN" $SCAN_TARGETS 2>/dev/null || true) \
         | grep -vE '^[^:]*:[0-9]+:[[:space:]]*#' \
         | grep -v 'acknowledged-exception:' || true )"

if [ -n "$HITS" ]; then
  hits_count="$(printf '%s\n' "$HITS" | wc -l | tr -d '[:space:]')"
  echo "FAILED: $hits_count line(s) use a forbidden Bash 4+ construct:" >&2
  echo "" >&2
  printf '%s\n' "$HITS" >&2
  echo "" >&2
  echo "Each line above uses a construct declared forbidden in" >&2
  echo "ci/bash32-forbidden.txt, because it aborts on the Bash 3.2 that ships" >&2
  echo "with macOS. See docs/scripting-conventions.md, Rule 5, for the portable" >&2
  echo "replacement of each. If a script deliberately requires a newer shell," >&2
  echo "tag the line with '# acknowledged-exception: <reason>'." >&2
  exit 1
fi

echo "OK: no forbidden Bash 4+ construct in $SCAN_TARGETS" \
     "($declared declared construct(s), $scanned file(s) scanned)."
