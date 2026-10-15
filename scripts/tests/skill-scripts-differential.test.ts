// skill-scripts-differential.test.ts — the shell leg against the entry leg, case by case (spec
// 0258 R28, R29, R31). Both legs run on every case of the oracle registry (no case of its own)
// and the four outputs (status, stdout, stderr, files, with the stub calls and the temp
// directory) are compared. An untagged case must be byte-identical (after the script-name token,
// tag (a)); a difference of a tagged case must be explained by the tags of the case, or the test
// FAILS naming the case; the overlay golden of a tagged case must equal the entry's output and
// differ from the shell golden in exactly the differing, tagged streams. The shell leg runs on
// Linux only (GNU grep, awk, sed, find); elsewhere the suites skip with a named reason. Once the
// switch deleted the `.sh` (decided by file presence), the base goldens ARE the shell's output:
// the shell leg is skipped with the named reason of `SHELL_RETIRED`, the entry leg is compared
// with the goldens and overlays, and the tag and overlay consistency checks run on every host.

import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import { findTool } from "./lib/hermetic-env.ts";
import { SCRIPTS } from "./lib/skill-scripts-cases.ts";
import { CALLERS, checkCaller, readCaller, retiredSpellings } from "./lib/skill-scripts-callers.ts";
import { explain, mayOverlay, tagsOf } from "./lib/skill-scripts-deviations.ts";
import {
  compareGolden,
  expectedFor,
  goldenFiles,
  overlayKeys,
  readGolden,
} from "./lib/skill-scripts-golden.ts";
import { SHELL_RETIRED, observe, shellAvailable } from "./lib/skill-scripts-observe.ts";
import type { SkillCase } from "./lib/skill-scripts-observe.ts";

const NOT_LINUX = "skipped: the shell leg needs a Linux host (GNU grep, awk, sed, find)";
const OVERLAY = ".overlay.golden";

function differential(testCase: SkillCase, t: TestContext): void {
  if (
    shellAvailable(testCase.script) &&
    testCase.tools?.includes("yq") === true &&
    findTool("yq") === undefined
  )
    return t.skip("skipped: a YAML-leg case needs yq on the host (the golden container has it)");
  const where = `${testCase.script}/${testCase.name}`;
  const tags = tagsOf(testCase.deviation);
  const stored = readGolden(testCase);
  const live = shellAvailable(testCase.script);
  const entryObs = observe(testCase, "entry");
  // the retired shell's output is the stored base golden (every overlay is an entry-only file)
  const shell = live ? goldenFiles(observe(testCase, "shell")) : expectedFor(stored, "shell");
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
  if (live)
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

describe("skill-script callers: every text names the `.ts` entry run through Node", () => {
  for (const caller of CALLERS)
    test(caller.file, () => assert.deepEqual(checkCaller(caller, readCaller(caller)), []));

  test("the guard is not vacuous: it fails on the old spelling and on a missing new one", () => {
    const [first] = CALLERS;
    assert.ok(first !== undefined);
    const text = readCaller(first);
    assert.deepEqual(checkCaller(first, text), []);
    assert.equal(checkCaller(first, `${text}\nscripts/lint-workflow.sh x\n`).length, 1);
    assert.equal(checkCaller(first, `${text}\nscripts/check-pinned-actions x\n`).length, 1);
    assert.equal(
      checkCaller(first, text.replaceAll("node scripts/simulate-job.ts", "x")).length,
      1,
    );
    assert.deepEqual(retiredSpellings("lint-shell.sh and lint-typescript.ts stay"), []);
  });
});

for (const { script, cases } of SCRIPTS) {
  const live = shellAvailable(script);
  describe(
    live
      ? `${script}: shell leg against entry leg`
      : `${script}: entry leg against the goldens and overlays`,
    { skip: live && process.platform !== "linux" && NOT_LINUX },
    () => {
      if (!live) test("the shell leg", (t) => t.skip(SHELL_RETIRED));
      for (const testCase of cases) test(testCase.name, (t) => differential(testCase, t));
    },
  );
}
