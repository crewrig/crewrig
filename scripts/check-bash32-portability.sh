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
#   bash scripts/check-bash32-portability.sh                  # render a verdict
#   bash scripts/check-bash32-portability.sh --list-constructs # report what it read
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test
# against temporary fixtures), mirroring the sibling check-*.sh guards.
#
# Exits 0 when no governed script uses a declared construct, non-zero (naming
# every offending file and line) otherwise.
#
# Contract of the second invocation (spec 0120, requirements 1-3 and 5). It
# exists so that this guard is the repository's single interpretation of the
# declared set's row format: a consumer that needs to know what the declared set
# contains asks the enforcement instead of parsing ci/bash32-forbidden.txt a
# second time. What is promised:
#   - Rows on stdout, one per declared construct, in the shape
#     <kind><TAB><token> — the two fields requirement 2 names, drawn from the
#     alphabets this script already validates (kind is `command` or
#     `declare-flag`, token is letters, digits, underscore and hyphen).
#   - The row *set*, and therefore the row count, is exactly what the parse loop
#     below accepted. Nothing is scanned and no verdict is rendered.
#   - Exit 0 with rows; exit 2 for any refusal — every declared set this script
#     refuses when asked for a verdict is refused here too, and the converse.
#     Never exit 1: exit 1 is a verdict, and this invocation renders none.
# What is deliberately NOT promised, so that the surface stays cheap to keep:
#   - Row order. A consumer that depends on it is depending on file order, which
#     is not part of this contract.
#   - The wording of anything written to stderr.
#   - Any third field. The reason column is free text that may itself hold tabs,
#     which is the field-boundary ambiguity this invocation exists to remove; it
#     is not reported.

set -euo pipefail

# Mode selection happens before the repository root is resolved and before
# anything is read, so an unrecognised argument cannot scan the tree (R3).
MODE=verdict
if [ "$#" -gt 0 ]; then
  # `[ "$#" -gt 0 ]` before touching `$1`: this script runs under `set -u`,
  # where a bare `$1` with no arguments aborts on `$1: unbound variable`.
  if [ "$#" -eq 1 ] && [ "$1" = "--list-constructs" ]; then
    MODE=list
  else
    echo "Error: unrecognised argument(s): $*" >&2
    echo "Usage: bash ${0##*/} [--list-constructs]" >&2
    exit 2
  fi
fi

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
# LISTING is the report the second invocation returns: the same rows, joined by
# newlines rather than held in an array, for the reason above.
CMD_ALT=""
FLAG_ALT=""
declared=0
TAB="$(printf '\t')"
NL=$'\n'
LISTING=""

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"                       # tolerate CRLF
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Split on TAB, which is what the format declares. Splitting on generic
  # whitespace instead let a row with an empty token field slide its reason
  # into the token's place — `command<TAB><TAB>some reason` parsed as
  # token=`some`, and the guard then scanned for the wrong word and reported
  # OK on a tree holding real violations. Same false green this script exists
  # to eliminate, arriving through its own authority file.
  case "$line" in
    *"$TAB"*) : ;;
    *)
      echo "Error: $FORBIDDEN: entry '$line' has no tab-separated fields." >&2
      echo "       (expected <kind><TAB><token><TAB><reason>)" >&2
      exit 2
      ;;
  esac
  kind="${line%%"$TAB"*}"                    # first tab field
  rest="${line#*"$TAB"}"                     # everything past the first tab
  token="${rest%%"$TAB"*}"                   # second tab field, verbatim
  if [ -z "$kind" ] || [ -z "$token" ]; then
    echo "Error: $FORBIDDEN: entry '$line' declares an empty kind or token." >&2
    exit 2
  fi
  # A token is interpolated into an ERE below, so a regex metacharacter in it
  # would build an invalid or wrongly-matching pattern. Reject it here rather
  # than letting grep decide: the declared set is documented as a floor, not a
  # ceiling, so a maintainer WILL add tokens, and nothing in the file warns
  # that they are regex-interpolated.
  case "$token" in
    *[^A-Za-z0-9_-]*)
      echo "Error: $FORBIDDEN: token '$token' contains a character that is not" >&2
      echo "       a letter, digit, underscore or hyphen. Tokens are interpolated" >&2
      echo "       into a regular expression; a metacharacter would silently" >&2
      echo "       change or invalidate the pattern." >&2
      exit 2
      ;;
  esac
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
  # Accumulated, never emitted here: a malformed row later in the file must be
  # refused with no partial report already on stdout, so the report is written
  # once, below, after the whole file has been accepted.
  LISTING="${LISTING:+$LISTING$NL}$kind$TAB$token"
