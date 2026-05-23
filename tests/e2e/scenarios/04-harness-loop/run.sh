#!/usr/bin/env bash
# tests/e2e/scenarios/04-harness-loop/run.sh
#
# Pillar 4 — Harness loop. Round-trips a friction tag from
# `harness-report` → MemPalace → `harness-curator`. The full interactive
# loop (skill invocation through the CLI) is hard to drive
# non-interactively, so this scenario uses the documented simulation
# path from AGENTS.md: write a drawer directly to `wing=harness-friction`
# (the same lane the skill writes to) and then verify a curator-style
# search finds it.
#
# Parity:
#   - claude/gemini: simulated path (drawer write + search), shared
#     MemPalace sidecar.
#   - copilot: same simulated path. The full claude-only interactive
#     leg is recorded as a parity gap in docs/cli-matrix.md until the
#     copilot image gains a programmatic skill invocation surface.

set -euo pipefail

: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
: "${E2E_REPORT_DIR:?runner must export E2E_REPORT_DIR}"
: "${E2E_CLI:?runner must export E2E_CLI}"
: "${E2E_RUN_ID:?runner must export E2E_RUN_ID}"
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
SUB_NOK=0

sub_emit() {
  SUB_INDEX=$((SUB_INDEX + 1))
  case "$1" in
    ok)     printf 'ok %d - %s\n'     "$SUB_INDEX" "$2" >> "$SCENARIO_TAP" ;;
    not_ok) printf 'not ok %d - %s\n' "$SUB_INDEX" "$2" >> "$SCENARIO_TAP"; SUB_NOK=$((SUB_NOK + 1)) ;;
  esac
}

scenario_skip() {
  printf '1..0 # SKIP %s\n' "$1" > "$SCENARIO_TAP"
  printf 'SKIP - %s/04-harness-loop: %s\n' "$E2E_CLI" "$1"
  exit 78
}

VOLUME="crewrig-e2e-mem-${E2E_RUN_ID}-${E2E_CLI}-harness"
SIDECAR="crewrig-e2e-mem-${E2E_RUN_ID}-${E2E_CLI}-harness-sidecar"
MEMPALACE_IMAGE="crewrig/e2e-mempalace:latest"

cleanup() {
  docker rm -f "$SIDECAR" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker volume create "$VOLUME" >/dev/null 2>&1; then
  scenario_skip "could not create docker volume ${VOLUME}"
fi
if ! docker run -d --rm --name "$SIDECAR" \
      -v "${VOLUME}:/home/agent/.mempalace" \
      "$MEMPALACE_IMAGE" sleep 600 >/dev/null 2>&1
then
  scenario_skip "could not start sidecar (image ${MEMPALACE_IMAGE} missing?)"
fi

# --------------------------------------------------------------------------
# Step 1 — harness-report simulation. Write a friction drawer to the
# global harness-friction wing. The drawer content is drawn from
# friction.prompt so the LLM-judge has the same input under test.
# --------------------------------------------------------------------------
friction_body="$(cat "${E2E_SCENARIO_DIR}/friction.prompt")"
friction_content=$'[FRICTION] e2e-04-build-version-drop | silent drop of metadata.provenance.version\n\nwriter_agent: '"${E2E_CLI}-harness-report"$'\ncomponent: scripts/build-components.sh\nvisible_to: ["*"]\nsymptom: build exits 0 even though metadata.provenance.version was dropped on rename\nexpected: explicit "version field missing" diagnostic; non-zero exit\n\n---\n'"$friction_body"

if ! docker run --rm \
      -v "${VOLUME}:/home/agent/.mempalace" \
      "$MEMPALACE_IMAGE" \
      mempalace add-drawer \
        --wing harness-friction \
        --room frictions \
        --content "$friction_content" \
      >"${E2E_REPORT_DIR}/report.stdout" \
      2>"${E2E_REPORT_DIR}/report.stderr"
then
  sub_emit not_ok "harness-report: drawer write exited non-zero"
else
  sub_emit ok "harness-report: friction drawer written"
fi

# --------------------------------------------------------------------------
# Step 2 — harness-curator simulation. Search the wing for the friction
# the report step just wrote. Real curator additionally clusters and
# files an issue; the cluster + file steps depend on a live GitHub
# token under the test account and are deferred to a separate scenario
# in a later epic.
# --------------------------------------------------------------------------
curator_out="${E2E_REPORT_DIR}/curator.stdout"
if ! docker run --rm \
      -v "${VOLUME}:/home/agent/.mempalace" \
      "$MEMPALACE_IMAGE" \
      mempalace search "[FRICTION]" \
        --wing harness-friction \
        --room frictions \
        --results 5 \
      >"$curator_out" \
      2>"${E2E_REPORT_DIR}/curator.stderr"
then
  sub_emit not_ok "harness-curator: search exited non-zero"
else
  sub_emit ok "harness-curator: search returned"
fi

# Side-effect — curator output captured.
if assert_file_exists "$curator_out"; then
  sub_emit ok "side-effect: curator stdout captured"
else
  sub_emit not_ok "side-effect: curator stdout missing"
fi

# Structural — the friction marker is in the search output.
if assert_stdout_matches '\[FRICTION\]' "$curator_out"; then
  sub_emit ok "structural: [FRICTION] marker present in curator output"
else
  sub_emit not_ok "structural: [FRICTION] marker absent in curator output"
fi

# LLM-judge — the friction body is coherent.
judge_subject="${E2E_REPORT_DIR}/judge-subject.txt"
printf '%s\n' "$friction_body" > "$judge_subject"
if llm_judge \
     "${E2E_SCENARIO_DIR}/friction.prompt" \
     "$judge_subject" \
     "$(cat "${E2E_SCENARIO_DIR}/judge-criterion.txt")" \
     >>"${E2E_REPORT_DIR}/judge.log" 2>&1
then
  sub_emit ok "llm-judge: friction summary coherent"
else
  sub_emit not_ok "llm-judge: friction summary incoherent"
fi

printf '1..%d\n' "$SUB_INDEX" >> "$SCENARIO_TAP"

if (( SUB_NOK > 0 )); then
  printf '%d/%d FAIL — %s/04-harness-loop\n' "$SUB_NOK" "$SUB_INDEX" "$E2E_CLI"
  exit 1
fi
printf 'OK — %s/04-harness-loop (%d assertions)\n' "$E2E_CLI" "$SUB_INDEX"
exit 0
