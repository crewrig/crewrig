// skill-evals-regression.test.ts — regression arithmetic, knobs, results file (spec 0290 R19-R21, R30, R36, R25).
//
// Real (non-mock) runs with an injected mock executor and a recording judge endpoint: the
// `anthropic` driver authenticates with ANTHROPIC_API_KEY against a stub `fetch`; nothing leaves the
// process.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isRegression } from "../lib/skill-evals/benchmark.ts";
import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import { contentHash, readWorkingTree } from "../lib/skill-evals/hash.ts";
import type { Snapshot } from "../lib/skill-evals/hash.ts";
import { skillRel } from "./lib/skill-evals-fixtures.ts";
import { judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const resultsFile = (repo: string) => path.join(repo, skillRel("demo"), "evals", "results.json");

/**
 * 10 evals. The base skill fails eval 10 (mean 0.9); the head skill, recognisable by the marker in
 * references/ref.md, also fails evals 9 (mean 0.8).
 */
const script =
  (headFails: number[], baseFails: number[]): MockScript =>
  (req) => {
    const id = Number(/Task (\d+)/.exec(req.prompt)?.[1]);
    const ref = path.join(req.homeDir, ".claude", "skills", "demo", "references", "ref.md");
    const installed = fs.existsSync(ref) ? fs.readFileSync(ref, "utf8") : "";
    const isHead = installed.includes("HEAD-VARIANT");
    const broken = req.label.includes("without")
      ? true
      : isHead
        ? headFails.includes(id)
        : baseFails.includes(id);
    return {
      files: { "answer.md": "x" },
      transcript: broken ? "Assistant: BROKEN answer" : "Assistant: the quick brown fox answer",
      costUsd: 0.1,
    };
  };

const regressionRig = (extra: Partial<Parameters<typeof makeRig>[0]> = {}) =>
  makeRig({
    evalsCount: 10,
    change: (repo) => {
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 10),
      );
      repo.git("add", "-A");
      repo.git("commit", "-q", "-m", "evals");
      repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "references", "ref.md"),
        "HEAD-VARIANT\n",
      );
    },
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    script: script([9, 10], [10]),
    ...extra,
  });

test("tolerance boundary: a drop equal to the tolerance is not a regression, one byte beyond is", () => {
  assert.equal(isRegression(0.86, 0.9, 0.05), false);
  assert.equal(
    isRegression(0.85, 0.9, 0.05),
    false,
    "exactly the tolerance is not MORE than the tolerance",
  );
  assert.equal(isRegression(0.849, 0.9, 0.05), true);
  assert.equal(isRegression(0.8, 0.9, 0.05), true);
  assert.equal(isRegression(0.95, 0.9, 0.05), false);
});

test("regression versus base is reported with both means and does not block by default", async () => {
  const rig = regressionRig();
  try {
    const j = judgeFetch();
    const r = await rig.run({ fetchImpl: j.fetch });
    const s = r.results[0];
    assert.equal(s?.status, "regression", r.text + r.stderr);
    assert.equal(s?.baseMean?.toFixed(2), "0.90");
    assert.equal(s?.withSkillMean?.toFixed(2), "0.80");
    assert.equal(r.exitCode, 0);
    assert.match(
      r.text,
      /regression: demo base mean 0\.90, head mean 0\.80, delta -0\.10, tolerance 0\.05/,
    );
    const rec = JSON.parse(fs.readFileSync(resultsFile(rig.repo.root), "utf8"));
    assert.equal(rec.status, "regression");
    assert.equal(rec.benchmark.base_mean.toFixed(2), "0.90");
    assert.equal(rec.executor_runs, 30);
    assert.equal(rec.cost_usd.toFixed(1), "3.0");
    assert.ok(j.requests.length > 0);
  } finally {
    rig.cleanup();
  }
});

test("the regression-blocking knob flips the same condition", async () => {
  const rig = regressionRig({ settings: { regressionBlocking: true } });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "regression");
    assert.equal(r.exitCode, 1);
  } finally {
    rig.cleanup();
  }
});

test("a drop within tolerance is a pass", async () => {
  const rig = regressionRig({ settings: { tolerance: 0.15 } });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass");
    assert.equal(r.exitCode, 0);
  } finally {
    rig.cleanup();
  }
});

