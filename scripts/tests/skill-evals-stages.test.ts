// skill-evals-stages.test.ts — the staged execution of one measurement through the runner (spec
// 0304 R5 declared first, R7 every run recorded, R8(a)/(c) resume, R9 infrastructure errors, R27
// layout). A real (non-mock) run with an injected executor and a recording judge endpoint; no model
// call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import { planCopy } from "../lib/skill-evals/results.ts";
import { selectionOf, skillRel } from "./lib/skill-evals-fixtures.ts";
import { buildRecord, stagedRuns, writeRecord } from "./lib/skill-evals-record.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";

const KEY = { mock: false as const, env: { ANTHROPIC_API_KEY: "sk-test" }, useApiKey: true };
const caps = { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 };
const FOX = "Assistant: the quick brown fox";

/** Pass everything: the probe loads the skill, the eval writes answer.md and quotes the fixed phrase. */
const happy: MockScript = (req) =>
  req.label.includes("probe-")
    ? { skillsLoaded: ["demo"] }
    : { files: { "answer.md": "x" }, transcript: FOX, costUsd: 0.05 };

const fileOf = (root: string) => path.join(root, skillRel("demo"), "evals", "results.json");
const readRec = (root: string) => JSON.parse(fs.readFileSync(fileOf(root), "utf8"));

test("R5: before the first model call the file exists as in-progress with the plan, ticket, declaration time and no run", async () => {
  let seen:
    | {
        status: string;
        plan: unknown;
        ticket: string;
        declared_at: string;
        schema_version: number;
        evals: { runs: unknown[] }[];
      }
    | undefined;
  const rig = makeRig({
    evalsCount: 2,
    ...KEY,
    settings: caps,
    script: (req) => {
      seen ??= JSON.parse(fs.readFileSync(fileOf(rig.repo.root), "utf8"));
      return happy(req);
    },
  });
  try {
    const clock = () => new Date("2026-04-01T10:00:00.000Z");
    const r = await rig.run({ fetchImpl: judgeFetch().fetch, now: clock });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.ok(seen, "the executor was called");
    assert.equal(seen?.["status"], "in-progress");
    assert.deepEqual(seen?.["plan"], planCopy());
    assert.equal(seen?.["ticket"], "1849");
    assert.equal(seen?.["declared_at"], "2026-04-01T10:00:00.000Z");
    assert.deepEqual(
      seen?.["evals"].map((e: { runs: unknown[] }) => e.runs.length),
      [0, 0],
      "no recorded run at the first call",
    );
    assert.equal(seen?.["schema_version"], 2);
    assert.equal(readRec(rig.repo.root).status, "pass", "and the file is finalised afterwards");
  } finally {
    rig.cleanup();
  }
});

test("R5: when the file cannot be written no model call is made, the exit is non-zero and the path is named", async () => {
  const rig = makeRig({ evalsCount: 1, ...KEY, settings: caps, script: happy });
  const evalsDir = path.join(rig.repo.root, skillRel("demo"), "evals");
  try {
    fs.chmodSync(evalsDir, 0o555);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(rig.executor.calls.length, 0, "no model call");
    assert.equal(r.exitCode, 1);
    assert.equal(r.results[0]?.status, "error");
    assert.match(r.text, /cannot write .*evals\/results\.json/);
  } finally {
    fs.chmodSync(evalsDir, 0o755);
    rig.cleanup();
  }
});

