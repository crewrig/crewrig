// skill-evals-regression.test.ts — regression against the committed base results, knobs, results file
// (spec 0290 R19-R21, R30, R36, R25 as modified by delta-04).
//
// Real (non-mock) runs with an injected mock executor and a recording judge endpoint: under
// `--use-api-key` the `anthropic` driver authenticates with ANTHROPIC_API_KEY against a stub `fetch`;
// nothing leaves the process and `claude` is never started (the key source makes no login probe).

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isRegression } from "../lib/skill-evals/results.ts";
import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import { contentHash, readWorkingTree } from "../lib/skill-evals/hash.ts";
import type { Snapshot } from "../lib/skill-evals/hash.ts";
import { cleanEnv, selectionOf, skillRel } from "./lib/skill-evals-fixtures.ts";
import { DEFAULT_SETTINGS, runEvals } from "../lib/skill-evals/run.ts";
import { judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const resultsFile = (repo: string) => path.join(repo, skillRel("demo"), "evals", "results.json");

/** A valid `evals/results.json` as the merge-base would carry it (the runner reads only its base rate). */
const baseRecord = (evalPassRate: number, over: Record<string, unknown> = {}): string =>
  `${JSON.stringify(
    {
      skill_name: "demo",
      content_hash: "0".repeat(64),
      runner_version: "2.0.0",
      executor_model: "claude-sonnet-5-5",
      judge_model: "claude-sonnet-5-5",
      effort: "medium",
      date: "2026-01-01T00:00:00.000Z",
      status: "pass",
      eval_pass_rate: evalPassRate,
      probe_pass_rate: null,
      base_eval_pass_rate: null,
      threshold: 0.8,
      tolerance: 0.05,
      evals_passed: Math.round(evalPassRate * 10),
      evals_total: 10,
      probes_passed: 0,
      probes_total: 0,
      executor_runs: 10,
      judge_calls: 10,
      cost_usd: 1,
      ...over,
    },
    null,
    2,
  )}\n`;

/** 10 evals; the head skill fails the evals whose id is listed (its transcript lacks the quoted phrase). */
const script =
  (headFails: number[]): MockScript =>
  (req) => {
    const id = Number(/Task (\d+)/.exec(req.prompt)?.[1]);
    return {
      files: { "answer.md": "x" },
      transcript: headFails.includes(id)
        ? "Assistant: BROKEN answer"
        : "Assistant: the quick brown fox answer",
      costUsd: 0.1,
    };
  };

/** The caps are passed explicitly: the declared ones are provisional (#1882). The tolerance is one case. */
const EXPLICIT = {
  maxExecutorRuns: 100,
  judgeMaxCalls: 100,
  maxInvocationUsd: 1000,
} as const;

/**
 * 10 evals committed at the merge-base with `baseResults` as their evals/results.json (absent when
 * undefined); the head only edits SKILL.md, so the base's recorded rate is what the head is
 * compared with (R19: nothing is replayed).
 */
const regressionRig = (
  headFails: number[],
  baseResults: string | undefined,
  extra: Partial<Parameters<typeof makeRig>[0]> = {},
) =>
  makeRig({
    evalsCount: 10,
    change: (repo) => {
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 10),
      );
      if (baseResults !== undefined) fs.writeFileSync(resultsFile(repo.root), baseResults);
      repo.git("add", "-A");
      repo.git("commit", "-q", "-m", "evals and base results");
      repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
      fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "\nHEAD\n");
    },
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    script: script(headFails),
    ...extra,
    settings: { ...EXPLICIT, ...extra.settings },
  });

test("tolerance boundary: a drop of exactly one case is not a regression, one more is", () => {
  assert.equal(isRegression(0.8, 0.9, 0.1), false, "9/10 to 8/10 is one case");
  assert.equal(isRegression(0.7, 0.9, 0.1), true, "9/10 to 7/10 is two cases");
  assert.equal(isRegression(0.95, 0.9, 0.1), false);
});

