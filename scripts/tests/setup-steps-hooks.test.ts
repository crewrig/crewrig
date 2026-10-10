// setup-steps-hooks.test.ts — the `hooks-rewrite-installed` and `session-recording` steps of
// Claude Code, Gemini CLI and Copilot CLI through the flow (spec 0256 requirements 29-31). A
// temporary home and checkout, a fake Spawner and `--answer` pre-answers stand in for the machine;
// the printed lines are asserted to sit, byte for byte, inside the stdout of the golden cell the
// unchanged shell produced (the golden holds the whole run; the steps print one stretch of it).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { POSIX_ONLY } from "./setup-flow-fixtures.ts";
import type { Spawner } from "../lib/setup/context.ts";
import type { StepFn } from "../lib/setup/descriptor.ts";
import {
  backupShas,
  goldenShas,
  hookDescriptor,
  hashOf,
  HOOK_CLIS,
  hooksFileOf,
  okSpawn,
  put,
  readGolden,
  rig,
  runHooks,
  seedClaudeSettings,
  unusedCopyOf,
  useRig,
  type HookCli,
} from "./setup-steps-hooks-fixtures.ts";

useRig();

const STEPS = ["mcp", "hooks-rewrite-installed", "session-recording"] as const;
const YES = { transcripts: "yes", "transcripts-confirm": "yes" };
/** The golden cell each (cli, scenario) is pinned by; Copilot's names differ for two of them. */
const CELL = {
  no: (_cli: HookCli) => "transcript-optin-no",
  yes: (_cli: HookCli) => "transcript-optin-yes",
  declined: (cli: HookCli) =>
    cli === "copilot" ? "transcript-optin-yes-declined" : "transcript-optin-apply-declined",
  cancelled: (cli: HookCli) =>
    cli === "copilot" ? "cancelled-transcripts-prompt" : "cancelled-prompt-guarded",
};

/** The home as the shell has left it by the time the hook steps run. */
function seed(cli: HookCli): void {
  if (cli === "claude") seedClaudeSettings();
  if (cli === "gemini") put(".gemini/settings.json", "{}\n");
}

function within(mine: string, cli: HookCli, cell: string): void {
  const golden = readGolden(cli, cell);
  assert.ok(mine.length > 0 && golden.includes(mine), `not in golden ${cli}/${cell}:\n${mine}`);
}

