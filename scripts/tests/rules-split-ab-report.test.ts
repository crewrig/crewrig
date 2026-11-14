// Tests of the arm comparison, the extension rule, truncation mapping and the report (spec 0308 R8, R12).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyTruncationRule, scenarioVerdict } from "../lib/rules-split-ab/compare.ts";
import type { RunRecord } from "../lib/rules-split-ab/compare.ts";
import { renderReport } from "../lib/rules-split-ab/report.ts";

const P = "pass";
const F = "fail";
const I = "invalid";

describe("scenarioVerdict", () => {
  test("two identical passes in both arms: no regression, no extension", () => {
    assert.deepEqual(scenarioVerdict([P, P], [P, P], { extendTo: 5 }), {
      verdict: "no-regression",
      extend: false,
    });
  });
  test("two identical fails in both arms: no regression (not above arm A)", () => {
    assert.equal(scenarioVerdict([F, F], [F, F], { extendTo: 5 }).verdict, "no-regression");
  });
  test("runs of one arm disagreeing extend to 5 runs per arm", () => {
    const v = scenarioVerdict([P, P], [P, F], { extendTo: 5 });
    assert.equal(v.extend, true);
    assert.equal(v.verdict, "extend");
  });
  test("disagreement inside arm A alone also extends", () => {
    assert.equal(scenarioVerdict([P, F], [P, P], { extendTo: 5 }).extend, true);
  });
  test("arms diverging with each arm consistent extends", () => {
    const v = scenarioVerdict([P, P], [F, F], { extendTo: 5 });
    assert.equal(v.extend, true);
  });
  test("after extension B below A is a regression", () => {
    const v = scenarioVerdict([P, P, P, P, P], [P, F, F, P, F], { extendTo: 5 });
    assert.deepEqual(v, { verdict: "regression", extend: false });
  });
  test("after extension B equal to A despite flapping is no regression", () => {
    assert.equal(
      scenarioVerdict([P, F, P, P, F], [P, F, P, P, F], { extendTo: 5 }).verdict,
      "no-regression",
    );
  });
  test("after extension B above A is no regression", () => {
    assert.equal(
      scenarioVerdict([P, F, F, P, F], [P, P, P, P, F], { extendTo: 5 }).verdict,
      "no-regression",
    );
  });
  test("an invalid run blocks the conclusion", () => {
    assert.equal(scenarioVerdict([P, P], [P, I], { extendTo: 5 }).verdict, "blocked");
  });
  test("a regression among valid runs is never hidden by an invalid run", () => {
    assert.equal(
      scenarioVerdict([P, P, P, P, P], [F, F, F, F, I], { extendTo: 5 }).verdict,
      "regression",
    );
  });
});

const rec = (
  arm: "A" | "B",
  runIndex: number,
  status: "pass" | "fail" | "invalid",
  truncatedTwice = false,
): RunRecord => ({
  scenario: 1,
  arm,
  runIndex,
  status,
  truncatedTwice,
  attempts: [],
});

describe("applyTruncationRule", () => {
  test("B truncated twice while the paired A run completed counts as fail", () => {
    const { b } = applyTruncationRule([rec("A", 1, P)], [rec("B", 1, I, true)]);
    assert.deepEqual(b, [F]);
  });
  test("A truncated twice stays invalid and the verdict is blocked", () => {
    const { a, b } = applyTruncationRule(
      [rec("A", 1, I, true), rec("A", 2, P)],
      [rec("B", 1, P), rec("B", 2, P)],
    );
    assert.deepEqual(a, [I, P]);
    assert.equal(scenarioVerdict(a, b, { extendTo: 5 }).verdict, "blocked");
  });
  test("both arms truncated twice stay invalid", () => {
    const { a, b } = applyTruncationRule([rec("A", 1, I, true)], [rec("B", 1, I, true)]);
    assert.deepEqual([a, b], [[I], [I]]);
  });
  test("an invalid B run that was not a truncation stays invalid", () => {
    const { b } = applyTruncationRule([rec("A", 1, P)], [rec("B", 1, I, false)]);
    assert.deepEqual(b, [I]);
  });
  test("a scored B run is untouched", () => {
    const { b } = applyTruncationRule([rec("A", 1, F)], [rec("B", 1, P)]);
    assert.deepEqual(b, [P]);
  });
  test("B truncated twice turns into a regression against a passing A", () => {
    const a = [rec("A", 1, P), rec("A", 2, P), rec("A", 3, P), rec("A", 4, P), rec("A", 5, P)];
    const b = [
      rec("B", 1, I, true),
      rec("B", 2, I, true),
      rec("B", 3, P),
      rec("B", 4, P),
      rec("B", 5, P),
    ];
    const r = applyTruncationRule(a, b);
    assert.equal(scenarioVerdict(r.a, r.b, { extendTo: 5 }).verdict, "regression");
  });
});

