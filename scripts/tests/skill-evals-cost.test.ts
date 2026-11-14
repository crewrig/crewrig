// skill-evals-cost.test.ts — the judge cost is recorded or assumed, and a run without a cost is
// counted by the caps (spec 0304 R22, R23). The `claude -p` judge driver reads the result record of
// `--output-format json`; a driver that reports none leaves the figure assumed. Offline: stub
// `claude` binaries and a scripted executor.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { llmJudgeEvidence } from "../../tests/e2e/lib/llm_judge.ts";
import type { JudgeDeps } from "../../tests/e2e/lib/llm_judge.ts";
import { parseCliOutput } from "../../tests/e2e/lib/llm_judge_drivers/claude-cli.ts";
import { resetLoginProbe } from "../lib/skill-evals/claude-child.ts";
import { MeasureMeter } from "../lib/skill-evals/spend.ts";
import {
  JUDGE_ASSUMED_USD,
  JUDGE_MODEL,
  MAX_MEASUREMENT_USD,
  RUN_ASSUMED_USD,
} from "../lib/skill-evals/settings.ts";
import { skillRel, tmpDir, writeStubClaude } from "./lib/skill-evals-fixtures.ts";
import { stagedRuns } from "./lib/skill-evals-record.ts";
import { stubRig } from "./lib/skill-evals-stub-rig.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";

const record = (o: Record<string, unknown>) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, ...o });
const PASS_LINE = '1 VERDICT=PASS EVIDENCE="the quick brown fox"';

test("parseCliOutput reads result, is_error and total_cost_usd, and falls back to the whole text", () => {
  assert.deepEqual(parseCliOutput(record({ result: "answer", total_cost_usd: 0.04 })), {
    text: "answer",
    isError: false,
    costUsd: 0.04,
  });
  assert.deepEqual(parseCliOutput(record({ result: "answer" })), {
    text: "answer",
    isError: false,
    costUsd: undefined,
  });
  assert.deepEqual(
    parseCliOutput(record({ result: "", is_error: true, total_cost_usd: 0.01 })).isError,
    true,
  );
  assert.deepEqual(parseCliOutput("1 VERDICT=PASS plain text"), {
    text: "1 VERDICT=PASS plain text",
    isError: false,
    costUsd: undefined,
  });
  assert.equal(parseCliOutput(JSON.stringify({ is_error: true })).isError, true);
  assert.equal(
    parseCliOutput(record({ result: "x", total_cost_usd: "free" })).costUsd,
    undefined,
    "a non-number is no cost",
  );
});

/** A `claude` stub whose judge answers come from `answers` in order (one stdout string per call). */
function judgeStub(answers: string[], code: number[] = []) {
  resetLoginProbe();
  const dir = tmpDir();
  const report = path.join(dir, "report");
  fs.mkdirSync(report);
  fs.writeFileSync(
    path.join(report, "effective.json"),
    JSON.stringify({ judge: { backend: "claude-cli", model: JUDGE_MODEL, max_calls: 50 } }),
  );
  const counter = path.join(dir, "n");
  const bin = writeStubClaude(
    dir,
    `process.stdin.on("data", () => {});\nprocess.stdin.on("end", () => {\nconst n = require("fs").existsSync(${JSON.stringify(counter)}) ? Number(require("fs").readFileSync(${JSON.stringify(counter)}, "utf8")) : 0;\nrequire("fs").writeFileSync(${JSON.stringify(counter)}, String(n + 1));\nconst answers = ${JSON.stringify(answers)};\nprocess.stdout.write(answers[Math.min(n, answers.length - 1)]);\nprocess.exit(${JSON.stringify(code)}[n] || 0);\n});\n`,
    "claude-stub.js",
    { loggedIn: true },
  );
  const deps: JudgeDeps = {
    env: {
      E2E_REPORT_DIR: report,
      SKILL_EVALS_CLAUDE_BIN: bin,
      PATH: process.env["PATH"] ?? "",
      HOME: "/contributor/home",
      CLAUDE_CODE_OAUTH_TOKEN: "t",
    },
    now: () => 0,
    sleep: async () => undefined,
    fetch: (() => {
      throw new Error("no network");
    }) as unknown as typeof fetch,
  };
  return { dir, deps };
}

