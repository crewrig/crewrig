// skill-evals-budget.test.ts — caps, cost bound, concurrency, limits and measured cost
// (spec 0290 R23, R27-R30, R25 as modified by delta-04; 0304 R21, R22: the plan maximum, the judge
// worst case and the aggregate bound; the caps against recorded spend are in skill-evals-caps).

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CostMeter, planSkill, preflight, RunBudget } from "../lib/skill-evals/budget.ts";
import { formatReport } from "../lib/skill-evals/report.ts";
import { readCalls, skillRel } from "./lib/skill-evals-fixtures.ts";
import { stubRig } from "./lib/skill-evals-stub-rig.ts";
import { evalsWith, judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

// local figures for the pure function: they are not the declared defaults
const limits = {
  maxExecutorRuns: 30,
  judgeMaxCalls: 300,
  maxInvocationUsd: 40,
  perRunUsd: 1,
  maxMeasurementUsd: 5,
  maxSkillUsd: 10,
  maxTicketUsd: 25,
  executorConcurrency: 4,
};

test("planning: the plan maximum is 4 runs per eval and 2 per probe; the judge worst case is two calls per judged eval run plus 25 percent", () => {
  const doc = JSON.parse(evalsWith("x", 4, 3));
  const evals = {
    skill_name: "x",
    evals: doc.evals.map((e: object, i: number) => ({
      ...e,
      checks: [],
      // the last eval has no expectation: it is not judged
      expectations: i === 3 ? [] : ["a", "b", "c"],
    })),
    trigger_probes: [
      { query: "p1", should_trigger: true },
      { query: "p2", should_trigger: false },
    ],
  };
  const plan = planSkill("x", evals);
  assert.equal(plan.executorRuns, 4 * 4 + 2 * 2, "both stages of every eval and probe");
  assert.equal(plan.judged, 3);
  // 3 judged evals x 4 runs = 12 runs; two calls each plus ceil(12 x 0.25) = 27
  assert.equal(plan.judgeCalls, 12 * 2 + 3, "per eval run, not per expectation");
  assert.equal(
    planSkill("six", {
      ...evals,
      evals: Array.from({ length: 6 }, () => evals.evals[0]!),
      trigger_probes: Array.from({ length: 12 }, () => evals.trigger_probes[0]!),
    }).executorRuns,
    48,
  );
});

test("an over-cap executor plan is refused before any call, with planned versus cap: 5 evals and 1 probe against 20", async () => {
  // explicit caps: no test follows the declared defaults
  const settings = { maxExecutorRuns: 20, judgeMaxCalls: 1000, maxInvocationUsd: 1000 };
  const rig = makeRig({ evalsCount: 5, settings }); // 5 x 4 + 1 x 2 = 22 plan-maximum runs
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0, "no executor run, no judge call");
    assert.equal(r.exitCode, 1);
    assert.equal(r.results[0]?.status, "error");
    assert.match(r.stderr, /planned executor runs 22 exceed max-executor-runs 20/);
    assert.equal(fs.existsSync(path.join(rig.out, "demo", "eval-1")), false);
  } finally {
    rig.cleanup();
  }
  const fits = makeRig({ evalsCount: 4, settings }); // 4 x 4 + 2 = 18: under the cap
  try {
    const r = await fits.run();
    assert.equal(r.exitCode, 0, r.text + r.stderr);
    assert.equal(fits.executor.calls.length, 9, "stage 1 only: 2 runs of 4 evals and 1 probe run");
  } finally {
    fits.cleanup();
  }
});

test("an over-cap judge worst case is refused before any call", async () => {
  // 2 judged evals: 4 runs each = 8 runs, 16 calls plus 2 of allowance = 18 against a cap of 2
  const rig = makeRig({ evalsCount: 2, settings: { judgeMaxCalls: 2, maxExecutorRuns: 100 } });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /worst-case judge calls 18 exceed the judge max_calls 2/);
    assert.match(r.stderr, /split the skill's evals or reduce them/);
  } finally {
    rig.cleanup();
  }
});

test("a skill of 7 evals that carry expectations is refused: 7 x 4 x 2 + 7 = 63 against 60, before any call", async () => {
  const rig = makeRig({ evalsCount: 7 });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /worst-case judge calls 63 exceed the judge max_calls 60/);
  } finally {
    rig.cleanup();
  }
});

