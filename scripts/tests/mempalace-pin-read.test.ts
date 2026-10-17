// mempalace-pin-read.test.ts — groups G1 and G2 of the retired
// scripts/tests/test-mempalace-pin.sh (spec 0263, PR E): the Python read_pin against the
// real common.sh and against fixtures derived from it by text transform.
// G1's print-pin leg duplicates one assertion of mempalace-pin.test.ts ("the real
// common.sh agrees...") on purpose: the oracle here is an independent regex.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  COMMON_SH,
  PIN_MODULE,
  type Rig,
  makeRig,
  printPin,
  readPin,
} from "./lib/mempalace-pin-rig.ts";

let rig: Rig;
before(() => {
  rig = makeRig();
});
after(() => rig.cleanup());

describe("G1 read_pin against the repository's real common.sh", () => {
  test("--print-pin returns the pin declared in common.sh", () => {
    const pin = readPin();
    const res = printPin(rig, COMMON_SH);
    assert.equal(res.rc, 0, res.out);
    assert.equal(res.out, `min=${pin.min} max=${pin.max}`);
  });

  test("mempalace_pin.py carries neither bound as a bare substring (R5)", () => {
    const pin = readPin();
    const lines = fs.readFileSync(PIN_MODULE, "utf8").split("\n");
    for (const bound of [pin.min, pin.max]) {
      const hits = lines.filter((line) => line.includes(bound));
      assert.deepEqual(hits, [], `bound literal '${bound}' present in ${PIN_MODULE}`);
    }
  });
});

/** A fixture common.sh derived from the real one, so no pin literal is authored here. */
function derive(name: string, transform: (text: string) => string): string {
  const file = path.join(rig.root, `${name}.sh`);
  fs.writeFileSync(file, transform(fs.readFileSync(COMMON_SH, "utf8")));
  return file;
}

const MIN_LINE = /^MEMPALACE_MIN_VERSION="([^"]*)"$/m;

const REFUSALS: ReadonlyArray<readonly [string, (text: string) => string]> = [
  ["min-version line deleted", (t) => t.replace(/^MEMPALACE_MIN_VERSION=.*\n/m, "")],
  ["min-version line duplicated", (t) => t.replace(MIN_LINE, (line) => `${line}\n${line}`)],
  [
    "export-prefixed declaration",
    (t) => t.replace(/^MEMPALACE_MIN_VERSION=/m, "export MEMPALACE_MIN_VERSION="),
  ],
  ["unquoted value", (t) => t.replace(MIN_LINE, "MEMPALACE_MIN_VERSION=$1")],
];

describe("G2 read_pin's single-declaration contract", () => {
  for (const [label, transform] of REFUSALS) {
    test(`${label}: refused with a PIN_ERROR diagnostic`, () => {
      const fixture = derive(label.replace(/\W+/g, "-"), transform);
      assert.notEqual(fs.readFileSync(fixture, "utf8"), fs.readFileSync(COMMON_SH, "utf8"));
      const res = printPin(rig, fixture);
      assert.notEqual(res.rc, 0, `accepted an ambiguous pin ('${res.out}')`);
      assert.ok(res.out.startsWith("PIN_ERROR"), res.out);
    });
  }

  test("absent common.sh: refused with a PIN_ERROR diagnostic", () => {
    const res = printPin(rig, path.join(rig.root, "does-not-exist.sh"));
    assert.notEqual(res.rc, 0, res.out);
    assert.ok(res.out.startsWith("PIN_ERROR"), res.out);
  });
});
