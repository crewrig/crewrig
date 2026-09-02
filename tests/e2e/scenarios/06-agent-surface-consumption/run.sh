#!/usr/bin/env bash
# tests/e2e/scenarios/06-agent-surface-consumption/run.sh
#
# Probe B (spec 0194 R12-R15) — determines, per CLI and per per-file layout,
# whether that CLI's agent reader consumes a repository agent declaration
# placed under the `.claude/agents/` surface. Covers copilot and claude (R12
# "at least").
#
# One container run per cell, each with exactly ONE layout present in the
# fixture workspace, so no cell's observation can be attributed to
# another's declaration (PLAN v2 step 25):
#
#   # | CLI     | surface / layout                          | role
#   1 | copilot | .claude/agents/<n>/AGENT.md (nested)       | recorded cell
#   2 | copilot | .claude/agents/<n>.md (flat)                | recorded cell
#   3 | copilot | ~/.copilot/agents/<n>.md                    | cross-cell control
#   4 | claude  | .claude/agents/<n>/AGENT.md (nested)        | recorded cell
#   5 | claude  | .claude/agents/<n>.md (flat)                | recorded cell
#
# Every cell also carries an in-cell session-liveness baseline (a
# host-supplied nonce the top-level session writes directly, no agent
# involved) — the same-session control that carries the `not-consumed`
# attribution (tests/e2e/lib/probe_b_resolve.sh). Cell 3 is a SEPARATE run
# and adds only cross-cell evidence. Claude has no documented user-level
# agent layout (grep -rn '~/\.claude/agents' docs/ artifacts/ returns
# nothing), so its cells record control: in-cell-liveness-baseline-only.
#
# Per-cell consumption credit is derived from the CLI-generated
# spawn-result markers in the cell's own transcript (tests/e2e/lib/
# probe_spawn_markers.sh), not from consumed.txt or a raw grep of stdout —
# issue #1107 fix 1's audit of probe A's same hole (analysis comment on
# #1103): both prior observables are orchestrator-writable/readable and so
# forgeable in the same way leg.txt was proven forgeable for probe A. Both
# are retained in each cell's `observable` object as corroboration only.

set -euo pipefail

: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
: "${E2E_REPORT_DIR:?runner must export E2E_REPORT_DIR}"
: "${E2E_CLI:?runner must export E2E_CLI}"
: "${E2E_IMAGE:?runner must export E2E_IMAGE}"
: "${E2E_EFFECTIVE_JSON:?runner must export E2E_EFFECTIVE_JSON}"
: "${E2E_CREWRIG_E2E_HOME:?runner must export E2E_CREWRIG_E2E_HOME}"
: "${E2E_SCENARIO_DIR:?runner must export E2E_SCENARIO_DIR}"

# shellcheck source=../../lib/expand.sh
source "${E2E_LIB_DIR}/expand.sh"
# shellcheck source=../../lib/copilot_ephemeral_home.sh
source "${E2E_LIB_DIR}/copilot_ephemeral_home.sh"
# shellcheck source=../../lib/probe_b_resolve.sh
source "${E2E_LIB_DIR}/probe_b_resolve.sh"
# shellcheck source=../../lib/probe_spawn_markers.sh
source "${E2E_LIB_DIR}/probe_spawn_markers.sh"

SCENARIO_TAP="${E2E_REPORT_DIR}/scenario.tap"

scenario_skip() {
  printf '1..0 # SKIP %s\n' "$1" > "$SCENARIO_TAP"
  printf 'SKIP - %s/06-agent-surface-consumption: %s\n' "$E2E_CLI" "$1"
  exit 78
}

case "$E2E_CLI" in
  copilot|claude) ;;
  *) scenario_skip "probe B covers copilot and claude only (R12: at least)" ;;
esac

