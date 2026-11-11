// skill-evals-layout.test.ts — output layout and formats of a run (spec 0290 R10, R11, R12, R14, R24, R25).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildBenchmark, popStddev, signedDecimal } from "../lib/skill-evals/benchmark.ts";
import { skillRel } from "./lib/skill-evals-fixtures.ts";
import { evalsWith, makeRig } from "./lib/skill-evals-run-rig.ts";

const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(...p), "utf8"));

test("a mock run writes the R10 layout, R11 grading.json and R14 benchmark.json, all marked mock", async () => {
  const rig = makeRig({ evalsCount: 2 });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.text + r.stderr);
    assert.equal(r.results[0]?.status, "mock");
    const skillOut = path.join(rig.out, "demo");
    for (const id of [1, 2])
      for (const cfg of ["with_skill", "without_skill"]) {
        const dir = path.join(skillOut, `eval-${id}`, cfg);
        assert.ok(fs.existsSync(path.join(dir, "transcript.md")), dir);
        assert.ok(fs.existsSync(path.join(dir, "outputs", "answer.md")), "produced files live in outputs/");
        assert.equal(fs.existsSync(path.join(dir, "outputs", "in.txt")), false, "an unchanged R3 input is not an output");
        const grading = read(dir, "grading.json");
        assert.equal(grading.mock, true);
        // check first (R12), then the expectation (file order within each list)
        assert.deepEqual(grading.expectations.map((e: { text: string }) => e.text), ["check file_exists: answer.md", "Expectation 1 holds"]);
        assert.deepEqual(grading.summary, { passed: 2, failed: 0, total: 2, pass_rate: 1 });
        for (const e of grading.expectations) {
          assert.equal(typeof e.passed, "boolean");
          assert.ok(e.evidence.length > 0);
        }
        const metrics = read(dir, "metrics.json");
        assert.equal(metrics.limit, null);
        assert.equal(metrics.cost_usd, 0.01);
      }
    assert.ok(fs.existsSync(path.join(skillOut, "base", "eval-1", "with_skill", "grading.json")), "the base replay writes under base/");
    const bench = read(skillOut, "benchmark.json");
    assert.equal(bench.mock, true);
    assert.equal(bench.runs.length, 4, "head runs only: 2 evals x 2 configurations");
    assert.deepEqual(Object.keys(bench.runs[0]).sort(), ["configuration", "eval_id", "result", "summary"]);
    assert.deepEqual(bench.run_summary.with_skill.pass_rate, { mean: 1, stddev: 0 });
    assert.deepEqual(bench.run_summary.delta, { pass_rate: "+0.00" });
    assert.equal(bench.run_summary.delta_value, 0);
    assert.equal(fs.existsSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json")), false, "a mock run writes no results file");
  } finally {
    rig.cleanup();
  }
});

test("mean, population standard deviation, single-eval zero, and the signed delta string", () => {
  assert.equal(popStddev([1]), 0);
  assert.equal(popStddev([]), 0);
  assert.equal(popStddev([0, 1]), 0.5);
  assert.equal(signedDecimal(0.1), "+0.10");
  assert.equal(signedDecimal(-0.05), "-0.05");
  const g = (pr: number) => ({ passed: pr, failed: 1 - pr, total: 1, pass_rate: pr });
  const b = buildBenchmark(
    [
      { evalId: 1, configuration: "with_skill", summary: g(1) },
      { evalId: 2, configuration: "with_skill", summary: g(0) },
      { evalId: 1, configuration: "without_skill", summary: g(0) },
      { evalId: 2, configuration: "without_skill", summary: g(0) },
    ],
    { skill: "x", mock: false },
  ) as { run_summary: Record<string, unknown> };
  assert.deepEqual((b.run_summary["with_skill"] as { pass_rate: unknown }).pass_rate, { mean: 0.5, stddev: 0.5 });
  assert.deepEqual(b.run_summary["delta"], { pass_rate: "+0.50" });
  assert.equal(b.run_summary["delta_value"], 0.5);
  assert.equal("mock" in b, false);
});

test("a failed check is recorded with its observed value and the judge is called only for expectations", async () => {
  const rig = makeRig({
    evalsCount: 1,
    script: (req) => ({ files: req.label.includes("without") ? {} : { "answer.md": "x" }, transcript: "Assistant: there is no answer file here at all" }),
  });
  try {
    let judged = 0;
    const r = await rig.run({ mockAnswer: () => (judged++, 'VERDICT=PASS CONF=0.9\nEVIDENCE="there is no answer file here"') });
    assert.equal(r.exitCode, 0, r.text);
    const g = read(rig.out, "demo", "eval-1", "without_skill", "grading.json");
    assert.equal(g.expectations[0].passed, false);
    assert.match(g.expectations[0].evidence, /observed: file "answer\.md" was not produced/);
    assert.equal(g.expectations.length, 2);
    assert.equal(judged, 3, "one expectation per run, three runs (head, base replay, without)");
  } finally {
    rig.cleanup();
  }
});

test("a run whose outputs directory cannot be read gets no judge call", async () => {
  const { gradeRun } = await import("../lib/skill-evals/grade.ts");
  let calls = 0;
  const g = await gradeRun({
    evalCase: { id: 1, prompt: "p", expected_output: "o", files: [], expectations: ["e1", "e2"], checks: [] },
    outputsDir: path.join(os.tmpdir(), "skill-evals-does-not-exist-outputs"),
    skillDir: "/nonexistent",
    transcript: "t",
    judge: async () => (calls++, { verdict: "PASS", evidence: "x", confidence: "1.00" }),
  });
  assert.equal(calls, 0);
  assert.deepEqual(g.expectations.map((e) => e.passed), [false, false]);
  assert.match(g.expectations[0]?.evidence ?? "", /could not be read/);
});

test("evalsWith produces a valid multi-eval file", () => {
  assert.equal(JSON.parse(evalsWith("x", 3)).evals.length, 3);
});
