// skill-evals-budget.test.ts — caps, cost bound, concurrency, limits and measured cost
// (spec 0290 R23, R27-R30, R25 as modified by delta-04).

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

// local figures for the pure function: they are not the declared (provisional) defaults
const limits = { maxExecutorRuns: 30, judgeMaxCalls: 300, maxInvocationUsd: 40, perRunUsd: 1 };

test("planning: one run per eval and per probe; judge worst case is one call per judged eval plus the retry allowance", () => {
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
  assert.equal(plan.executorRuns, 4 + 2, "4 evals + 2 probes, no paired run, no replay");
  assert.equal(
    plan.judgeCalls,
    3 + Math.ceil(3 * 0.25),
    "one call per judged eval, not per expectation",
  );
});

test("an over-cap executor plan is refused before any call, with planned versus cap: 21 evals and probes against 20", async () => {
  // explicit caps: the declared defaults are provisional (#1882) and no test may follow them
  const settings = { maxExecutorRuns: 20, judgeMaxCalls: 100, maxInvocationUsd: 1000 };
  const rig = makeRig({ evalsCount: 20, settings }); // 20 evals + 1 probe = 21 runs
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0, "no executor run, no judge call");
    assert.equal(r.exitCode, 1);
    assert.equal(r.results[0]?.status, "error");
    assert.match(r.stderr, /planned executor runs 21 exceed max-executor-runs 20/);
    assert.equal(fs.existsSync(path.join(rig.out, "demo", "eval-1")), false);
  } finally {
    rig.cleanup();
  }
  const fits = makeRig({ evalsCount: 19, settings }); // 19 evals + 1 probe = 20 runs: at the cap
  try {
    const r = await fits.run();
    assert.equal(r.exitCode, 0, r.text + r.stderr);
    assert.equal(fits.executor.calls.length, 20);
  } finally {
    fits.cleanup();
  }
});

test("an over-cap judge worst case is refused before any call", async () => {
  // 2 judged evals: 2 calls plus 1 of retry allowance = 3 against a cap of 2
  const rig = makeRig({ evalsCount: 2, settings: { judgeMaxCalls: 2, maxExecutorRuns: 100 } });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /worst-case judge calls 3 exceed the judge max_calls 2/);
  } finally {
    rig.cleanup();
  }
});

test("an over-cost plan (112 runs at 1 dollar against 100) makes no model call and prints 112 and 100", async () => {
  const names = Array.from({ length: 7 }, (_, i) => `skill${i}`);
  const rig = makeRig({
    skills: names,
    evalsCount: 15, // 15 evals + 1 probe per skill = 16 runs, 7 skills = 112
    settings: { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 100, perRunUsd: 1 },
  });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.ok(r.results.every((s) => s.status === "error"));
    assert.match(
      r.stderr,
      /planned executor cost 112 dollars \(112 runs x 1\) exceeds max-invocation-usd 100/,
    );
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
    judgeCalls: 1,
  });
  assert.deepEqual(preflight([p(30)], limits), []);
  assert.equal(
    preflight([p(31)], limits).length,
    1,
    "31 runs against 30 (31 dollars is within 40)",
  );
  assert.deepEqual(preflight([p(10), p(10), p(10), p(10)], limits), [], "40 dollars: at the cap");
  assert.equal(
    preflight([p(10), p(10), p(10), p(10), p(10)], limits).length,
    1,
    "50 planned dollars against 40",
  );
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
  const t = stubRig({ loggedIn: true }, {}, { evals: 1, stub: { judgeFailCalls: [0] } });
  try {
    const r = await t.run({ settings: { judgeMaxCalls: 2 } });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.results[0]?.judgeCalls, 2, "the failed call and its retry");
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json"),
        "utf8",
      ),
    );
    assert.equal(rec.judge_calls, 2);
  } finally {
    t.cleanup();
  }
});

test("a judge retry that would pass the cap is refused: the call fails, the skill is an error and no results file is written", async () => {
  // 4 judged evals: worst case 5 calls, so the cap 5 passes the pre-flight. The first call fails and
  // its retry succeeds (2 calls), two evals take 2 more, and the last eval's call is the 5th and
  // fails: its retry would be the 6th call and is refused at the cap.
  const t = stubRig({ loggedIn: true }, {}, { evals: 4, stub: { judgeFailCalls: [0, 4] } });
  try {
    const r = await t.run({ settings: { judgeMaxCalls: 5 } });
    assert.equal(r.results[0]?.status, "error", r.text + r.stderr);
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /judge: the judge returned no parseable verdict line/);
    assert.match(r.text, /judge calls used 5/);
    assert.equal(readCalls(t.bin, "judge").length, 5, "the refused retry spawned nothing");
    assert.equal(
      fs.existsSync(path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json")),
      false,
    );
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
    assert.equal(rig.executor.calls.length, 7, "6 evals and 1 probe, one run each");
  } finally {
    rig.cleanup();
  }
});

test("a runtime cost breach starts no new run and ends the invocation with status error", async () => {
  const rig = makeRig({
    evalsCount: 8,
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
    assert.ok(rig.executor.calls.length < 9, `only ${rig.executor.calls.length} of 9 runs started`);
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
    const dir = path.join(rig.out, "demo", "eval-1");
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
    assert.match(r.text, /cost_usd=unknown/);
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
    assert.match(r.text, /executor failure: exited with code 1/);
    assert.match(r.text, /cost_usd=unknown/);
  } finally {
    rig.cleanup();
  }
});

test("measured cost: 0.40 and 0.35 sum to 0.75 in the report, per skill and for the invocation, and in results.json", async () => {
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
      costUsd: req.label.endsWith("eval-2") ? 0.35 : 0.4,
    }),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.costUsd, 0.75);
    assert.match(r.text, /demo: .*cost_usd=0\.75/);
    assert.match(r.text, /invocation: .*cost_usd=0\.75/);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"),
          "utf8",
        ),
      ).cost_usd,
      0.75,
    );
    const m = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "metrics.json"), "utf8"),
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
    /invocation: skills=2 executor_runs=10 judge_calls=0 cost_usd=unknown \(at least 4\.00\)/,
  );
});
