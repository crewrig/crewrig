// skill-evals-hardening.test.ts — review pass 1 of spec 0304 (i1-F1 to i1-F4): a pool decided while
// the other is open stays `in-progress`; the history of the range is listed with --full-history and
// fails closed; a resume refuses a case edited since the interruption; the verifier ties `passed` to
// `assertions`, `executor_runs` to the runs and `cost_usd` to the run costs. Offline, no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestSelection } from "../lib/skill-evals/attest.ts";
import { HistoryError, readHistory } from "../lib/skill-evals/ledger.ts";
import { decideSkill } from "../lib/skill-evals/plan.ts";
import { verifyRecord } from "../lib/skill-evals/results-verify.ts";
import { commitAll, makeRepo, skillRel } from "./lib/skill-evals-fixtures.ts";
import { allPass, writeRecord } from "./lib/skill-evals-record.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";
import { sixRig } from "./lib/skill-evals-six.ts";

const KEY = { mock: false as const, env: { ANTHROPIC_API_KEY: "sk-test" }, useApiKey: true };
const caps = { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 };
const fileOf = (root: string) => path.join(root, skillRel("demo"), "evals", "results.json");
const readRec = (root: string) => JSON.parse(fs.readFileSync(fileOf(root), "utf8"));

test("i1-F1: decideSkill keeps a rejected pool in-progress while the other pool is open", () => {
  const evalsRejected = [
    [false, false],
    [false, false],
  ];
  assert.equal(decideSkill({ evals: evalsRejected, probes: [[]] }).status, "in-progress");
  assert.equal(decideSkill({ evals: evalsRejected, probes: [[false]] }).status, "fail");
  assert.equal(decideSkill({ evals: [[true, true]], probes: [[false]] }).status, "fail");
  assert.equal(decideSkill({ evals: evalsRejected }).status, "fail");
});

test("i1-F1: two evals failing every run and a probe that fails twice leave the file in-progress; the resume decides the probe pool", async () => {
  let probeCrashes = true;
  const rig = makeRig({
    ...KEY,
    settings: { ...caps, executorConcurrency: 1 },
    change: (repo) => {
      const evals = [1, 2].map((id) => ({
        id,
        prompt: `Task ${id}`,
        expected_output: "An answer file.",
        files: [],
        expectations: [],
        checks: [{ type: "file_exists", path: "answer.md" }],
      }));
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        JSON.stringify({
          skill_name: "demo",
          evals,
          trigger_probes: [{ query: "probe", should_trigger: true }],
        }),
      );
    },
    script: (req) =>
      req.label.includes("probe-")
        ? probeCrashes
          ? { failure: "probe crashed", costUsd: 0.01 }
          : { skillsLoaded: ["demo"], costUsd: 0.01 }
        : { costUsd: 0.01 },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.exitCode, 1);
    assert.equal(r.results[0]?.status, "error");
    const rec = readRec(rig.repo.root);
    assert.equal(
      rec.status,
      "in-progress",
      "the evals pool is rejected but the probe pool is open",
    );
    assert.equal(rec.eval_runs, 4);
    assert.equal(rec.probe_runs, 0);
    const ctx = { skillName: "demo", baseText: undefined, mergeBase: "" };
    assert.equal(verifyRecord(rec, ctx).ok, true, "the verifier accepts the half-finished file");
    probeCrashes = false;
    const before = rig.executor.calls.length;
    const r2 = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(
      rig.executor.calls.length - before,
      1,
      `only the missing probe slot runs: ${r2.text}${r2.stderr}`,
    );
    assert.equal(r2.results[0]?.status, "fail");
    const done = readRec(rig.repo.root);
    assert.equal(done.status, "fail");
    assert.equal(done.probe_runs, 1);
    assert.equal(verifyRecord(done, ctx).ok, true);
  } finally {
    rig.cleanup();
  }
});

test("i1-F2: the range is listed with --full-history: a restore inside a merged branch is not hidden", () => {
  const repo = makeRepo();
  try {
    const rel = `${skillRel("demo")}/evals/results.json`;
    const put = (text: string) => {
      fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo.root, rel), text);
    };
    put("base\n");
    commitAll(repo, "base");
    repo.git("checkout", "-q", "-b", "branch");
    put("measured\n");
    commitAll(repo, "measure");
    put("base\n");
    commitAll(repo, "restore");
    repo.git("checkout", "-q", "main");
    fs.writeFileSync(path.join(repo.root, "other.txt"), "main moved\n");
    commitAll(repo, "main moves");
    const tip = repo.git("rev-parse", "HEAD").trim();
    repo.git("checkout", "-q", "--detach", "main");
    repo.git("merge", "-q", "--no-ff", "-m", "merge ref", "branch");
    const h = readHistory(repo.root, tip, skillRel("demo"));
    assert.equal(h.mbText, "base\n");
    assert.ok(h.revisions.includes("measured\n"), "the measured revision is in the range");
  } finally {
    repo.cleanup();
  }
});

test("i1-F2: a history that cannot be listed fails closed: HistoryError, and the attestation is invalid", () => {
  const repo = makeRepo();
  try {
    fs.writeFileSync(path.join(repo.root, "a.txt"), "a\n");
    commitAll(repo, "a");
    assert.throws(() => readHistory(repo.root, "deadbeefdeadbeef", skillRel("demo")), HistoryError);
  } finally {
    repo.cleanup();
  }
  const rig = sixRig({});
  try {
    writeRecord(rig.dir, rig.head({ evalRuns: allPass(6, 2) }));
    const sel = { ...rig.sel(), mergeBase: "deadbeefdeadbeef" };
    const o = attestSelection(sel, undefined, rig.repo.root);
    assert.equal(o.status, "invalid");
    assert.match(o.reason, /cannot list the revisions/);
  } finally {
    rig.cleanup();
  }
});

