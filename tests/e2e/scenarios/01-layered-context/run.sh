#!/usr/bin/env bash
# tests/e2e/scenarios/01-layered-context/run.sh
#
# Pillar 1 — Layered context. Verifies that the 00-60 rule files
# deployed under the user's CLI config dir actually steer the CLI's
# answer to a profile-aware probe. The probe asks for the user's
# location (PROFILE.md → `Location: Nantes`) and expects a one-word
# answer matching /[Nn]antes/.
#
# Assertions:
#   1. Side-effect — the CLI wrote /tmp/e2e-output.txt (mounted at /out
#      from the host case dir); host reads it via the bind-mount.
#   2. Structural — the answer file matches /[Nn]antes/ (POSIX ERE).
#   3. LLM-judge — the answer demonstrates awareness of a location
#      field in a profile configuration.
#
# Parity: claude, gemini, copilot. The runner gates each CLI on
# e2e_auth_ready, so unconfigured CLIs are skipped before reaching us.
# A CLI without a recognised one-shot prompt mode is reported as
# exit 78 (skip) with a diagnostic.

set -euo pipefail

: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
: "${E2E_REPORT_DIR:?runner must export E2E_REPORT_DIR}"
: "${E2E_CLI:?runner must export E2E_CLI}"
: "${E2E_IMAGE:?runner must export E2E_IMAGE}"
: "${E2E_EFFECTIVE_JSON:?runner must export E2E_EFFECTIVE_JSON}"
: "${E2E_CREWRIG_E2E_HOME:?runner must export E2E_CREWRIG_E2E_HOME}"
: "${E2E_SCENARIO_DIR:?runner must export E2E_SCENARIO_DIR}"

# shellcheck source=../../lib/assert.sh
source "${E2E_LIB_DIR}/assert.sh"
# shellcheck source=../../lib/structural.sh
source "${E2E_LIB_DIR}/structural.sh"
# shellcheck source=../../lib/llm_judge.sh
source "${E2E_LIB_DIR}/llm_judge.sh"

SCENARIO_TAP="${E2E_REPORT_DIR}/scenario.tap"
: > "$SCENARIO_TAP"
SUB_INDEX=0
SUB_OK=0
SUB_NOK=0

sub_emit() {
  # sub_emit ok|not_ok <desc>
  SUB_INDEX=$((SUB_INDEX + 1))
  case "$1" in
    ok)     printf 'ok %d - %s\n'     "$SUB_INDEX" "$2" >> "$SCENARIO_TAP"; SUB_OK=$((SUB_OK + 1)) ;;
    not_ok) printf 'not ok %d - %s\n' "$SUB_INDEX" "$2" >> "$SCENARIO_TAP"; SUB_NOK=$((SUB_NOK + 1)) ;;
  esac
}

scenario_skip() {
  printf '1..0 # SKIP %s\n' "$1" > "$SCENARIO_TAP"
  printf 'SKIP - %s/01-layered-context: %s\n' "$E2E_CLI" "$1"
  exit 78
}

# --------------------------------------------------------------------------
# Per-CLI one-shot probe mode. The base command comes from the effective
# config (E2E_EFFECTIVE_JSON) so local.toml overrides (e.g. ollama wrapper)
# are respected automatically. -p is the shared non-interactive flag.
# Copilot's -p support is undocumented; we attempt it as best effort.
# --------------------------------------------------------------------------
case "$E2E_CLI" in
  claude|gemini|copilot) ;;
  *) scenario_skip "unknown CLI '${E2E_CLI}'" ;;
esac

mapfile -t _cli_cmd < <(jq -r --arg c "$E2E_CLI" '.cli[$c].command[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_mounts < <(jq -r --arg c "$E2E_CLI" '.cli[$c].mounts // [] | .[]' "$E2E_EFFECTIVE_JSON")
mapfile -t _cli_env_keys < <(jq -r --arg c "$E2E_CLI" '.cli[$c].env_keys // [] | .[]' "$E2E_EFFECTIVE_JSON")

expand_mount() { printf '%s' "${1/\$\{CREWRIG_E2E_HOME\}/${E2E_CREWRIG_E2E_HOME}}"; }

probe_argv=("${_cli_cmd[@]}" -p)

PROBE_PROMPT="$(cat "${E2E_SCENARIO_DIR}/probe.prompt")"
EXPECTED_RE="$(head -n1 "${E2E_SCENARIO_DIR}/expected.regex")"

# Rules dir — written by the matching auth flow. Soft-skip if absent so
# this scenario can run on a clean machine without false failures.
rules_dir="${E2E_CREWRIG_E2E_HOME}/${E2E_CLI}"
if [[ ! -d "$rules_dir" ]]; then
  scenario_skip "no auth/rules dir at ${rules_dir} (run \`task e2e:auth:${E2E_CLI}\`)"
fi

# Container-side rules mount target.
case "$E2E_CLI" in
  claude)  rules_mount_target="/home/agent/.claude" ;;
  gemini)  rules_mount_target="/home/agent/.gemini" ;;
  copilot) rules_mount_target="/home/agent/.copilot" ;;
