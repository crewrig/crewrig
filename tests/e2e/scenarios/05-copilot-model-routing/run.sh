#!/usr/bin/env bash
# tests/e2e/scenarios/05-copilot-model-routing/run.sh
#
# Probe A (spec 0194 R8-R11) — a differential probe adjudicating the
# upstream defect tracked as github/copilot-cli#4437: on a Copilot CLI
# session served by a bring-your-own-key (BYOK) provider, does a `model:`
# hint in a repository agent declaration break subagent routing through the
# session's task tool?
#
# Applies only to copilot (applies_to in tests/e2e/defaults.toml). Runs on
# whichever Copilot credential path is already ready (spec 0194 R10) — NOT
# gated on requirements 1-7 (the workstation-credential passthrough).
#
# Three legs, differing in exactly one field — the declaration's `model:`
# line (PLAN v2 comment 5506614582 step 2):
#   control_no_hint  — absent.                       Read-proof for the
#                                                      .claude/agents/ surface.
#   hint_efficacy    — crewrig-probe-no-such-model    (unresolvable by
#                       construction). Its nonce appearing means the
#                       model: key is inert in this CLI version.
#   model_bearing    — sonnet (the historical trigger, per
#                       specs/0143-copilot-subagent-model-fallback.md →
#                       Intent).
#
# The verdict is resolved by tests/e2e/lib/probe_a_resolve.sh (sourced
# below) — see that file for the full truth table and finding v2-F1.
# Verdict vocabulary: BUG-PRESENT | BUG-ABSENT | INDETERMINATE (spec 0194 R9).
#
# Per-leg nonce credit is derived from the CLI-generated spawn-result
# markers in the leg's own transcript (tests/e2e/lib/probe_spawn_markers.sh),
# not from leg.txt — issue #1107 fix 1: live run 20260902T132406Z-088f
# proved leg.txt orchestrator-writable and forgeable (the orchestrating
# session read the nonce out of the agent declaration and wrote it there
# itself, on legs whose own spawn markers read "Agent completed but
# produced no response."). leg.txt is retained in the verdict as
# corroboration only.

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
# shellcheck source=../../lib/mask_command.sh
source "${E2E_LIB_DIR}/mask_command.sh"
# shellcheck source=../../lib/probe_a_resolve.sh
source "${E2E_LIB_DIR}/probe_a_resolve.sh"
# shellcheck source=../../lib/probe_spawn_markers.sh
source "${E2E_LIB_DIR}/probe_spawn_markers.sh"

# Credential path actually selected by e2e_auth_ready (scripts/e2e/lib/
# auth-common.sh) — exported by the runner (spec 0194 R9 record accuracy;
# issue #1107 fix 2). Optional, not required: a direct-invocation caller
# (e.g. the hermetic skip-path tests) that bypasses the runner's auth gate
# has no such decision to report — "unknown" is honest there, unlike the
# previously hardcoded "COPILOT_GITHUB_TOKEN" literal, which recorded a
# path even when a different one had actually authenticated the run.
E2E_CREDENTIAL_PATH="${E2E_CREDENTIAL_PATH:-unknown}"

SCENARIO_TAP="${E2E_REPORT_DIR}/scenario.tap"

scenario_skip() {
  printf '1..0 # SKIP %s\n' "$1" > "$SCENARIO_TAP"
  printf 'SKIP - %s/05-copilot-model-routing: %s\n' "$E2E_CLI" "$1"
  exit 78
}

if [[ "$E2E_CLI" != "copilot" ]]; then
  scenario_skip "probe A applies only to copilot"
fi

# --------------------------------------------------------------------------
# Precondition — declared AND backed (PLAN v2 step 2 bullet 2). The two
# byok_* keys are a developer's own assertion about tests/e2e/local.toml,
# not evidence a wrapper is in force.
# --------------------------------------------------------------------------
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
  scenario_skip "byok_provider='${BYOK_PROVIDER}' declared but [cli.copilot].command is unchanged from the defaults-only merge — the wrapper is not in force (edit tests/e2e/local.toml)"
