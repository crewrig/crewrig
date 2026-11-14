// skill-evals-layout.test.ts — output layout and formats of a run (spec 0290 R10, R11, R12, R24, R25, R45 as modified by delta-04).

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { skillRel } from "./lib/skill-evals-fixtures.ts";
import { evalsWith, makeRig } from "./lib/skill-evals-run-rig.ts";

const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(...p), "utf8"));

test("a mock run writes the R10 layout: eval-<id>/ and probe-<n>/, all marked mock, no base, no benchmark", async () => {
  const rig = makeRig({ evalsCount: 2 });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.text + r.stderr);
    assert.equal(r.results[0]?.status, "mock");
    const skillOut = path.join(rig.out, "demo");
    for (const id of [1, 2]) {
      const dir = path.join(skillOut, `eval-${id}`);
      assert.ok(fs.existsSync(path.join(dir, "transcript.md")), dir);
      assert.ok(
        fs.existsSync(path.join(dir, "outputs", "answer.md")),
        "produced files live in outputs/",
      );
      assert.equal(
        fs.existsSync(path.join(dir, "outputs", "in.txt")),
        false,
        "an unchanged R3 input is not an output",
      );
      const grading = read(dir, "grading.json");
      assert.equal(grading.mock, true);
      // check first (R12), then the expectation (file order within each list)
      assert.deepEqual(
        grading.expectations.map((e: { text: string }) => e.text),
        ["check file_exists: answer.md", "Expectation 1 holds"],
      );
      assert.deepEqual(grading.summary, { passed: 2, failed: 0, total: 2, pass_rate: 1 });
      for (const e of grading.expectations) {
        assert.equal(typeof e.passed, "boolean");
        assert.ok(e.evidence.length > 0);
      }
      const metrics = read(dir, "metrics.json");
      assert.equal(metrics.limit, null);
      assert.equal(metrics.cost_usd, 0.01);
      assert.equal(metrics.skill_loaded, true);
      assert.equal(metrics.mock, true);
    }
    // the probe (R45): no grading, no outputs, probe.json marked mock
    const probe = path.join(skillOut, "probe-1");
    assert.ok(fs.existsSync(path.join(probe, "transcript.md")));
    assert.ok(fs.existsSync(path.join(probe, "metrics.json")));
    assert.equal(fs.existsSync(path.join(probe, "grading.json")), false);
    assert.deepEqual(read(probe, "probe.json"), {
      query: "q",
      should_trigger: true,
      observed: false,
      passed: false,
      mock: true,
    });
    // the removed machinery leaves no trace (R10 as modified by delta-04)
    assert.deepEqual(
      fs
        .readdirSync(skillOut)
        .filter((n) => !n.startsWith("."))
        .sort(),
      ["eval-1", "eval-2", "probe-1"],
    );
    assert.equal(
      fs.existsSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json")),
      false,
      "a mock run writes no results file",
    );
  } finally {
    rig.cleanup();
  }
});

test("a failed check is recorded with its observed value and the judge is called once, only for expectations", async () => {
  const rig = makeRig({
    evalsCount: 1,
    script: () => ({
      files: {},
      transcript: "Assistant: there is no answer file here at all",
    }),
  });
  try {
    let judged = 0;
    const r = await rig.run({
      mockAnswer: () => (judged++, '1 VERDICT=PASS EVIDENCE="there is no answer file here"'),
    });
    assert.equal(r.exitCode, 0, r.text);
    const g = read(rig.out, "demo", "eval-1", "grading.json");
    assert.equal(g.expectations[0].passed, false);
    assert.match(g.expectations[0].evidence, /observed: file "answer\.md" was not produced/);
    assert.equal(g.expectations.length, 2);
    assert.equal(judged, 1, "one judge call for the eval, none for the probe");
  } finally {
    rig.cleanup();
  }
});

test("a run whose outputs directory cannot be read gets no judge call", async () => {
  const { gradeRun } = await import("../lib/skill-evals/grade.ts");
  let calls = 0;
  const g = await gradeRun({
    evalCase: {
      id: 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: ["e1", "e2"],
      checks: [],
    },
    outputsDir: path.join(os.tmpdir(), "skill-evals-does-not-exist-outputs"),
    skillDir: "/nonexistent",
    transcript: "t",
    judge: async () => (calls++, [{ verdict: "PASS", evidence: "x" }]),
  });
  assert.equal(calls, 0);
  assert.deepEqual(
    g.expectations.map((e) => e.passed),
    [false, false],
  );
  assert.match(g.expectations[0]?.evidence ?? "", /could not be read/);
});

test("evalsWith produces a valid multi-eval file", () => {
  assert.equal(JSON.parse(evalsWith("x", 3)).evals.length, 3);
});
