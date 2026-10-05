// worktree-guard-windows.test.ts — the `windows-worktree-git-guard` job's guard
// proof (spec 0248 R34(a), R34(b); scenarios 2, 22).
//
// (a) runs on every platform, so the Linux capability exercises it too:
//     hooks/worktree-git-guard.ts with a payload of each CLI's shape, a working
//     directory in the platform's native separators (backslashes on Windows),
//     the refusal text for a prohibited command without a claim, silence with a
//     claim and for a safe command.
// (b) needs Windows and is skipped elsewhere with an explicit SKIP line: the
//     command line the module produces for each of the four CLIs runs through
//     the invocation row 37 records for it (`bash -c` for Claude Code,
//     `powershell.exe -NoProfile -NonInteractive -Command` for Gemini CLI and
//     Copilot CLI, `cmd /c` for Antigravity CLI), from a checkout path with no
//     space for Antigravity CLI, and the guard is asserted to have run.

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";

import { GUARDED_PREFIX, hookCommandLine, type Cli } from "../lib/hook-command.ts";
import { resolveReal } from "../lib/paths.ts";
import { allowed, payload, refused } from "./lib/guard-asserts.ts";
import { invocation, LEGS, GIT_BASH, runInvocation } from "./lib/windows-invocation.ts";
import {
  cleanupAll,
  GUARD_TS,
  makeFixture,
  runGuard,
  SKIP_WINDOWS,
  writeClaim,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

let unclaimed: Fixture;
let claimed: Fixture;
before(() => {
  unclaimed = makeFixture({ ticket: "1328" });
  claimed = makeFixture({ ticket: "1328" });
  writeClaim(claimed, { holder: "alice" });
});
after(cleanupAll);

const CLIS = ["Claude Code", "Gemini CLI", "Copilot CLI", "Antigravity CLI"] as const;

/** The payload of `cli`'s shape for `command` in `cwd`, `cwd` in native separators. */
function shape(cli: (typeof CLIS)[number], command: string, cwd: string): string {
  switch (cli) {
    case "Claude Code":
      return JSON.stringify({ cwd, hook_event_name: "PreToolUse", tool_input: { command } });
    case "Gemini CLI":
      return JSON.stringify({ cwd, hook_event_name: "BeforeTool", tool_input: { command } });
    case "Copilot CLI":
      return JSON.stringify({ cwd, toolName: "bash", command });
    case "Antigravity CLI":
      return JSON.stringify({
        workspacePaths: [cwd],
        toolCall: { name: "run_command", args: { CommandLine: command } },
      });
  }
}

describe("the entry from a native working directory, a payload of each CLI's shape (R34(a))", () => {
  for (const cli of CLIS) {
    test(`${cli}: refused without a claim, with the refusal text`, () => {
      refused(
        runGuard(shape(cli, "git reset --hard", unclaimed.wt), { cwd: unclaimed.wt }),
        "1328",
      );
    });

    test(`${cli}: allowed with a claim, empty streams`, () => {
      allowed(runGuard(shape(cli, "git reset --hard", claimed.wt), { cwd: claimed.wt }));
    });

    test(`${cli}: a safe command is allowed, empty streams`, () => {
      allowed(runGuard(shape(cli, "git status", unclaimed.wt), { cwd: unclaimed.wt }));
    });
  }

  test(
    "scenario 2: on Windows a backslash cwd is in scope and its id is 1328",
    { skip: SKIP_WINDOWS },
    () => {
      assert.ok(unclaimed.wt.includes("\\"), "the fixture path has backslashes");
      refused(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: unclaimed.wt }), "1328");
      const mixed = unclaimed.wt.replaceAll("\\", "/").replace("/.worktrees/", "\\.worktrees\\");
      refused(runGuard(payload("git reset --hard", mixed), { cwd: unclaimed.wt }), "1328");
    },
  );
});

describe(
  "each CLI's command line, through its interpreter (R34(b))",
  { skip: SKIP_WINDOWS },
  () => {
    before(() => {
      assert.ok(fs.existsSync(GIT_BASH), `${GIT_BASH} is missing: row 37's Git Bash path moved`);
    });

    for (const { cli, interpreter } of LEGS) {
      test(`${cli}: the module's command runs under ${interpreter} and the guard refuses`, () => {
        const built = hookCommandLine({
          cli: cli as Cli,
          surface: "hooks",
          platform: "win32",
          scriptPath: resolveReal(GUARD_TS),
          args: [],
        });
        assert.ok(built.ok, built.ok ? "" : built.refusal);
        if (cli === "antigravity")
          assert.ok(built.command.startsWith(GUARDED_PREFIX), built.command);
        const res = runInvocation(invocation(interpreter, built.command), {
          input: payload("git reset --hard", unclaimed.wt),
          cwd: unclaimed.wt,
        });
        assert.equal(res.status, 1, `${res.stdout}${res.stderr}\n${built.command}`);
        assert.match(res.stderr, /^mempalace-git-guard: prohibited whole-tree operation/m);
      });

      test(`${cli}: with a claim the same command line allows, silently`, () => {
        const built = hookCommandLine({
          cli: cli as Cli,
          surface: "hooks",
          platform: "win32",
          scriptPath: resolveReal(GUARD_TS),
          args: [],
        });
        assert.ok(built.ok, built.ok ? "" : built.refusal);
        const res = runInvocation(invocation(interpreter, built.command), {
          input: payload("git reset --hard", claimed.wt),
          cwd: claimed.wt,
        });
        assert.equal(res.status, 0, `${res.stderr}\n${built.command}`);
        assert.equal(res.stdout, "");
        assert.equal(res.stderr, "");
      });
    }
  },
);
