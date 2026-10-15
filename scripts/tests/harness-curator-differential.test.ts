// harness-curator-differential.test.ts — the shell-versus-entry differential of the three curator
// scripts, with goldens (spec 0258 R28, R29, R31; PLAN v2 step 19). Each case runs as a black box in
// a fresh sandbox: the shell leg `LC_ALL=C bash <name>.sh` (Linux only: the scripts and their stubs
// lean on GNU tools) and the entry leg `node <name>.ts`. The `auto` leg, the subject of the goldens,
// is the `.ts` when it exists, else the `.sh`. The entry leg is compared with the committed goldens
// and overlays; the shell leg with the base goldens, and every difference between the two legs must
// match a deviation rule the case declares (R31) and be recorded as an overlay. After the switch the
// `.sh` is a forwarding shim: the shell leg is then skipped and only the committed files judge.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { CASES } from "./lib/harness-curator-cases.ts";
import {
  compareGolden,
  expectedFor,
  findDifferences,
  goldenFiles,
  overlayBaseKeys,
  overlayKeys,
  readGolden,
  tagOf,
} from "./lib/harness-curator-differential.ts";
import { findTool, observe, resolveLeg, scriptFile } from "./lib/harness-curator-observe.ts";
import type { HcCase } from "./lib/harness-curator-observe.ts";

const isShim = (script: string): boolean =>
  fs.readFileSync(scriptFile(script, "sh"), "utf8").includes("exec node");
const needsPython = (c: HcCase): boolean => c.tools?.includes("python3") === true;

describe("curator scripts: legs and goldens", () => {
  test("case names are unique and every stored golden has a case", () => {
    const names = CASES.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, "duplicate case name");
    const root = new URL("./fixtures/harness-curator/", import.meta.url);
    const stored = fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
    assert.deepEqual(stored, [...names].sort(), "stored cases differ from the case table");
  });

  for (const testCase of CASES) {
    test(testCase.name, (t) => {
      if (needsPython(testCase) && findTool("python3") === undefined)
        return t.skip("skipped: the case runs the real curate.py and needs python3 on the host");
      const stored = readGolden(testCase.name);
      assert.notEqual(stored.size, 0, `${testCase.name}: no golden stored`);
      assert.ok(
        overlayKeys(stored).length === 0 || testCase.deviations !== undefined,
        `${testCase.name}: an overlay golden needs a deviation tag on the case`,
      );

      const leg = resolveLeg(testCase.script, "auto");
      const subject = observe(testCase, leg);
      assert.deepEqual(
        compareGolden(goldenFiles(subject), expectedFor(stored, leg)),
        [],
        `${testCase.name}: ${leg} leg against the goldens`,
      );

      const shellLive =
        process.platform === "linux" &&
        fs.existsSync(scriptFile(testCase.script, "sh")) &&
        !isShim(testCase.script);
      if (!shellLive && process.platform === "linux" && isShim(testCase.script))
        t.diagnostic("shell leg skipped: the .sh is a forwarding shim (spec 0258 requirement 32)");
      if (!shellLive || leg === "shell") return;
      const shell = observe(testCase, "shell");
      assert.deepEqual(
        compareGolden(goldenFiles(shell), expectedFor(stored, "shell")),
        [],
        `${testCase.name}: shell leg against the base goldens`,
      );
      const diffs = findDifferences(shell, subject);
      const untagged = diffs.filter((d) => tagOf(d, testCase) === undefined);
      assert.deepEqual(
        untagged.map(
          (d) =>
            `${d.field}\n  shell: ${JSON.stringify(d.shell)}\n  ts:    ${JSON.stringify(d.ts)}`,
        ),
        [],
        `${testCase.name}: untagged difference between the shell and the entry leg`,
      );
      const tags = [...new Set(diffs.map((d) => tagOf(d, testCase)))].join(" ");
      if (tags !== "") t.diagnostic(`deviations hit: ${tags}`);
      assert.deepEqual(
        overlayKeys(stored)
          .map((k) => k.replace(/\.overlay\.golden$/, ".golden"))
          .sort(),
        overlayBaseKeys(goldenFiles(shell), goldenFiles(subject)),
        `${testCase.name}: the overlays must be exactly the tagged differences`,
      );
    });
  }
});