test("an over-cost plan (12 skills at 9 dollars against 100) makes no model call and prints 108 and 100", async () => {
  const names = Array.from({ length: 12 }, (_, i) => `skill${i}`);
  const rig = makeRig({
    skills: names,
    evalsCount: 3, // 3 x 4 + 1 x 2 = 14 runs per skill: min(14 x 1, 5 + 4 x 1) = 9 each
    settings: { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 100, perRunUsd: 1 },
  });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.ok(r.results.every((s) => s.status === "error"));
    assert.match(r.stderr, /planned worst-case cost 108.00 dollars exceeds max-invocation-usd 100/);
    assert.match(r.stderr, /select fewer skills per invocation/);
    assert.match(r.stderr, /cap 100 dollars/);
  } finally {
    rig.cleanup();
  }
});

test("pre-flight arithmetic is a pure function of the plans", () => {
  const p = (n: number) => ({
    skill: "s",
    evals: n,
    probes: 0,
    executorRuns: n,
    judged: 0,
    judgeCalls: 1,
  });
  assert.deepEqual(preflight([p(30)], limits), []);
  assert.equal(preflight([p(31)], limits).length, 1, "31 runs against 30");
  // each skill is bounded by min(runs x 1, 5 + 4 x 1) = 9 dollars (R22)
  assert.deepEqual(preflight([p(30), p(30), p(30), p(30)], limits), [], "36 dollars within 40");
  assert.equal(
    preflight([p(30), p(30), p(30), p(30), p(30)], limits).length,
    1,
    "45 planned dollars against 40",
  );
  assert.deepEqual(preflight([p(2), p(2)], limits), [], "a small skill counts its runs, not 9");
  assert.match(
    preflight([{ ...p(1), judgeCalls: 301 }], limits)[0] ?? "",
    /worst-case judge calls 301 exceed the judge max_calls 300/,
  );
});

test("RunBudget reserves before a run starts and refuses past the cap", () => {
  const b = new RunBudget(2);
  assert.deepEqual(
    [b.reserve(), b.reserve(), b.reserve(), b.reserve()],
    [true, true, false, false],
  );
  assert.equal(b.used, 2);
  assert.match(b.breach ?? "", /cap 2/);
  const m = new CostMeter(1);
  m.add(0.6);
  assert.equal(m.reached, false);
  m.add(0.6);
  assert.equal(m.reached, true);
  m.add(null);
  assert.equal(m.unknown, 1);
});

test("a judge retry is a call of its own: it is counted, and the run still passes", async () => {
  // 1 judged eval: the worst case is 4 runs x 2 + 1 = 9; the cap 9 passes the pre-flight
  const t = stubRig({ loggedIn: true }, {}, { evals: 1, stub: { judgeFailCalls: [0] } });
  try {
    const r = await t.run({ settings: { judgeMaxCalls: 9 } });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(
      r.results[0]?.judgeCalls,
      3,
      "the failed call, its retry, and the second run's call",
    );
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json"),
        "utf8",
      ),
    );
    assert.equal(rec.judge_calls, 3);
  } finally {
    t.cleanup();
  }
});

test("a judge that keeps failing is capped: the skill is an error, the file stays in-progress and the calls stop at the cap", async () => {
  const fail = Array.from({ length: 100 }, (_, i) => i);
  const t = stubRig({ loggedIn: true }, {}, { evals: 1, stub: { judgeFailCalls: fail } });
  try {
    const r = await t.run({ settings: { judgeMaxCalls: 9 } });
    assert.equal(r.results[0]?.status, "error", r.text + r.stderr);
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /failed twice \(judge\)/);
    assert.ok(readCalls(t.bin, "judge").length <= 9, "no spawn past the cap");
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json"),
        "utf8",
      ),
    );
    assert.equal(rec.status, "in-progress", "R5: the declared file is kept, never discarded");
    assert.ok(rec.errors.length >= 2, "R9: each failure is recorded in errors");
  } finally {
    t.cleanup();
  }
});

test("a judge that returns no verdict after its retries is an error, not a pass", async () => {
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
  });
  try {
    const down = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const r = await rig.run({ fetchImpl: down });
    assert.equal(r.results[0]?.status, "error");
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /the judge returned no parseable verdict line/);
  } finally {
    rig.cleanup();
  }
});

