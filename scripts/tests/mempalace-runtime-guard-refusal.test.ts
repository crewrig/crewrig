// mempalace-runtime-guard-refusal.test.ts — the launch-time version guard of
// scripts/lib/mempalace-http-wrapper.py refuses out-of-range installs (spec 0108
// R1-R6, issue #623). Ports sections 0-6 of the retired Bash suite for the guard
// (G1-G7 of spec 0263). The wrapper runs for real under Python against a
// fabricated interpreter environment; see lib/mempalace-guard-fixture.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  assertRefusalFields,
  BELOW_FLOOR,
  buildFixture,
  cleanupScratch,
  COMMON_SH,
  EXPECTED_RANGE,
  expectedComparator,
  interpreterAvailable,
  PIN,
  PIN_MODULE,
  PYTHON_BIN,
  runGuard,
  SENTINEL,
} from "./lib/mempalace-guard-fixture.ts";

before(() => {
  assert.ok(interpreterAvailable(), `interpreter not found: ${PYTHON_BIN}`);
});
after(cleanupScratch);

const comparator = expectedComparator();

function pinCheck(version: string): number | null {
  return spawnSync(PYTHON_BIN, [PIN_MODULE, "--common-sh", COMMON_SH, "--check", version], {
    stdio: "ignore",
  }).status;
}

describe("G1 preconditions", () => {
  test("below-floor fixture version is outside the committed pin", () => {
    assert.notEqual(pinCheck(BELOW_FLOOR), 0, `${BELOW_FLOOR} is INSIDE ${EXPECTED_RANGE}`);
  });
  test("in-range fixture version is inside the committed pin", () => {
    assert.equal(pinCheck(PIN.min), 0, `${PIN.min} is OUTSIDE ${EXPECTED_RANGE}`);
  });
});

describe("G2-G3 out-of-range dist-info refuses (Phase A in isolation)", () => {
  test("below-floor refuses with the full R3/R4 field set", () => {
    const run = runGuard(buildFixture({ name: "below-floor", dist: BELOW_FLOOR, attr: PIN.min }));
    assert.notEqual(run.rc, 0, "an out-of-range MemPalace began serving");
    assertRefusalFields(run, BELOW_FLOOR, "importlib.metadata", comparator);
  });
  test("above-ceiling (the exclusive max itself) refuses likewise", () => {
    const run = runGuard(buildFixture({ name: "above-ceiling", dist: PIN.max, attr: PIN.min }));
    assert.notEqual(run.rc, 0, "an out-of-range MemPalace began serving");
    assertRefusalFields(run, PIN.max, "importlib.metadata", comparator);
  });
});

describe("G4 in-range serves unchanged (R6)", () => {
  test("exit 0, stdout exactly the sentinel, stderr silent", () => {
    const run = runGuard(buildFixture({ name: "in-range", dist: PIN.min, attr: PIN.min }));
    assert.equal(run.rc, 0, run.stderr);
    assert.equal(run.stdout.trimEnd(), SENTINEL);
    assert.equal(run.stdout, `${SENTINEL}\n`);
    assert.equal(run.stderr, "");
  });
});

describe("G5-G6 the two bound-less refusal paths", () => {
  test("pin unreadable: names the cause and the declaration repair", () => {
    const root = buildFixture({ name: "pin-unreadable", dist: PIN.min, attr: PIN.min });
    const common = path.join(root, "lib", "common.sh");
    const kept = fs
      .readFileSync(common, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("MEMPALACE_MIN_VERSION="));
    fs.writeFileSync(common, kept.join("\n"));
    const run = runGuard(root);
    assert.notEqual(run.rc, 0, "an unverifiable install began serving");
    assert.ok(run.stderr.includes("the supported-version pin could not be read"), run.stderr);
    assert.ok(run.stderr.includes("must be restarted"));
    assert.ok(!run.stderr.includes("Traceback (most recent call last)"));
    assert.ok(run.stderr.includes("repair the pin declaration in"));
    assert.ok(!run.stderr.includes("re-run the framework setup"));
  });
  test("guard module unimportable: fails closed with the setup remedy, no traceback", () => {
    const root = buildFixture({ name: "guard-unimportable", dist: PIN.min, attr: PIN.min });
    fs.writeFileSync(
      path.join(root, "lib", "mempalace_pin.py"),
      'raise ImportError("deliberately broken by mempalace-runtime-guard-refusal.test.ts")\n',
    );
    const run = runGuard(root);
    assert.notEqual(run.rc, 0, "a session started with no version guard at all");
    assert.ok(run.stderr.includes("could not be imported"), run.stderr);
    assert.ok(!run.stderr.includes("Traceback (most recent call last)"));
    assert.ok(run.stderr.includes("re-run the framework setup"));
    assert.ok(!run.stderr.includes("repair the pin declaration in"));
    assert.ok(run.stderr.includes("must be restarted"));
  });
});

describe("G7 no distribution metadata", () => {
  test("fails closed under -S with the full field set", () => {
    const run = runGuard(buildFixture({ name: "no-dist-info", dist: null, attr: PIN.min }), {
      flags: ["-S"],
    });
    assert.notEqual(run.rc, 0, "a version-less install began serving");
    assert.ok(run.stderr.includes("no mempalace distribution metadata is resolvable"), run.stderr);
    assertRefusalFields(run, "none resolvable", "importlib.metadata", "not reached");
  });
});

describe("Phase B module attribute", () => {
  test("an out-of-range mempalace.__version__ refuses, sourced to the attribute", () => {
    const run = runGuard(
      buildFixture({ name: "phase-b-refuse", dist: PIN.min, attr: BELOW_FLOOR }),
    );
    assert.notEqual(run.rc, 0, "an out-of-range module attribute was ignored");
    assert.ok(run.stderr.includes("source: mempalace.__version__"), run.stderr);
    assertRefusalFields(run, BELOW_FLOOR, "mempalace.__version__", comparator);
  });
});
