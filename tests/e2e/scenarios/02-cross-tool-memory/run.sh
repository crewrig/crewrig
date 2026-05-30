#!/usr/bin/env bash
# tests/e2e/scenarios/02-cross-tool-memory/run.sh
#
# Pillar 2 — Cross-tool memory. Spins up a MemPalace sidecar (volume
# unique per E2E_RUN_ID), writes a [TASK:ongoing] drawer from one
# container, reads it back from a second container with a different
# CLI identity, and asserts on the search output via the assertion
# libraries on the host.
#
# Per-scenario invocation model — the runner loops over CLIs in
# `applies_to`. This scenario uses the per-loop CLI as the WRITER and
# always uses gemini as the READER (the second leg in the matrix
# `[claude, gemini]` exercises the swap). The MemPalace sidecar lives
# only for the duration of this scenario run; teardown happens in the
# EXIT trap.
#
# Parity: claude, gemini. Copilot is recorded as a parity gap in
# docs/cli-matrix.md — empirical evidence: no MemPalace MCP wiring
# nor mempalace CLI is shipped in the crewrig/e2e-copilot:latest
# image (see docker/e2e/copilot.Dockerfile — only Node + GH CLI).
#
# Writer mechanism — the `mempalace` shell CLI has NO `add-drawer`
# sub-command (see issue #155); the write path is `tool_add_drawer`
# from `mempalace.mcp_server`, invoked directly via the image's
# pipx-managed venv interpreter. This is the carve-out documented in
# `~/.claude/rules/60-tools.md` (Python-direct invocation when MCP
# lifecycle is overkill — here the writer container is one-shot and
# throwaway). The drawer content is piped via stdin so the bash
# variable carrying newlines, brackets, and quotes never has to be
# re-quoted into the python source.
#
# Expected stderr noise — on first run the embedding model (~79 MB)
# downloads through chromadb/onnxruntime, emitting ~30 lines of
# progress + onnxruntime warnings to `write.stderr`. The structural
# assertions below match stdout only; the stderr file is informational.

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
  printf 'SKIP - %s/02-cross-tool-memory: %s\n' "$E2E_CLI" "$1"
  exit 78
}

# --------------------------------------------------------------------------
# Sidecar lifecycle — unique volume per run, torn down on EXIT.
# --------------------------------------------------------------------------
VOLUME="crewrig-e2e-mem-${E2E_RUN_ID}-${E2E_CLI}"
SIDECAR="crewrig-e2e-mem-${E2E_RUN_ID}-${E2E_CLI}-sidecar"
MEMPALACE_IMAGE="crewrig/e2e-mempalace:latest"

