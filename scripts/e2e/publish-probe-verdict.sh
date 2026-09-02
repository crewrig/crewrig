#!/usr/bin/env bash
# scripts/e2e/publish-probe-verdict.sh — publish a probe's verdict.json as a
# forge comment (spec 0194 R11, R15; PLAN v2 step 4).
#
# Usage:
#   scripts/e2e/publish-probe-verdict.sh <report-dir> --issue <N> [--dry-run]
#
# Reads <report-dir>/verdict.json, renders a Markdown comment body to a
# file, and posts it with `gh issue comment --body-file` — NEVER `--body`:
# a JSON payload passed inline is command-substituted by the shell and
# posts a mangled comment while still reporting success (see this
# project's own logbook history for why that convention exists).
#
# --dry-run prints the rendered body to stdout and exits 0 without calling
# `gh` at all. This is what the hermetic test (scripts/tests/test-e2e-
# probes.sh) exercises — no network, no forge credential required.
#
# The verdict JSON is embedded verbatim in the comment (PLAN v2 D4): the
# forge comment is the durable, machine-readable record: the report
# directory it was read from is gitignored and pruned by `--keep`.

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/e2e/publish-probe-verdict.sh <report-dir> --issue <N> [--dry-run]

Reads <report-dir>/verdict.json and posts (or, with --dry-run, prints) the
rendered Markdown comment body for issue #<N>.
USAGE
}

REPORT_DIR=""
ISSUE=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)   ISSUE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ -z "$REPORT_DIR" ]]; then
        REPORT_DIR="$1"; shift
      else
        printf 'ERROR: unexpected argument: %s\n\n' "$1" >&2
        usage >&2
        exit 2
      fi
      ;;
  esac
done

if [[ -z "$REPORT_DIR" ]]; then
  printf 'ERROR: missing <report-dir>.\n\n' >&2
  usage >&2
  exit 2
fi
if [[ -z "$ISSUE" ]]; then
  printf 'ERROR: --issue <N> is required.\n\n' >&2
  usage >&2
  exit 2
fi

VERDICT_JSON="${REPORT_DIR}/verdict.json"
if [[ ! -f "$VERDICT_JSON" ]]; then
  printf 'ERROR: no verdict.json at %s.\n' "$VERDICT_JSON" >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || { printf 'ERROR: jq is required.\n' >&2; exit 1; }

PROBE="$(jq -r '.probe' "$VERDICT_JSON")"
VERDICT="$(jq -r '.verdict' "$VERDICT_JSON")"
RUN_ID="$(jq -r '.run_id' "$VERDICT_JSON")"
OBSERVED_AT="$(jq -r '.observed_at' "$VERDICT_JSON")"
CLI="$(jq -r '.cli' "$VERDICT_JSON")"
CLI_VERSION="$(jq -r '.cli_version' "$VERDICT_JSON")"

BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/crewrig-probe-verdict-body.XXXXXX")"
trap 'rm -f "$BODY_FILE"' EXIT

{
  printf '## Probe verdict — `%s`\n\n' "$PROBE"
  printf '**Verdict:** `%s`  \n' "$VERDICT"
  printf '**CLI:** %s (%s)  \n' "$CLI" "$CLI_VERSION"
  printf '**Run:** `%s`, observed %s\n\n' "$RUN_ID" "$OBSERVED_AT"
  printf '<details><summary>verdict.json (verbatim)</summary>\n\n'
  printf '```json\n'
  jq '.' "$VERDICT_JSON"
  printf '```\n\n'
  printf '</details>\n'
} > "$BODY_FILE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  cat "$BODY_FILE"
  exit 0
fi

command -v gh >/dev/null 2>&1 || { printf 'ERROR: gh (GitHub CLI) is required to publish (drop --dry-run to skip).\n' >&2; exit 1; }

gh issue comment "$ISSUE" --body-file "$BODY_FILE"
