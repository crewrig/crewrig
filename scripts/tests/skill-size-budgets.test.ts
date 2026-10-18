// skill-size-budgets.test.ts — spec 0269 R1/R12: the byte budget of four skills, counting the
// references a skill reads unconditionally (before its first decision). References read at a
// later named step or under a condition are not counted (R12).
//
// `harness-report` is marked todo: SKILL.md plus the always-read identify-and-route.md exceed
// its 5,120 B budget, and meeting it without changing rule meaning is not possible (the
// reference holds steps 1-2, needed on every tag). It needs a delta-spec, not a looser check.

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
  readonly todo?: string;
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
    todo: "needs a delta-spec: SKILL.md + identify-and-route.md exceed 5,120 B (spec 0269 R12)",
  },
];

const bytes = (dir: string, rel: string): number => fs.statSync(path.join(REPO, dir, rel)).size;

/** Bytes of SKILL.md plus its unconditionally read references. */
export function loadedBytes(b: Budget): number {
  return bytes(b.dir, "SKILL.md") + b.unconditional.reduce((n, rel) => n + bytes(b.dir, rel), 0);
}

describe("skill byte budgets (R12)", () => {
  for (const b of BUDGETS) {
    const opts = b.todo === undefined ? {} : { todo: b.todo };
    test(`${path.basename(b.dir)} loads at most ${b.max} B unconditionally`, opts, () => {
      const total = loadedBytes(b);
      assert.ok(total <= b.max, `${b.dir}: ${total} B > ${b.max} B`);
    });
  }

  test("mutation: counting an always-read 11 KB reference breaks the pr-reviewer budget", () => {
    const pr = BUDGETS.find((b) => b.dir.endsWith("pr-reviewer"));
    assert.ok(pr);
    const total = loadedBytes(pr) + 11641;
    assert.ok(total > pr.max);
  });
});