cleanup() {
  docker rm -f "$SIDECAR" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker volume create "$VOLUME" >/dev/null 2>&1; then
  scenario_skip "could not create docker volume ${VOLUME}"
fi

# Start the sidecar detached — it just holds the volume open. Writes
# and reads happen via short-lived containers below sharing the same
# volume mount at /home/agent/.mempalace.
if ! docker run -d --rm --name "$SIDECAR" \
      -v "${VOLUME}:/home/agent/.mempalace" \
      "$MEMPALACE_IMAGE" sleep 600 >/dev/null 2>&1
then
  scenario_skip "could not start sidecar ${SIDECAR} (image ${MEMPALACE_IMAGE} missing?)"
fi

# --------------------------------------------------------------------------
# Step 1 — WRITER. Use a throwaway mempalace container as the writer
# regardless of E2E_CLI, because the CLI images (claude/gemini) do not
# embed the mempalace binary. The CLI identity is encoded via the
# writer_agent field, not the executing process — which is the property
# under test (drawer provenance crossing CLI identities).
# --------------------------------------------------------------------------
writer_agent_id="${E2E_CLI}-writer"
write_content=$'[TASK:ongoing] e2e-02-cross-tool | cross-tool handoff probe\n\nwriter_agent: '"$writer_agent_id"$'\nhandoff_key: e2e-02-cross-tool\nvisible_to: ["*"]\nstatus: written by container A\nnext: container B should read this back\n'

MEMPALACE_VENV_PY="/home/agent/.local/pipx/venvs/mempalace/bin/python"

if ! docker run --rm -i \
      -e "WRITER_AGENT_ID=${writer_agent_id}" \
      -v "${VOLUME}:/home/agent/.mempalace" \
      "$MEMPALACE_IMAGE" \
      "$MEMPALACE_VENV_PY" -c '
import os, sys
# mempalace.mcp_server swaps sys.stdout at import time to protect its
# JSON-RPC channel; dup fd 1 BEFORE importing so we can still write
# RESULT: to the real stdout (see ~/.claude/rules/60-tools.md → "Stdout hazard").
_REAL_STDOUT = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
os.environ["MEMPALACE_PALACE_DIR"] = "/home/agent/.mempalace/palace"
from mempalace.mcp_server import tool_add_drawer
content = sys.stdin.read()
result = tool_add_drawer(
    wing="e2e-cross-tool",
    room="task-handoff",
    content=content,
    added_by=os.environ.get("WRITER_AGENT_ID", "e2e-test"),
)
print("RESULT:", result, file=_REAL_STDOUT, flush=True)
sys.exit(0 if result.get("success") else 1)
' \
      >"${E2E_REPORT_DIR}/write.stdout" \
      2>"${E2E_REPORT_DIR}/write.stderr" \
      <<<"$write_content"
then
  sub_emit not_ok "writer: tool_add_drawer (python-direct) exited non-zero"
else
  sub_emit ok "writer: drawer added to wing=e2e-cross-tool"
fi

# --------------------------------------------------------------------------
# Step 2 — READER. Run a second container with a distinct identity and
# read the drawer back. The container shares the same volume; the search
# output is captured on the host.
# --------------------------------------------------------------------------
reader_out="${E2E_REPORT_DIR}/read.stdout"
if ! docker run --rm \
      -v "${VOLUME}:/home/agent/.mempalace" \
      "$MEMPALACE_IMAGE" \
      mempalace search "[TASK:ongoing]" \
        --wing e2e-cross-tool \
        --room task-handoff \
        --results 5 \
      >"$reader_out" \
      2>"${E2E_REPORT_DIR}/read.stderr"
then
  sub_emit not_ok "reader: mempalace search exited non-zero"
else
  sub_emit ok "reader: search returned successfully"
fi

# --------------------------------------------------------------------------
# Assertions on the read-back output.
# --------------------------------------------------------------------------
# Side-effect — the output file exists and is non-empty.
if assert_file_exists "$reader_out"; then
  sub_emit ok "side-effect: reader stdout captured"
else
  sub_emit not_ok "side-effect: reader stdout missing"
fi

# Structural — the search output mentions the [TASK:ongoing] marker.
if assert_stdout_matches '\[TASK:ongoing\]' "$reader_out"; then
  sub_emit ok "structural: [TASK:ongoing] marker present"
else
  sub_emit not_ok "structural: [TASK:ongoing] marker absent"
fi

# Structural — writer_agent field is present (proves the drawer round-tripped).
if assert_stdout_matches 'writer_agent' "$reader_out"; then
  sub_emit ok "structural: writer_agent field present in read-back"
else
  sub_emit not_ok "structural: writer_agent field absent in read-back"
fi

printf '1..%d\n' "$SUB_INDEX" >> "$SCENARIO_TAP"

if (( SUB_NOK > 0 )); then
  printf '%d/%d FAIL — %s/02-cross-tool-memory\n' "$SUB_NOK" "$SUB_INDEX" "$E2E_CLI"
  exit 1
fi
printf 'OK — %s/02-cross-tool-memory (%d assertions)\n' "$E2E_CLI" "$SUB_INDEX"
exit 0
