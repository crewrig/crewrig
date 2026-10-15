// skill-scripts-oracle.test.ts — the black-box oracle of the skill scripts (spec 0258 R28). Each
// case runs the script as the SUBJECT picked by file presence — the `.ts` entry when it exists,
// else the `.sh` — and compares status, stdout, stderr, files written, stub calls and the temp
// directory with the stored goldens, so this text does not change when the switch deletes the
// shell. The shell leg runs on Linux only (the scripts depend on GNU grep, awk, sed and find: a
// BSD host proves nothing about them); on another host the entry leg runs as a smoke test when a
// `.ts` exists, and the case is skipped with a named reason otherwise.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test, type TestContext } from "node:test";

import { SCRIPTS } from "./lib/skill-scripts-cases.ts";
import {
  GOLDEN_ROOT,
  compareGolden,
  expectedFor,
  goldenFiles,
  overlayKeys,
  readGolden,
} from "./lib/skill-scripts-golden.ts";
import { findTool } from "./lib/hermetic-env.ts";
import { observe, resolveLeg } from "./lib/skill-scripts-observe.ts";
import type { SkillCase } from "./lib/skill-scripts-observe.ts";

function runCase(testCase: SkillCase, t: TestContext): void {
  const leg = resolveLeg(testCase.script, "auto");
  if (leg === "shell" && process.platform !== "linux")
    return t.skip("skipped: the shell leg needs a Linux host (GNU grep, awk, sed, find)");
  if (leg === "shell" && testCase.tools?.includes("yq") === true && findTool("yq") === undefined)
    return t.skip("skipped: a YAML-leg case needs yq on the host (the golden container has it)");
  const stored = readGolden(testCase);
  assert.notEqual(stored.size, 0, `${testCase.name}: no golden stored`);
  assert.ok(
    overlayKeys(stored).length === 0 || testCase.deviation !== undefined,
    `${testCase.name}: an overlay golden needs a deviation tag on the case`,
  );
  const obs = observe(testCase, leg);
  assert.deepEqual(
    compareGolden(goldenFiles(obs), expectedFor(stored, leg)),
    [],
    `${testCase.name}: ${leg} leg against the golden`,
  );
}

for (const { script, cases } of SCRIPTS) {
  describe(`${script}: oracle`, () => {
    test("case names are unique and every stored golden has a case", () => {
      const names = cases.map((c) => c.name);
      assert.equal(new Set(names).size, names.length, "duplicate case name");
      const dir = path.join(GOLDEN_ROOT, ...script.split("/"));
      const stored = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
      assert.deepEqual(stored, [...names].sort(), "stored cases differ from the case table");
    });
    for (const testCase of cases) test(testCase.name, (t) => runCase(testCase, t));
  });
}
