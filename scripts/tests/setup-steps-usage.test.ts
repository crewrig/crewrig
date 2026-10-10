// setup-steps-usage.test.ts — the `usage-capture` step of Claude Code, Gemini CLI and Copilot CLI
// through the flow (spec 0256 requirement 30). A temporary home and checkout, a fake Spawner and
// `--answer` pre-answers stand in for the machine; the printed lines are asserted to sit, byte for
// byte, inside the stdout of the golden cell the unchanged shell produced, and for Copilot (whose
// hooks file no later shell step rewrites) the written file and its backups are asserted by hash.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Spawner } from "../lib/setup/context.ts";
import type { StepFn } from "../lib/setup/descriptor.ts";
import {
  backupShas,
  goldenShas,
  hashOf,
  HOOK_CLIS,
  hookDescriptor,
  hooksFileOf,
  okSpawn,
  put,
  readGolden,
  rig,
  runHooks,
  seedClaudeSettings,
  useRig,
  type HookCli,
} from "./setup-steps-hooks-fixtures.ts";

useRig();

const STEPS = ["mcp", "usage-capture"] as const;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const CAPTURE = {
  claude: {
    event: "Stop",
    command: 'node "/srv/co/crewrig/hooks/usage-capture.ts" claude-code Stop',
  },
  gemini: {
    event: "AfterModel",
    command: 'node "/srv/co/crewrig/hooks/usage-capture.ts" gemini-cli AfterModel',
  },
} as const;

/** The file as the shell had it: installed = one registered capture command; absent = no capture. */
function seed(cli: HookCli, state: "absent" | "installed"): void {
  if (cli === "copilot") {
    if (state === "installed") {
      const command = 'bash "/opt/old/hooks/usage-capture.sh" copilot-cli sessionEnd';
      put(hooksFileOf(cli), json({ hooks: { sessionEnd: [{ type: "command", command }] } }));
    }
    return;
  }
  if (state === "installed") {
    const { event, command } = CAPTURE[cli];
    put(
      hooksFileOf(cli),
      json({ hooks: { [event]: [{ hooks: [{ type: "command", command }] }] } }),
    );
  } else if (cli === "claude") seedClaudeSettings();
  else put(hooksFileOf(cli), "{}\n");
}

function within(mine: string, cli: HookCli, cell: string): void {
  assert.ok(
    mine.length > 0 && readGolden(cli, cell).includes(mine),
    `not in ${cli}/${cell}:\n${mine}`,
  );
}

/** Copilot: the file (and its backups) the run left hash-equal to the shell's. */
function sameCopilotFiles(cell: string, backups: boolean): void {
  const file = path.join(rig.home, hooksFileOf("copilot"));
  const at = `<HOME>/${hooksFileOf("copilot")}`;
  const wanted = goldenShas("copilot", cell, at);
  assert.deepEqual(fs.existsSync(file) ? [hashOf(file)] : [], wanted);
  const baks = goldenShas("copilot", cell, `${at}.bak.<STAMP>`).sort();
  assert.deepEqual(backups ? backupShas(file) : [], baks);
}

