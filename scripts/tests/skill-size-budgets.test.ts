// skill-size-budgets.test.ts — spec 0269 R1/R12: the byte budget of four skills, counting the
// references a skill reads unconditionally (before its first decision). References read at a
// later named step or under a condition are not counted (R12).
//
// `harness-report` follows delta-01 (requirement 13a): SKILL.md alone is held to 5,120 B and
// SKILL.md plus the always-read references/identify-and-route.md to 7,168 B.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

interface Budget {
  readonly dir: string;
  readonly max: number;
  /** References read unconditionally, relative to the skill directory. */
  readonly unconditional: readonly string[];
  /** Delta-01 R13a: ceiling for SKILL.md plus its unconditional references. */
  readonly combinedMax?: number;
}

const BUDGETS: readonly Budget[] = [
  { dir: "artifacts/library/skills/user-validate", max: 8192, unconditional: [] },
  {
    dir: "artifacts/core/skills/spec-author",
    max: 12288,
    // interview-script, pre-write-grounding and output-contract are read at later named steps.
    unconditional: [],
  },
  {
    dir: "artifacts/core/skills/pr-reviewer",
    max: 10240,
    unconditional: ["references/step-1-preflight.md"],
  },
  {
    dir: "artifacts/library/skills/harness-report",
    max: 5120,
    unconditional: ["references/identify-and-route.md"],
    combinedMax: 7168,
  },
];

const bytes = (dir: string, rel: string): number => fs.statSync(path.join(REPO, dir, rel)).size;

/** Bytes of SKILL.md plus its unconditionally read references. */
export function loadedBytes(b: Budget): number {
  return bytes(b.dir, "SKILL.md") + b.unconditional.reduce((n, rel) => n + bytes(b.dir, rel), 0);
}

/** The checks of one budget: [label, measured, ceiling]. */
export function checksOf(b: Budget): [string, number, number][] {
  if (b.combinedMax === undefined) return [["loads unconditionally", loadedBytes(b), b.max]];
  return [
    ["SKILL.md body", bytes(b.dir, "SKILL.md"), b.max],
    ["SKILL.md plus always-read references", loadedBytes(b), b.combinedMax],
  ];
}

describe("skill byte budgets (R12, delta-01 R13a)", () => {
  for (const b of BUDGETS) {
    for (const [label, measured, ceiling] of checksOf(b)) {
      test(`${path.basename(b.dir)}: ${label} is at most ${ceiling} B`, () => {
        assert.ok(measured <= ceiling, `${b.dir}: ${measured} B > ${ceiling} B`);
      });
    }
  }

  test("mutation: counting an always-read 11 KB reference breaks the pr-reviewer budget", () => {
    const pr = BUDGETS.find((b) => b.dir.endsWith("pr-reviewer"));
    assert.ok(pr);
    assert.ok(loadedBytes(pr) + 11641 > pr.max);
  });

  test("mutation: a 7,236 B harness-report combined size breaks the R13a ceiling", () => {
    const hr = BUDGETS.find((b) => b.dir.endsWith("harness-report"));
    assert.ok(hr?.combinedMax !== undefined);
    assert.ok(7236 > hr.combinedMax);
    assert.ok(loadedBytes(hr) + (7236 - loadedBytes(hr)) > hr.combinedMax);
  });

  test("mutation: a body over 5,120 B breaks the harness-report body budget", () => {
    const hr = BUDGETS.find((b) => b.dir.endsWith("harness-report"));
    assert.ok(hr);
    assert.ok(bytes(hr.dir, "SKILL.md") + 100 > hr.max);
  });
});
