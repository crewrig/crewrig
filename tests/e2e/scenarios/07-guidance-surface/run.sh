#!/usr/bin/env bash
# tests/e2e/scenarios/07-guidance-surface/run.sh
#
# Probe C (spec 0203) — evaluates guidance-surface prose vs Copilot reader,
# effort: frontmatter key inertness, and orchestrator guidance reliability.
#
# Four cells across targets:
#   C1 | copilot | .claude/agents/<n>.md prose names unserved model, no model: field
#   C2 | copilot | same, with effort: frontmatter key and no model: field
#   C3 | claude  | agent description requests model + effort vs control agent
#   C4 | agy     | agent description requests agy models identifier
#
# Outcome vocabulary per cell: HONOURED | IGNORED | DISTURBED | INDETERMINATE

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
# shellcheck source=../../lib/probe_spawn_markers.sh
source "${E2E_LIB_DIR}/probe_spawn_markers.sh"
# shellcheck source=../../lib/probe_c_resolve.sh
source "${E2E_LIB_DIR}/probe_c_resolve.sh"

SCENARIO_TAP="${E2E_REPORT_DIR}/scenario.tap"

scenario_skip() {
  printf '1..0 # SKIP %s\n' "$1" > "$SCENARIO_TAP"
  printf 'SKIP - %s/07-guidance-surface: %s\n' "$E2E_CLI" "$1"
  exit 78
}

case "$E2E_CLI" in
  copilot|claude|antigravity) ;;
  *) scenario_skip "probe C applies to copilot, claude, and antigravity" ;;
esac

# Copilot-specific preconditions (BYOK provider and model must be declared and backed)
if [[ "$E2E_CLI" == "copilot" ]]; then
  BYOK_PROVIDER="$(jq -r '.cli.copilot.byok_provider // ""' "$E2E_EFFECTIVE_JSON")"
  BYOK_MODEL="$(jq -r '.cli.copilot.byok_model // ""' "$E2E_EFFECTIVE_JSON")"

  if [[ -z "$BYOK_PROVIDER" || -z "$BYOK_MODEL" ]]; then
    scenario_skip "byok_provider/byok_model not declared — copy tests/e2e/local.toml.example's [cli.copilot] block to tests/e2e/local.toml, then run \`task e2e:auth:ollama\`"
  fi

  DEFAULTS_TOML="$(cd "${E2E_SCENARIO_DIR}/../.." && pwd)/defaults.toml"
  DEFAULTS_ONLY_JSON="$(bash "${E2E_LIB_DIR}/toml_merge.sh" "$DEFAULTS_TOML")"
  DEFAULTS_ONLY_CMD="$(jq -c '.cli.copilot.command' <<<"$DEFAULTS_ONLY_JSON")"
  EFFECTIVE_CMD="$(jq -c '.cli.copilot.command' "$E2E_EFFECTIVE_JSON")"

  if [[ "$EFFECTIVE_CMD" == "$DEFAULTS_ONLY_CMD" ]]; then
    scenario_skip "byok_provider='${BYOK_PROVIDER}' declared but [cli.copilot].command is unchanged from defaults — wrapper not in force"
  fi
fi