test("i1-F3: a resume refuses a case edited since the interruption, naming the eval, and makes no model call", async () => {
  const rig = makeRig({
    evalsCount: 1,
    ...KEY,
    settings: { ...caps, executorConcurrency: 1 },
    script: (req) =>
      /eval-1\/run-2$/.test(req.label)
        ? { failure: "crashed", costUsd: null }
        : { files: { "answer.md": "x" }, transcript: "Assistant: the quick brown fox" },
  });
  try {
    await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(readRec(rig.repo.root).status, "in-progress");
    fs.appendFileSync(
      path.join(rig.repo.root, skillRel("demo"), "evals", "files", "in.txt"),
      "edit\n",
    );
    const before = rig.executor.calls.length;
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.exitCode, 1);
    assert.equal(rig.executor.calls.length, before, "no model call");
    assert.match(
      r.text,
      /cannot resume the measurement of sha256:[0-9a-f]+: eval 1 changed after the measurement/,
    );
    assert.equal(readRec(rig.repo.root).status, "in-progress", "the file is left as it was");
  } finally {
    rig.cleanup();
  }
});

test("i1-F4: the verifier ties passed to assertions, executor_runs to the runs and cost_usd to the run costs", () => {
  const rig = sixRig({});
  try {
    const sel = rig.sel();
    const ctx = {
      skillName: "demo",
      baseText: sel.baseResultsText,
      mergeBase: sel.mergeBase ?? "",
    };
    const good = () => JSON.parse(JSON.stringify(rig.head({ evalRuns: allPass(6, 2) })));
    assert.equal(verifyRecord(good(), ctx).ok, true);
    const passed = good();
    passed.evals[0].runs[0].assertions = "10";
    const v1 = verifyRecord(passed, ctx);
    assert.equal(v1.ok, false);
    assert.match(
      v1.ok ? "" : v1.reason,
      /eval 1 run 1 records passed true but its assertions are "10"/,
    );
    const flipped = good();
    flipped.evals[0].runs[0].passed = false;
    assert.equal(verifyRecord(flipped, ctx).ok, false);
    const runs = good();
    runs.executor_runs = 3;
    const v2 = verifyRecord(runs, ctx);
    assert.match(v2.ok ? "" : v2.reason, /executor_runs 3 is below the 13 recorded runs/);
    const cost = good();
    cost.cost_usd = 0.01;
    const v3 = verifyRecord(cost, ctx);
    assert.match(v3.ok ? "" : v3.reason, /cost_usd 0.01 is below/);
    const unknown = good();
    unknown.cost_usd = null;
    assert.equal(verifyRecord(unknown, ctx).ok, true, "an unknown cost is not understated");
  } finally {
    rig.cleanup();
  }
});

test("i1-F6: runs in flight when the measurement cost cap is reached finish, are recorded and counted; no new run starts", async () => {
  const rig = makeRig({
    evalsCount: 4,
    ...KEY,
    settings: { ...caps, maxMeasurementUsd: 0.5, executorConcurrency: 3 },
    script: (req) =>
      req.label.includes("probe-")
        ? { skillsLoaded: ["demo"], costUsd: 0.01 }
        : /eval-1\/run-1$/.test(req.label)
          ? { files: { "answer.md": "x" }, transcript: FOX, costUsd: 0.6 }
          : { files: { "answer.md": "x" }, transcript: FOX, costUsd: 0.1, delayMs: 100 },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /the measurement is at its cap/);
    assert.equal(rig.executor.calls.length, 3, "three runs started, none after the cap");
    const rec = readRec(rig.repo.root);
    assert.equal(rec.status, "in-progress");
    assert.equal(rec.eval_runs, 3, "the two runs in flight finished and are recorded");
    assert.ok(Math.abs(rec.cost_usd - 0.8) < 1e-9, `their cost is counted: ${rec.cost_usd}`);
    assert.equal(rec.executor_runs, 3);
  } finally {
    rig.cleanup();
  }
});

test("i1-F7: several resume sessions of one measurement keep a valid file: costs are summed in integer micro-dollars", async () => {
  let allowed = 0;
  const rig = makeRig({
    evalsCount: 3,
    ...KEY,
    settings: { ...caps, executorConcurrency: 1 },
    script: (req) =>
      allowed <= 0
        ? { failure: "session over", costUsd: 0 }
        : (allowed--,
          req.label.includes("probe-")
            ? { skillsLoaded: ["demo"], costUsd: 0.1234554 }
            : { files: { "answer.md": "x" }, transcript: FOX, costUsd: 0.1234554 }),
  });
  try {
    let sessions = 0;
    let rec = readRecOrNone(rig.repo.root);
    while (rec?.status !== "pass" && sessions < 12) {
      allowed = 1; // one run per session, then the executor fails twice and the skill stops
      await rig.run({ fetchImpl: judgeFetch().fetch });
      sessions++;
      rec = readRec(rig.repo.root);
    }
    assert.equal(rec.status, "pass");
    assert.ok(sessions >= 7, `${sessions} sessions`);
    const ctx = { skillName: "demo", baseText: undefined, mergeBase: "" };
    const v = verifyRecord(rec, ctx);
    assert.equal(v.ok, true, v.ok ? "" : v.reason);
    assert.equal(Math.round(rec.cost_usd * 1e6), 7 * 123455, "no rounding drift across sessions");
  } finally {
    rig.cleanup();
  }
});

const FOX = "Assistant: the quick brown fox";
function readRecOrNone(root: string) {
  return fs.existsSync(fileOf(root)) ? readRec(root) : undefined;
}
