// mempalace-pin-corpus.test.ts — groups G5 and G7 of the retired
// scripts/tests/test-mempalace-pin.sh (spec 0263, PR E): the safety invariant over a
// generated corpus, and the import safety of mempalace_pin.py.
//
// Arm A always runs with `packaging` shielded out (the fallback provably decides) and
// re-checks every accepted string against an independently authored grammar. Arm B is
// the differential against the REAL library (zero strings where the fallback accepts and
// `packaging` refuses); it, and the shield-effectiveness proof, need an interpreter with
// `packaging` and FAIL under CI / skip elsewhere with the reason.

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import {
  LIB_DIR,
  PACKAGING_HINT,
  PIN_MODULE,
  type Pin,
  type Rig,
  checkVersion,
  findPackagingPython,
  makeRig,
  readPin,
  runDriver,
} from "./lib/mempalace-pin-rig.ts";

let rig: Rig;
let pin: Pin;
let packagingPython: string | undefined;
before(() => {
  rig = makeRig();
  pin = readPin();
  packagingPython = findPackagingPython(rig);
});
after(() => rig.cleanup());

function field(out: string, key: string): number {
  const match = new RegExp(`^${key}=(\\d+)$`, "m").exec(out);
  assert.ok(match !== null, `no ${key}= line in:\n${out}`);
  return Number(match[1]);
}

describe("G5 the invariant over a generated corpus", () => {
  test("Arm A: the fallback accepts only grammar strings that order by release tuple", () => {
    const res = runDriver(rig, "corpus_driver.py", [LIB_DIR, "a", pin.min, pin.max], {
      pythonpath: rig.shield,
    });
    assert.equal(res.rc, 0, `the fallback accepted a string outside its grammar:\n${res.out}`);
    // The OBSERVED label proves the shield worked.
    assert.ok(res.out.includes("comparator=stdlib-whitelist"), res.out);
    assert.ok(field(res.out, "corpus_size") >= 400, `corpus degenerated:\n${res.out}`);
    assert.ok(field(res.out, "fallback_accepted") > 0, `accept path never exercised:\n${res.out}`);
  });

  test("the shield flips the comparator on an interpreter that has packaging", (t) => {
    if (!requireOrSkip(t, packagingPython !== undefined, PACKAGING_HINT)) return;
    const unshielded = checkVersion(rig, pin.min, { python: packagingPython });
    const shielded = checkVersion(rig, pin.min, {
      python: packagingPython,
      pythonpath: rig.shield,
    });
    assert.ok(unshielded.out.includes("comparator=packaging"), unshielded.out);
    assert.ok(shielded.out.includes("comparator=stdlib-whitelist"), shielded.out);
  });

  test("Arm B: zero strings where the fallback accepts and packaging refuses", (t) => {
    if (!requireOrSkip(t, packagingPython !== undefined, PACKAGING_HINT)) return;
    const res = runDriver(rig, "corpus_driver.py", [LIB_DIR, "b", pin.min, pin.max], {
      python: packagingPython,
    });
    assert.equal(res.rc, 0, `the fallback is more permissive than packaging:\n${res.out}`);
    assert.ok(res.out.includes("comparator=packaging"), res.out);
    assert.equal(field(res.out, "fallback_accept_packaging_refuse"), 0, res.out);
  });
});

describe("G7 the module is import-safe inside a JSON-RPC process", () => {
  test("a __main__ guard exists and no print()/sys.argv precedes it", () => {
    const res = runDriver(rig, "import_safety.py", [PIN_MODULE]);
    assert.ok(/^guard_line=\d+$/m.test(res.out), `no '__main__' guard:\n${res.out}`);
    assert.equal(res.rc, 0, `print()/sys.argv outside the guard:\n${res.out}`);
    assert.equal(field(res.out, "strays"), 0, res.out);
  });

  test("nothing third-party is imported at module scope", () => {
    const res = runDriver(rig, "import_safety.py", [PIN_MODULE]);
    const guardLine = field(res.out, "guard_line");
    const head = fs.readFileSync(PIN_MODULE, "utf8").split("\n").slice(0, guardLine);
    assert.ok(head.length === guardLine, "head extraction failed");
    const hits = head.filter((line) =>
      /^(import|from) (packaging|chromadb|mempalace)\b/.test(line),
    );
    assert.deepEqual(hits, []);
  });
});