describe("usage-capture: the golden cells", () => {
  for (const cli of HOOK_CLIS) {
    test(`${cli}: absent + yes disclosure, enable, no stderr`, async () => {
      seed(cli, "absent");
      const result = await runHooks(cli, { steps: STEPS, answers: { "usage-capture": "yes" } });
      assert.equal(result.status, 0);
      within(result.out, cli, "usage-capture-absent-yes");
      assert.match(result.out, /\n {2}Usage capture enabled on .+ in <HOME>\//);
      assert.equal(result.err, "");
      if (cli === "copilot") sameCopilotFiles("usage-capture-absent-yes", false);
    });

    test(`${cli}: absent + no registers nothing and says how to enable it`, async () => {
      seed(cli, "absent");
      const result = await runHooks(cli, { steps: STEPS, answers: { "usage-capture": "no" } });
      assert.equal(result.status, 0);
      within(result.out, cli, "usage-capture-absent-no");
      assert.ok(
        result.out.endsWith(
          `Usage capture not enabled (re-run scripts/setup-${cli}-interactive.sh to enable it).\n`,
        ),
      );
      if (cli === "copilot") sameCopilotFiles("usage-capture-absent-no", false);
    });

    test(`${cli}: a cancelled question reads as the empty answer, a decline`, async () => {
      seed(cli, "absent");
      const result = await runHooks(cli, { steps: STEPS, tty: true });
      assert.equal(result.status, 0);
      within(result.out, cli, "usage-capture-absent-no");
    });

    for (const answer of ["keep", "remove"] as const) {
      test(`${cli}: installed + ${answer}`, async () => {
        seed(cli, "installed");
        const result = await runHooks(cli, {
          steps: STEPS,
          answers: { "usage-capture-keep": answer },
        });
        assert.equal(result.status, 0, result.err);
        within(result.out, cli, `usage-capture-installed-${answer}`);
        assert.ok(result.out.includes("Usage capture is registered in <HOME>/"));
        assert.equal(result.err, "");
        if (cli === "copilot") sameCopilotFiles(`usage-capture-installed-${answer}`, true);
      });
    }
  }

  test("installed + a cancelled question keeps (the empty answer is not remove)", async () => {
    seed("claude", "installed");
    const result = await runHooks("claude", { steps: STEPS, tty: true });
    assert.equal(result.status, 0);
    within(result.out, "claude", "usage-capture-installed-keep");
  });
});

describe("usage-capture: failures never abort the run", () => {
  test("an unreadable hooks file skips the step with the two shell lines (Copilot golden)", async () => {
    put(hooksFileOf("copilot"), "not json {\n");
    const result = await runHooks("copilot", { steps: STEPS });
    assert.equal(result.status, 0);
    assert.equal(result.out, "\n");
    const golden = readGolden("copilot", "usage-capture-unreadable-hooks", "stderr.golden");
    assert.ok(golden.includes(result.err));
    assert.match(result.err, /usage-capture step skipped\.\n$/);
  });

  test("below the Node.js floor the apply fails: FAILED line on stderr, the next step still runs", async () => {
    seed("gemini", "absent");
    const below: Spawner = (a) =>
      a[0] === "node" ? { status: 1, stdout: "", stderr: "floor\n" } : okSpawn(a);
    const log: string[] = [];
    const next: StepFn = async () => void log.push("next");
    const result = await runHooks("gemini", {
      steps: [...STEPS, "summary"],
      answers: { "usage-capture": "yes" },
      spawn: below,
      extra: { summary: next },
    });
    assert.equal(result.status, 0);
    assert.ok(result.err.endsWith("  Usage-capture step FAILED — setup continues.\n"));
    assert.deepEqual(log, ["next"]);
  });

  test("the flow state records the detected state and the raw answer", async () => {
    seed("claude", "installed");
    const seen: unknown[] = [];
    const probe: StepFn = async ({ state }) => void seen.push(state.ucState, state.ucAnswer);
    await runHooks("claude", {
      steps: [...STEPS, "summary"],
      answers: { "usage-capture-keep": "remove" },
      extra: { summary: probe },
    });
    assert.deepEqual(seen, ["installed", "remove"]);
  });

  test("channel agy-json delegates to the Antigravity statusline step, not to the settings flow", async () => {
    const base = hookDescriptor("claude", STEPS);
    const agy = {
      ...base,
      cli: "antigravity" as const,
      hooks: { ...base.hooks, channel: "agy-json" as const },
    };
    const answers = { "usage-capture": "no" };
    const result = await runHooks("claude", { steps: STEPS, descriptor: agy, answers });
    assert.equal(result.status, 0);
    assert.ok(!result.out.startsWith("\n"));
    assert.ok(!result.out.includes("Enabling usage capture will:"));
    assert.equal(fs.existsSync(path.join(rig.home, hooksFileOf("claude"))), false);
  });
});
