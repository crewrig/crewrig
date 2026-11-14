// skill-scripts-security-finding-shape.test.ts — how security-finding.ts reads the shape of a report
// (spec 0303 R9, review finding i1-F6): a blank line or an unindented fence after a label keeps the
// field open, and prose or a numbered list after the findings is not another finding. No network,
// from a copy of the skill outside the repository.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { copySkill, envelope, run, tempDir } from "./lib/skill-scripts-security-cli.ts";

const root = tempDir("security-finding-shape-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const skill = copySkill(root);
const checkout = path.join(root, "checkout");
fs.mkdirSync(path.join(checkout, "src"), { recursive: true });
fs.writeFileSync(path.join(checkout, "src", "a.ts"), "1\n2\n3\n4\n5\n");

let counter = 0;
function check(report: string) {
  const file = path.join(root, `report-${(counter += 1)}.md`);
  fs.writeFileSync(file, report);
  return run(skill, "security-finding", ["--root", checkout, "--json", file], { cwd: root });
}
const HEAD = "1. [HIGH] SQL injection in the sort parameter\n   Where: src/a.ts:3\n   Threat: t\n";

describe("the open field", () => {
  for (const [name, evidence] of [
    [
      "a blank line then an indented fence",
      "   Evidence:\n\n   ```js\n   ORDER BY ${sort}\n   ```\n",
    ],
    ["an unindented fence", "   Evidence:\n```js\nORDER BY ${sort}\n```\n"],
    ["an unindented fence after a blank line", "   Evidence:\n\n```\nORDER BY ${sort}\n```\n"],
    [
      "a fence holding a numbered line and a label",
      "   Evidence:\n```\n2. not a finding\nFix: not a field\n```\n",
    ],
  ] as [string, string][])
    test(`${name}: no false field-missing`, () => {
      const r = check(`${HEAD}${evidence}   Fix: use an allow-list\n`);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(envelope(r).data?.["checked"], 1);
    });
  test("an empty Evidence label is still field-missing", () => {
    const r = check(`${HEAD}   Evidence:\n   Fix: use an allow-list\n`);
    assert.equal(r.status, 1);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["field-missing"],
    );
  });
});

describe("after the findings", () => {
  test("a numbered list after a prose line is not read as findings", () => {
    const r = check(
      `${HEAD}   Evidence: e\n   Fix: f\n\nSummary:\n1. first point\n2. second point\n`,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(envelope(r).data?.["checked"], 1);
  });
  test("two consecutive findings are still both read", () => {
    const second = HEAD.replace("1.", "2.");
    const r = check(`${HEAD}   Evidence: e\n   Fix: f\n\n${second}   Evidence: e\n   Fix: f\n`);
    assert.equal(envelope(r).data?.["checked"], 2);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