esac

# Host out-dir bound into the container at /out for the answer file.
host_out="${E2E_REPORT_DIR}/out"
mkdir -p "$host_out"

container_name="crewrig-e2e-01-${E2E_CLI}-${E2E_RUN_ID:-adhoc}"

# Copilot writes session-state/ into its config dir at runtime; mount rw
# so those writes succeed. Claude/Gemini do not need write access.
case "$E2E_CLI" in
  copilot) rules_mount_mode="rw" ;;
  *)       rules_mount_mode="ro" ;;
esac

docker_argv=(
  docker run --rm --name "$container_name"
  -v "${rules_dir}:${rules_mount_target}:${rules_mount_mode}"
  -v "${host_out}:/out"
)
# Mounts from effective config (e.g. Ollama keypair dir from local.toml).
for _m in "${_cli_mounts[@]}"; do
  docker_argv+=(-v "$(expand_mount "$_m")")
done
# Env keys from effective config (covers PAT, API key, OLLAMA_HOST, etc.).
for _k in "${_cli_env_keys[@]}"; do
  docker_argv+=(-e "$_k")
done
docker_argv+=(
  -e "E2E_PROBE_PROMPT=${PROBE_PROMPT}"
  "$E2E_IMAGE"
  "${probe_argv[@]}" "$PROBE_PROMPT"
)

{
  printf 'image: %s\n' "$E2E_IMAGE"
  printf 'argv:'
  for a in "${docker_argv[@]}"; do printf ' %q' "$a"; done
  printf '\n'
} > "${E2E_REPORT_DIR}/invocation.txt"

if ! "${docker_argv[@]}" \
      >"${E2E_REPORT_DIR}/probe.stdout" \
      2>"${E2E_REPORT_DIR}/probe.stderr"
then
  sub_emit not_ok "docker run probe exited non-zero"
fi

# The probe.prompt instructs the CLI to write /out/answer.txt. Fall back
# to capturing stdout so the structural / judge assertions still have
# something to bite on when the model ignores the side-effect ask.
answer_file="${host_out}/answer.txt"
if [[ ! -s "$answer_file" ]]; then
  cp "${E2E_REPORT_DIR}/probe.stdout" "$answer_file" 2>/dev/null || true
fi

# 1. Side-effect — answer file exists and is non-empty.
if assert_file_exists "$answer_file"; then
  sub_emit ok "side-effect: answer file present"
else
  sub_emit not_ok "side-effect: answer file missing"
fi

# 2. Structural — regex match on the answer.
if assert_stdout_matches "$EXPECTED_RE" "$answer_file"; then
  sub_emit ok "structural: answer matches /${EXPECTED_RE}/"
else
  sub_emit not_ok "structural: answer does not match /${EXPECTED_RE}/"
fi

# 3. LLM-judge — semantic check on the answer.
if llm_judge \
     "${E2E_SCENARIO_DIR}/probe.prompt" \
     "$answer_file" \
     "$(cat "${E2E_SCENARIO_DIR}/judge-criterion.txt")" \
     >>"${E2E_REPORT_DIR}/judge.log" 2>&1
then
  sub_emit ok "llm-judge: profile-awareness criterion met"
else
  sub_emit not_ok "llm-judge: profile-awareness criterion not met"
fi

# Subtap plan line.
printf '1..%d\n' "$SUB_INDEX" >> "$SCENARIO_TAP"

# Stdout summary — the runner already prints the top-level TAP line.
if (( SUB_NOK > 0 )); then
  printf '%d/%d FAIL — %s/01-layered-context\n' "$SUB_NOK" "$SUB_INDEX" "$E2E_CLI"
  exit 1
fi
printf '%d/%d OK — %s/01-layered-context\n' "$SUB_OK" "$SUB_INDEX" "$E2E_CLI"
exit 0
