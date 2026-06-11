#!/usr/bin/env bash
# tests/e2e/lib/test-gemini-headless.sh — standalone smoke test for the
# post-#148 / post-#149 headless contract.
#
# History: this script was originally authored for issue #139 to lock in
# the MODE A (BidiGenerateContent socket holds the container open) and
# MODE B (empty settings-headless.json → exit 41) failure modes. Both
# workarounds are gone:
#   - #148 replaced the `timeout 120 gemini` wrapper with a writable-home
#     bootstrap chain (see tests/e2e/defaults.toml [cli.gemini].command).
#   - #149 dropped GOOGLE_CLOUD_ACCESS_TOKEN / GOOGLE_GENAI_USE_GCA and
#     the e2e_gemini_refresh_access_token helper.
# The MODE B settings-headless.json file and the assertions that depended
# on it have been removed accordingly.
#
# What this test asserts now (Strategy B, per issue #153):
#
#   `gemini -p` exits within 60 s and produces a non-empty answer
#   (either /out/answer.txt or stdout) when invoked through the
#   post-#148 contract — a :ro creds-bundle mount plus a container-side
#   `cp -a` into a writable $HOME/.gemini, then `exec gemini`.
#
# The stdout fallback mirrors tests/e2e/scenarios/01-layered-context/run.sh
# (search for `cp "${E2E_REPORT_DIR}/probe.stdout" "$answer_file"`):
# whether the model honors the "write to /out/answer.txt" side-effect
# ask is a model-behavior concern, not a property of the headless
# contract. The contract we lock in here is: the container exits and
# the CLI produces output.
#
# Tests 2 and 3 from the original script (auth-failure message present;
# answer.txt absent under MODE B) are gone — they asserted against a
# code path that no longer exists. End-to-end layered-context coverage
# lives in tests/e2e/scenarios/01-layered-context/run.sh; this smoke
# test deliberately exercises only the headless-exit-and-answer-file
# property, with no rules mount and no LLM judge, so it can fail fast
# on environments where the bundle is broken without paying the cost
# of a full scenario.
#
# The bootstrap shell below mirrors the structure of
# [cli.gemini].command in tests/e2e/defaults.toml — minus the rules
# manifest patch, which is irrelevant here. If that contract changes,
# update defaults.toml first, then mirror the change here.
#
# Run standalone: bash tests/e2e/lib/test-gemini-headless.sh
# TAP output: ok N - ... / not ok N - ...
# Skip codes: 78 (preconditions missing — docker / image / creds bundle).

set -uo pipefail

GEMINI_IMAGE="${GEMINI_IMAGE:-crewrig/e2e-gemini:latest}"
GEMINI_DIR="${CREWRIG_E2E_HOME:-$HOME/.crewrig-e2e}/gemini"

TAP_INDEX=0
TAP_NOK=0

emit() {
  TAP_INDEX=$((TAP_INDEX + 1))
  case "$1" in
    ok)     printf 'ok %d - %s\n'     "$TAP_INDEX" "$2" ;;
    not_ok) printf 'not ok %d - %s\n' "$TAP_INDEX" "$2"; TAP_NOK=$((TAP_NOK + 1)) ;;
  esac
}

# --------------------------------------------------------------------------
# Preconditions — skip (78) cleanly when the local env isn't set up.
# --------------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  printf '1..0 # SKIP docker not found on PATH\n'
  exit 78
fi

if ! docker image inspect "$GEMINI_IMAGE" >/dev/null 2>&1; then
  printf '1..0 # SKIP image %s not present locally\n' "$GEMINI_IMAGE"
  exit 78
fi

if [[ ! -f "${GEMINI_DIR}/settings.json" || ! -f "${GEMINI_DIR}/oauth_creds.json" ]]; then
  printf '1..0 # SKIP gemini auth bundle not found at %s (run `task e2e:auth:gemini`)\n' "$GEMINI_DIR"
  exit 78
fi

# --------------------------------------------------------------------------
# Test 1 — headless smoke: post-#148 contract produces a non-empty
# /out/answer.txt within the bounded window.
# --------------------------------------------------------------------------

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Bootstrap mirrors tests/e2e/defaults.toml [cli.gemini].command:
# copy the :ro creds bundle into a writable $HOME/.gemini, fix ownership
# to `agent` (best-effort, the image runs as agent already), then
# exec gemini. No rules manifest patch — see header comment.
BOOTSTRAP='set -e; D=/home/agent/.gemini; mkdir -p $D && cp -a /run/gemini-creds/. $D/ && chown -R agent:agent $D 2>/dev/null || true; exec gemini "$@"'

PROMPT='Write the single word READY to /out/answer.txt and print it.'

docker run --rm \
  --stop-timeout 5 \
  -v "${GEMINI_DIR}:/run/gemini-creds:ro" \
  -v "${WORK_DIR}:/out" \
  --entrypoint bash \
  "$GEMINI_IMAGE" \
  -c "$BOOTSTRAP" sh -p "$PROMPT" \
  >"${WORK_DIR}/stdout.txt" 2>"${WORK_DIR}/stderr.txt" &
docker_pid=$!

# Bounded wait: 60 s is generous for a single-turn response on a warm
# bundle. If the container holds past this, kill the docker client and
# fall back to the answer-file check — same shape the scenario runner
# uses (exit 124 tolerated when the side-effect landed).
SECONDS=0
while kill -0 "$docker_pid" 2>/dev/null; do
  if (( SECONDS >= 60 )); then
    kill "$docker_pid" 2>/dev/null || true
    break
  fi
  sleep 1
done
wait "$docker_pid" 2>/dev/null
actual_exit=$?

# Exit semantics: 0 is the nominal happy path; 124 is tolerated to
# mirror the scenario runner's safety belt for the BidiGenerateContent
# socket edge-case (see tests/e2e/scenarios/01-layered-context/run.sh
# around the `_probe_rc -eq 124` branch). Any other exit fails.
case "$actual_exit" in
  0|124) exit_ok=1 ;;
  *)     exit_ok=0 ;;
esac

if [[ -s "${WORK_DIR}/answer.txt" ]]; then
  answer_source="/out/answer.txt"
  has_answer=1
elif [[ -s "${WORK_DIR}/stdout.txt" ]]; then
  answer_source="stdout (fallback — model did not honour the side-effect ask)"
  has_answer=1
else
  answer_source="none"
  has_answer=0
fi

if (( exit_ok && has_answer )); then
  emit ok "headless: gemini -p exited ${actual_exit} with non-empty answer from ${answer_source}"
else
  emit not_ok "headless: exit=${actual_exit} answer=${answer_source}; stderr: $(head -c 200 "${WORK_DIR}/stderr.txt" 2>/dev/null)"
fi

printf '1..%d\n' "$TAP_INDEX"

if (( TAP_NOK > 0 )); then
  exit 1
fi
exit 0