mapfile -t _cli_cmd < <(jq -r --arg c "$E2E_CLI" '.cli[$c].command[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_args < <(jq -r --arg c "$E2E_CLI" '.cli[$c].command_args // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_mounts < <(jq -r --arg c "$E2E_CLI" '.cli[$c].mounts // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_env_keys < <(jq -r --arg c "$E2E_CLI" '.cli[$c].env_keys // [] | .[]' "$E2E_EFFECTIVE_JSON")

PROBE_PROMPT_TMPL="$(cat "${E2E_SCENARIO_DIR}/probe.prompt")"
probe_argv=("${_cli_cmd[@]}")
if [[ ${#_cli_args[@]} -gt 0 ]]; then probe_argv+=("${_cli_args[@]}"); fi
probe_argv+=(-p)

case "$E2E_CLI" in
  copilot) CLI_VERSION="$(docker run --rm "$E2E_IMAGE" copilot --version 2>/dev/null | head -n1 || echo unknown)" ;;
  claude)  CLI_VERSION="$(docker run --rm "$E2E_IMAGE" claude --version 2>/dev/null | head -n1 || echo unknown)" ;;
esac

mkdir -p "${E2E_REPORT_DIR}/out"
CELLS_JSON="[]"

# run_cell <cell-key> <layout-desc> <path-desc> <mount-mode: workspace|ephemeral-home>
# Sets globals: CELL_OUTCOME, CELL_NONCE, CELL_BASELINE_OBSERVED,
# CELL_NONCE_OBSERVED (spawn-marker-derived; issue #1107 fix 1),
# CELL_SPAWN_OBSERVED, CELL_SUBAGENT_RESPONDED, CELL_LEGACY_NONCE_OBSERVED
# (corroboration only — see below), CELL_EVIDENCE.
run_cell() {
  local cell="$1" layout="$2" path_desc="$3" mount_mode="$4"
  local nonce baseline_nonce
  nonce="crewrig-probe-b-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  baseline_nonce="crewrig-probe-b-baseline-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

  local host_out="${E2E_REPORT_DIR}/out/${cell}"
  mkdir -p "$host_out"

  local prompt="${PROBE_PROMPT_TMPL//__BASELINE_NONCE__/${baseline_nonce}}"

  local docker_argv=(
    docker run --rm --name "crewrig-e2e-06-${E2E_CLI}-${cell}-${E2E_RUN_ID:-adhoc}"
    -v "${host_out}:/out"
  )

  local fixture_dir="" ephemeral_home=""
  if [[ "$mount_mode" == "workspace-nested" || "$mount_mode" == "workspace-flat" ]]; then
    fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/crewrig-e2e-probe-b.XXXXXX")"
    if [[ "$mount_mode" == "workspace-nested" ]]; then
      mkdir -p "${fixture_dir}/agents/probe-consumer"
      sed "s/__NONCE__/${nonce}/" "${E2E_SCENARIO_DIR}/agent-consumer.md.tmpl" \
        > "${fixture_dir}/agents/probe-consumer/AGENT.md"
    else
      mkdir -p "${fixture_dir}/agents"
      sed "s/__NONCE__/${nonce}/" "${E2E_SCENARIO_DIR}/agent-consumer.md.tmpl" \
        > "${fixture_dir}/agents/probe-consumer.md"
    fi
    chmod -R a+rX "$fixture_dir"
    docker_argv+=(-v "${fixture_dir}:/home/agent/workspace/.claude:ro")
    for _m in ${_cli_mounts[@]+"${_cli_mounts[@]}"}; do
      docker_argv+=(-v "$(expand_mount "$_m")")
    done
  elif [[ "$mount_mode" == "ephemeral-home" ]]; then
    local decl_src bundle_dir
    decl_src="$(mktemp "${TMPDIR:-/tmp}/crewrig-e2e-probe-b-decl.XXXXXX")"
    sed "s/__NONCE__/${nonce}/" "${E2E_SCENARIO_DIR}/agent-consumer.md.tmpl" > "$decl_src"
    bundle_dir="${E2E_CREWRIG_E2E_HOME}/copilot"
    ephemeral_home="$(e2e_stage_copilot_ephemeral_home "$bundle_dir" "probe-consumer" "$decl_src")"
    rm -f "$decl_src"
    # Cleanup happens explicitly at the end of this function (below), after
    # docker has already run — NOT via a trap set here: this branch (and
    # e2e_stage_copilot_ephemeral_home itself) runs inside command
    # substitution / a subshell context, where a trap fires immediately on
    # return rather than at the outer function's exit. See
    # copilot_ephemeral_home.sh's header comment for the reproduction.

    local substituted=false
    for _m in ${_cli_mounts[@]+"${_cli_mounts[@]}"}; do
      if [[ "$_m" == *":/home/agent/.copilot:"* || "$_m" == *":/home/agent/.copilot" ]]; then
        docker_argv+=(-v "$(e2e_copilot_home_mount_override "$ephemeral_home")")
        substituted=true
      else
        docker_argv+=(-v "$(expand_mount "$_m")")
      fi
    done
    if [[ "$substituted" == "false" ]]; then
      docker_argv+=(-v "$(e2e_copilot_home_mount_override "$ephemeral_home")")
    fi
  fi

  for _k in ${_cli_env_keys[@]+"${_cli_env_keys[@]}"}; do
    docker_argv+=(-e "$_k")
  done
  docker_argv+=("$E2E_IMAGE" "${probe_argv[@]}" "$prompt")

  {
    printf 'cell: %s (%s)\n' "$cell" "$layout"
    printf 'image: %s\n' "$E2E_IMAGE"
    printf 'argv:'
    for a in "${docker_argv[@]}"; do printf ' %q' "$a"; done
    printf '\n'
  } > "${host_out}/invocation.txt"

  local rc=0
  "${docker_argv[@]}" >"${host_out}/stdout" 2>"${host_out}/stderr" || rc=$?
  printf '%d\n' "$rc" > "${host_out}/exit"
  [[ -n "$fixture_dir" ]] && rm -rf "$fixture_dir"
  [[ -n "$ephemeral_home" ]] && rm -rf "$ephemeral_home"

  if grep -Fq "$baseline_nonce" "${host_out}/baseline.txt" 2>/dev/null \
     || grep -Fq "$baseline_nonce" "${host_out}/stdout" 2>/dev/null; then
    CELL_BASELINE_OBSERVED=true
  else
    CELL_BASELINE_OBSERVED=false
  fi
  # Corroboration-only (issue #1107 fix 1's probe-B twin): consumed.txt and
  # raw stdout are both orchestrator-writable/forgeable — the same hazard
  # the analysis comment on #1103 proved live for probe A (a session
  # reading the nonce out of the agent declaration after a failed spawn
  # and writing it itself). Recorded for transparency; never fed to the
  # resolver.
  if grep -Fq "$nonce" "${host_out}/consumed.txt" 2>/dev/null \
     || grep -Fq "$nonce" "${host_out}/stdout" 2>/dev/null; then
    CELL_LEGACY_NONCE_OBSERVED=true
  else
    CELL_LEGACY_NONCE_OBSERVED=false
  fi

  # Primary observable: the CLI-generated spawn-result markers in the
  # transcript (tests/e2e/lib/probe_spawn_markers.sh) — the orchestrating
  # session does not control these.
  IFS='|' read -r CELL_SPAWN_OBSERVED CELL_SUBAGENT_RESPONDED CELL_NONCE_OBSERVED CELL_SPAWN_MODEL \
    <<<"$(e2e_probe_spawn_signals "${host_out}/stdout" "Probe-consumer" "$nonce")"

  CELL_OUTCOME="$(e2e_probe_b_resolve_cell "$CELL_NONCE_OBSERVED" "$CELL_BASELINE_OBSERVED")"
  CELL_EVIDENCE="$(cat "${host_out}/stdout" "${host_out}/stderr" 2>/dev/null | tr '\n' ' ' | head -c 300)"
  CELL_PATH="$path_desc"
  CELL_LAYOUT="$layout"
}

emit_cell_json() {
  local role="$1" control="$2"
  CELLS_JSON="$(jq -c \
    --arg cli "$E2E_CLI" \
    --arg cli_version "$CLI_VERSION" \
    --arg surface "${CELL_LAYOUT}" \
    --arg layout "$CELL_LAYOUT" \
    --arg path "$CELL_PATH" \
    --arg outcome "$CELL_OUTCOME" \
    --arg nonce_observed "$CELL_NONCE_OBSERVED" \
    --arg baseline_observed "$CELL_BASELINE_OBSERVED" \
    --arg spawn_observed "$CELL_SPAWN_OBSERVED" \
    --arg subagent_responded "$CELL_SUBAGENT_RESPONDED" \
    --arg legacy_nonce_observed "$CELL_LEGACY_NONCE_OBSERVED" \
    --arg evidence "$CELL_EVIDENCE" \
    --arg control "$control" \
    --arg role "$role" \
    --arg observed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '. + [{
      cli: $cli, cli_version: $cli_version, surface: $surface, layout: $layout,
      path: $path, outcome: $outcome,
      observable: {nonce_observed: ($nonce_observed == "true"), baseline_observed: ($baseline_observed == "true"), spawn_observed: ($spawn_observed == "true"), subagent_responded: ($subagent_responded == "true"), legacy_nonce_observed: ($legacy_nonce_observed == "true"), evidence: $evidence},
      control: $control, role: $role, observed_at: $observed_at
    }]' <<<"$CELLS_JSON")"
}

