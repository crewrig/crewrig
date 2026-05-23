#!/usr/bin/env bash
# tests/e2e/lib/report.sh — aggregate per-run TAP files into a parity matrix.
#
# Reads TAP 13 files produced by tests/e2e/run.sh (typically located at
# <tap-dir>/<run-id>/run.tap, or any *.tap directly under <tap-dir>) and
# emits:
#
#   1. A console table to stdout — rows are scenarios, columns are CLIs
#      (claude, gemini, copilot), cells are one of:
#        ✅  pass
#        ❌  fail
#        ⚠️   skip / uncertain / missing
#
#   2. A markdown report at <output-dir>/parity-YYYYMMDD-HHMMSS.md with
#      the same matrix.
#
# Exit code: 1 if any cell is ❌, 0 otherwise.
#
# Usage:
#   tests/e2e/lib/report.sh [--tap-dir <dir>] [--output-dir <dir>] [--dry-run]
#
# Defaults: --tap-dir tests/e2e/reports/  --output-dir tests/e2e/reports/

set -euo pipefail

# --------------------------------------------------------------------------
# CLI parsing.
# --------------------------------------------------------------------------
TAP_DIR="tests/e2e/reports"
OUTPUT_DIR="tests/e2e/reports"
DRY_RUN=0

usage() {
  cat <<'EOF'
report.sh — aggregate per-run TAP files into a parity matrix.

Reads TAP 13 files produced by tests/e2e/run.sh and emits:
  1. A console table to stdout (✅ pass / ❌ fail / ⚠️  skip)
  2. A markdown report at <output-dir>/parity-YYYYMMDD-HHMMSS.md

Exit code: 1 if any cell is ❌, 2 on empty TAP dir, 0 otherwise.

Usage:
  tests/e2e/lib/report.sh [--tap-dir <dir>] [--output-dir <dir>] [--dry-run]

Defaults: --tap-dir tests/e2e/reports/  --output-dir tests/e2e/reports/
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tap-dir)    TAP_DIR="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "report.sh: unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -d "$TAP_DIR" ]]; then
  echo "report.sh: tap dir not found: $TAP_DIR" >&2
  exit 2
fi

# --------------------------------------------------------------------------
# Configuration.
# --------------------------------------------------------------------------
# Stable column order for both console and markdown outputs.
CLIS=(claude gemini copilot)

# --------------------------------------------------------------------------
# Discover TAP files.
# --------------------------------------------------------------------------
# Accept any `*.tap` under TAP_DIR, recursively. Runner writes
# `<run-id>/run.tap`, but historic / hand-placed files at the top level
# work the same way.
TAP_FILES=()
while IFS= read -r -d '' f; do
  TAP_FILES+=("$f")
done < <(find "$TAP_DIR" -type f -name '*.tap' -print0 | sort -z)

