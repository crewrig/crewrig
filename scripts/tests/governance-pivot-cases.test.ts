// governance-pivot-cases.test.ts — Replaces scripts/tests/test-check-extension-pivot.sh
// (cases 1-5, one fixture each; case 6 stays in governance-check-extension-pivot.test.ts).
// Spec 0265 (row J2): black-box on scripts/check-extension-pivot.ts in a temp tree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-extension-pivot.ts");
const PIVOT_COMMAND = '---\nname: x\ndescription: "A pivot command"\ntype: command\n---\n\nBody.\n';
const COMMAND_TOML = 'description = "A command"\n\nprompt = """\n\nBody.\n"""\n';
const PIVOT_AGENT =
  '---\nname: a\ndescription: "A pivot agent"\ntype: agent\n---\n\nSystem prompt.\n';

/** A fresh tree with the given files (relative path to text). */
function tree(files: Record<string, string>): string {
  const root = makeSandbox("pivot-");
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const status = (root: string): number | null => runEntry(ENTRY, { cwd: root }).status;

describe("check-extension-pivot.ts cases", () => {
  test("Case 1 — command pivot (.md + .toml) passes", () => {
    const d = "extensions/core/demo/commands";
    assert.equal(status(tree({ [`${d}/x.md`]: PIVOT_COMMAND, [`${d}/x.toml`]: COMMAND_TOML })), 0);
  });

  test("Case 2 — orphan command .toml (no pivot .md) fails", () => {
    assert.equal(status(tree({ "extensions/core/demo/commands/x.toml": COMMAND_TOML })), 1);
  });

  test("Case 3 — agent pivot (AGENT.md) passes", () => {
    assert.equal(status(tree({ "extensions/core/demo/agents/a/AGENT.md": PIVOT_AGENT })), 0);
  });

  test("Case 4 — agent dir lacking AGENT.md fails", () => {
    const files = {
      "extensions/core/demo/agents/a/PROMPT.md": "Native agent prompt, no AGENT.md.\n",
    };
    assert.equal(status(tree(files)), 1);
  });

  test("Case 5 — adopter-owned extensions/org is exempt", () => {
    assert.equal(status(tree({ "extensions/org/demo/commands/x.toml": COMMAND_TOML })), 0);
  });
});
