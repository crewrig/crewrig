// skill-scripts-secrets-engine-legacy.test.ts — the engine copies of github-actions and gitlab-ci
// answer the legacy argument forms with the bytes of the unmodified scripts (spec 0303 R8, R13): the
// forms that no spec 0258 or 0301 golden pins, stored under fixtures/skill-scripts/security-0303/legacy.
// The forms those goldens pin are checked by the 0258 oracle and the gitlab-ci baseline suites.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { compareGolden } from "./lib/skill-scripts-golden.ts";
import {
  LEGACY_ROOT,
  legacyCases,
  observeLegacy,
  readLegacy,
  unreadablePreload,
} from "./lib/skill-scripts-secrets-engine.ts";

const preload = unreadablePreload();
const cases = legacyCases(preload);
const isRoot = process.getuid?.() === 0;

describe("legacy argument forms against the goldens of the unmodified scripts", () => {
  test("every stored golden has a case and the reverse", () => {
    const stored = ["github", "gitlab"].flatMap((p) =>
      fs.readdirSync(path.join(LEGACY_ROOT, p)).map((n) => `${p}/${n}`),
    );
    assert.deepEqual(stored.sort(), cases.map((c) => `${c.platform}/${c.case.name}`).sort());
  });
  for (const { platform, case: c } of cases)
    test(`${platform}: ${c.name}`, { skip: isRoot && c.name === "unreadable-file" }, () => {
      const stored = readLegacy(platform, c.name);
      assert.notEqual(stored.size, 0, "no golden stored");
      assert.deepEqual(compareGolden(observeLegacy(c), stored), []);
    });
  test("the sibling help forms keep the legacy text with a platform option in front", () => {
    const gh = observeLegacy({
      name: "x",
      script: "github-actions/check-secrets-exposure",
      args: ["--platform", "bogus", "--help"],
    });
    assert.deepEqual(compareGolden(gh, readLegacy("github", "help-alone")), []);
  });
});
