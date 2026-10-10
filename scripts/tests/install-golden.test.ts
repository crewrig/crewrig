// install-golden.test.ts — the TypeScript install, manage and link entries reproduce the committed
// golden bytes (spec 0255 R27, PR C step 17). The golden was written by the shell oracle
// (scripts/tests/lib/install-golden-regen.ts) and outlives the differential test, which retires
// in PR E. The suite regenerates nothing and runs only the TypeScript leg.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { collectGolden } from "./lib/extension-run.ts";
import { MODES, observe } from "./lib/install-golden-cases.ts";

const WIN = process.platform === "win32";
const GOLDEN = path.resolve(import.meta.dirname, "fixtures", "install-golden");

describe("the TypeScript entries equal the install golden", () => {
  const stored = collectGolden(GOLDEN);
  const actual = observe("node");
  test("the stored and the produced file sets are the same", () => {
    const want = [...stored.keys()].filter((n) => !(WIN && n === MODES));
    assert.deepEqual([...actual.keys()].sort(), want.sort());
  });
  for (const [name, bytes] of stored) {
    const skip = WIN && name === MODES ? "POSIX file modes" : false;
    test(name, { skip }, () => assert.equal(actual.get(name), bytes.toString("utf8")));
  }
  test("the golden is not empty", () => assert.ok(fs.existsSync(GOLDEN) && stored.size > 0));
});