describe("session-recording: the golden cells", { skip: POSIX_ONLY }, () => {
  for (const cli of HOOK_CLIS) {
    test(`${cli}: answer no prints the disabled line and writes nothing`, async () => {
      seed(cli);
      const before = fs.existsSync(path.join(rig.home, hooksFileOf(cli)));
      const result = await runHooks(cli, { steps: STEPS, answers: { transcripts: "no" } });
      assert.equal(result.status, 0);
      within(result.out, cli, CELL.no(cli));
      assert.match(result.out, /Session recording disabled/);
      assert.equal(fs.existsSync(path.join(rig.home, hooksFileOf(cli))), before);
      assert.equal(result.err, "");
    });

    test(`${cli}: yes then declined confirmation prints the cancellation and writes nothing`, async () => {
      seed(cli);
      const answers = { transcripts: "yes", "transcripts-confirm": "no" };
      const result = await runHooks(cli, { steps: STEPS, answers, python: true });
      assert.equal(result.status, 0);
      within(result.out, cli, CELL.declined(cli));
      assert.match(result.out, /Transcript activation canceled/);
      assert.deepEqual(backupShas(path.join(rig.home, hooksFileOf(cli))), []);
    });

    test(`${cli}: a cancelled question is a decline (class decline), status 0`, async () => {
      seed(cli);
      const result = await runHooks(cli, { steps: STEPS, tty: true });
      assert.equal(result.status, 0);
      within(result.out, cli, CELL.cancelled(cli));
      assert.match(result.out, /Session recording disabled/);
    });

    test(`${cli}: yes then yes merges, reports, and records the wiring in the flow state`, async () => {
      seed(cli);
      let seen: unknown[] = [];
      const probe: StepFn = async ({ state }) => {
        seen = [state.srTranscriptWired, state.srAllHooksDisabled];
      };
      const result = await runHooks(cli, {
        steps: [...STEPS, "summary"],
        answers: YES,
        python: true,
        extra: { summary: probe },
      });
      assert.equal(result.status, 0, result.err);
      within(result.out, cli, CELL.yes(cli));
      assert.deepEqual(seen, [true, false]);
      const file = path.join(rig.home, hooksFileOf(cli));
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      const text = fs.readFileSync(file, "utf8");
      assert.ok(text.includes(`${rig.repo}/hooks/mempalace-transcript.ts`));
      assert.ok(text.includes(`${rig.repo}/hooks/worktree-git-guard.ts`));
      if (cli === "copilot") {
        // No later writer touches this file in the shell run: the golden's hash is deterministic.
        const wanted = goldenShas(cli, CELL.yes(cli), `<HOME>/${hooksFileOf(cli)}`);
        assert.deepEqual([hashOf(file)], wanted);
      }
    });
  }

  test("claude: the env patch carries the consent and the interpreter (golden line and file)", async () => {
    seedClaudeSettings();
    const result = await runHooks("claude", { steps: STEPS, answers: YES, python: true });
    const patch = `{"MEMPALACE_TRANSCRIPT_ENABLED":"1","MEMPALACE_PYTHON":"<HOME>/.local/share/pipx/venvs/mempalace/bin/python"}`;
    assert.ok(result.out.includes(`  env patched: ${patch}`));
    assert.ok(
      result.out.includes(
        `  4. Set env.MEMPALACE_PYTHON="<HOME>/.local/share/pipx/venvs/mempalace/bin/python" in <HOME>/.claude/settings.json`,
      ),
    );
    const env = (
      JSON.parse(fs.readFileSync(path.join(rig.home, ".claude/settings.json"), "utf8")) as {
        env: Record<string, string>;
      }
    ).env;
    assert.equal(env["MEMPALACE_TRANSCRIPT_ENABLED"], "1");
    assert.equal(
      env["MEMPALACE_PYTHON"],
      path.join(rig.home, ".local/share/pipx/venvs/mempalace/bin/python"),
    );
  });

  test("claude without an interpreter: the disclosure has three items and the patch only the consent", async () => {
    seedClaudeSettings();
    const result = await runHooks("claude", { steps: STEPS, answers: YES });
    assert.ok(!result.out.includes("  4. Set env.MEMPALACE_PYTHON"));
    assert.ok(
      result.out.includes(`  env patched: {"MEMPALACE_TRANSCRIPT_ENABLED":"1"}`) ||
        result.out.includes(`  env patched: {"MEMPALACE_TRANSCRIPT_ENABLED": "1"}`),
    );
  });

  test("gemini and copilot print no env patch", async () => {
    for (const cli of ["gemini", "copilot"] as const) {
      const result = await runHooks(cli, { steps: STEPS, answers: YES, python: true });
      assert.ok(!result.out.includes("env patched"), cli);
    }
  });

  test("copilot: disableAllHooks keeps the file, prints the not-active line and the stderr warning", async () => {
    const file = put(
      hooksFileOf("copilot"),
      `${JSON.stringify({ disableAllHooks: true, hooks: {} }, null, 2)}\n`,
    );
    const seen: boolean[] = [];
    const probe: StepFn = async ({ state }) =>
      void seen.push(state.srAllHooksDisabled, state.srTranscriptWired);
    const result = await runHooks("copilot", {
      steps: [...STEPS, "summary"],
      answers: YES,
      extra: { summary: probe },
    });
    within(result.out, "copilot", "transcript-optin-all-hooks-disabled");
    assert.match(
      result.out,
      /Session recording is NOT active: "disableAllHooks" is true in <HOME>/,
    );
    assert.ok(
      readGolden("copilot", "transcript-optin-all-hooks-disabled", "stderr.golden").includes(
        result.err.trimEnd(),
      ),
    );
    assert.deepEqual(seen, [true, true]);
    const written = JSON.parse(fs.readFileSync(file, "utf8")) as { disableAllHooks?: unknown };
    assert.equal(written.disableAllHooks, true);
  });
});

