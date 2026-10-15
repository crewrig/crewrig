// skill-scripts-differential.test.ts — the shell leg against the entry leg, case by case (spec
// 0258 R28, R29, R31). Both legs run on every case of the oracle registry (no case of its own)
// and the four outputs (status, stdout, stderr, files, with the stub calls and the temp
// directory) are compared. An untagged case must be byte-identical (after the script-name token,
// tag (a)); a difference of a tagged case must be explained by the tags of the case, or the test
// FAILS naming the case; the overlay golden of a tagged case must equal the entry's output and
// differ from the shell golden in exactly the differing, tagged streams. The shell leg runs on
// Linux only (GNU grep, awk, sed, find); elsewhere the suites skip with a named reason.

import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import { findTool } from "./lib/hermetic-env.ts";
import { SCRIPTS } from "./lib/skill-scripts-cases.ts";
import { explain, mayOverlay, tagsOf } from "./lib/skill-scripts-deviations.ts";
import {
  compareGolden,
  expectedFor,
  goldenFiles,
  overlayKeys,
  readGolden,
} from "./lib/skill-scripts-golden.ts";
import { observe } from "./lib/skill-scripts-observe.ts";
import type { SkillCase } from "./lib/skill-scripts-observe.ts";

const NOT_LINUX = "skipped: the shell leg needs a Linux host (GNU grep, awk, sed, find)";
const OVERLAY = ".overlay.golden";

function differential(testCase: SkillCase, t: TestContext): void {
  if (testCase.tools?.includes("yq") === true && findTool("yq") === undefined)
    return t.skip("skipped: a YAML-leg case needs yq on the host (the golden container has it)");
  const where = `${testCase.script}/${testCase.name}`;
  const tags = tagsOf(testCase.deviation);
  const stored = readGolden(testCase);
  const shellObs = observe(testCase, "shell");
  const entryObs = observe(testCase, "entry");
  const shell = goldenFiles(shellObs);
  const entry = goldenFiles(entryObs);
  const differing = [...new Set([...shell.keys(), ...entry.keys()])]
    .filter((key) => shell.get(key) !== entry.get(key))
    .sort();

  const script = testCase.script.split("/")[1] as string;
  const untagged = differing.filter(
    (key) =>
      explain(key, shell.get(key), entry.get(key), tags, entryObs.stdout, script) === undefined,
  );
  assert.deepEqual(
    untagged,
    [],
    `${where}: UNTAGGED difference between the legs (tags: ${testCase.deviation ?? "none"})`,
  );

  const overlaid = overlayKeys(stored)
    .map((key) => `${key.slice(0, -OVERLAY.length)}.golden`)
    .sort();
  assert.deepEqual(overlaid, differing, `${where}: the overlays are not the differing streams`);
  for (const key of overlaid) {
    assert.ok(mayOverlay(key, tags), `${where}: overlay ${key} is outside the tagged streams`);
    assert.equal(
      stored.get(key.replace(/\.golden$/, OVERLAY)),
      entry.get(key),
      `${where}: overlay ${key} is not the entry's output`,
    );
  }
  assert.deepEqual(compareGolden(entry, expectedFor(stored, "entry")), [], `${where}: entry`);
  assert.deepEqual(compareGolden(shell, expectedFor(stored, "shell")), [], `${where}: shell`);
}

describe("skill-script deviations: the tag table", () => {
  test("every tagged case of the registry carries known tags", () => {
    for (const { cases } of SCRIPTS)
      for (const c of cases) assert.ok(tagsOf(c.deviation).length > 0 || c.deviation === undefined);
  });

  test("(o) explains the Terminated line only, (m) an extra finding only", () => {
    const o = tagsOf("(o)");
    const explainStderr = (shell: string, entry: string): string | undefined =>
      explain("stderr.golden", shell, entry, o, "", "lint-workflow");
    assert.equal(explainStderr("Terminated\n", ""), "o");
    assert.equal(explainStderr("Terminated\nboom\n", ""), undefined);
    assert.equal(explain("stdout.golden", "x\n", "y\n", o, "", "lint-workflow"), undefined);
    const m = tagsOf("m");
    const finding = "f.json: invalid JSON — <JSON-MSG>\n";
    assert.equal(explain("stdout.golden", "", finding, m, finding, "lint-json"), "m");
    assert.equal(explain("status.golden", "0\n", "1\n", m, finding, "lint-json"), "m");
    assert.equal(explain("status.golden", "0\n", "2\n", m, finding, "lint-json"), undefined);
    assert.equal(explain("stdout.golden", "", finding, [], finding, "lint-json"), undefined);
  });
});

for (const { script, cases } of SCRIPTS) {
  describe(
    `${script}: shell leg against entry leg`,
    { skip: process.platform !== "linux" && NOT_LINUX },
    () => {
      for (const testCase of cases) test(testCase.name, (t) => differential(testCase, t));
    },
  );
}
