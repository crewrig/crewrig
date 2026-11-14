// skill-evals-plan.test.ts — the pure sampling plan (spec 0304 R1-R4, R12): every boundary of the
// stage decisions on integer counts, the stage path, the exact Fisher figures as rationals and the
// regression test at exactly 0.10 on both conditions. plan.ts is tested directly: no file, no clock.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  atLeast,
  decideSkill,
  finalVerdict,
  fisherOneSided,
  planMaximum,
  poolState,
  rational,
  regressionTest,
  stage1Verdict,
  stagePathRuns,
} from "../lib/skill-evals/plan.ts";
import { SAMPLING_PLAN } from "../lib/skill-evals/settings.ts";

/** `passes` of `runs` as one array of pass flags per item (items x perItem). */
function pool(items: number, perItem: number, passes: number): boolean[][] {
  let left = passes;
  return Array.from({ length: items }, () =>
    Array.from({ length: perItem }, () => {
      const ok = left > 0;
      if (ok) left -= 1;
      return ok;
    }),
  );
}

/** Reduced fractions are compared by cross-multiplication. */
function sameFraction(p: { num: bigint; den: bigint }, n: bigint, d: bigint): boolean {
  return p.num * d === n * p.den;
}

test("R1: the plan constant carries exactly the declared members and values", () => {
  assert.deepEqual(SAMPLING_PLAN, {
    id: "two-stage-1",
    evalRunsPerStage: [2, 2],
    probeRunsPerStage: [1, 1],
    acceptStage1: 0.9,
    rejectStage1: 0.6,
    acceptFinal: 0.75,
    regression: { test: "fisher-one-sided", alpha: 0.1, minDrop: 0.1 },
  });
});

test("R2: comparisons are exact on integer counts (9 of 10 meets 0.90, 11 of 12 too)", () => {
  assert.deepEqual(rational(0.9), { n: 9n, d: 10n });
  assert.equal(atLeast(9, 10, 0.9), true);
  assert.equal(atLeast(8, 10, 0.9), false);
  assert.equal(atLeast(11, 12, 0.9), true);
  assert.equal(atLeast(18, 24, 0.75), true);
  assert.equal(atLeast(17, 24, 0.75), false);
  assert.throws(() => rational(1e-7), /plain decimal/);
});

test("R2 stage 1: 11 of 12 accepts, 8 of 12 continues, 7 of 12 rejects", () => {
  assert.equal(stage1Verdict(11, 12), "accepted");
  assert.equal(stage1Verdict(8, 12), "continue");
  assert.equal(stage1Verdict(7, 12), "rejected");
  assert.equal(stage1Verdict(9, 10), "accepted");
  assert.equal(stage1Verdict(8, 10), "continue");
  assert.equal(stage1Verdict(6, 10), "continue");
  assert.equal(stage1Verdict(5, 10), "rejected");
});

test("R2 stage 2: the cumulative 18 of 24 is accepted and 17 of 24 rejected", () => {
  assert.equal(finalVerdict(18, 24), "accepted");
  assert.equal(finalVerdict(17, 24), "rejected");
});

test("R2 probes: 8 of 8 accepts at stage 1, 7 of 8 continues, and the final bar is 0.75", () => {
  assert.equal(stage1Verdict(8, 8), "accepted");
  assert.equal(stage1Verdict(7, 8), "continue");
  assert.equal(finalVerdict(12, 16), "accepted");
  assert.equal(finalVerdict(11, 16), "rejected");
});

test("poolState: a pool with a short item is pending with the missing slots of the stage", () => {
  const rows = [[true, true], [true], [true, true]];
  const s = poolState(rows, [2, 2]);
  assert.equal(s.verdict, "pending");
  assert.equal(s.stage, 1);
  assert.deepEqual(s.remaining, [0, 1, 0]);
  assert.equal(s.prescribed, undefined);
});

test("poolState: stage 1 accepted decides with the stage-1 path of 2 runs per eval", () => {
  const s = poolState(pool(6, 2, 11), [2, 2]);
  assert.equal(s.verdict, "accepted");
  assert.equal(s.stage, 1);
  assert.equal(s.prescribed, 2);
  assert.deepEqual(s.remaining, [0, 0, 0, 0, 0, 0]);
});

test("poolState: 8 of 12 continues, then asks 2 more runs of every eval", () => {
  const s = poolState(pool(6, 2, 8), [2, 2]);
  assert.equal(s.verdict, "pending");
  assert.equal(s.stage, 2);
  assert.equal(s.stage1, "continue");
  assert.deepEqual(s.remaining, [2, 2, 2, 2, 2, 2]);
});

test("poolState: 7 of 12 is rejected with no stage 2", () => {
  const s = poolState(pool(6, 2, 7), [2, 2]);
  assert.equal(s.verdict, "rejected");
  assert.equal(s.stage, 1);
  assert.deepEqual(s.remaining, [0, 0, 0, 0, 0, 0]);
});