test("R7, R27: every graded run is recorded in order with its assertions string, and the layout has one directory per run", async () => {
  // eval 1 fails its check on run 1 only (11 of 12: accepted at stage 1): assertions show which
  const rig = makeRig({
    evalsCount: 6,
    ...KEY,
    settings: caps,
    script: (req) => {
      if (/eval-1\/run-1$/.test(req.label)) return { files: {}, transcript: FOX };
      return happy(req);
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    const rec = readRec(rig.repo.root);
    assert.equal(rec.evals[0].runs.length, 2);
    assert.equal(rec.evals[0].runs[0].passed, false);
    assert.equal(
      rec.evals[0].runs[0].assertions,
      "01",
      "the check fails, the judged expectation passes",
    );
    assert.equal(rec.evals[0].runs[1].assertions, "11");
    assert.deepEqual(Object.keys(rec.evals[0].runs[1]), [
      "passed",
      "assertions",
      "skill_loaded",
      "cost_usd",
      "reasked",
    ]);
    assert.deepEqual(rec.probes[0].runs, [true]);
    assert.match(
      r.text,
      /eval runs: 1=1\/2 2=2\/2 3=2\/2/,
      "the per-eval counts make a flaky eval visible",
    );
    for (const d of [
      "eval-1/run-1",
      "eval-1/run-2",
      "eval-6/run-1",
      "eval-6/run-2",
      "probe-1/run-1",
    ])
      assert.ok(fs.existsSync(path.join(rig.out, "demo", d)), d);
    assert.equal(fs.existsSync(path.join(rig.out, "demo", "eval-1", "run-3")), false);
    assert.equal(rec.executor_runs, 13);
    assert.equal(rec.judge_calls, 12);
  } finally {
    rig.cleanup();
  }
});

test("R2, R7: a stage that continues adds runs, never replaces them: 8 of 12 then stage 2 gives 4 runs per eval", async () => {
  const flags = stagedRuns(6, [2, 2], [8, 12]);
  const rig = makeRig({
    evalsCount: 6,
    ...KEY,
    settings: caps,
    script: (req) => {
      const m = /eval-(\d+)\/run-(\d+)$/.exec(req.label);
      if (m === null) return happy(req);
      return flags[Number(m[1]) - 1]![Number(m[2]) - 1]
        ? { files: { "answer.md": "x" }, transcript: FOX }
        : { files: {}, transcript: FOX };
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    const rec = readRec(rig.repo.root);
    assert.deepEqual(rec.stage_reached.evals, 2);
    assert.deepEqual(
      rec.evals.map((e: { runs: unknown[] }) => e.runs.length),
      [4, 4, 4, 4, 4, 4],
    );
    assert.equal(rec.eval_passes, 20);
    assert.equal(rig.executor.calls.length, 24 + 1, "24 eval runs and one probe run");
    assert.equal(r.results[0]?.evalStage, 2);
  } finally {
    rig.cleanup();
  }
});

test("R9: an infrastructure failure of a slot is recorded in errors and the slot is retried once in the same invocation", async () => {
  const tries = new Map<string, number>();
  const rig = makeRig({
    evalsCount: 1,
    ...KEY,
    settings: caps,
    script: (req) => {
      const n = (tries.get(req.label) ?? 0) + 1;
      tries.set(req.label, n);
      if (/eval-1\/run-1$/.test(req.label) && n === 1)
        return { failure: "exited with code 1 and no result record", costUsd: null };
      return happy(req);
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = readRec(rig.repo.root);
    assert.equal(rec.errors.length, 1);
    assert.deepEqual(Object.keys(rec.errors[0]), ["slot", "kind", "message", "time"]);
    assert.equal(rec.errors[0].slot, "eval-1/run-1");
    assert.equal(rec.errors[0].kind, "executor");
    assert.equal(rec.evals[0].runs.length, 2, "the failed attempt is not a sample; its retry is");
    assert.equal(rec.eval_runs, 2);
  } finally {
    rig.cleanup();
  }
});

test("R9: a second failure of the same slot ends the skill with status error, a non-zero exit and the file kept in-progress", async () => {
  const rig = makeRig({
    evalsCount: 1,
    ...KEY,
    settings: { ...caps, executorConcurrency: 1 },
    script: (req) =>
      /eval-1\/run-1$/.test(req.label)
        ? { failure: "executor crashed", costUsd: null }
        : happy(req),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "error");
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /eval-1\/run-1: failed twice \(executor\): executor crashed/);
    const rec = readRec(rig.repo.root);
    assert.equal(rec.status, "in-progress");
    assert.equal(rec.errors.length, 2);
    assert.ok(
      rec.evals[0].runs.every((x: { passed: boolean }) => typeof x.passed === "boolean"),
      "no failed slot is counted in a rate",
    );
    assert.equal(rec.eval_runs, rec.evals[0].runs.length);
  } finally {
    rig.cleanup();
  }
});

test("R9: a run that ends at a turn limit with partial output is graded as a sample, like any other run", async () => {
  const rig = makeRig({
    evalsCount: 1,
    ...KEY,
    settings: caps,
    script: (req) =>
      req.label.includes("probe-")
        ? happy(req)
        : { files: { "answer.md": "partial" }, transcript: FOX, limit: "turns", costUsd: 0.05 },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = readRec(rig.repo.root);
    assert.deepEqual(rec.errors, []);
    assert.equal(rec.evals[0].runs.length, 2);
    const metrics = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "run-1", "metrics.json"), "utf8"),
    );
    assert.equal(metrics.limit, "turns");
  } finally {
    rig.cleanup();
  }
});

/** An in-progress file for the rig's current content holding 7 of the 12 stage-1 eval runs. */
function seedPartial(rig: ReturnType<typeof makeRig>, over: Record<string, unknown> = {}) {
  const sel = selectionOf(rig.repo, "demo");
  const runs = [[true, true], [true, true], [true, true], [true], [], []];
  const rec = buildRecord(sel, { evalRuns: runs, probeRuns: [[]], ticket: "1849", costUsd: 0.05 });
  writeRecord(sel.skill.dirAbs, {
    ...rec,
    status: "in-progress",
    executor_runs: 7,
    judge_calls: 7,
    ...over,
  } as never);
  return rec;
}

test("R8(a), R27: a resumed measurement runs only the missing slots, keeps the recorded runs and never overwrites a recorded run's directory", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, settings: caps, script: happy });
  try {
    const marker = path.join(rig.out, "demo", "eval-1", "run-1", "marker.txt");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "recorded run");
    seedPartial(rig);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const labels = rig.executor.calls.map((c) => c.label).sort();
    assert.deepEqual(labels, [
      "demo/eval-4/run-2",
      "demo/eval-5/run-1",
      "demo/eval-5/run-2",
      "demo/eval-6/run-1",
      "demo/eval-6/run-2",
      "demo/probe-1/run-1",
    ]);
    assert.equal(fs.readFileSync(marker, "utf8"), "recorded run", "run-1 of eval 1 is untouched");
    const rec = readRec(rig.repo.root);
    assert.deepEqual(
      rec.evals.map((e: { runs: unknown[] }) => e.runs.length),
      [2, 2, 2, 2, 2, 2],
    );
    assert.equal(rec.eval_runs, 12);
    assert.equal(rec.executor_runs, 7 + 6, "the recorded runs and the new ones");
    assert.equal(rec.ledger.length, 0, "a resumed measurement is not a second measurement");
  } finally {
    rig.cleanup();
  }
});

test("R8(c): the same file under another ticket makes no model call and exits 1 naming both tickets", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, settings: caps, script: happy });
  try {
    seedPartial(rig, { ticket: "1850" });
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /ticket 1850/);
    assert.match(r.text, /ticket 1849/);
    assert.equal(readRec(rig.repo.root).status, "in-progress", "the file is untouched");
  } finally {
    rig.cleanup();
  }
});

test("R8(d): an in-progress file whose plan differs moves to the ledger as abandoned and a new measurement runs under the current plan", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, settings: caps, script: happy });
  try {
    seedPartial(rig, { plan: { ...planCopy(), acceptStage1: 0.95 } });
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const rec = readRec(rig.repo.root);
    assert.deepEqual(rec.plan, planCopy());
    assert.equal(rec.ledger.length, 1);
    assert.equal(rec.ledger[0].status, "abandoned");
    assert.equal(rig.executor.calls.length, 13, "a full stage 1 again: 12 eval runs and one probe");
    assert.match(r.text, /measurements on this branch: 2$/m);
  } finally {
    rig.cleanup();
  }
});