mapfile -t _cli_cmd < <(jq -r --arg c "$E2E_CLI" '.cli[$c].command[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_args < <(jq -r --arg c "$E2E_CLI" '.cli[$c].command_args // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_mounts < <(jq -r --arg c "$E2E_CLI" '.cli[$c].mounts // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_env_keys < <(jq -r --arg c "$E2E_CLI" '.cli[$c].env_keys // [] | .[]' "$E2E_EFFECTIVE_JSON")

PROBE_PROMPT_TMPL="$(cat "${E2E_SCENARIO_DIR}/probe.prompt")"
probe_argv=("${_cli_cmd[@]}")
if [[ ${#_cli_args[@]} -gt 0 ]]; then probe_argv+=("${_cli_args[@]}"); fi
probe_argv+=(-p)

case "$E2E_CLI" in
  copilot)     CLI_VERSION="$(docker run --rm "$E2E_IMAGE" copilot --version 2>/dev/null | head -n1 || echo unknown)" ;;
  claude)      CLI_VERSION="$(docker run --rm "$E2E_IMAGE" claude --version 2>/dev/null | head -n1 || echo unknown)" ;;
  antigravity) CLI_VERSION="unknown" ;;
esac

mkdir -p "${E2E_REPORT_DIR}/out"
CELLS_JSON="[]"

run_cell() {
  local cell="$1" template_file="$2"
  local nonce baseline_nonce
  nonce="crewrig-probe-c-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  baseline_nonce="crewrig-probe-c-base-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

  local host_out="${E2E_REPORT_DIR}/out/${cell}"
  mkdir -p "$host_out"

  local prompt="${PROBE_PROMPT_TMPL//__BASELINE_NONCE__/${baseline_nonce}}"

  local docker_argv=(
    docker run --rm --name "crewrig-e2e-07-${E2E_CLI}-${cell}-${E2E_RUN_ID:-adhoc}"
    -v "${host_out}:/out"
  )

  local fixture_dir
  fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/crewrig-e2e-probe-c.XXXXXX")"
  mkdir -p "${fixture_dir}/agents"
  sed "s/__NONCE__/${nonce}/" "${E2E_SCENARIO_DIR}/${template_file}" \
    > "${fixture_dir}/agents/probe-guidance.md"
  chmod -R a+rX "$fixture_dir"

  docker_argv+=(-v "${fixture_dir}:/home/agent/workspace/.claude:ro")
  for _m in ${_cli_mounts[@]+"${_cli_mounts[@]}"}; do
    docker_argv+=(-v "$(expand_mount "$_m")")
  done

  for _k in ${_cli_env_keys[@]+"${_cli_env_keys[@]}"}; do
    docker_argv+=(-e "$_k")
  done
  docker_argv+=("$E2E_IMAGE" "${probe_argv[@]}" "$prompt")

  {
    printf 'cell: %s\n' "$cell"
    printf 'image: %s\n' "$E2E_IMAGE"
    printf 'argv:'
    for a in "${docker_argv[@]}"; do printf ' %q' "$a"; done
    printf '\n'
  } > "${host_out}/invocation.txt"

  local rc=0
  "${docker_argv[@]}" >"${host_out}/stdout" 2>"${host_out}/stderr" || rc=$?
  printf '%d\n' "$rc" > "${host_out}/exit"
  rm -rf "$fixture_dir"

  if grep -Fq "$baseline_nonce" "${host_out}/baseline.txt" 2>/dev/null \
     || grep -Fq "$baseline_nonce" "${host_out}/stdout" 2>/dev/null; then
    CELL_BASELINE_OBSERVED=true
  else
    CELL_BASELINE_OBSERVED=false
  fi

  # Extract spawn signals from transcript
  IFS='|' read -r CELL_SPAWN_OBSERVED CELL_SUBAGENT_RESPONDED CELL_NONCE_OBSERVED CELL_SPAWN_MODEL \
    <<<"$(e2e_probe_spawn_signals "${host_out}/stdout" "probe-guidance" "$nonce")"

  CELL_SYMPTOM_MATCHED=false
  if grep -Eqi 'Model .* not found|Invalid model|Unknown model' "${host_out}/stderr" "${host_out}/stdout" 2>/dev/null; then
    CELL_SYMPTOM_MATCHED=true
  fi
}

emit_cell_json() {
  local cell="$1" question="$2" outcome="$3" reason="$4"
  CELLS_JSON="$(jq -c \
    --arg cell "$cell" \
    --arg cli "$E2E_CLI" \
    --arg cli_version "$CLI_VERSION" \
    --arg question "$question" \
    --arg outcome "$outcome" \
    --arg reason "$reason" \
    --arg spawn_observed "$CELL_SPAWN_OBSERVED" \
    --arg subagent_responded "$CELL_SUBAGENT_RESPONDED" \
    --arg nonce_observed "$CELL_NONCE_OBSERVED" \
    --arg spawn_model "$CELL_SPAWN_MODEL" \
    --arg baseline_observed "$CELL_BASELINE_OBSERVED" \
    --arg observed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '. + [{
      cell: $cell,
      cli: $cli,
      cli_version: $cli_version,
      question: $question,
      outcome: $outcome,
      reason: $reason,
      observables: {
        spawn_observed: ($spawn_observed == "true"),
        subagent_responded: ($subagent_responded == "true"),
        nonce_observed: ($nonce_observed == "true"),
        spawn_model: $spawn_model,
        baseline_observed: ($baseline_observed == "true")
      },
      observed_at: $observed_at
    }]' <<<"$CELLS_JSON")"
}

