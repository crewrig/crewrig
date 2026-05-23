#!/usr/bin/env bash
# tests/e2e/run.sh — e2e scenario runner (issue #78).
#
# Resolves the effective config (defaults.toml + optional local.toml deep-
# merge), enumerates (scenario, cli) pairs, decides SKIP via e2e_auth_ready,
# and emits a TAP 13 report to <report-dir>/run.tap. See ADR 0003 for the
# full design contract.
#
# v1 scope: issue #80 will populate [scenarios.*]. Until then the runner is
# expected to emit `1..0 # no scenarios defined yet (waiting for #80)` and
# exit 0 — verified by the v1 acceptance test.

set -euo pipefail

# --------------------------------------------------------------------------
# Locate self + project, source helpers.
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../../scripts/e2e/lib/auth-common.sh
source "${REPO_DIR}/scripts/e2e/lib/auth-common.sh"

DEFAULTS_TOML="${SCRIPT_DIR}/defaults.toml"
LOCAL_TOML="${SCRIPT_DIR}/local.toml"
MERGE_SH="${SCRIPT_DIR}/lib/toml_merge.sh"
REPORTS_ROOT="${SCRIPT_DIR}/reports"

# --------------------------------------------------------------------------
# Defaults + arg parsing (named flags only — Taskfile `--` forwarding does
# not play well with positionals).
# --------------------------------------------------------------------------
SCENARIO=""        # empty → all
CLI_FILTER=""      # empty → all
REPORT_FORMAT="tap"
REPORT_DIR=""      # empty → auto under tests/e2e/reports/<timestamp>-<rand>
KEEP=20
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: tests/e2e/run.sh [options]

Options:
  --scenario <name>         Limit to one scenario (default: all).
  --cli <claude|gemini|copilot|all>
                            Limit to one CLI (default: all configured).
  --report <tap>            Report format (default: tap; v1 only supports tap).
  --report-dir <path>       Override the report directory.
  --keep <N>                Keep at most N most-recent report dirs (default: 20).
  --dry-run                 Resolve config + write effective.json; do not spawn containers.
  -h, --help                Show this help.

The runner exits 0 on success or when no scenarios are defined. It exits
non-zero only if at least one scenario fails (TAP `not ok`).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)   SCENARIO="$2"; shift 2 ;;
    --cli)        CLI_FILTER="$2"; shift 2 ;;
    --report)     REPORT_FORMAT="$2"; shift 2 ;;
    --report-dir) REPORT_DIR="$2"; shift 2 ;;
    --keep)       KEEP="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)
      printf 'ERROR: unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$REPORT_FORMAT" != "tap" ]]; then
  e2e_die "report format '$REPORT_FORMAT' is not supported in v1 (tap only)."
fi
if [[ "$CLI_FILTER" == "all" ]]; then CLI_FILTER=""; fi
case "$CLI_FILTER" in
  ""|claude|gemini|copilot) ;;
  *) e2e_die "--cli must be one of: claude, gemini, copilot, all (got '$CLI_FILTER')." ;;
esac

command -v jq >/dev/null 2>&1 || e2e_die "jq is required on \$PATH."
command -v yq >/dev/null 2>&1 || e2e_die "yq is required on \$PATH."

# --------------------------------------------------------------------------
# Report directory: <timestamp>-<rand>. Lexicographic sort = chronological.
# --------------------------------------------------------------------------
if [[ -z "$REPORT_DIR" ]]; then
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%04x' $((RANDOM % 65536)))"
  REPORT_DIR="${REPORTS_ROOT}/${RUN_ID}"
fi
mkdir -p "$REPORT_DIR"
TAP_OUT="${REPORT_DIR}/run.tap"
: > "$TAP_OUT"