test("concurrency: never more than executor-concurrency runs in flight, and all of them are used", async () => {
  const rig = makeRig({
    evalsCount: 6,
    settings: { executorConcurrency: 4, maxExecutorRuns: 100, judgeMaxCalls: 100 },
    script: () => ({ files: { "answer.md": "x" }, delayMs: 30 }),
  });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.text);
    assert.equal(rig.executor.maxInFlight, 4);
    assert.equal(rig.executor.calls.length, 13, "stage 1: 2 runs of 6 evals and 1 probe run");
  } finally {
    rig.cleanup();
  }
});

test("a runtime cost breach starts no new run and ends the invocation with status error", async () => {
  const rig = makeRig({
    evalsCount: 3,
    settings: {
      executorConcurrency: 4,
      perRunUsd: 0.1,
      maxInvocationUsd: 1.5,
      maxExecutorRuns: 100,
      judgeMaxCalls: 100,
    },
    script: () => ({ files: { "answer.md": "x" }, costUsd: 0.5, delayMs: 20 }),
  });
  try {
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "error");
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /max-invocation-usd 1\.5 reached/);
    assert.ok(
      rig.executor.calls.length < 7,
      `only ${rig.executor.calls.length} of 7 stage-1 runs started`,
    );
    assert.ok(rig.executor.maxInFlight <= 4);
  } finally {
    rig.cleanup();
  }
});

test("a run killed at the wall-clock limit with no result record is graded on partial output, cost unknown, not an error", async () => {
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 1),
      ),
    script: () => ({
      files: { "answer.md": "partial" },
      transcript: "Assistant: the quick brown fox so far",
      limit: "wall-clock",
      costUsd: null,
    }),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.exitCode, 0);
    const dir = path.join(rig.out, "demo", "eval-1", "run-1");
    const metrics = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8"));
    assert.equal(metrics.limit, "wall-clock");
    assert.equal(metrics.cost_usd, null);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, "grading.json"), "utf8")).summary.total,
      1,
      "graded on the partial output",
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"),
          "utf8",
        ),
      ).cost_usd,
      null,
    );
    assert.match(r.text, /cost_usd=assumed/, "no run reported a cost: R23 assumes one");
    const rec = JSON.parse(
      fs.readFileSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"), "utf8"),
    );
    assert.equal(rec.evals[0].runs[0].cost_assumed, true);
  } finally {
    rig.cleanup();
  }
});

test("a run that exits abnormally with no limit and no result record has unknown cost and makes the status error", async () => {
  const rig = makeRig({
    evalsCount: 1,
    script: () => ({ failure: "exited with code 1 and no result record", costUsd: null }),
  });
  try {
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "error");
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /failed twice \(executor\): exited with code 1/);
    assert.match(r.text, /cost_usd=(unknown|assumed)/);
  } finally {
    rig.cleanup();
  }
});

test("measured cost: 2 x 0.40 and 2 x 0.35 sum to 1.50 in the report, per skill and for the invocation, and in results.json", async () => {
  const rig = makeRig({
    evalsCount: 2,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 2),
      ),
    script: (req) => ({
      files: { "answer.md": "x" },
      transcript: "Assistant: the quick brown fox",
      costUsd: /eval-2\/run-\d$/.test(req.label) ? 0.35 : 0.4,
    }),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.costUsd, 1.5);
    assert.match(r.text, /demo: .*cost_usd=1\.50/);
    assert.match(r.text, /invocation: .*cost_usd=1\.50/);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"),
          "utf8",
        ),
      ).cost_usd,
      1.5,
    );
    const m = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "run-1", "metrics.json"), "utf8"),
    );
    assert.equal(m.cost_usd, 0.4);
    assert.deepEqual(m.usage, { input_tokens: 100, output_tokens: 20 });
  } finally {
    rig.cleanup();
  }
});

test("the report sums two skills and labels a lower bound when a cost is unknown", () => {
  const base = { blocking: false, messages: [] as string[], judgeCalls: 0 };
  const text = formatReport([
    { ...base, skill: "a", status: "pass", executorRuns: 6, costUsd: 2.5 },
    { ...base, skill: "b", status: "pass", executorRuns: 4, costUsd: null, costLowerBound: 1.5 },
  ]);
  assert.match(
    text,
    /invocation: skills=2 executor_runs=10 judge_calls=0 cost_usd=unknown or assumed \(at least 4\.00\)/,
  );
});
