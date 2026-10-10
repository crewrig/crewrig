// setup-steps-hooks-lossy.test.ts — finding i1-F12: the `hooks-rewrite-installed` step is best effort
// (the shell's `guard_rewrite_installed ... || true`). A settings file holding a number that does not
// round-trip (`1.0`) is not rewritten: the step prints the one `Error:` line, leaves the file and the
// directory untouched, and the flow runs the next step and ends with status 0 (it never aborts the run).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { StepFn } from "../lib/setup/descriptor.ts";
import { POSIX_ONLY } from "./setup-flow-fixtures.ts";
import { hooksFileOf, put, rig, runHooks, useRig } from "./setup-steps-hooks-fixtures.ts";

useRig();

describe("hooks-rewrite-installed on a lossy settings file", { skip: POSIX_ONLY }, () => {
  test("prints one Error line, writes nothing and the next step still runs", async () => {
    const legacy = { type: "command", command: `bash "${rig.repo}/hooks/worktree-git-guard.sh"` };
    const text = `{ "limit": 1.0, "hooks": { "PreToolUse": [ { "hooks": [ ${JSON.stringify(legacy)} ] } ] } }\n`;
    const file = put(hooksFileOf("claude"), text);
    const log: string[] = [];
    const next: StepFn = async () => void log.push("next");
    const result = await runHooks("claude", {
      steps: ["mcp", "hooks-rewrite-installed", "summary"],
      extra: { summary: next },
    });
    assert.equal(result.status, 0, result.err);
    const lines = result.err.split("\n").filter((l) => l.startsWith("Error: "));
    assert.equal(lines.length, 1, result.err);
    assert.ok(lines[0]?.includes("cannot be rewritten without loss: "));
    assert.equal(fs.readFileSync(file, "utf8"), text, "file bytes");
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["settings.json"], "no backup");
    assert.deepEqual(log, ["next"]);
  });
});
