// worktree-guard-jq.test.ts — the guard's extraction against jq
// (spec 0248 R5, R38(h); plan verification duty 4).
//
// Black-box: every test spawns the real entry the way a CLI does (see
// worktree-guard-decision.test.ts for the conventions). Allowed outcomes are
// asserted silent (R10), refusals exact (R9).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";

import { refused } from "./lib/guard-asserts.ts";

import { cleanupAll, makeFixture, runGuard, which, type Fixture } from "./lib/worktree-fixtures.ts";

let unclaimed: Fixture;

before(() => {
  unclaimed = makeFixture({ ticket: "771" });
});
after(cleanupAll);

describe("R5 against jq: the shell guard's extraction, row by row", () => {
  const jq = which("jq");
  const FILTER =
    ".toolCall.args.CommandLine // .toolCall.args // .tool_input.command // .command // .tool_input // empty";
  const rows: unknown[] = [
    { toolCall: { args: { CommandLine: "git reset --hard" } } },
    { toolCall: { args: { cmd: "git reset --hard" } } },
    { tool_input: { command: "git reset --hard" } },
    { command: "git reset --hard" },
    { tool_input: { cmd: "git clean -fd" } },
    { toolCall: { args: { CommandLine: "" } }, command: "git reset --hard" },
    { toolCall: { args: { CommandLine: null } }, command: "git reset --hard" },
    { tool_input: { command: false }, command: "git reset --hard" },
    { tool_input: { command: null }, command: "git stash" },
    { command: 5 },
    { command: ["git stash"] },
    { unrelated: true },
    {},
    // Rows where jq itself fails (an unindexable segment): the TypeScript reading continues the
    // chain (R38(h)); asserted separately below.
  ];
  const reference = (text: string): boolean =>
    /git reset --hard|git checkout -- \.|git checkout \.|git clean|git worktree remove --force|git worktree remove -f/.test(
      text,
    ) ||
    (text.includes("git stash") && !/git stash (list|show|pop|apply|drop)/.test(text));

  test(
    "jq and the guard agree on every row jq can evaluate",
    { skip: jq === null ? "SKIP: jq is not installed" : false },
    () => {
      for (const row of rows) {
        const text = JSON.stringify(row);
        const res = spawnSync("jq", ["-r", FILTER], { input: text, encoding: "utf8" });
        assert.equal(res.status, 0, `${text}: jq failed: ${res.stderr}`);
        const wants = reference(res.stdout);
        const got = runGuard(JSON.stringify({ ...(row as object), cwd: unclaimed.wt }), {
          cwd: unclaimed.wt,
        });
        assert.equal(
          got.status,
          wants ? 1 : 0,
          `${text}: jq selected ${JSON.stringify(res.stdout)}`,
        );
      }
    },
  );

  test(
    "on an unindexable segment jq's behaviour varies between releases; the guard continues the chain (R38(h))",
    { skip: jq === null ? "SKIP: jq is not installed" : false },
    () => {
      const text = JSON.stringify({ tool_input: "git reset --hard", cwd: unclaimed.wt });
      const res = spawnSync("jq", ["-r", FILTER], { input: text, encoding: "utf8" });
      // Either jq fails (the deviation) or it selects the string; the guard refuses in both cases.
      assert.ok(res.status === 0 || res.status !== 0);
      refused(runGuard(text, { cwd: unclaimed.wt }), "771");
    },
  );
});
