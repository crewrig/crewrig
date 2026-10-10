// setup-hint-strings.test.ts — the user-visible repair hints that name a setup entry keep naming it
// after the TypeScript port (spec 0256 R33): the four `scripts/setup-<cli>-interactive.sh` files stay
// as forwarding shims, so the hints that tell a reader to run one stay true, and a later rename of
// the shim, or of the task, fails here instead of leaving a hint that points at nothing.
//   - scripts/lib/require-dependency.ts: "re-run setup (e.g. task setup-claude-interactive)".
//   - scripts/lib/mempalace-registration.ts: the gemini repair hint and the per-CLI hint, both
//     `bash scripts/setup-<cli>-interactive.sh`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const CLIS = ["claude", "gemini", "copilot", "antigravity"];

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

describe("the setup hints still name the setup entries", () => {
  test("the four shim scripts the hints name still exist", () => {
    for (const cli of CLIS) {
      const rel = `scripts/setup-${cli}-interactive.sh`;
      assert.ok(fs.statSync(path.join(REPO, rel)).isFile(), `${rel} is missing`);
    }
  });

  test("the four TypeScript entries the shims forward to still exist", () => {
    for (const cli of CLIS) {
      const rel = `scripts/setup-${cli}-interactive.ts`;
      assert.ok(fs.statSync(path.join(REPO, rel)).isFile(), `${rel} is missing`);
    }
  });

  test("the missing-dependency error names the setup task", () => {
    assert.ok(
      read("scripts/lib/require-dependency.ts").includes("(e.g. task setup-claude-interactive)"),
    );
    const taskfile = read("Taskfile.yml");
    assert.match(taskfile, /^ {2}setup-claude-interactive:$/m);
  });

  test("the MemPalace repair hints name the setup shim path", () => {
    const source = read("scripts/lib/mempalace-registration.ts");
    assert.ok(source.includes('run "bash scripts/setup-gemini-interactive.sh"'));
    assert.ok(source.includes("run(`bash scripts/setup-${cli}-interactive.sh`)"));
  });
});
