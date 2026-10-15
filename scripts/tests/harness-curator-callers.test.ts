// harness-curator-callers.test.ts — every text that calls the three curator scripts names the `.ts`
// entry run through Node (spec 0258 requirements 32 and 35), with a self-test that proves the guard
// is not vacuous. The shims themselves, test.sh and the historical docstrings are not callers.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CALLERS,
  checkCaller,
  readCaller,
  retiredSpellings,
} from "./lib/harness-curator-callers.ts";

describe("curator callers: every text names the `.ts` entry run through Node", () => {
  for (const caller of CALLERS)
    test(caller.file, () => assert.deepEqual(checkCaller(caller, readCaller(caller)), []));

  test("the guard is not vacuous: it fails on the old spelling and on a missing new one", () => {
    const [first] = CALLERS;
    assert.ok(first !== undefined);
    const text = readCaller(first);
    assert.deepEqual(checkCaller(first, text), []);
    assert.equal(checkCaller(first, `${text}\nbash scripts/curate.sh --apply\n`).length, 1);
    assert.equal(checkCaller(first, `${text}\nscripts/setup-labels.sh x\n`).length, 1);
    assert.equal(checkCaller(first, `${text}\nschedule-curator.sh\n`).length, 1);
    assert.equal(
      checkCaller(first, text.replaceAll("node scripts/curate.ts --dry-run", "x")).length,
      1,
    );
    assert.deepEqual(retiredSpellings("test.sh and curate.ts and curate.py stay"), []);
  });
});
