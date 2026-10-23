// setup-hint-strings.test.ts — the user-visible repair hints that name a setup entry keep naming it
// after the TypeScript port (spec 0256 R33): the four `scripts/setup-<cli>-interactive.ts` files stay
// as forwarding shims, so the hints that tell a reader to run one stay true, and a later rename of
// the shim, or of the task, fails here instead of leaving a hint that points at nothing.
//   - scripts/lib/require-dependency.ts: "re-run setup (e.g. task setup-claude-interactive)".
//   - scripts/lib/mempalace-registration.ts: the gemini repair hint and the per-CLI hint, both
//     `bash scripts/setup-<cli>-interactive.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { loadTaskfileTree } from "../lib/taskfile-tree.ts";
import { REPO } from "./lib/build-fixture-tree.ts";

const CLIS = ["claude", "gemini", "copilot", "antigravity"];

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

describe("the setup hints still name the setup entries", () => {
  test("the four setup entries the hints name exist", () => {
    for (const cli of CLIS) {
      const rel = `scripts/setup-${cli}-interactive.ts`;
      assert.ok(fs.statSync(path.join(REPO, rel)).isFile(), `${rel} is missing`);
    }
  });

  test("the missing-dependency error names the setup task", () => {
    assert.ok(
      read("scripts/lib/require-dependency.ts").includes("(e.g. task setup-claude-interactive)"),
    );
    assert.ok(loadTaskfileTree(REPO).byName.has("setup-claude-interactive"));
  });

  test("the MemPalace repair hints name the setup entry path", () => {
    const source = read("scripts/lib/mempalace-registration.ts");
    assert.ok(source.includes('run "node scripts/setup-gemini-interactive.ts"'));
    assert.ok(source.includes("run(`node scripts/setup-${cli}-interactive.ts`)"));
  });
});