test("poolState: a pool that continued is decided at 18 of 24 and rejected at 17 of 24", () => {
  const stage1 = [true, true, true, true, true, true, true, true, false, false, false, false];
  const mk = (extra: number) => {
    const rows: boolean[][] = [];
    for (let i = 0; i < 6; i++) rows.push([stage1[i * 2], stage1[i * 2 + 1]]);
    let left = extra;
    for (const r of rows)
      for (let k = 0; k < 2; k++) {
        r.push(left > 0);
        left -= 1;
      }
    return rows;
  };
  const accepted = poolState(mk(10), [2, 2]);
  assert.equal(accepted.verdict, "accepted");
  assert.equal(accepted.passes, 18);
  assert.equal(accepted.prescribed, 4);
  assert.equal(poolState(mk(9), [2, 2]).verdict, "rejected");
});

test("poolState: the stage-2 trigger depends on the stage-1 runs only, not on later runs", () => {
  const rows = pool(5, 2, 10);
  rows[0].push(false, false); // extra recorded runs beyond the path never undo an accepted stage 1
  assert.equal(poolState(rows, [2, 2]).verdict, "accepted");
});

test("R4: stage path runs and the plan maximum (6 evals and 12 probes is 48, fits 60)", () => {
  assert.equal(stagePathRuns(6, [2, 2], false), 12);
  assert.equal(stagePathRuns(6, [2, 2], true), 24);
  assert.equal(stagePathRuns(8, [1, 1], false), 8);
  assert.equal(planMaximum(6, 12), 48);
  assert.equal(planMaximum(6, 8), 40);
  assert.equal(planMaximum(4, 5), 26);
  assert.equal(planMaximum(7, 0), 28);
});

test("R12: the Fisher figures of the scenarios are exact rationals", () => {
  const base24 = { passes: 24, runs: 24 };
  assert.equal(
    sameFraction(fisherOneSided({ passes: 20, runs: 24 }, base24), 10626n, 194580n),
    true,
  );
  assert.equal(sameFraction(fisherOneSided({ passes: 21, runs: 24 }, base24), 2024n, 17296n), true);
  assert.equal(
    sameFraction(fisherOneSided({ passes: 18, runs: 24 }, base24), 134596n, 12271512n),
    true,
  );
  // 134596/12271512 is 133/12126 in lowest terms: the reduced form is what plan.ts returns.
  assert.equal(sameFraction(fisherOneSided({ passes: 18, runs: 24 }, base24), 133n, 12126n), true);
  assert.equal(fisherOneSided({ passes: 18, runs: 24 }, base24).den, 12126n);
  assert.equal(
    sameFraction(fisherOneSided({ passes: 20, runs: 24 }, { passes: 6, runs: 6 }), 10626n, 27405n),
    true,
  );
});

test("R12: the legacy figure 10626/27405 is 0.388 and the reduced form is what is returned", () => {
  const p = fisherOneSided({ passes: 20, runs: 24 }, { passes: 6, runs: 6 });
  assert.equal(sameFraction(p, 10626n, 27405n), true);
  assert.equal(Math.round((Number(p.num) / Number(p.den)) * 1000) / 1000, 0.388);
});

test("R12 scenario: 20 of 24 against 24 of 24 is a regression, 21 of 24 is not, 18 of 24 is", () => {
  const base = { passes: 24, runs: 24 };
  const r20 = regressionTest({ passes: 20, runs: 24 }, base);
  assert.equal(r20.holds, true);
  assert.equal(r20.dropHolds && r20.pHolds, true);
  assert.equal(Math.round(r20.drop * 1000) / 1000, 0.167);
  assert.equal(Math.round(r20.pValue * 1000) / 1000, 0.055);
  const r21 = regressionTest({ passes: 21, runs: 24 }, base);
  assert.equal(r21.dropHolds, true);
  assert.equal(r21.pHolds, false);
  assert.equal(Math.round(r21.pValue * 1000) / 1000, 0.117);
  const r18 = regressionTest({ passes: 18, runs: 24 }, base);
  assert.equal(r18.holds, true);
  assert.equal(Math.round(r18.pValue * 1000) / 1000, 0.011);
});

test("R12: the test fires only where the spec lists it (22 and 20 of 24 never, a legacy base never)", () => {
  assert.equal(regressionTest({ passes: 22, runs: 24 }, { passes: 24, runs: 24 }).holds, false);
  for (const head of [18, 19, 20]) {
    assert.equal(regressionTest({ passes: head, runs: 24 }, { passes: 24, runs: 24 }).holds, true);
  }
  for (const base of [6, 5, 4]) {
    for (let head = 18; head <= 24; head++)
      assert.equal(
        regressionTest({ passes: head, runs: 24 }, { passes: base, runs: 6 }).holds,
        false,
        `head ${head}/24 vs legacy ${base}/6`,
      );
  }
  // 18 or 19 against 23 of 24 and 16 of 16; 18 against 12 of 12.
  assert.equal(regressionTest({ passes: 19, runs: 24 }, { passes: 23, runs: 24 }).holds, true);
  assert.equal(regressionTest({ passes: 19, runs: 24 }, { passes: 16, runs: 16 }).holds, true);
  assert.equal(regressionTest({ passes: 18, runs: 24 }, { passes: 12, runs: 12 }).holds, true);
  assert.equal(regressionTest({ passes: 19, runs: 24 }, { passes: 12, runs: 12 }).holds, false);
});