case "$E2E_CLI" in
  copilot)
    run_cell "nested" ".claude/agents/ (nested)" ".claude/agents/probe-consumer/AGENT.md" "workspace-nested"
    COPILOT_NESTED_OUTCOME="$CELL_OUTCOME"
    emit_cell_json "recorded" "in-cell-liveness-baseline"

    run_cell "flat" ".claude/agents/ (flat)" ".claude/agents/probe-consumer.md" "workspace-flat"
    emit_cell_json "recorded" "in-cell-liveness-baseline"

    run_cell "cross_cell_control" "~/.copilot/agents/ (flat)" "~/.copilot/agents/probe-consumer.md" "ephemeral-home"
    emit_cell_json "cross-cell-control" "cross-cell-documented-layout"
    CROSS_CELL_OUTCOME="$CELL_OUTCOME"
    ;;
  claude)
    run_cell "nested" ".claude/agents/ (nested)" ".claude/agents/probe-consumer/AGENT.md" "workspace-nested"
    emit_cell_json "recorded" "in-cell-liveness-baseline-only"

    run_cell "flat" ".claude/agents/ (flat)" ".claude/agents/probe-consumer.md" "workspace-flat"
    emit_cell_json "recorded" "in-cell-liveness-baseline-only"
    ;;
esac

