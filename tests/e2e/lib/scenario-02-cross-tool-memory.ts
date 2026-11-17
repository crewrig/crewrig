// scenario-02-cross-tool-memory.ts — scenario 02 (pillar 2, cross-tool memory): the writer container
// adds a [TASK:ongoing] drawer through the image's python, the reader container searches it back.
// Twin of tests/e2e/scenarios/02-cross-tool-memory/run.sh.

import { assertFileExists } from "./assert.ts";
import {
  MEMPALACE_IMAGE,
  runSidecarScenario,
  type SidecarScenario,
} from "./scenario-02-sidecar.ts";
import type { Env } from "./scenario.ts";
import { assertStdoutMatches } from "./structural.ts";

const VENV_PY = "/home/agent/.local/pipx/venvs/mempalace/bin/python";

const WRITER_SOURCE = `
import os, sys
# mempalace.mcp_server swaps sys.stdout at import time to protect its
# JSON-RPC channel; dup fd 1 BEFORE importing so we can still write
# RESULT: to the real stdout (see ~/.claude/rules/60-memory.md → "Stdout hazard").
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
`;

async function body(s: SidecarScenario): Promise<void> {
  const { ctx } = s;
  const mount = `${s.volume}:/home/agent/.mempalace`;
  const writerAgent = `${ctx.cli}-writer`;
  const content =
    `[TASK:ongoing] e2e-02-cross-tool | cross-tool handoff probe\n\nwriter_agent: ${writerAgent}\n` +
    `handoff_key: e2e-02-cross-tool\nvisible_to: ["*"]\nstatus: written by container A\n` +
    `next: container B should read this back\n`;

  const wrote = s.docker(
    [
      "run",
      "--rm",
      "-i",
      "-e",
      `WRITER_AGENT_ID=${writerAgent}`,
      "-v",
      mount,
      MEMPALACE_IMAGE,
      VENV_PY,
      "-c",
      WRITER_SOURCE,
    ],
    {
      stdoutFile: `${ctx.reportDir}/write.stdout`,
      stderrFile: `${ctx.reportDir}/write.stderr`,
      input: `${content}\n`,
    },
  );
  if (wrote !== 0) s.emit("not_ok", "writer: tool_add_drawer (python-direct) exited non-zero");
  else s.emit("ok", "writer: drawer added to wing=e2e-cross-tool");

  const readerOut = `${ctx.reportDir}/read.stdout`;
  const read = s.docker(
    [
      "run",
      "--rm",
      "-v",
      mount,
      MEMPALACE_IMAGE,
      "mempalace",
      "search",
      "[TASK:ongoing]",
      "--wing",
      "e2e-cross-tool",
      "--room",
      "task-handoff",
      "--results",
      "5",
    ],
    { stdoutFile: readerOut, stderrFile: `${ctx.reportDir}/read.stderr` },
  );
  if (read !== 0) s.emit("not_ok", "reader: mempalace search exited non-zero");
  else s.emit("ok", "reader: search returned successfully");

  const o = { cwd: ctx.scenarioDir, env: s.toolEnv };
  s.check(
    assertFileExists(readerOut, o),
    "side-effect: reader stdout captured",
    "side-effect: reader stdout missing",
  );
  s.check(
    assertStdoutMatches("\\[TASK:ongoing\\]", readerOut, "", o),
    "structural: [TASK:ongoing] marker present",
    "structural: [TASK:ongoing] marker absent",
  );
  s.check(
    assertStdoutMatches("writer_agent", readerOut, "", o),
    "structural: writer_agent field present in read-back",
    "structural: writer_agent field absent in read-back",
  );
}

export function runScenario02(env: Env) {
  return runSidecarScenario("02-cross-tool-memory/run.ts", "02-cross-tool-memory", "", env, body);
}