done < "$FORBIDDEN"

if [ "$declared" -eq 0 ]; then
  echo "Error: $FORBIDDEN declares no construct — the guard would pass vacuously." >&2
  exit 2
fi

# --- Report what was read, when that is what was asked ----------------------
# Placed here on purpose, and the placement is the whole design: everything
# upstream of this point is shared with the verdict path — the missing
# declared-set file, every refusal inside the parse loop, and the vacuous-set
# refusal above — so both invocations refuse exactly the same declared sets
# (R5) without a duplicated condition. Everything downstream is the tree scan
# the report must not perform (R3).
if [ "$MODE" = list ]; then
  printf '%s\n' "$LISTING"
  exit 0
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
# grep's exit status is load-bearing and must not be swallowed. `|| true` on the
# whole pipeline made exit 2 (invalid pattern) indistinguishable from exit 1 (no
# match): the guard then found nothing, printed OK and exited 0 on a tree holding
# real violations. Measured on a two-violation fixture, a declared token of `(`
# produced `OK … (1 declared construct(s), 2 file(s) scanned)` at rc 0 while a
# well-formed set on the same tree produced `FAILED: 2 line(s)` at rc 1.
#
# The token validation above should now make an invalid pattern unreachable, but
# this stays as the second line of defence: a guard that cannot tell "nothing
# found" from "could not look" has no business reporting OK. Anything above 1 is
# grep failing, not grep finding nothing.
RAW=""
GREP_RC=0
GREP_ERR="$(mktemp)"
RAW="$( cd "$REPO_DIR" && grep -rnE "$PATTERN" $SCAN_TARGETS 2>"$GREP_ERR" )" || GREP_RC=$?
GREP_MSG="$(cat "$GREP_ERR")"
rm -f "$GREP_ERR"
# stderr is captured to a separate file, never folded into stdout: a grep that
# warns without failing (an unreadable file, a directory loop) would otherwise
# have its warning counted as a match and reported as a violation.
if [ "$GREP_RC" -gt 1 ]; then
  echo "Error: the scan itself failed (grep exit $GREP_RC), so this run proves" >&2
  echo "       nothing about the tree. Refusing to report a clean result." >&2
  echo "       grep said: $GREP_MSG" >&2
  exit 2
fi

HITS="$( printf '%s\n' "$RAW" \
         | grep -vE '^[^:]*:[0-9]+:[[:space:]]*#' \
         | grep -v 'acknowledged-exception:' || true )"

if [ -n "$HITS" ]; then
  hits_count="$(printf '%s\n' "$HITS" | grep -c . | tr -d '[:space:]')"
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

# --- Phase 2: empty-array guard (Bash 3.2) -----------------------------------
# Every `${name[@]}` / `${name[*]}` value expansion must be guarded, because on
# the Bash 3.2 that ships with macOS an empty array is treated as unset and an
# unguarded expansion aborts under `set -u`. This is a second, `.sh`-scoped
# scan, folded in after the declared-set grep above so a single OK means both
# rules held. The lib is sourced here — in the verdict path only, after the
# list-mode exit — so `--list-constructs` still queries without scanning.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/bash32-array-guard.sh
. "$SCRIPT_DIR/lib/bash32-array-guard.sh"

array_guard_scan "$REPO_DIR"
if [ -n "$ARRAY_GUARD_HITS" ]; then
  ag_hits_count="$(printf '%s\n' "$ARRAY_GUARD_HITS" | grep -c . | tr -d '[:space:]')"
  echo "FAILED: $ag_hits_count array value expansion(s) are unguarded:" >&2
  echo "" >&2
  printf '%s\n' "$ARRAY_GUARD_HITS" >&2
  echo "" >&2
  echo "Each line expands an array value (the \${name[...]} brace form)" >&2
  echo "without guarding against the empty array. On the Bash 3.2 that ships" >&2
  echo "with macOS an empty array is treated as unset, so under set -u the" >&2
  echo "expansion aborts with 'unbound variable' — silently, because suites" >&2
  echo "run set -uo pipefail WITHOUT -e, so the child subshell dies and the" >&2
  echo "suite can exit 0 with cases skipped (the false green of issue #697)." >&2
  echo "Guard the expansion per Rule 5 (docs/scripting-conventions.md)." >&2
  exit 1
fi

echo "OK: no forbidden Bash 4+ construct and no unguarded array value expansion" \
     "in $SCAN_TARGETS ($declared declared construct(s), $scanned file(s) scanned," \
     "$ARRAY_GUARD_SH_FILES .sh file(s) array-scanned)."
