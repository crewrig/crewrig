// check-timing-budget.test.ts — tests for scripts/check-timing-budget.ts (spec 0240 R13).
//
// The logic is driven through an injected runner and clock, so the budget
// verdict is deterministic; one case runs the real CLI end to end.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluate,
  main,
  measure,
  parseArgs,
  type Clock,
  type Runner,
} from "../check-timing-budget.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HARNESS = path.join(REPO, "scripts", "check-timing-budget.ts");
const GUARD = path.join(REPO, "scripts", "lib", "node-floor-guard.js");

/** A clock whose successive run durations are `durations` (two reads per run). */
function fakeClock(durations: number[]): Clock {
  const stamps: number[] = [];
  let t = 0;
  for (const d of durations) {
    stamps.push(t, t + d);
    t += d + 1;
  }
  let i = 0;
  return () => stamps[i++] ?? t;
}

const exitWith =
  (status: number): Runner =>
  () =>
    status;

const BASE = ["--runs", "3", "--budget-ms", "100", "--", "script.js"];

describe("parseArgs", () => {
  test("reads runs, budget, expected exit and the node argv", () => {
    assert.deepEqual(
      parseArgs(["--runs", "2", "--budget-ms", "50", "--expect-exit", "1", "--", "a.js", "x"]),
      {
        runs: 2,
        budgetMs: 50,
        expectExit: 1,
        argv: ["a.js", "x"],
      },
    );
  });

  test("rejects a missing separator or budget", () => {
    assert.throws(() => parseArgs(["--runs", "2", "--budget-ms", "50"]), /missing '--/);
    assert.throws(() => parseArgs(["--runs", "2", "--", "a.js"]), /--budget-ms/);
  });
});

describe("evaluate", () => {
  test("over budget: names the script, budget, measured time and run", () => {
    const opts = parseArgs(BASE);
    const verdict = evaluate(opts, measure(opts, exitWith(0), fakeClock([40, 250, 60])));
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.lines, [
      "timing-budget: script.js exceeded 100 ms: measured 250.0 ms (run 2/3)",
    ]);
  });

  test("within budget: reports min, median and max", () => {
    const opts = parseArgs(BASE);
    const verdict = evaluate(opts, measure(opts, exitWith(0), fakeClock([40, 90, 60])));
    assert.equal(verdict.ok, true);
    assert.match(verdict.lines[0] ?? "", /min 40\.0 ms, median 60\.0 ms, max 90\.0 ms/);
  });

  test("wrong exit code fails even within budget", () => {
    const opts = parseArgs(BASE);
    const verdict = evaluate(opts, measure(opts, exitWith(1), fakeClock([10, 10, 10])));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.lines.length, 3);
    assert.match(verdict.lines[0] ?? "", /exited 1, expected 0 \(run 1\/3\)/);
  });

  test("--expect-exit accepts a deliberate non-zero exit", () => {
    const opts = parseArgs([
      "--runs",
      "1",
      "--budget-ms",
      "100",
      "--expect-exit",
      "1",
      "--",
      "s.js",
    ]);
    assert.equal(evaluate(opts, measure(opts, exitWith(1), fakeClock([5]))).ok, true);
  });
});

describe("main", () => {
  test("returns 2 on a usage error", () => {
    assert.equal(main(["--runs", "1"]), 2);
  });

  test("returns 1 over budget and 0 within it", () => {
    assert.equal(main(BASE, exitWith(0), fakeClock([1, 500, 1])), 1);
    assert.equal(main(BASE, exitWith(0), fakeClock([1, 2, 3])), 0);
  });

  test("CLI end to end against the floor guard", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        HARNESS,
        "--runs",
        "2",
        "--budget-ms",
        "60000",
        "--",
        GUARD,
      ],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /node-floor-guard\.js within 60000 ms over 2 runs/);
  });
});