test("R23: the judge driver reports the cost of a call, and the answer carries no costUsd key when the driver reports none", async () => {
  const s = judgeStub([record({ result: PASS_LINE, total_cost_usd: 0.04 })]);
  const plain = judgeStub([PASS_LINE]);
  try {
    assert.deepEqual(await llmJudgeEvidence(s.deps, "m"), {
      kind: "answer",
      text: PASS_LINE,
      costUsd: 0.04,
    });
    assert.deepEqual(await llmJudgeEvidence(plain.deps, "m"), { kind: "answer", text: PASS_LINE });
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
    fs.rmSync(plain.dir, { recursive: true, force: true });
  }
});

test("R23: the retry rule tests the parsed result, and the cost of a retry adds to the first attempt's", async () => {
  const s = judgeStub([
    record({ result: "", is_error: true, total_cost_usd: 0.02 }),
    record({ result: PASS_LINE, total_cost_usd: 0.03 }),
  ]);
  const empty = judgeStub([
    record({ result: "", total_cost_usd: 0.01 }),
    record({ result: PASS_LINE, total_cost_usd: 0.03 }),
  ]);
  try {
    const r = await llmJudgeEvidence(s.deps, "m");
    assert.equal(r.kind, "answer");
    if (r.kind === "answer") {
      assert.equal(r.text, PASS_LINE);
      assert.ok(Math.abs((r.costUsd ?? 0) - 0.05) < 1e-9, "0.02 + 0.03");
    }
    const e = await llmJudgeEvidence(empty.deps, "m");
    assert.equal(e.kind, "answer", "JSON output is never empty: an empty result is retried");
    if (e.kind === "answer") assert.ok(Math.abs((e.costUsd ?? 0) - 0.04) < 1e-9);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
    fs.rmSync(empty.dir, { recursive: true, force: true });
  }
});

test("R23: a driver that reports a cost per call gives judge_cost_usd as the measured sum", async () => {
  const t = stubRig(
    { loggedIn: true },
    {},
    { evals: 1, stub: { judgeAnswer: `${record({ result: PASS_LINE, total_cost_usd: 0.04 })}\n` } },
  );
  try {
    const r = await t.run();
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json"),
        "utf8",
      ),
    );
    assert.equal(rec.judge_calls, 2);
    assert.ok(Math.abs(rec.judge_cost_usd - 0.08) < 1e-9, `${rec.judge_cost_usd}`);
    assert.ok(Math.abs(rec.cost_usd - 0.2) < 1e-9, "the executor cost is the measured 2 x 0.1");
    assert.match(r.text, /judge_cost_usd=0\.08/);
    assert.doesNotMatch(r.text, /judge cost is assumed/);
  } finally {
    t.cleanup();
  }
});

test("R23: a driver that reports none gives judge_cost_usd null, each call counts at 0.03 and the report says assumed", async () => {
  const t = stubRig({ loggedIn: true }, {}, { evals: 1 });
  try {
    const r = await t.run();
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json"),
        "utf8",
      ),
    );
    assert.equal(rec.judge_cost_usd, null);
    assert.match(r.text, /judge_cost_usd=assumed/);
    assert.match(r.text, /judge cost is assumed/);
    assert.equal(JUDGE_ASSUMED_USD, 0.03);
  } finally {
    t.cleanup();
  }
});

const noCost = (flags: boolean[][]) => (req: { label: string }) => {
  const m = /eval-(\d+)\/run-(\d+)$/.exec(req.label);
  if (m === null) return { skillsLoaded: ["demo"], costUsd: null };
  return flags[Number(m[1]) - 1]![Number(m[2]) - 1]
    ? { files: { "answer.md": "x" }, transcript: "Assistant: the quick brown fox", costUsd: null }
    : { files: {}, transcript: "Assistant: BROKEN", costUsd: null };
};