test("R12: a drop of exactly 0.10 holds (the comparison is on integers), 0.083 does not", () => {
  // 9/10 against 10/10: drop exactly 0.10; p is then large, so only the drop condition is read.
  const exact = regressionTest({ passes: 90, runs: 100 }, { passes: 100, runs: 100 });
  assert.equal(exact.dropHolds, true);
  const below = regressionTest({ passes: 22, runs: 24 }, { passes: 24, runs: 24 });
  assert.equal(Math.round(below.drop * 1000) / 1000, 0.083);
  assert.equal(below.dropHolds, false);
  assert.equal(below.holds, false);
});

test("R12: p exactly equal to alpha is not below it (strict), found by a search over counts", () => {
  // Find head/base counts whose reduced p is exactly 1/10 and check the strict comparison.
  let found = false;
  for (let n = 2; n <= 12 && !found; n++)
    for (let m = 2; m <= 12 && !found; m++)
      for (let a = 0; a <= n && !found; a++)
        for (let b = 0; b <= m && !found; b++) {
          const p = fisherOneSided({ passes: a, runs: n }, { passes: b, runs: m });
          if (p.num * 10n === p.den) {
            found = true;
            const r = regressionTest({ passes: a, runs: n }, { passes: b, runs: m });
            assert.equal(r.pHolds, false, `p = ${p.num}/${p.den} is not below 0.10`);
          }
        }
  assert.equal(found, true, "no count pair gives p of exactly 0.10 in the searched range");
});

test("R3: a rejected pool is fail before the regression test, whatever the base", () => {
  // stage 1 at 8 of 12 continues; stage 2 adds nothing: 8 of 24 is rejected and the test is not evaluated
  const rows = [
    [true, true, false, false],
    [true, true, false, false],
    [true, true, false, false],
    [true, true, false, false],
    [false, false, false, false],
    [false, false, false, false],
  ];
  const fail = decideSkill({
    evals: rows,
    compare: { head: { passes: 8, runs: 24 }, base: { passes: 24, runs: 24 } },
  });
  assert.equal(fail.status, "fail");
  assert.equal(fail.regression, null);
  // a pool rejected at stage 1 never reaches stage 2 either
  assert.equal(decideSkill({ evals: pool(6, 2, 7) }).status, "fail");
});

test("R3: an unfinished pool is in-progress and never pass", () => {
  assert.equal(decideSkill({ evals: pool(6, 1, 6) }).status, "in-progress");
  assert.equal(decideSkill({ evals: pool(6, 2, 8) }).status, "in-progress");
});

test("R3: pass and regression come from the pools then the test: 20 of 24 against 24 of 24 is a regression, against 12 of 24 a pass", () => {
  // stage 1: 8 of 12 (continues), stage 2: 12 of 12 more = 20 of 24, accepted by the absolute bar
  const rows = [
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
    [false, false, true, true],
    [false, false, true, true],
  ];
  const head = { passes: 20, runs: 24 };
  const reg = decideSkill({ evals: rows, compare: { head, base: { passes: 24, runs: 24 } } });
  assert.equal(reg.status, "regression");
  assert.equal(reg.regression?.holds, true);
  assert.deepEqual(reg.stageReached, { evals: 2, probes: null });
  const better = decideSkill({ evals: rows, compare: { head, base: { passes: 12, runs: 24 } } });
  assert.equal(better.status, "pass");
  assert.equal(better.regression?.holds, false);
  assert.equal(decideSkill({ evals: rows }).status, "pass", "not compared: the pools alone decide");
  assert.equal(decideSkill({ evals: rows, compare: null }).regression, null);
});

test("R2/R3: the probe pool is decided apart (8 of 8 accepted, evals continue) and a skill with no probe has none", () => {
  const d = decideSkill({ evals: pool(6, 2, 8), probes: pool(8, 1, 8) });
  assert.deepEqual(d.stageReached, { evals: 2, probes: 1 });
  assert.equal(d.probes?.verdict, "accepted");
  const none = decideSkill({ evals: pool(6, 2, 12), probes: [] });
  assert.equal(none.probes, null);
  assert.deepEqual(none.stageReached, { evals: 1, probes: null });
  assert.equal(none.status, "pass");
});

test("R2/R3 happy path: 12 of 12 evals accept at stage 1, 7 of 8 probes continue, and 16 probe runs decide", () => {
  const pending = decideSkill({ evals: pool(6, 2, 12), probes: pool(8, 1, 7) });
  assert.equal(pending.status, "in-progress");
  assert.deepEqual(pending.stageReached, { evals: 1, probes: 2 });
  const probes16 = pool(8, 2, 14);
  const done = decideSkill({ evals: pool(6, 2, 12), probes: probes16 });
  assert.equal(done.status, "pass");
  assert.equal(poolState(pool(8, 2, 11), [1, 1]).verdict, "rejected");
});