describe("renderReport", () => {
  const records: RunRecord[] = [
    {
      scenario: 1,
      arm: "A",
      runIndex: 1,
      status: "pass",
      truncatedTwice: false,
      attempts: [
        {
          status: "pass",
          note: "",
          subtype: "success",
          costUsd: 0.31,
          charged: 0.31,
          firstCallTokens: 59000,
        },
      ],
    },
    {
      scenario: 1,
      arm: "B",
      runIndex: 1,
      status: "invalid",
      truncatedTwice: true,
      attempts: [
        {
          status: "invalid",
          note: "truncated",
          subtype: "error_max_budget_usd",
          costUsd: 0.6,
          charged: 0.6,
          firstCallTokens: 41000,
        },
        {
          status: "invalid",
          note: "truncated",
          subtype: "error_max_turns",
          costUsd: 0.5,
          charged: 0.5,
          firstCallTokens: 41000,
        },
      ],
    },
  ];
  const md = renderReport({
    records,
    verdicts: { 1: { verdict: "blocked", extend: false } },
    spent: 1.41,
    cap: 12,
    stopped: null,
  });
  test("lists scenario x arm x run with only pass, fail and invalid", () => {
    assert.match(md, /\| 1 \|/);
    assert.match(md, /pass/);
    assert.match(md, /invalid/);
    assert.doesNotMatch(md, /truncated\b(?! twice)(?!.*subtype)[^|]*\|\s*$/m);
  });
  test("shows the subtype notes of truncated attempts", () => {
    assert.match(md, /error_max_budget_usd/);
    assert.match(md, /error_max_turns/);
  });
  test("shows per-run cost, total and cap", () => {
    assert.match(md, /0\.31/);
    assert.match(md, /1\.41/);
    assert.match(md, /12/);
  });
  test("shows the verdict per scenario and first-call tokens per arm for scenario 2", () => {
    assert.match(md, /blocked/);
    const md2 = renderReport({
      records: [
        {
          scenario: 2,
          arm: "A",
          runIndex: 1,
          status: "pass",
          truncatedTwice: false,
          attempts: [
            {
              status: "pass",
              note: "",
              subtype: "success",
              costUsd: 0.1,
              charged: 0.1,
              firstCallTokens: 50000,
            },
          ],
        },
        {
          scenario: 2,
          arm: "B",
          runIndex: 1,
          status: "pass",
          truncatedTwice: false,
          attempts: [
            {
              status: "pass",
              note: "",
              subtype: "success",
              costUsd: 0.1,
              charged: 0.1,
              firstCallTokens: 40000,
            },
          ],
        },
      ],
      verdicts: { 2: { verdict: "no-regression", extend: false } },
      spent: 0.2,
      cap: 12,
      stopped: null,
    });
    assert.match(md2, /50000/);
    assert.match(md2, /40000/);
    assert.match(md2, /-10000/);
  });
  test("summarises cost and mean first-call tokens per scenario and arm", () => {
    assert.match(md, /Cost and first-call tokens per scenario and arm/);
    assert.match(md, /\| 1 \| A \| 1 \| 1 \| 0 \| 0 \| 0\.31 \| 59000 \|/);
    assert.match(md, /\| 1 \| B \| 1 \| 0 \| 0 \| 1 \| 1\.10 \| 41000 \|/);
  });
  test("reports a guard stop and asks the coordinator", () => {
    const m = renderReport({
      records: [],
      verdicts: {},
      spent: 11.7,
      cap: 12,
      stopped: { reason: "cost guard: 11.70 + 0.30 reaches 12 USD" },
    });
    assert.match(m, /stopped/i);
    assert.match(m, /coordinator/i);
  });
});