# Prune old reports — keep only the newest $KEEP under REPORTS_ROOT.
prune_reports() {
  local keep="$1"
  if [[ ! -d "$REPORTS_ROOT" ]]; then return 0; fi
  # List dirs only, sorted descending by name (= chronological because of ISO 8601).
  # Skip the report we just created.
  local current_basename
  current_basename="$(basename "$REPORT_DIR")"
  # Collect dir names (one per line) then drop the top $keep.
  local victims
  victims="$(
    find "$REPORTS_ROOT" -mindepth 1 -maxdepth 1 -type d \
      ! -name "$current_basename" \
      -exec basename {} \; \
      2>/dev/null | sort -r | tail -n +"$((keep + 1))" || true
  )"
  if [[ -z "$victims" ]]; then return 0; fi
  while IFS= read -r v; do
    [[ -z "$v" ]] && continue
    rm -rf -- "${REPORTS_ROOT:?}/${v}"
  done <<< "$victims"
}
prune_reports "$KEEP"

# --------------------------------------------------------------------------
# Resolve effective config: defaults.toml + optional local.toml → effective.json.
# --------------------------------------------------------------------------
EFFECTIVE_JSON="${REPORT_DIR}/effective.json"
if [[ -f "$LOCAL_TOML" ]]; then
  bash "$MERGE_SH" "$DEFAULTS_TOML" "$LOCAL_TOML" > "$EFFECTIVE_JSON"
  e2e_info "[runner] merged defaults.toml + local.toml → $EFFECTIVE_JSON"
else
  bash "$MERGE_SH" "$DEFAULTS_TOML" > "$EFFECTIVE_JSON"
  e2e_info "[runner] using defaults.toml (no local.toml present) → $EFFECTIVE_JSON"
fi

# --------------------------------------------------------------------------
# Enumerate (scenario, cli) pairs.
# --------------------------------------------------------------------------
mapfile -t ALL_SCENARIOS < <(
  jq -r '(.scenarios // {}) | keys[]?' "$EFFECTIVE_JSON" 2>/dev/null || true
)

if [[ -n "$SCENARIO" ]]; then
  # Filter to the requested scenario only.
  if ! jq -e --arg s "$SCENARIO" '(.scenarios // {}) | has($s)' "$EFFECTIVE_JSON" >/dev/null; then
    e2e_die "scenario '$SCENARIO' not found in effective config."
  fi
  SELECTED_SCENARIOS=("$SCENARIO")
else
  SELECTED_SCENARIOS=("${ALL_SCENARIOS[@]}")
fi

# --------------------------------------------------------------------------
# v1 short-circuit: no scenarios defined yet (#80 will populate them).
# --------------------------------------------------------------------------
if [[ ${#SELECTED_SCENARIOS[@]} -eq 0 ]]; then
  e2e_info "[runner] no scenarios defined yet (waiting for #80) — emitting empty TAP plan."
  {
    printf 'TAP version 13\n'
    printf '1..0 # no scenarios defined yet (waiting for #80)\n'
  } | tee -a "$TAP_OUT"
  exit 0
fi

# --------------------------------------------------------------------------
# Expand env-var template inside mount strings. Currently only
# ${CREWRIG_E2E_HOME} is recognised; expansion uses e2e_e2e_home so the
# CREWRIG_E2E_HOME override mechanism is preserved.
# --------------------------------------------------------------------------
expand_mount() {
  local raw="$1"
  local e2e_home
  e2e_home="$(e2e_e2e_home)"
  # Replace literal "${CREWRIG_E2E_HOME}" — guard against re-expansion by
  # the shell by doing a plain string substitution.
  printf '%s\n' "${raw//\$\{CREWRIG_E2E_HOME\}/$e2e_home}"
}

# Validate that an env var name matches the safe regex. Closes the secret-
# leakage path documented in ADR 0003 Open Risk #4.
ENV_NAME_RE='^[A-Z_][A-Z0-9_]*$'
validate_env_key() {
  local key="$1"
  if [[ ! "$key" =~ $ENV_NAME_RE ]]; then
    e2e_die "invalid env_keys entry '$key' (must match $ENV_NAME_RE)."
  fi
}

# --------------------------------------------------------------------------
# TAP emitter.
# --------------------------------------------------------------------------
TAP_INDEX=0
TAP_OK=0
TAP_NOK=0
TAP_SKIP=0

tap_emit() {
  # tap_emit ok|not_ok|skip <description> [<directive>]
  local kind="$1" desc="$2" directive="${3:-}"
  TAP_INDEX=$((TAP_INDEX + 1))
  local line
  case "$kind" in
    ok)
      line="ok ${TAP_INDEX} - ${desc}"
      TAP_OK=$((TAP_OK + 1))
      ;;
    not_ok)
      line="not ok ${TAP_INDEX} - ${desc}"
      TAP_NOK=$((TAP_NOK + 1))
      ;;
    skip)
      line="ok ${TAP_INDEX} - ${desc} # SKIP ${directive}"
      TAP_SKIP=$((TAP_SKIP + 1))
      ;;
  esac
  printf '%s\n' "$line" | tee -a "$TAP_OUT"
}