# --------------------------------------------------------------------------
# Contradicts array (PLAN v2 step 27, R15) — if a copilot cell records
# not-consumed on the .claude/agents/ surface, name the contradicted
# assertions without resolving them. Cross-reference probe A's own reading
# of the same cell, published on #1103.
# --------------------------------------------------------------------------
CONTRADICTS_JSON="[]"
if [[ "${COPILOT_NESTED_OUTCOME:-}" == "not-consumed" ]]; then
  CONTRADICTS_JSON='[
    "specs/0143-copilot-subagent-model-fallback.md -> ## Intent (\"Copilot CLI inspects .claude/agents\")",
    "specs/0143-copilot-subagent-model-fallback.md delta-01 -> shared-read hazard section (pull request 1102)",
    "epic #1100 -> compiled-layout-convention block"
  ]'
fi

PROBE_A_CROSS_REF='null'
if [[ -n "${COPILOT_NESTED_OUTCOME:-}" ]]; then
  PROBE_A_CROSS_REF="$(jq -n \
    --arg comment_url "https://github.com/crewrig/crewrig/issues/1103#issuecomment-5506957758" \
    --arg probe_b_reading "$COPILOT_NESTED_OUTCOME" \
    '{comment_url: $comment_url, probe_a_verdict: "INDETERMINATE", probe_b_copilot_nested_reading: $probe_b_reading, note: "probe A did not discriminate (session never established); no agreement/disagreement to report yet"}')"
fi

RUN_ID_FIELD="${E2E_RUN_ID:-adhoc}"
jq -n \
  --arg probe "06-agent-surface-consumption" \
  --arg spec "0194" \
  --arg run_id "$RUN_ID_FIELD" \
  --arg observed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson cells "$CELLS_JSON" \
  --argjson contradicts "$CONTRADICTS_JSON" \
  --argjson probe_a_cross_reference "$PROBE_A_CROSS_REF" \
  '{probe: $probe, spec: $spec, run_id: $run_id, observed_at: $observed_at, cells: $cells, contradicts: $contradicts, probe_a_cross_reference: $probe_a_cross_reference}' \
  > "${E2E_REPORT_DIR}/verdict.json"

# --------------------------------------------------------------------------
# TAP subplan — one assertion per cell recorded.
# --------------------------------------------------------------------------
: > "$SCENARIO_TAP"
n_cells="$(jq 'length' <<<"$CELLS_JSON")"
idx=0
while [[ "$idx" -lt "$n_cells" ]]; do
  desc="$(jq -r ".[$idx] | \"\\(.cli)/\\(.layout): \\(.outcome)\"" <<<"$CELLS_JSON")"
  printf 'ok %d - %s\n' "$((idx + 1))" "$desc" >> "$SCENARIO_TAP"
  idx=$((idx + 1))
done
printf '1..%d\n' "$n_cells" >> "$SCENARIO_TAP"

printf 'probe B recorded %d cell(s) — %s (report: %s)\n' "$n_cells" "$E2E_CLI" "${E2E_REPORT_DIR}/verdict.json"
exit 0