test("a regression versus the committed base is reported with both rates and blocks", async () => {
  const rig = regressionRig([8, 9, 10], baseRecord(0.9));
  try {
    const j = judgeFetch();
    const r = await rig.run({ fetchImpl: j.fetch });
    const s = r.results[0];
    assert.equal(s?.status, "regression", r.text + r.stderr);
    assert.equal(s?.baseEvalPassRate?.toFixed(2), "0.90");
    assert.equal(s?.evalPassRate?.toFixed(2), "0.70");
    assert.equal(r.exitCode, 1);
    assert.match(
      r.text,
      /regression: demo base eval pass rate 0\.90, head 0\.70, diff -0\.20, tolerance 0\.10/,
    );
    assert.match(r.text, /base=0\.90 diff=-0\.20/);
    const rec = JSON.parse(fs.readFileSync(resultsFile(rig.repo.root), "utf8"));
    assert.equal(rec.status, "regression");
    assert.equal(rec.base_eval_pass_rate, 0.9);
    assert.equal(rec.tolerance, 0.1, "the tolerance in force is one case, recorded");
    assert.equal(rec.executor_runs, 10, "one run per eval: no paired run, no replay");
    assert.equal(rec.cost_usd.toFixed(1), "1.0");
    assert.equal(
      fs.existsSync(path.join(rig.out, "demo", "base")),
      false,
      "nothing ran on the base",
    );
    assert.ok(j.requests.length > 0);
  } finally {
    rig.cleanup();
  }
});

test("the regression-blocking knob gates the same condition", async () => {
  const rig = regressionRig([8, 9, 10], baseRecord(0.9), {
    settings: { regressionBlocking: false },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "regression");
    assert.equal(r.exitCode, 0);
  } finally {
    rig.cleanup();
  }
});

test("a drop of exactly one case against the base is a pass, and a low absolute score stays advisory", async () => {
  const rig = regressionRig([9, 10], baseRecord(0.9));
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text);
    assert.equal(r.exitCode, 0);
    assert.doesNotMatch(r.text, /advisory:/, "0.80 meets the advisory bar");
  } finally {
    rig.cleanup();
  }
  const low = regressionRig([5, 6, 7, 8, 9, 10], baseRecord(0.4));
  try {
    const r = await low.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", "4/10 against a base of 4/10 is no regression");
    assert.equal(r.exitCode, 0);
    assert.match(r.text, /advisory: eval pass rate 0\.40 is below 0\.80; not a failure/);
  } finally {
    low.cleanup();
  }
});

test("a real pass writes every R36 key in order, with the hash of the tree it ran on, the measured cost and the base rate", async () => {
  const rig = regressionRig([10], baseRecord(0.9));
  try {
    const j = judgeFetch();
    const r = await rig.run({
      fetchImpl: j.fetch,
      now: () => new Date("2026-02-03T04:05:06.000Z"),
    });
    assert.equal(r.results[0]?.status, "pass", r.text);
    const rec = JSON.parse(fs.readFileSync(resultsFile(rig.repo.root), "utf8"));
    const snap = readWorkingTree(rig.repo.root, skillRel("demo")) as Extract<
      Snapshot,
      { kind: "ok" }
    >;
    assert.equal(rec.content_hash, contentHash(snap.files));
    assert.deepEqual(Object.keys(rec), [
      "skill_name",
      "content_hash",
      "runner_version",
      "executor_model",
      "judge_model",
      "effort",
      "date",
      "status",
      "eval_pass_rate",
      "probe_pass_rate",
      "base_eval_pass_rate",
      "threshold",
      "tolerance",
      "evals_passed",
      "evals_total",
      "probes_passed",
      "probes_total",
      "executor_runs",
      "judge_calls",
      "cost_usd",
      "skill_loaded",
    ]);
    assert.equal(rec.date, "2026-02-03T04:05:06.000Z");
    assert.equal(rec.skill_name, "demo");
    assert.equal(rec.status, "pass");
    assert.equal(rec.eval_pass_rate, 0.9);
    assert.equal(rec.probe_pass_rate, null, "this skill has no probe");
    assert.equal(rec.base_eval_pass_rate, 0.9);
    assert.equal(rec.threshold, DEFAULT_SETTINGS.passThreshold);
    assert.deepEqual(
      [rec.evals_passed, rec.evals_total, rec.probes_passed, rec.probes_total],
      [9, 10, 0, 0],
    );
    assert.equal(rec.executor_model, "claude-sonnet-5-5");
    assert.equal(rec.effort, DEFAULT_SETTINGS.effort);
    assert.equal(rec.judge_calls, 10, "one judge call per eval");
    assert.equal(rec.cost_usd.toFixed(1), "1.0");
    // the judge authenticated with the API key against the recording endpoint
    assert.ok(j.requests.every((q) => q.headers["x-api-key"] === "sk-test"));
  } finally {
    rig.cleanup();
  }
});