describe("session-recording: failures", { skip: POSIX_ONLY }, () => {
  test("a manifest that cannot be rendered prints the shell's ERROR line and exits 1 (the shell's exit 1)", async () => {
    seedClaudeSettings();
    fs.writeFileSync(path.join(rig.repo, "hooks/claude-transcript-hooks.json"), "[]\n");
    const result = await runHooks("claude", { steps: STEPS, answers: YES });
    assert.equal(result.status, 1);
    assert.ok(
      result.err.includes(`  ERROR: could not render <REPO>/hooks/claude-transcript-hooks.json.\n`),
    );
  });

  test("a settings file that is not a JSON object fails the merge; the run continues", async () => {
    put(".claude/settings.json", "[]\n");
    const log: string[] = [];
    const next: StepFn = async () => void log.push("next");
    const result = await runHooks("claude", {
      steps: [...STEPS, "summary"],
      answers: YES,
      extra: { summary: next },
    });
    assert.equal(result.status, 0);
    assert.ok(
      result.err.includes("  Transcript activation FAILED — setup continues without it.\n"),
    );
    assert.ok(!result.out.includes("Transcript hooks merged"));
    assert.deepEqual(log, ["next"]);
  });

  test("below the Node.js floor the render is refused: the commands stay out, the merge still runs", async () => {
    seedClaudeSettings();
    const below: Spawner = (argv) =>
      argv[0] === "node" ? { status: 1, stdout: "", stderr: "floor\n" } : okSpawn(argv);
    const result = await runHooks("claude", { steps: STEPS, answers: YES, spawn: below });
    assert.equal(result.status, 0);
    assert.ok(
      result.err.includes(
        "  Worktree git guard and session recording not wired this run; installed commands are left as they are.\n",
      ),
    );
    assert.ok(
      result.out.includes(
        "  Session recording NOT activated this run; installed transcript commands are left as they are.\n",
      ),
    );
    assert.ok(!result.out.includes("  Worktree git guard wired to"));
  });

  test("a linked worktree adds the four-line warning after each wired report", async () => {
    seedClaudeSettings();
    const linked: Spawner = (argv) =>
      argv.includes("rev-parse")
        ? { status: 0, stdout: "/elsewhere/.git\n", stderr: "" }
        : okSpawn(argv);
    const result = await runHooks("claude", { steps: STEPS, answers: YES, spawn: linked });
    assert.equal(result.out.split("this checkout is a linked git worktree").length - 1, 2);
    assert.ok(result.out.includes("The session recording wiring above points INTO this checkout"));
    assert.ok(result.out.includes("The worktree git guard wiring above points INTO this checkout"));
  });
});

describe("hooks-rewrite-installed", { skip: POSIX_ONLY }, () => {
  test("the leading blank line is the descriptor's: Claude and Gemini print one, Copilot none", async () => {
    for (const cli of HOOK_CLIS) {
      const result = await runHooks(cli, { steps: ["mcp", "hooks-rewrite-installed"] });
      assert.equal(result.out, cli === "copilot" ? "" : "\n", cli);
    }
  });

  test("a leftover shell hook copy is reported with the shell's two lines, status stays 0", async () => {
    for (const cli of HOOK_CLIS) {
      const copy = put(unusedCopyOf(cli), "#!/bin/sh\n");
      const result = await runHooks(cli, { steps: ["mcp", "hooks-rewrite-installed"] });
      assert.equal(result.status, 0);
      assert.ok(
        result.out.includes(
          `  No longer used (left on disk): ${copy.replace(rig.home, "<HOME>")} — session recording now runs the\n  hook from this checkout.\n`,
        ),
        cli,
      );
    }
  });

  test("below the floor the installed commands are left as they are and setup continues", async () => {
    put(
      hooksFileOf("claude"),
      `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "bash /x/worktree-git-guard.sh" }] }] } })}\n`,
    );
    const below: Spawner = (argv) =>
      argv[0] === "node" ? { status: 1, stdout: "", stderr: "floor\n" } : okSpawn(argv);
    const result = await runHooks("claude", {
      steps: ["mcp", "hooks-rewrite-installed"],
      spawn: below,
    });
    assert.equal(result.status, 0);
    assert.ok(result.err.includes("  Installed worktree git guard command left as it is.\n"));
  });

  test("channel agy-json delegates both steps to steps-agy.ts: no leading blank line, no settings flow", async () => {
    const base = hookDescriptor("claude", STEPS);
    const agy = {
      ...base,
      cli: "antigravity" as const,
      hooks: { ...base.hooks, channel: "agy-json" as const },
    };
    const steps = ["hooks-rewrite-installed", "session-recording"] as const;
    const result = await runHooks("claude", {
      steps,
      descriptor: agy,
      answers: { transcripts: "no" },
    });
    assert.equal(result.status, 0);
    assert.ok(!result.out.startsWith("\n") && result.out.endsWith("\n\n"));
    assert.match(result.out, /Session recording disabled/);
    assert.equal(fs.existsSync(path.join(rig.home, hooksFileOf("claude"))), false);
  });
});
