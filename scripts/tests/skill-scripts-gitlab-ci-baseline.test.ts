// skill-scripts-gitlab-ci-baseline.test.ts — the edited check-pinned-images.ts and
// check-secrets-exposure.ts behave byte-identically to the unmodified scripts for every argument
// form accepted before spec 0301 (R8, R9, R14): status, stdout, stderr, files and stub calls.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  BASELINE_ROOT,
  BASELINE_SCRIPTS,
  observeLegacy,
  readBaseline,
} from "./lib/skill-scripts-gitlab-ci-baseline.ts";
import { compareGolden } from "./lib/skill-scripts-golden.ts";

for (const { script, cases } of BASELINE_SCRIPTS) {
  describe(`${script}: unchanged behaviour against the pre-edit baseline`, () => {
    test("every baseline case has a case and the reverse", () => {
      const dir = path.join(BASELINE_ROOT, ...script.split("/"));
      assert.deepEqual(fs.readdirSync(dir).sort(), cases.map((c) => c.name).sort());
    });
    test("missing target keeps exit 1 and its message", () => {
      const stored = readBaseline({ script, name: "missing-path" });
      assert.equal(stored.get("status.golden"), "1\n");
    });
    for (const c of cases)
      test(c.name, () => {
        const stored = readBaseline(c);
        assert.notEqual(stored.size, 0, `${c.name}: no baseline stored`);
        assert.deepEqual(compareGolden(observeLegacy(c), stored), []);
      });
  });
}
