// mempalace-pin-compare.test.ts — groups G3, G4 and G6 of the retired
// scripts/tests/test-mempalace-pin.sh (spec 0263, PR E): the range comparator of
// scripts/lib/mempalace_pin.py on every branch.
//
// Two distinct claims, asserted separately: (1) check() returns the right verdict for a
// version against [min, max) — verdict_rows.py asserts check()'s OWN verdict on every
// branch, never only the comparator label; (2) the fallback is never more permissive than
// `packaging` (see mempalace-pin-corpus.test.ts). Three comparator branches are forced:
// the SHIELD (a stub `packaging` whose version submodule raises ImportError), the
// PROVIDER (a minimal stand-in that makes check() take its `packaging` branch; a branch
// selector, never an oracle), and the REAL library. The real-library leg needs an
// interpreter with `packaging`: it FAILS under CI and skips elsewhere with the reason.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { requireOrSkip } from "./lib/capability.ts";
import {
  LIB_DIR,
  PACKAGING_HINT,
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

function expectVerdict(version: string, want: "IN_RANGE" | "OUT_OF_RANGE"): void {
  const res = checkVersion(rig, version, { pythonpath: rig.shield });
  assert.equal(res.rc, want === "IN_RANGE" ? 0 : 1, `'${version}': ${res.out}`);
  assert.ok(res.out.startsWith(`${want} `), `'${version}': ${res.out}`);
  assert.ok(res.out.includes("comparator=stdlib-whitelist"), `'${version}': ${res.out}`);
}

describe("G3 regression rows: the strings that broke a blacklist-shaped comparator", () => {
  // Every one is InvalidVersion to `packaging`, so a fallback accepting any would be
  // MORE permissive than its own primary comparator.
  const refused = (): string[] =>
    ["-git", "-nightly", ".unknown", "_1", "~1", "+", ":1"].map((s) => `${pin.min}${s}`);
  test("non-canonical suffixes are refused by the fallback", () => {
    for (const version of refused()) expectVerdict(version, "OUT_OF_RANGE");
  });

  test("the rows the grammar must keep serving", () => {
    for (const s of ["", ".post1", "+local", ".0"]) expectVerdict(`${pin.min}${s}`, "IN_RANGE");
  });

  test("the rows it must refuse in the safe direction", () => {
    // `-1` normalises to `.post1` under packaging; the whitelist refuses it deliberately.
    for (const version of [pin.max, `${pin.max}.0`, `${pin.min}-1`, `1!${pin.min}`])
      expectVerdict(version, "OUT_OF_RANGE");
  });
});

function verdictRows(
  python: string | undefined,
  pythonpath: string | undefined,
  comparator: string,
): void {
  const res = runDriver(rig, "verdict_rows.py", [LIB_DIR, pin.min, pin.max, comparator], {
    python,
    pythonpath,
  });
  assert.equal(res.rc, 0, `check() verdict, comparator or row construction is wrong:\n${res.out}`);
  assert.ok(res.out.includes(`comparator=${comparator}`), res.out);
}

describe("G4 the range comparison itself: check()'s own verdict on every branch", () => {
  test("G4a the packaging branch, forced via the provider stand-in", () => {
    verdictRows(undefined, rig.provider, "packaging");
  });

  test("G4b the fallback branch, forced via the shield", () => {
    verdictRows(undefined, rig.shield, "stdlib-whitelist");
  });

  test("G4c the packaging branch against the real library", (t) => {
    if (!requireOrSkip(t, packagingPython !== undefined, PACKAGING_HINT)) return;
    verdictRows(packagingPython, undefined, "packaging");
  });
});

describe("G6 InvalidVersion refuses on the packaging branch", () => {
  const invalid = (): string => `${pin.min}-git`;
  const check = (res: { rc: number; out: string }): void => {
    assert.equal(res.rc, 1, res.out);
    assert.match(res.out, /^OUT_OF_RANGE.*comparator=packaging/s);
  };

  test("provider: an InvalidVersion string is refused, not ignored", () => {
    check(checkVersion(rig, invalid(), { pythonpath: rig.provider }));
  });

  test("real library: the same string is refused", (t) => {
    if (!requireOrSkip(t, packagingPython !== undefined, PACKAGING_HINT)) return;
    check(checkVersion(rig, invalid(), { python: packagingPython }));
  });
});