if [[ ${#TAP_FILES[@]} -eq 0 ]]; then
  echo "report.sh: no .tap files found under $TAP_DIR" >&2
  echo "Run \`task e2e:test\` first to produce TAP output." >&2
  exit 2
fi

# --------------------------------------------------------------------------
# Parse TAP into an associative result map keyed by "<cli>/<scenario>".
# Values: pass | fail | skip
#
# When the same cell appears in multiple TAP files (e.g. successive runs),
# the *most recent* file wins because `find ... | sort -z` orders by
# pathname and runner dirs carry a timestamp prefix. We simply overwrite.
# --------------------------------------------------------------------------
declare -A RESULT=()
declare -A SCENARIO_SEEN=()

for tap in "${TAP_FILES[@]}"; do
  # Strip CR; skip TAP header, plan, comments, diagnostics.
  while IFS= read -r line; do
    line="${line%$'\r'}"
    case "$line" in
      ok\ *|'not ok'\ *) : ;;
      *) continue ;;
    esac

    # Extract the description (everything after the first " - ") and
    # the directive (text after " # ", if any).
    desc="${line#* - }"
    if [[ "$desc" == "$line" ]]; then
      # Malformed — no " - " separator. Skip.
      continue
    fi
    directive=""
    if [[ "$desc" == *" # "* ]]; then
      directive="${desc#* # }"
      desc="${desc% # *}"
    fi

    # Description shape: "<cli>/<scenario>" — trim whitespace.
    desc="${desc#"${desc%%[![:space:]]*}"}"
    desc="${desc%"${desc##*[![:space:]]}"}"
    cli="${desc%%/*}"
    scen="${desc#*/}"
    [[ -n "$cli" && -n "$scen" && "$cli" != "$scen" ]] || continue

    # Classify.
    if [[ "$line" == "not ok "* ]]; then
      status="fail"
    elif [[ -n "$directive" && "${directive,,}" =~ ^(skip|todo) ]]; then
      status="skip"
    else
      status="pass"
    fi

    RESULT["${cli}/${scen}"]="$status"
    SCENARIO_SEEN["$scen"]=1
  done < "$tap"
done

# --------------------------------------------------------------------------
# Sort scenarios deterministically.
# --------------------------------------------------------------------------
SCENARIOS=()
while IFS= read -r s; do SCENARIOS+=("$s"); done < <(
  printf '%s\n' "${!SCENARIO_SEEN[@]}" | sort
)

# --------------------------------------------------------------------------
# Render console table.
# --------------------------------------------------------------------------
glyph_for() {
  case "$1" in
    pass) printf '✅' ;;
    fail) printf '❌' ;;
    skip|"") printf '⚠️' ;;
  esac
}

# Compute column width for the scenario name column.
name_w=8 # "Scenario"
for s in "${SCENARIOS[@]}"; do
  (( ${#s} > name_w )) && name_w=${#s}
done

print_row() {
  local label="$1"; shift
  printf '%-*s' "$name_w" "$label"
  for cell in "$@"; do
    printf '  %-8s' "$cell"
  done
  printf '\n'
}

# Header.
print_row "Scenario" "${CLIS[@]}"
# Separator.
sep="$(printf '%*s' "$name_w" '' | tr ' ' '-')"
seps=()
for _ in "${CLIS[@]}"; do seps+=("--------"); done
print_row "$sep" "${seps[@]}"

EXIT_CODE=0
for scen in "${SCENARIOS[@]}"; do
  cells=()
  for cli in "${CLIS[@]}"; do
    s="${RESULT["${cli}/${scen}"]:-}"
    g="$(glyph_for "$s")"
    cells+=("$g")
    [[ "$s" == "fail" ]] && EXIT_CODE=1
  done
  print_row "$scen" "${cells[@]}"
done

# --------------------------------------------------------------------------
# Render markdown report (unless --dry-run).
# --------------------------------------------------------------------------
if [[ "$DRY_RUN" -eq 0 ]]; then
  mkdir -p "$OUTPUT_DIR"
  ts="$(date +%Y%m%d-%H%M%S)"
  out="${OUTPUT_DIR%/}/parity-${ts}.md"

  {
    printf '# e2e Parity Matrix — %s\n\n' "$ts"
    printf '| Scenario |'
    for cli in "${CLIS[@]}"; do printf ' %s |' "$cli"; done
    printf '\n|%s|' '---'
    for _ in "${CLIS[@]}"; do printf '%s|' '---'; done
    printf '\n'

    for scen in "${SCENARIOS[@]}"; do
      printf '| %s |' "$scen"
      for cli in "${CLIS[@]}"; do
        s="${RESULT["${cli}/${scen}"]:-}"
        printf ' %s |' "$(glyph_for "$s")"
      done
      printf '\n'
    done

    printf '\nGenerated by `task e2e:report` from `%s/*.tap`\n' "${TAP_DIR%/}"
  } > "$out"

  printf '\nMarkdown report: %s\n' "$out"
fi

exit "$EXIT_CODE"