if [[ "$E2E_CLI" == "copilot" ]]; then
  # Cell C1: Copilot BYOK prose naming unserved model (sonnet), no model: field
  run_cell "C1" "agent-c1.md.tmpl"
  IFS='|' read -r c1_outcome c1_reason \
    <<<"$(e2e_probe_c_resolve_c1 "$CELL_BASELINE_OBSERVED" "$CELL_NONCE_OBSERVED" "$CELL_SUBAGENT_RESPONDED" "$CELL_SYMPTOM_MATCHED")"
  emit_cell_json "C1" "Does description prose naming an unserved model disturb Copilot BYOK routing?" "$c1_outcome" "$c1_reason"

  # Cell C2: Copilot BYOK effort: frontmatter key, no model: field
  run_cell "C2" "agent-c2.md.tmpl"
  IFS='|' read -r c2_outcome c2_reason \
    <<<"$(e2e_probe_c_resolve_c2 "$CELL_BASELINE_OBSERVED" "$CELL_NONCE_OBSERVED" "$CELL_SUBAGENT_RESPONDED" "$CELL_SYMPTOM_MATCHED")"
  emit_cell_json "C2" "Is non-model effort: frontmatter key inert for Copilot reader?" "$c2_outcome" "$c2_reason"

elif [[ "$E2E_CLI" == "claude" ]]; then
  # Cell C3 control leg: observe unguided/session model
  run_cell "C3-control" "agent-c3-control.md.tmpl"
  c3_control_model="$CELL_SPAWN_MODEL"

  # Cell C3 guided leg: observe whether requested model (haiku) is selected
  run_cell "C3" "agent-c3-guided.md.tmpl"
  IFS='|' read -r c3_outcome c3_reason \
    <<<"$(e2e_probe_c_resolve_c3 "$CELL_BASELINE_OBSERVED" "$CELL_NONCE_OBSERVED" "$CELL_SUBAGENT_RESPONDED" "$CELL_SPAWN_MODEL" "haiku" "$c3_control_model")"
  emit_cell_json "C3" "Does Claude Code orchestrator honor description-borne model and effort requests?" "$c3_outcome" "$c3_reason"

elif [[ "$E2E_CLI" == "antigravity" ]]; then
  # Cell C4: Antigravity CLI model selection guidance
  run_cell "C4-control" "agent-c3-control.md.tmpl"
  c4_control_model="$CELL_SPAWN_MODEL"

  run_cell "C4" "agent-c4.md.tmpl"
  IFS='|' read -r c4_outcome c4_reason \
    <<<"$(e2e_probe_c_resolve_c4 "$CELL_BASELINE_OBSERVED" "$CELL_NONCE_OBSERVED" "$CELL_SUBAGENT_RESPONDED" "$CELL_SPAWN_MODEL" "gemini-3.8-flash-low" "$c4_control_model")"
  emit_cell_json "C4" "Does Antigravity CLI orchestrator honor description-borne model requests?" "$c4_outcome" "$c4_reason"
fi

RUN_ID_FIELD="${E2E_RUN_ID:-adhoc}"
jq -n \
  --arg probe "07-guidance-surface" \
  --arg spec "0203" \
  --arg run_id "$RUN_ID_FIELD" \
  --arg observed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson cells "$CELLS_JSON" \
  '{probe: $probe, spec: $spec, run_id: $run_id, observed_at: $observed_at, cells: $cells}' \
  > "${E2E_REPORT_DIR}/verdict.json"

: > "$SCENARIO_TAP"
n_cells="$(jq 'length' <<<"$CELLS_JSON")"
idx=0
while [[ "$idx" -lt "$n_cells" ]]; do
  desc="$(jq -r ".[$idx] | \"\\(.cell) (\\(.cli)): \\(.outcome) [\\(.reason)]\"" <<<"$CELLS_JSON")"
  printf 'ok %d - %s\n' "$((idx + 1))" "$desc" >> "$SCENARIO_TAP"
  idx=$((idx + 1))
done
printf '1..%d\n' "$n_cells" >> "$SCENARIO_TAP"

printf 'probe C recorded %d cell(s) — %s (report: %s)\n' "$n_cells" "$E2E_CLI" "${E2E_REPORT_DIR}/verdict.json"
exit 0