test("R23 assumed path: with no reported run cost, every run carries cost_usd null and cost_assumed true and counts 0.10; 3.2 USD is not refused", async () => {
  const flags = stagedRuns(6, [2, 2], [8, 12]);
  const probes = Array.from({ length: 8 }, (_, i) => ({
    query: `probe ${i}`,
    should_trigger: true,
  }));
  const rig = makeRig({
    evalsCount: 6,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    settings: { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 },
    script: noCost(flags) as never,
    change: (repo) => {
      const file = path.join(repo.root, skillRel("demo"), "evals", "evals.json");
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      doc.trigger_probes = probes;
      fs.writeFileSync(file, JSON.stringify(doc));
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = JSON.parse(
      fs.readFileSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"), "utf8"),
    );
    const runs = rec.evals.flatMap((e: { runs: Record<string, unknown>[] }) => e.runs);
    assert.equal(runs.length, 24);
    assert.ok(
      runs.every(
        (x: Record<string, unknown>) => x["cost_usd"] === null && x["cost_assumed"] === true,
      ),
    );
    assert.equal(rec.cost_usd, null);
    assert.equal(rec.executor_runs, 32);
    assert.match(r.text, /cost_usd=assumed 3\.20/);
    assert.match(r.text, /executor cost is assumed/);
    assert.doesNotMatch(r.text, /at its cap/);
    assert.ok(Math.abs(RUN_ASSUMED_USD * rec.executor_runs - 3.2) < 1e-9);
  } finally {
    rig.cleanup();
  }
});

test("R23: one run without a cost among runs that reported one counts at 1 USD and carries no cost_assumed key", async () => {
  const rig = makeRig({
    evalsCount: 6,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    settings: { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 },
    script: (req) =>
      req.label.includes("probe-")
        ? { skillsLoaded: ["demo"], costUsd: 0.02 }
        : {
            files: { "answer.md": "x" },
            transcript: "Assistant: the quick brown fox",
            costUsd: /eval-3\/run-2$/.test(req.label) ? null : 0.05,
          },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = JSON.parse(
      fs.readFileSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"), "utf8"),
    );
    const odd = rec.evals[2].runs[1];
    assert.equal(odd.cost_usd, null);
    assert.equal("cost_assumed" in odd, false);
    assert.equal(rec.cost_usd, null, "the file's cost is unknown once any run's is");
    assert.match(r.text, /cost_usd=unknown \(at least /);
  } finally {
    rig.cleanup();
  }
});

test("R22, R23: the live counter: five runs of unknown cost among reported ones reach the cap of a measurement, which is intended", () => {
  const judge = { callsUsed: () => 0, costUsd: () => null };
  const m = new MeasureMeter(undefined, judge);
  m.addRun(0.05);
  for (let i = 0; i < 5; i++) m.addRun(null);
  assert.equal(m.reported, true);
  assert.ok(m.total >= MAX_MEASUREMENT_USD, `${m.total} reaches ${MAX_MEASUREMENT_USD}`);
  assert.equal(m.costUsd, null);
  // with no run reporting a cost every run counts at 0.10, and a judge call without a cost at 0.03
  const none = new MeasureMeter(undefined, { callsUsed: () => 10, costUsd: () => null });
  for (let i = 0; i < 32; i++) none.addRun(null);
  assert.equal(none.assumed, true);
  assert.ok(Math.abs(none.total - (32 * 0.1 + 10 * 0.03)) < 1e-9);
  assert.equal(none.judgeCostUsd, null);
  // a measured judge cost replaces the assumption
  const measured = new MeasureMeter(undefined, { callsUsed: () => 10, costUsd: () => 0.5 });
  measured.addRun(1);
  assert.ok(Math.abs(measured.total - 1.5) < 1e-9);
  assert.equal(measured.judgeCostUsd, 0.5);
});