test("a real pass writes results.json with the hash of the tree it ran on, the measured cost and a numeric base_mean", async () => {
  const rig = regressionRig({ script: script([10], [10]) });
  try {
    const j = judgeFetch();
    const r = await rig.run({
      fetchImpl: j.fetch,
      now: () => new Date("2026-02-03T04:05:06.000Z"),
    });
    assert.equal(r.results[0]?.status, "pass");
    const rec = JSON.parse(fs.readFileSync(resultsFile(rig.repo.root), "utf8"));
    const snap = readWorkingTree(rig.repo.root, skillRel("demo")) as Extract<
      Snapshot,
      { kind: "ok" }
    >;
    assert.equal(rec.content_hash, contentHash(snap.files));
    assert.equal(rec.date, "2026-02-03T04:05:06.000Z");
    assert.equal(rec.skill_name, "demo");
    assert.equal(
      typeof rec.benchmark.base_mean,
      "number",
      "a scripts/references change is replayed against the base",
    );
    assert.equal(rec.status, "pass");
    assert.equal(rec.executor_model, "claude-sonnet-4-6");
    assert.equal(rec.cost_usd.toFixed(1), "3.0");
    assert.deepEqual(Object.keys(rec).sort(), [
      "benchmark",
      "content_hash",
      "cost_usd",
      "date",
      "executor_model",
      "executor_runs",
      "judge_calls",
      "judge_model",
      "runner_version",
      "skill_name",
      "status",
    ]);
    // the judge authenticated with the API key against the recording endpoint
    assert.ok(j.requests.every((q) => q.headers["x-api-key"] === "sk-test"));
  } finally {
    rig.cleanup();
  }
});

test("an evals-only change plans two runs per eval, reports pass with a null base_mean and writes results.json", async () => {
  const rig = makeRig({
    evalsCount: 2,
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 2),
      ),
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    script: () => ({
      files: { "answer.md": "x" },
      transcript: "Assistant: the quick brown fox",
      costUsd: 0.2,
    }),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass");
    assert.equal(r.results[0]?.executorRuns, 4, "2 evals x 2 runs, no base replay");
    assert.equal(r.results[0]?.baseMean, null);
    assert.equal(fs.existsSync(path.join(rig.out, "demo", "base")), false);
    const rec = JSON.parse(fs.readFileSync(resultsFile(rig.repo.root), "utf8"));
    assert.equal(rec.benchmark.base_mean, null);
    assert.equal(rec.cost_usd, 0.8);
    assert.match(r.text, /cost_usd=0\.80/);
  } finally {
    rig.cleanup();
  }
});

test("a skill new on the base branch is reported new, not compared, and attested", async () => {
  const rig = makeRig({
    newSkill: true,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    script: () => ({ files: { "answer.md": "x" }, transcript: "Assistant: the quick brown fox" }),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch }, ["demo-new"]);
    assert.equal(r.results[0]?.status, "new");
    assert.equal(r.results[0]?.executorRuns, 2);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(rig.repo.root, skillRel("demo-new"), "evals", "results.json"),
          "utf8",
        ),
      ).status,
      "new",
    );
  } finally {
    rig.cleanup();
  }
});

test("a mock run leaves results.json absent and byte-identical, and produces no regression or blocking outcome", async () => {
  const rig = regressionRig({ mock: true, env: {}, settings: { regressionBlocking: true } });
  try {
    fs.writeFileSync(resultsFile(rig.repo.root), '{"kept":true}\n');
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "mock");
    assert.equal(r.exitCode, 0);
    assert.equal(fs.readFileSync(resultsFile(rig.repo.root), "utf8"), '{"kept":true}\n');
  } finally {
    rig.cleanup();
  }
});

test("scripts changes are replayed: the base run installs the merge-base scripts, exit_code checks run the head scripts", async () => {
  const seen: { label: string; script: string }[] = [];
  const rig = makeRig({
    evalsCount: 1,
    change: (repo) => {
      const dir = path.join(repo.root, skillRel("demo"));
      fs.writeFileSync(path.join(dir, "scripts", "run.sh"), "#!/bin/sh\necho head\nexit 5\n");
      fs.writeFileSync(
        path.join(dir, "evals", "evals.json"),
        JSON.stringify({
          skill_name: "demo",
          evals: [
            {
              id: 1,
              prompt: "Task 1",
              expected_output: "o",
              files: [],
              expectations: [],
              checks: [{ type: "exit_code", script: "scripts/run.sh", expected: 5 }],
            },
          ],
        }),
      );
    },
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    script: (req) => {
      const f = path.join(req.homeDir, ".claude", "skills", "demo", "scripts", "run.sh");
      if (fs.existsSync(f)) {
        seen.push({ label: req.label, script: fs.readFileSync(f, "utf8") });
        assert.equal(
          fs.statSync(f).mode & 0o100,
          0o100,
          "the exec bit is restored on install, head and base alike",
        );
      }
      return { files: { "answer.md": "x" } };
    },
  });
  try {
    // the head evals.json change is part of the diff; commit it so the merge-base differs from head
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.executorRuns, 3);
    const base = seen.find((s) => s.label.includes("(base)"));
    const head = seen.find((s) => s.label.includes("with_skill") && !s.label.includes("(base)"));
    assert.match(base?.script ?? "", /echo hello/);
    assert.match(head?.script ?? "", /echo head/);
    // the base replay installs the base script (exit 0) but its exit_code check runs the HEAD script (exit 5)
    const g = JSON.parse(
      fs.readFileSync(
        path.join(rig.out, "demo", "base", "eval-1", "with_skill", "grading.json"),
        "utf8",
      ),
    );
    assert.equal(g.expectations[0].passed, true);
    assert.match(g.expectations[0].evidence, /exit code 5 \(expected 5\)/);
    assert.match(g.expectations[0].text, /scripts\/run\.sh/);
  } finally {
    rig.cleanup();
  }
});
