// model-resolve-select.test.ts — offering selection of `resolveAgent` (spec 0250 R19; spec 0198
// rules (b), (c), (f)): the floor and ceiling clauses, lowest rank, the intelligence-absent path,
// the no-mapping and no-profile cases, and the never-throws guarantee. Bash cases covered:
// C1, C3, C4, C5, C6, C13(i), rule (b) exhaustiveness and R7's tail clause.
//
// Documented as the twin does it, not as parity: a `rank` that is no shell integer never
// compares less (a preserved shell quirk; bash's own `integer expression expected` line is
// NOT reproduced, plan finding S3), and an empty best rank is replaced by the next candidate.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, describe, test } from "node:test";

import { INTELLIGENCE_RUNGS } from "../lib/model-resolve/ladders.ts";
import {
  cleanupTmp,
  coreGuard,
  makeRun,
  miniRoot,
  mkTmp,
  REPO,
  resolveProbe,
  tab,
  TARGETS,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const dir = mkTmp();
// The committed claude guard decides whether the model reaches the frontmatter (directed) or the
// guidance sentence (withheld), so these expectations follow `guard.state` and the one-step
// rollback of spec 0291 R4 needs no test edit.
const CORE_GUARD = coreGuard();
const WITHHELD = CORE_GUARD.state === "withheld";
const GUARD_NOTES = WITHHELD
  ? [
      tab(
        "model-note",
        "probe",
        "claude",
        "guard-withheld",
        `terms=${CORE_GUARD.holding} surface=guidance`,
      ),
    ]
  : [];
const real = (target: string, ...profile: string[]) =>
  resolveProbe(makeRun(REPO), writeProfile(dir, ...profile), target);
const O = (id: string, rank: string, level: string, more = ""): string =>
  `{id: ${id}, rank: ${rank}, native-value: n-${id}, provides: {intelligence: ${level}${more}}}`;
const mini = (offers: string[], ...profile: string[]) =>
  resolveProbe(makeRun(miniRoot(offers)), writeProfile(dir, ...profile), "t");

const TABLE: Record<string, readonly string[]> = {
  claude: ["haiku", "haiku", "haiku", "sonnet", "opus", "fable", "fable"],
  gemini: [
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    ...Array<string>(4).fill("gemini-3.1-pro-preview"),
  ],
  antigravity: [
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-medium",
    ...Array<string>(4).fill("gemini-3.1-pro-high"),
  ],
  copilot: Array<string>(7).fill(""),
};
const noChecker: string | undefined = undefined; // the TypeScript checker needs no yq

describe("C1, C3, C4, C13(i): selection on the real mappings", () => {
  test("C1 canonical example on claude: haiku, effort directed, two-line prose, one guard note", () => {
    const r = real("claude", "intelligence: medium", "reasoning: medium");
    assert.deepEqual(
      [r.offeringId, r.fmLines, r.prose, r.diagLines],
      [
        "haiku",
        WITHHELD ? ["effort: medium"] : ["model: haiku", "effort: medium"],
        (WITHHELD ? "Run this agent on the haiku model. " : "") +
          "Give its work medium reasoning effort.",
        GUARD_NOTES,
      ],
    );
  });

  test("C13(i) an intelligence-only profile on claude records nothing beyond its guard note", () => {
    const r = real("claude", "intelligence: medium");
    assert.deepEqual(
      [r.offeringId, r.fmLines, r.prose, r.diagLines],
      [
        "haiku",
        WITHHELD ? [] : ["model: haiku"],
        WITHHELD ? "Run this agent on the haiku model." : "",
        GUARD_NOTES,
      ],
    );
  });

  test("C4 a composite offering carries reasoning through selection", () => {
    const r = real("antigravity", "intelligence: medium", "reasoning: high");
    assert.deepEqual(
      [r.offeringId, r.fmLines, r.prose, r.diagLines],
      ["gemini-3.8-flash-high", [], "Run this agent on the gemini-3.8-flash-high model.", []],
    );
  });

  for (const target of TARGETS)
    test(`C3 ${target}: the offering chosen at each of the seven rungs`, () => {
      const got = INTELLIGENCE_RUNGS.map(
        (rung) => real(target, `intelligence: ${rung}`).offeringId,
      );
      assert.deepEqual(got, TABLE[target]);
    });

  test(
    "C3 the twin agrees with check-model-mappings.ts --print-selection",
    { skip: noChecker },
    () => {
      for (const target of TARGETS) {
        const file = path.join(REPO, "model-mappings", `${target}.yml`);
        const run = spawnSync(
          process.execPath,
          [
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            path.join(REPO, "scripts", "check-model-mappings.ts"),
            "--print-selection",
            file,
          ],
          { encoding: "utf8" },
        );
        const table = run.stdout
          .trim()
          .split("\n")
          .map((row) => row.split("\t")[2] ?? "");
        assert.deepEqual(table, TABLE[target], target);
      }
    },
  );
});

describe("rule (c) and (f): floor, ceiling, lowest rank", () => {
  test("the floor: the lowest-ranked offering at or above the declared rung", () => {
    assert.equal(
      mini([O("a", "1", "low"), O("b", "2", "high"), O("c", "3", "xhigh")], "intelligence: medium")
        .offeringId,
      "b",
    );
  });

  test("the ceiling clause: nothing at or above the rung selects the highest rung present", () => {
    assert.equal(
      mini([O("a", "1", "low"), O("b", "2", "high"), O("c", "3", "high")], "intelligence: max")
        .offeringId,
      "b",
    );
  });

  test("an offering whose rung is outside the ladder is never a candidate", () => {
    assert.equal(
      mini([O("a", "1", "bogus"), O("b", "2", "high")], "intelligence: low").offeringId,
      "b",
    );
  });

  test("a declared rung outside the ladder selects nothing", () => {
    assert.equal(mini([O("a", "1", "low")], "intelligence: bogus").offeringId, "");
  });

  test("equal ranks: the offering listed first wins", () => {
    assert.equal(
      mini([O("b", "1", "high"), O("a", "1", "high")], "intelligence: high").offeringId,
      "b",
    );
  });

  test("lowest rank wins whatever the file order", () => {
    assert.equal(
      mini([O("a", "9", "high"), O("b", "2", "high"), O("c", "5", "high")], "intelligence: high")
        .offeringId,
      "b",
    );
  });

  test("a rank is a decimal integer: 007 beats 8, and a negative rank beats 0", () => {
    assert.equal(
      mini([O("a", "8", "high"), O("b", "007", "high")], "intelligence: high").offeringId,
      "b",
    );
    assert.equal(
      mini([O("a", "0", "high"), O("b", "-1", "high")], "intelligence: high").offeringId,
      "b",
    );
  });

  test("PRESERVED SHELL QUIRK: a non-integer rank never compares less, so the earlier offering stays", () => {
    assert.equal(
      mini([O("a", "x", "high"), O("b", "5", "high")], "intelligence: high").offeringId,
      "a",
    );
    assert.equal(
      mini([O("a", "5", "high"), O("b", "x", "high")], "intelligence: high").offeringId,
      "a",
    );
    assert.equal(
      mini([O("a", "5", "high"), O("b", "0x1", "high")], "intelligence: high").offeringId,
      "a",
    );
  });

  test("PRESERVED SHELL QUIRK: an empty best rank is replaced by the next candidate", () => {
    const noRank = "{id: a, native-value: n-a, provides: {intelligence: high}}";
    assert.equal(mini([noRank, O("b", "5", "high")], "intelligence: high").offeringId, "b");
  });
});