fi

# --------------------------------------------------------------------------
# Effective per-CLI configuration — read, not just two keys (PLAN v2 step 2
# bullet 1). Mirrors tests/e2e/scenarios/01-layered-context/run.sh:73,77.
# --------------------------------------------------------------------------
mapfile -t _cli_cmd < <(jq -r '.cli.copilot.command[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_args < <(jq -r '.cli.copilot.command_args // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_mounts < <(jq -r '.cli.copilot.mounts // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_env_keys < <(jq -r '.cli.copilot.env_keys // [] | .[]' "$E2E_EFFECTIVE_JSON")

PROBE_PROMPT="$(cat "${E2E_SCENARIO_DIR}/probe.prompt")"
probe_argv=("${_cli_cmd[@]}")
if [[ ${#_cli_args[@]} -gt 0 ]]; then probe_argv+=("${_cli_args[@]}"); fi
probe_argv+=(-p)

# `copilot --version` from the same image in the same run (never the
# committed docker/e2e/.versions.lock, which drifts against `:latest`).
COPILOT_VERSION="$(docker run --rm "$E2E_IMAGE" copilot --version 2>/dev/null | head -n1 || echo unknown)"

# Symptom strings recorded in docs/cli-matrix.md's "[GAP] Copilot CLI
# subagent model routing on BYOK/Ollama" bullet (row 4).
SYMPTOM_RE='Agent completed but produced no response\.|not found on provider|HTTP 404'

mkdir -p "${E2E_REPORT_DIR}/out"

# run_leg <leg-name> <template-file>
# Returns via globals: LEG_NONCE_OBSERVED (true|false — the primary,
# spawn-marker-derived observable; issue #1107 fix 1), LEG_SPAWN_OBSERVED,
# LEG_SUBAGENT_RESPONDED, LEG_SPAWN_MODEL, LEG_LEGTXT_NONCE_OBSERVED
# (corroboration only — see below), LEG_SYMPTOM_MATCHED (true|false),
# LEG_EVIDENCE (truncated stdout+stderr sample).
run_leg() {
  local leg="$1" template="$2"
  local nonce fixture_dir host_out container_name
  nonce="crewrig-probe-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

  # Per-leg fixture workspace under mktemp -d — never under $E2E_REPORT_DIR
  # (R4; see step 26's rationale, applied here too). Lands the declaration
  # at the workspace-relative .claude/agents/<n>/AGENT.md surface (requirement
  # 8 of spec 0143 delta-01), mounted at the container's WORKDIR
  # (/home/agent/workspace), never at the CLI's own home-level config mount.
  fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/crewrig-e2e-probe-a.XXXXXX")"
  mkdir -p "${fixture_dir}/agents/probe-router"
  sed "s/__NONCE__/${nonce}/" "${E2E_SCENARIO_DIR}/${template}" \
    > "${fixture_dir}/agents/probe-router/AGENT.md"
  # World-readable: throwaway template text (no credential material), and a
  # Linux host's container uid may differ from the invoking host uid.
  chmod -R a+rX "$fixture_dir"

  host_out="${E2E_REPORT_DIR}/out/${leg}"
  mkdir -p "$host_out"
  container_name="crewrig-e2e-05-${leg}-${E2E_RUN_ID:-adhoc}"

  docker_argv=(
    docker run --rm --name "$container_name"
    -v "${host_out}:/out"
    -v "${fixture_dir}:/home/agent/workspace/.claude:ro"
  )
  for _m in ${_cli_mounts[@]+"${_cli_mounts[@]}"}; do
    docker_argv+=(-v "$(expand_mount "$_m")")
  done
  for _k in ${_cli_env_keys[@]+"${_cli_env_keys[@]}"}; do
    docker_argv+=(-e "$_k")
  done
  docker_argv+=("$E2E_IMAGE" "${probe_argv[@]}" "$PROBE_PROMPT")

  {
    printf 'leg: %s\n' "$leg"
    printf 'image: %s\n' "$E2E_IMAGE"
    printf 'argv:'
    for a in "${docker_argv[@]}"; do printf ' %q' "$a"; done
    printf '\n'
  } > "${host_out}/invocation.txt"

  local rc=0
  "${docker_argv[@]}" >"${host_out}/stdout" 2>"${host_out}/stderr" || rc=$?
  printf '%d\n' "$rc" > "${host_out}/exit"

  local answer_file="${host_out}/leg.txt"
  if [[ ! -s "$answer_file" ]]; then
    cp "${host_out}/stdout" "$answer_file" 2>/dev/null || true
  fi

  # Corroboration-only (issue #1107 fix 1): leg.txt is orchestrator-
  # writable and forgeable — live run 20260902T132406Z-088f proved the
  # orchestrating session reads the nonce straight out of the agent
  # declaration and writes it here itself after its own spawn produced no
  # response. Recorded in the verdict for transparency; never fed to the
  # resolver.
  if grep -Fq "$nonce" "$answer_file" 2>/dev/null; then
    LEG_LEGTXT_NONCE_OBSERVED=true
  else
    LEG_LEGTXT_NONCE_OBSERVED=false
  fi

  # Primary observable: the CLI-generated spawn-result markers in the
  # transcript (tests/e2e/lib/probe_spawn_markers.sh) — the orchestrating
  # session does not control these.
  IFS='|' read -r LEG_SPAWN_OBSERVED LEG_SUBAGENT_RESPONDED LEG_NONCE_OBSERVED LEG_SPAWN_MODEL \
    <<<"$(e2e_probe_spawn_signals "${host_out}/stdout" "Probe-router" "$nonce")"

  local combined
  combined="$(cat "${host_out}/stdout" "${host_out}/stderr" 2>/dev/null || true)"
  if grep -Eq "$SYMPTOM_RE" <<<"$combined"; then
    LEG_SYMPTOM_MATCHED=true
  else
    LEG_SYMPTOM_MATCHED=false
  fi
  LEG_EVIDENCE="$(printf '%s' "$combined" | tr '\n' ' ' | head -c 300)"

  rm -rf "$fixture_dir"
}

run_leg control_no_hint  agent-control.md.tmpl
CONTROL_OBSERVED="$LEG_NONCE_OBSERVED"; CONTROL_EVIDENCE="$LEG_EVIDENCE"
CONTROL_SPAWN_OBSERVED="$LEG_SPAWN_OBSERVED"; CONTROL_SUBAGENT_RESPONDED="$LEG_SUBAGENT_RESPONDED"; CONTROL_LEGTXT_OBSERVED="$LEG_LEGTXT_NONCE_OBSERVED"

run_leg hint_efficacy    agent-hint-efficacy.md.tmpl
EFFICACY_OBSERVED="$LEG_NONCE_OBSERVED"; EFFICACY_SYMPTOM="$LEG_SYMPTOM_MATCHED"; EFFICACY_EVIDENCE="$LEG_EVIDENCE"
EFFICACY_SPAWN_OBSERVED="$LEG_SPAWN_OBSERVED"; EFFICACY_SUBAGENT_RESPONDED="$LEG_SUBAGENT_RESPONDED"; EFFICACY_LEGTXT_OBSERVED="$LEG_LEGTXT_NONCE_OBSERVED"

run_leg model_bearing    agent-model-bearing.md.tmpl
BEARING_OBSERVED="$LEG_NONCE_OBSERVED"; BEARING_SYMPTOM="$LEG_SYMPTOM_MATCHED"; BEARING_EVIDENCE="$LEG_EVIDENCE"
BEARING_SPAWN_OBSERVED="$LEG_SPAWN_OBSERVED"; BEARING_SUBAGENT_RESPONDED="$LEG_SUBAGENT_RESPONDED"; BEARING_LEGTXT_OBSERVED="$LEG_LEGTXT_NONCE_OBSERVED"

# --------------------------------------------------------------------------
# Row-1 failure path (PLAN v2 step 2, finding v2-F4): control nonce absent.
# Re-run the control declaration once at the ONLY layout the public
# reference documents, ~/.copilot/agents/<n>.md, to separate "Copilot reads
# no agent surface / the session is broken" from "Copilot does not read
# .claude/agents/". Reuses step 26's ephemeral-home mechanism (never writes
# into the developer's persisted credential bundle).
# --------------------------------------------------------------------------
FALLBACK_OBSERVED=""
FALLBACK_EVIDENCE=""
FALLBACK_SPAWN_OBSERVED=""
FALLBACK_SUBAGENT_RESPONDED=""
FALLBACK_LEGTXT_OBSERVED=""
if [[ "$CONTROL_OBSERVED" != "true" ]]; then
  fallback_nonce="crewrig-probe-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  fallback_decl_src="$(mktemp "${TMPDIR:-/tmp}/crewrig-e2e-probe-a-fallback.XXXXXX")"
  sed "s/__NONCE__/${fallback_nonce}/" "${E2E_SCENARIO_DIR}/agent-control.md.tmpl" > "$fallback_decl_src"

  bundle_dir="${E2E_CREWRIG_E2E_HOME}/copilot"
  ephemeral_home="$(e2e_stage_copilot_ephemeral_home "$bundle_dir" "probe-router" "$fallback_decl_src")"
  rm -f "$fallback_decl_src"
  # Cleanup MUST be registered here, in this shell — not inside the helper,
  # which runs in the command-substitution subshell above and would delete
  # the staging dir before docker ever mounts it (see the helper's header
  # comment for the reproduction).
  trap 'rm -rf "$ephemeral_home"' EXIT

  fb_host_out="${E2E_REPORT_DIR}/out/fallback_control"
  mkdir -p "$fb_host_out"

  fb_docker_argv=(
    docker run --rm --name "crewrig-e2e-05-fallback-${E2E_RUN_ID:-adhoc}"
    -v "${fb_host_out}:/out"
  )
  for _m in ${_cli_mounts[@]+"${_cli_mounts[@]}"}; do
    # Substitute the ephemeral home for any mount whose container target is
    # /home/agent/.copilot (finding v2-F4) — never mount the real bundle rw
    # here, even transiently.
    if [[ "$_m" == *":/home/agent/.copilot:"* || "$_m" == *":/home/agent/.copilot" ]]; then
      fb_docker_argv+=(-v "$(e2e_copilot_home_mount_override "$ephemeral_home")")
    else
      fb_docker_argv+=(-v "$(expand_mount "$_m")")
    fi
  done
  if ! printf '%s\n' "${_cli_mounts[@]+"${_cli_mounts[@]}"}" | grep -q '/home/agent/.copilot'; then
    fb_docker_argv+=(-v "$(e2e_copilot_home_mount_override "$ephemeral_home")")
  fi
  for _k in ${_cli_env_keys[@]+"${_cli_env_keys[@]}"}; do
    fb_docker_argv+=(-e "$_k")
  done
  fb_docker_argv+=("$E2E_IMAGE" "${probe_argv[@]}" "$PROBE_PROMPT")

  fb_rc=0
  "${fb_docker_argv[@]}" >"${fb_host_out}/stdout" 2>"${fb_host_out}/stderr" || fb_rc=$?
  printf '%d\n' "$fb_rc" > "${fb_host_out}/exit"

  fb_answer="${fb_host_out}/leg.txt"
  [[ -s "$fb_answer" ]] || cp "${fb_host_out}/stdout" "$fb_answer" 2>/dev/null || true

  # Corroboration-only (issue #1107 fix 1) — see run_leg()'s header above.
  if grep -Fq "$fallback_nonce" "$fb_answer" 2>/dev/null; then
    FALLBACK_LEGTXT_OBSERVED=true
  else
    FALLBACK_LEGTXT_OBSERVED=false
  fi

  IFS='|' read -r FALLBACK_SPAWN_OBSERVED FALLBACK_SUBAGENT_RESPONDED FALLBACK_OBSERVED _fallback_spawn_model \
    <<<"$(e2e_probe_spawn_signals "${fb_host_out}/stdout" "Probe-router" "$fallback_nonce")"

  FALLBACK_EVIDENCE="$(cat "${fb_host_out}/stdout" "${fb_host_out}/stderr" 2>/dev/null | tr '\n' ' ' | head -c 300)"

  # Escalation note (PLAN v2 step 2 failure path) — written for a human/agent
  # to post deliberately, never auto-posted from here: this is a rare path
  # (the common control leg passes) and R11's publication already goes
  # through scripts/e2e/publish-probe-verdict.sh, which is where the
  # scenario's own output ends.
  if [[ "$FALLBACK_OBSERVED" == "true" ]]; then
    {
      printf 'Probe A (spec 0194) row-1 escalation from #1103: the control leg'
      printf ' observed no nonce at `.claude/agents/<n>/AGENT.md`, but DID observe'
      printf ' one at the fallback `~/.copilot/agents/<n>.md` layout. This puts'
      printf ' requirement 8'\''s shared-read hazard premise in question rather'
      printf ' than confirming it. See the probe A verdict comment on #1103 for'
      printf ' the full record.\n'
    } > "${E2E_REPORT_DIR}/escalation-1101.md" 2>/dev/null || true
  fi
fi

# --------------------------------------------------------------------------
# Resolve verdict + mask the effective command (finding v2-F3) + write
# verdict.json (spec 0194 R9; R11 publication happens via
# scripts/e2e/publish-probe-verdict.sh).
# --------------------------------------------------------------------------
RESOLVED="$(e2e_probe_a_resolve "$CONTROL_OBSERVED" "$EFFICACY_OBSERVED" "$EFFICACY_SYMPTOM" "$BEARING_OBSERVED" "$BEARING_SYMPTOM")"
VERDICT="${RESOLVED%%|*}"
REASON="${RESOLVED#*|}"

# DEV-stage tester audit finding (high): the original split(" ")-based mask
# missed --flag=value secrets and mangled quoted values containing a
# space. e2e_mask_command_json (tests/e2e/lib/mask_command.sh) fixes both
# with a single regex pass over each whole element — see that file for the
# full history and scripts/tests/test-e2e-probes.sh for the locked
# regression covering both bypass shapes.
MASKED_COMMAND_JSON="$(jq -c '.cli.copilot.command' "$E2E_EFFECTIVE_JSON" | e2e_mask_command_json)"

RUN_ID_FIELD="${E2E_RUN_ID:-adhoc}"
OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --arg probe "05-copilot-model-routing" \
  --arg spec "0194" \
  --arg run_id "$RUN_ID_FIELD" \
  --arg observed_at "$OBSERVED_AT" \
  --arg verdict "$VERDICT" \
  --arg reason "$REASON" \
  --arg cli "$E2E_CLI" \
  --arg cli_version "$COPILOT_VERSION" \
  --arg declared_provider "$BYOK_PROVIDER" \
  --arg declared_model "$BYOK_MODEL" \
  --argjson effective_command "$MASKED_COMMAND_JSON" \
  --arg credential_path "$E2E_CREDENTIAL_PATH" \
  --arg surface ".claude/agents/" \
  --arg layout "nested (.claude/agents/<n>/AGENT.md)" \
  --arg upstream_issue "github/copilot-cli#4437" \
  --arg control_nonce_observed "$CONTROL_OBSERVED" \
  --arg control_evidence "$CONTROL_EVIDENCE" \
  --arg control_spawn_observed "$CONTROL_SPAWN_OBSERVED" \
  --arg control_subagent_responded "$CONTROL_SUBAGENT_RESPONDED" \
  --arg control_legtxt_observed "$CONTROL_LEGTXT_OBSERVED" \
  --arg efficacy_model "crewrig-probe-no-such-model" \
  --arg efficacy_nonce_observed "$EFFICACY_OBSERVED" \
  --arg efficacy_evidence "$EFFICACY_EVIDENCE" \
  --arg efficacy_spawn_observed "$EFFICACY_SPAWN_OBSERVED" \
  --arg efficacy_subagent_responded "$EFFICACY_SUBAGENT_RESPONDED" \
  --arg efficacy_legtxt_observed "$EFFICACY_LEGTXT_OBSERVED" \
  --arg bearing_model "sonnet" \
  --arg bearing_nonce_observed "$BEARING_OBSERVED" \
  --arg bearing_evidence "$BEARING_EVIDENCE" \
  --arg bearing_spawn_observed "$BEARING_SPAWN_OBSERVED" \
  --arg bearing_subagent_responded "$BEARING_SUBAGENT_RESPONDED" \
  --arg bearing_legtxt_observed "$BEARING_LEGTXT_OBSERVED" \
  --arg fallback_observed "$FALLBACK_OBSERVED" \
  --arg fallback_evidence "$FALLBACK_EVIDENCE" \
  --arg fallback_spawn_observed "$FALLBACK_SPAWN_OBSERVED" \
  --arg fallback_subagent_responded "$FALLBACK_SUBAGENT_RESPONDED" \
  --arg fallback_legtxt_observed "$FALLBACK_LEGTXT_OBSERVED" \
  '{
    probe: $probe, spec: $spec,
    run_id: $run_id, observed_at: $observed_at,
    verdict: $verdict, reason: (if $reason == "" then null else $reason end),
    cli: $cli, cli_version: $cli_version,
    declared_provider: $declared_provider, declared_model: $declared_model,
    effective_command: $effective_command,
    credential_path: $credential_path,
    surface: $surface, layout: $layout,
    legs: {
      control_no_hint: {model_value: null, nonce_observed: ($control_nonce_observed == "true"), evidence: $control_evidence, spawn_observed: ($control_spawn_observed == "true"), subagent_responded: ($control_subagent_responded == "true"), legtxt_nonce_observed: ($control_legtxt_observed == "true")},
      hint_efficacy: {model_value: $efficacy_model, nonce_observed: ($efficacy_nonce_observed == "true"), evidence: $efficacy_evidence, spawn_observed: ($efficacy_spawn_observed == "true"), subagent_responded: ($efficacy_subagent_responded == "true"), legtxt_nonce_observed: ($efficacy_legtxt_observed == "true")},
      model_bearing: {model_value: $bearing_model, nonce_observed: ($bearing_nonce_observed == "true"), evidence: $bearing_evidence, spawn_observed: ($bearing_spawn_observed == "true"), subagent_responded: ($bearing_subagent_responded == "true"), legtxt_nonce_observed: ($bearing_legtxt_observed == "true")}
    },
    fallback_control: (if $fallback_observed == "" then null else {layout: "~/.copilot/agents/<n>.md", nonce_observed: ($fallback_observed == "true"), evidence: $fallback_evidence, spawn_observed: ($fallback_spawn_observed == "true"), subagent_responded: ($fallback_subagent_responded == "true"), legtxt_nonce_observed: ($fallback_legtxt_observed == "true")} end),
    upstream_issue: $upstream_issue
  }' > "${E2E_REPORT_DIR}/verdict.json"

# --------------------------------------------------------------------------
# TAP subplan.
# --------------------------------------------------------------------------
: > "$SCENARIO_TAP"
printf 'ok 1 - probe A recorded verdict: %s%s\n' "$VERDICT" "${REASON:+ ($REASON)}" >> "$SCENARIO_TAP"
printf '1..1\n' >> "$SCENARIO_TAP"

printf 'VERDICT %s%s — %s/05-copilot-model-routing (report: %s)\n' \
  "$VERDICT" "${REASON:+ [$REASON]}" "$E2E_CLI" "${E2E_REPORT_DIR}/verdict.json"
exit 0
