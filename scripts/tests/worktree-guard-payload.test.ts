// worktree-guard-payload.test.ts — payload extraction and input handling
// (spec 0248 R4, R5; scenarios 5, 6, 7; R38(c), R38(h)).
//
// Black-box: every test spawns the real entry the way a CLI does (see
// worktree-guard-decision.test.ts for the conventions). Allowed outcomes are
// asserted silent (R10), refusals exact (R9).

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";

import { allowed, payload, refusal, refused } from "./lib/guard-asserts.ts";

import {
  cleanEnv,
  cleanupAll,
  GUARD_TS,
  makeFixture,
  makePathDir,
  runGuard,
  SKIP_POSIX,
  which,
  writeClaim,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

let unclaimed: Fixture;
let claimed: Fixture;

before(() => {
  unclaimed = makeFixture({ ticket: "771" });
  claimed = makeFixture({ ticket: "771" });
  writeClaim(claimed, { holder: "alice" });
});
after(cleanupAll);

/** Run the guard in the unclaimed fixture worktree, with `payload` on standard input. */
const inWorktree = (input: string, extra: { args?: string[]; env?: NodeJS.ProcessEnv } = {}) =>
  runGuard(input, { cwd: unclaimed.wt, ...extra });

describe("payload shapes (R5; scenarios 5, 6, 7)", () => {
  const cwd = (): string => unclaimed.wt;
  const refusedShapes: Array<[string, () => unknown]> = [
    [
      "Antigravity .toolCall.args.CommandLine",
      () => ({ toolCall: { name: "run_command", args: { CommandLine: "git reset --hard" } } }),
    ],
    [
      "Antigravity .toolCall.args as an object",
      () => ({ toolCall: { args: { cmd: "git reset --hard" } } }),
    ],
    ["Antigravity .toolCall.args as a string", () => ({ toolCall: { args: "git reset --hard" } })],
    [
      "Antigravity workspacePaths[0] as the directory",
      () => ({
        workspacePaths: [unclaimed.wt],
        toolCall: { args: { CommandLine: "git clean -fd" } },
      }),
    ],
    [
      "Claude Code and Gemini CLI .tool_input.command",
      () => ({ cwd: cwd(), tool_input: { command: "git reset --hard" } }),
    ],
    ["Copilot CLI .command", () => ({ cwd: cwd(), command: "git reset --hard" })],
    [
      "an object .tool_input, taken as its JSON text",
      () => ({ cwd: cwd(), tool_input: { cmd: "git clean -fd" } }),
    ],
    [
      "an object nested deeper, taken as its JSON text",
      () => ({ cwd: cwd(), tool_input: { anything: ["git stash"] } }),
    ],
    [
      "a string .tool_input: .tool_input.command is unindexable and counts as absent",
      () => ({ tool_input: "git reset --hard", cwd: cwd() }),
    ],
    [
      "an array .toolCall: unindexable, the chain continues",
      () => ({ toolCall: [1], tool_input: { command: "git reset --hard" } }),
    ],
    [
      "a string .toolCall: unindexable, the chain continues",
      () => ({ toolCall: "x", tool_input: { command: "git reset --hard" } }),
    ],
    [
      "a false .tool_input.command is skipped, .command selected",
      () => ({ tool_input: { command: false }, command: "git reset --hard" }),
    ],
    [
      "a null .tool_input.command is skipped, .command selected",
      () => ({ tool_input: { command: null }, command: "git reset --hard" }),
    ],
    [
      "cwd from .workspace_dir",
      () => ({ workspace_dir: unclaimed.wt, command: "git reset --hard" }),
    ],
    ["cwd from .project_dir", () => ({ project_dir: unclaimed.wt, command: "git reset --hard" })],
    [
      "a null .cwd is skipped, .workspace_dir selected",
      () => ({ cwd: null, workspace_dir: unclaimed.wt, command: "git reset --hard" }),
    ],
    [
      "a false .cwd is skipped, .project_dir selected",
      () => ({ cwd: false, project_dir: unclaimed.wt, command: "git reset --hard" }),
    ],
  ];
  for (const [name, build] of refusedShapes) {
    test(`refused: ${name}`, () => {
      // The process runs in the main checkout, which is in no worktree: only the
      // payload can put the command in scope, except where the payload carries
      // no directory and the process directory must be inside one.
      const needsProcessDir = !/cwd|workspace|project_dir|Antigravity workspacePaths/.test(
        JSON.stringify(build()),
      );
      const res = runGuard(JSON.stringify(build()), {
        cwd: needsProcessDir ? unclaimed.wt : unclaimed.main,
      });
      refused(res, "771", name);
    });
  }

  const allowedShapes: Array<[string, () => unknown]> = [
    [
      "CommandLine selected first: a safe command ends the chain",
      () => ({
        toolCall: { args: { CommandLine: "git status" } },
        tool_input: { command: "git reset --hard" },
      }),
    ],
    [
      "a null CommandLine selects .toolCall.args, an object that is safe",
      () => ({
        toolCall: { args: { CommandLine: null } },
        tool_input: { command: "git reset --hard" },
      }),
    ],
    [
      "an empty string is selected and ends the chain (jq //)",
      () => ({
        toolCall: { args: { CommandLine: "" } },
        tool_input: { command: "git reset --hard" },
      }),
    ],
    ["a number is taken as its text", () => ({ command: 5 })],
    ["nothing in the chain", () => ({ unrelated: "git reset --hard" })],
    ["a JSON array", () => [1, 2]],
    ["a JSON string", () => "git reset --hard"],
    ["a JSON number", () => 7],
    ["JSON null", () => null],
    ["an empty object", () => ({})],
    [
      "the first cwd of the chain wins: .cwd outside a worktree, .project_dir inside",
      () => ({ cwd: "/tmp/x", project_dir: unclaimed.wt, command: "git reset --hard" }),
    ],
    [
      "a non-string .cwd is taken as its text, which is outside a worktree",
      () => ({ cwd: 5, workspace_dir: unclaimed.wt, command: "git reset --hard" }),
    ],
  ];
  for (const [name, build] of allowedShapes) {
    test(`allowed: ${name}`, () => {
      const hasDir = /cwd|workspace_dir|project_dir/.test(JSON.stringify(build()));
      allowed(
        runGuard(JSON.stringify(build()), { cwd: hasDir ? unclaimed.main : unclaimed.wt }),
        name,
      );
    });
  }

  test("an empty .cwd is enforced from the process directory, never read as outside every worktree", () => {
    refused(
      runGuard(JSON.stringify({ cwd: "", tool_input: { command: "git reset --hard" } }), {
        cwd: unclaimed.wt,
      }),
      "771",
    );
  });

  test("an empty command takes the first positional argument", () => {
    refused(
      runGuard(JSON.stringify({ tool_input: { command: "" } }), {
        cwd: unclaimed.wt,
        args: ["git reset --hard"],
      }),
      "771",
    );
  });

  test("an empty standard input takes the first positional argument", () => {
    refused(runGuard("", { cwd: unclaimed.wt, args: ["git reset --hard"] }), "771");
  });

  test("an unparsable payload falls back to the argument too: no command, not an error", () => {
    refused(runGuard("not json", { cwd: unclaimed.wt, args: ["git reset --hard"] }), "771");
  });

  test("a payload command wins over the argument", () => {
    allowed(
      runGuard(payload("git status", unclaimed.wt), {
        cwd: unclaimed.wt,
        args: ["git reset --hard"],
      }),
    );
  });

  test("an empty argument with nothing else allows", () => {
    allowed(runGuard("", { cwd: unclaimed.wt, args: [""] }));
  });

  test("scenario 6: empty standard input, then `not json`, no argument: silent allow", () => {
    allowed(runGuard("", { cwd: unclaimed.wt }));
    allowed(runGuard("not json", { cwd: unclaimed.wt }));
    allowed(runGuard(null, { cwd: unclaimed.wt }), "standard input closed");
  });

  test(
    "a payload that parses is enforced on a machine with no jq (R38(c))",
    { skip: SKIP_POSIX },
    () => {
      const git = which("git");
      assert.ok(git, "git is needed by this test");
      const bin = makePathDir({ links: { git } });
      assert.equal(
        spawnSync("jq", ["--version"], { env: { PATH: bin } }).error !== undefined,
        true,
        "the throwaway PATH has no jq",
      );
      const env = cleanEnv({ PATH: bin });
      allowed(runGuard("", { cwd: unclaimed.wt, env }));
      allowed(runGuard("not json", { cwd: unclaimed.wt, env }));
      refused(
        runGuard(payload("git reset --hard", unclaimed.wt), { cwd: unclaimed.wt, env }),
        "771",
      );
      allowed(runGuard(payload("git status", unclaimed.wt), { cwd: unclaimed.wt, env }));
    },
  );

  test("standard input is read to the end before the decision (R4)", async () => {
    const child = spawn(process.execPath, [GUARD_TS], { cwd: unclaimed.wt, env: cleanEnv() });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exit = new Promise<number | null>((resolve) => child.on("close", resolve));
    const whole = payload("git reset --hard", unclaimed.wt);
    const cut = whole.indexOf("reset");
    child.stdin.write(whole.slice(0, cut));
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.stdin.end(whole.slice(cut));
    assert.equal(await exit, 1);
    assert.equal(stderr, refusal("771"));
  });

  test("a large payload is read whole", () => {
    const filler = "x".repeat(2_000_000);
    refused(
      inWorktree(
        JSON.stringify({ cwd: unclaimed.wt, filler, tool_input: { command: "git reset --hard" } }),
      ),
      "771",
    );
  });
});