# Emit the TAP header — single source, mirrored to file and stdout via tee.
printf 'TAP version 13\n' | tee -a "$TAP_OUT"

# --------------------------------------------------------------------------
# Main loop.
# --------------------------------------------------------------------------
RUN_EXIT=0
for scenario in "${SELECTED_SCENARIOS[@]}"; do
  # Read `applies_to`, default to ["claude","gemini","copilot"] if absent.
  mapfile -t applies_to < <(
    jq -r --arg s "$scenario" \
      '.scenarios[$s].applies_to // ["claude","gemini","copilot"] | .[]' \
      "$EFFECTIVE_JSON"
  )
  mapfile -t scen_extra_args < <(
    jq -r --arg s "$scenario" \
      '.scenarios[$s].command_args // [] | .[]' \
      "$EFFECTIVE_JSON"
  )

  for cli in "${applies_to[@]}"; do
    # CLI filter.
    if [[ -n "$CLI_FILTER" && "$cli" != "$CLI_FILTER" ]]; then continue; fi
    if ! jq -e --arg c "$cli" '.cli | has($c)' "$EFFECTIVE_JSON" >/dev/null; then
      tap_emit not_ok "${cli}/${scenario}" ""
      e2e_info "[runner] scenario '$scenario' applies_to '$cli' but [cli.$cli] is missing."
      RUN_EXIT=1
      continue
    fi

    desc="${cli}/${scenario}"

    # Auth gate.
    if ! e2e_auth_ready "$cli"; then
      tap_emit skip "$desc" "unconfigured (run \`task e2e:auth:${cli}\`)"
      continue
    fi

    image="$(jq -r --arg c "$cli" '.cli[$c].image' "$EFFECTIVE_JSON")"
    case_dir="${REPORT_DIR}/${cli}/${scenario}"
    mkdir -p "$case_dir"

    # ----------------------------------------------------------------------
    # Scenario-script delegation branch (ADR 0005 Decision 3).
    # If tests/e2e/scenarios/<name>/run.sh is present and executable, the
    # runner hands off orchestration to it. The script receives the
    # contract env vars and is responsible for assembling its own docker
    # invocation(s), assertions, and tap subplan. Exit-code mapping is
    # unchanged: 0 → ok, 78 → skip, else → not ok.
    # ----------------------------------------------------------------------
    scenario_script="${SCRIPT_DIR}/scenarios/${scenario}/run.sh"
    if [[ -x "$scenario_script" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        tap_emit skip "$desc" "dry-run"
        continue
      fi
      if env \
          E2E_LIB_DIR="${SCRIPT_DIR}/lib" \
          E2E_REPORT_DIR="$case_dir" \
          E2E_CLI="$cli" \
          E2E_IMAGE="$image" \
          E2E_EFFECTIVE_JSON="$EFFECTIVE_JSON" \
          E2E_CREWRIG_E2E_HOME="$(e2e_e2e_home)" \
          E2E_SCENARIO_DIR="${SCRIPT_DIR}/scenarios/${scenario}" \
          E2E_RUN_ID="$(basename "$REPORT_DIR")" \
          "$scenario_script" \
          >"${case_dir}/stdout" \
          2>"${case_dir}/stderr"
      then
        exit_code=0
      else
        exit_code=$?
      fi
      printf '%d\n' "$exit_code" > "${case_dir}/exit"

      case "$exit_code" in
        0)  tap_emit ok "$desc" ;;
        78) tap_emit skip "$desc" "scenario reported skip (exit 78)" ;;
        *)
          tap_emit not_ok "$desc" ""
          e2e_info "[runner] ${desc} failed: exit ${exit_code}"
          e2e_info "[runner]   stdout: ${case_dir}/stdout"
          e2e_info "[runner]   stderr: ${case_dir}/stderr"
          RUN_EXIT=1
          ;;
      esac
      continue
    fi

    # ----------------------------------------------------------------------
    # Legacy direct-docker path (preserved for scenarios without a script).
    # ----------------------------------------------------------------------
    # Build docker invocation.
    mapfile -t cli_cmd < <(
      jq -r --arg c "$cli" '.cli[$c].command[]' "$EFFECTIVE_JSON"
    )
    mapfile -t cli_args < <(
      jq -r --arg c "$cli" '.cli[$c].command_args // [] | .[]' "$EFFECTIVE_JSON"
    )
    mapfile -t cli_mounts < <(
      jq -r --arg c "$cli" '.cli[$c].mounts // [] | .[]' "$EFFECTIVE_JSON"
    )
    mapfile -t cli_env_keys < <(
      jq -r --arg c "$cli" '.cli[$c].env_keys // [] | .[]' "$EFFECTIVE_JSON"
    )

    docker_argv=(docker run --rm --name "crewrig-e2e-${scenario}-${cli}")
    for m in "${cli_mounts[@]}"; do
      docker_argv+=(-v "$(expand_mount "$m")")
    done
    for k in "${cli_env_keys[@]}"; do
      validate_env_key "$k"
      # Forward by name only — value comes from the runner's env.
      docker_argv+=(-e "$k")
    done
    docker_argv+=("$image")
    docker_argv+=("${cli_cmd[@]}")
    if [[ ${#cli_args[@]} -gt 0 ]]; then docker_argv+=("${cli_args[@]}"); fi
    if [[ ${#scen_extra_args[@]} -gt 0 ]]; then docker_argv+=("${scen_extra_args[@]}"); fi

    {
      printf 'image: %s\n' "$image"
      printf 'argv:'
      for a in "${docker_argv[@]}"; do printf ' %q' "$a"; done
      printf '\n'
    } > "${case_dir}/invocation.txt"

    if [[ "$DRY_RUN" -eq 1 ]]; then
      tap_emit skip "$desc" "dry-run"
      continue
    fi

    if "${docker_argv[@]}" \
        >"${case_dir}/stdout" \
        2>"${case_dir}/stderr"
    then
      exit_code=0
    else
      exit_code=$?
    fi
    printf '%d\n' "$exit_code" > "${case_dir}/exit"

    case "$exit_code" in
      0)
        tap_emit ok "$desc"
        ;;
      78)
        tap_emit skip "$desc" "container reported skip (exit 78)"
        ;;
      *)
        tap_emit not_ok "$desc" ""
        e2e_info "[runner] ${desc} failed: exit ${exit_code}"
        e2e_info "[runner]   stdout: ${case_dir}/stdout"
        e2e_info "[runner]   stderr: ${case_dir}/stderr"
        RUN_EXIT=1
        ;;
    esac
  done
done

# --------------------------------------------------------------------------
# Plan line + summary comment.
# --------------------------------------------------------------------------
{
  printf '1..%d\n' "$TAP_INDEX"
  printf '# pass: %d  fail: %d  skip: %d\n' "$TAP_OK" "$TAP_NOK" "$TAP_SKIP"
  printf '# report dir: %s\n' "$REPORT_DIR"
} | tee -a "$TAP_OUT"

exit "$RUN_EXIT"