test("no base file, or one of the former shape: `base=n/a` with its line, and a pass whatever the score", async () => {
  const former = JSON.stringify({
    ...JSON.parse(baseRecord(0.9)),
    benchmark: { with_skill_mean: 0.9 },
    status: "new",
  });
  for (const base of [undefined, former, "{ not json"]) {
    // 10/10 passing: pass, never a regression
    const ok = regressionRig([], base);
    try {
      const r = await ok.run({ fetchImpl: judgeFetch().fetch });
      assert.equal(r.results[0]?.status, "pass", r.text);
      assert.equal(r.results[0]?.baseEvalPassRate, null);
      assert.match(r.text, /base=n\/a diff=n\/a/);
      assert.match(r.text, /^ {2}not compared: no valid evals\/results\.json at the merge-base$/m);
      assert.doesNotMatch(r.text, /regression:/);
      assert.equal(
        JSON.parse(fs.readFileSync(resultsFile(ok.repo.root), "utf8")).base_eval_pass_rate,
        null,
      );
    } finally {
      ok.cleanup();
    }
    // 7/10 = 0.7 is below the advisory bar: with nothing to compare it is still a pass
    const low = regressionRig([8, 9, 10], base);
    try {
      const r = await low.run({ fetchImpl: judgeFetch().fetch });
      assert.equal(r.results[0]?.status, "pass", r.text);
      assert.equal(r.exitCode, 0);
    } finally {
      low.cleanup();
    }
  }
});

test("a skill new on the base branch is compared with nothing: pass, `base=n/a`, and a pass is attested", async () => {
  const rig = makeRig({
    newSkill: true,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    settings: EXPLICIT,
    script: () => ({
      files: { "answer.md": "x" },
      transcript: "Assistant: the quick brown fox",
      skillsLoaded: ["demo-new"], // the one probe expects a trigger
    }),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch }, ["demo-new"]);
    assert.equal(r.results[0]?.status, "pass", r.text);
    assert.equal(r.results[0]?.executorRuns, 2, "1 eval + 1 probe, one run each");
    assert.match(r.text, /base=n\/a/);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(rig.repo.root, skillRel("demo-new"), "evals", "results.json"),
          "utf8",
        ),
      ).status,
      "pass",
    );
  } finally {
    rig.cleanup();
  }
});

test("a mock run leaves results.json absent and byte-identical, and produces no regression or blocking outcome", async () => {
  const rig = regressionRig([9, 10], baseRecord(0.9), {
    mock: true,
    env: {},
    settings: { regressionBlocking: true, failBlocking: true },
  });
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

test("an eval run installs the head scripts, with the exec bit, and its exit_code check runs the head script", async () => {
  const seen: { script: string }[] = [];
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
    useApiKey: true,
    settings: EXPLICIT,
    script: (req) => {
      const f = path.join(req.workspaceDir, ".claude", "skills", "demo", "scripts", "run.sh");
      seen.push({ script: fs.readFileSync(f, "utf8") });
      assert.equal(fs.statSync(f).mode & 0o100, 0o100, "the exec bit is restored on install");
      return { files: { "answer.md": "x" } };
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.executorRuns, 1, "one run: no base replay");
    assert.equal(seen.length, 1);
    assert.match(seen[0]?.script ?? "", /echo head/);
    const g = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "grading.json"), "utf8"),
    );
    assert.equal(g.expectations[0].passed, true);
    assert.match(g.expectations[0].evidence, /exit code 5 \(expected 5\)/);
    assert.match(g.expectations[0].text, /scripts\/run\.sh/);
  } finally {
    rig.cleanup();
  }
});

test("evals.json is parsed from the single snapshot read: a change on disk after the snapshot is not observed", async () => {
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    script: () => ({
      files: { "answer.md": "x" },
      transcript: "Assistant: the quick brown fox",
      skillsLoaded: ["demo"],
    }),
  });
  try {
    const sel = selectionOf(rig.repo, "demo"); // the snapshot is read here
    const file = path.join(rig.repo.root, skillRel("demo"), "evals", "evals.json");
    fs.writeFileSync(file, "{ not json at all");
    const r = await runEvals(
      {
        repoRoot: rig.repo.root,
        out: rig.out,
        mock: false,
        useApiKey: true,
        env: cleanEnv({ ANTHROPIC_API_KEY: "sk-test" }),
        fetchImpl: judgeFetch().fetch,
        settings: EXPLICIT,
        executor: rig.executor,
        sleep: async () => undefined,
        ticket: "1849",
        declare: () => ({ ok: true }),
      },
      [sel],
    );
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.ok(rig.executor.calls.length > 0, "the evals of the snapshot were run");
  } finally {
    rig.cleanup();
  }
});
