// skill-evals-budget.test.ts — caps, cost bound, concurrency, limits and measured cost
// (spec 0290 R23, R27-R30, R25).

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CostMeter, planSkill, preflight, RunBudget } from "../lib/skill-evals/budget.ts";
import { formatReport } from "../lib/skill-evals/report.ts";
import { skillRel } from "./lib/skill-evals-fixtures.ts";
import { evalsWith, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const limits = { maxExecutorRuns: 30, judgeMaxCalls: 300, maxInvocationUsd: 100, perRunUsd: 1 };

test("planning: three runs per eval, two when there is no replay; judge worst case with the retry allowance", () => {
  const doc = JSON.parse(evalsWith("x", 4, 3));
  const evals = {
    skill_name: "x",
    evals: doc.evals.map((e: object) => ({ ...e, checks: [], expectations: ["a", "b", "c"] })),
    trigger_probes: [],
  };
  const withReplay = planSkill("x", evals);
  assert.equal(withReplay.executorRuns, 12);
  assert.equal(
    withReplay.judgeCalls,
    4 * 3 * 3 * 3 + Math.ceil(4 * 3 * 3 * 3 * 0.25),
    "expectations x runs x quorum + retries",
  );
});

test("an over-cap executor plan is refused before any call, with planned versus cap", async () => {
  const rig = makeRig({ evalsCount: 2, settings: { maxExecutorRuns: 5 } });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0, "no executor run, no judge call");
    assert.equal(r.exitCode, 1);
    assert.equal(r.results[0]?.status, "error");
    assert.match(r.stderr, /planned executor runs 6 exceed max-executor-runs 5/);
    assert.equal(fs.existsSync(path.join(rig.out, "demo", "eval-1")), false);
  } finally {
    rig.cleanup();
  }
});

test("an over-cap judge worst case is refused before any call", async () => {
  const rig = makeRig({ evalsCount: 2, settings: { judgeMaxCalls: 10 } });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /worst-case judge calls \d+ exceed the judge max_calls 10/);
  } finally {
    rig.cleanup();
  }
});

test("an over-cost plan (210 runs at 1 dollar against 100) makes no model call and prints 210 and 100", async () => {
  const names = Array.from({ length: 7 }, (_, i) => `skill${i}`);
  const rig = makeRig({ skills: names, evalsCount: 10 });
  try {
    const r = await rig.run();
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.ok(r.results.every((s) => s.status === "error"));
    assert.match(
      r.stderr,
      /planned executor cost 210 dollars \(210 runs x 1\) exceeds max-invocation-usd 100/,
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
  assert.deepEqual(preflight([p(10)], limits), []);
  assert.equal(preflight([p(11)], limits).length, 1);
  assert.equal(
    preflight([p(10), p(10), p(10), p(10)], limits).length,
    1,
    "120 planned dollars against 100",
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

test("a runtime judge cap stops the run: retries push the calls past max_calls, status error with usage reported", async () => {
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    settings: { judgeMaxCalls: 12 },
  });
  try {
    const seen: string[] = [];
    let n = 0;
    const flaky = (async (url: string) => {
      seen.push(url);
      // the first attempt of each call fails (a retried 5xx), the second answers UNCERTAIN
      return n++ % 2 === 0
        ? new Response("busy", { status: 500 })
        : new Response(
            JSON.stringify({
              content: [{ type: "text", text: 'VERDICT=UNCERTAIN CONF=0.50\nEVIDENCE="maybe"' }],
            }),
            { status: 200 },
          );
    }) as unknown as typeof fetch;
    const r = await rig.run({ fetchImpl: flaky });
    assert.equal(r.results[0]?.status, "error", r.text + r.stderr);
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /judge max_calls 12 reached/);
    assert.match(r.text, /executor runs used 3, judge calls used 12/);
    assert.equal(seen.length, 12, "no model call after the cap: 12 attempts, none more");
    assert.equal(
      fs.existsSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json")),
      false,
    );
  } finally {
    rig.cleanup();
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
    assert.match(r.text, /no verdict after its retries/);
  } finally {
    rig.cleanup();
  }
});

test("concurrency: never more than executor-concurrency runs in flight, and all of them are used", async () => {
  const rig = makeRig({
    evalsCount: 6,
    settings: { executorConcurrency: 4 },
    script: () => ({ files: { "answer.md": "x" }, delayMs: 30 }),
  });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.text);
    assert.equal(rig.executor.maxInFlight, 4);
    assert.equal(rig.executor.calls.length, 18);
  } finally {
    rig.cleanup();
  }
});

test("a runtime cost breach starts no new run and ends the invocation with status error", async () => {
  const rig = makeRig({
    evalsCount: 4,
    settings: { executorConcurrency: 4, perRunUsd: 0.1, maxInvocationUsd: 1.5 },
    script: () => ({ files: { "answer.md": "x" }, costUsd: 0.5, delayMs: 20 }),
  });
  try {
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "error");
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /max-invocation-usd 1\.5 reached/);
    assert.ok(
      rig.executor.calls.length < 12,
      `only ${rig.executor.calls.length} of 12 runs started`,
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
    script: (req) =>
      req.label.includes("with_skill")
        ? {
            files: { "answer.md": "partial" },
            transcript: "Assistant: the quick brown fox so far",
            limit: "wall-clock",
            costUsd: null,
          }
        : { files: { "answer.md": "x" }, transcript: "Assistant: the quick brown fox" },
  });
  try {
    const { judgeFetch } = await import("./lib/skill-evals-run-rig.ts");
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.exitCode, 0);
    const dir = path.join(rig.out, "demo", "eval-1", "with_skill");
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
    script: (req) =>
      req.label.includes("without")
        ? { failure: "exited with code 1 and no result record", costUsd: null }
        : { files: { "answer.md": "x" } },
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
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 1),
      ),
    script: (req) => ({
      files: { "answer.md": "x" },
      transcript: "Assistant: the quick brown fox",
      costUsd: req.label.includes("without") ? 0.35 : 0.4,
    }),
  });
  try {
    const { judgeFetch } = await import("./lib/skill-evals-run-rig.ts");
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
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "with_skill", "metrics.json"), "utf8"),
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
