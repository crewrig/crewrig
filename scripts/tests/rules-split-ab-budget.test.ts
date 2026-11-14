// Tests of the cost ledger and guard (spec 0308 R8, scenario "Budget exceeded").

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canStart,
  charge,
  createLedger,
  perRunBudget,
  projectedCost,
} from "../lib/rules-split-ab/budget.ts";

describe("ledger", () => {
  test("projected cost is the per-run cap before any run, then the mean of charged runs", () => {
    let l = createLedger(12);
    assert.equal(projectedCost(l, 0.6), 0.6);
    l = charge(l, 0.2);
    l = charge(l, 0.4);
    assert.ok(Math.abs(projectedCost(l, 0.6) - 0.3) < 1e-9);
  });
  test("a run with no reported cost is charged the per-run cap", () => {
    const l = charge(createLedger(12), null, 0.6);
    assert.equal(l.spent, 0.6);
  });
  test("charge does not mutate its input", () => {
    const l = createLedger(12);
    charge(l, 1);
    assert.equal(l.spent, 0);
  });
});

describe("guard", () => {
  test("allows the first run, then blocks when the mean-cost projection would pass the cap", () => {
    assert.equal(canStart(createLedger(12), 0.6).ok, true);
    assert.equal(canStart(charge(createLedger(12), 11), 0.6).ok, false); // 11 + mean 11 > 12
  });
  test("blocks when spent + projected would exceed 12 USD (including an extension run)", () => {
    let l = createLedger(12);
    for (let i = 0; i < 20; i++) l = charge(l, 0.5); // spent 10, mean 0.5
    assert.equal(canStart(l, 0.6).ok, true); // 10.5 < 12
    for (let i = 0; i < 3; i++) l = charge(l, 0.5); // spent 11.5, mean 0.5
    const g = canStart(l, 0.6);
    assert.equal(g.ok, false); // 12.0 is not under 12
    assert.match(g.reason ?? "", /12/);
    assert.match(g.reason ?? "", /coordinator/);
  });
  test("blocks at exactly the cap", () => {
    assert.equal(canStart(charge(createLedger(12), 12), 0.6).ok, false);
  });
  test("an approved higher cap re-opens the guard", () => {
    let l = createLedger(12);
    for (let i = 0; i < 23; i++) l = charge(l, 0.5);
    assert.equal(canStart(l, 0.6).ok, false);
    assert.equal(canStart({ ...l, cap: 15 }, 0.6).ok, true);
  });
  test("per-run --max-budget-usd is the lesser of 0.6 and the remaining cap", () => {
    assert.equal(perRunBudget(createLedger(12), 0.6), 0.6);
    assert.ok(Math.abs(perRunBudget(charge(createLedger(12), 11.8), 0.6) - 0.2) < 1e-9);
  });
});
