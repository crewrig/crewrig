// skill-evals-pass-criterion.test.ts — the pass criterion of the sampling plan and the `fail-blocking`
// knob (spec 0304 R2, R3, R4; 0290 R46, R20 as superseded). Runs go through the real runner with a scripted
// mock executor: an eval passes by its one deterministic check (no judge call), a probe passes when
// the script reports the skill as loaded. No model call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import { attestSelection } from "../lib/skill-evals/attest.ts";
import { blocks } from "../lib/skill-evals/results.ts";
import { selectionOf, skillRel } from "./lib/skill-evals-fixtures.ts";
import { stagedRuns } from "./lib/skill-evals-record.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";

/**
 * The settings that hold every plan: the declared caps are not under test here and a test with
 * many evals must not trip the judge cap (these evals carry no expectation, so no judge call).
 */
const EXPLICIT = { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 } as const;

/**
 * `evalRuns[i][r]` says whether run r+1 of eval i+1 passes; `probeRuns[j][r]` whether run r+1 of probe
 * j+1 passes (every probe has should_trigger true, so it passes exactly when the skill is loaded).
 * A run beyond the table fails, so a stage that should not run shows up as a recorded failure.
 */
async function runTable(
  evalRuns: boolean[][],
  probeRuns: boolean[][],
  settings: Record<string, unknown> = {},
) {
  const evals = evalRuns.map((_, i) => ({
    id: i + 1,
    prompt: `Task ${i + 1}`,
    expected_output: "An answer file.",
    files: [],
    expectations: [],
    checks: [{ type: "file_exists", path: "answer.md" }],
  }));
  const text = JSON.stringify({
    skill_name: "demo",
    evals,
    ...(probeRuns.length > 0
      ? {
          trigger_probes: probeRuns.map((_, j) => ({
            query: `probe ${j + 1}`,
            should_trigger: true,
          })),
        }
      : {}),
  });
  const script: MockScript = (req) => {
    const probe = /probe-(\d+)\/run-(\d+)$/.exec(req.label);
    if (probe !== null)
      return {
        skillsLoaded: probeRuns[Number(probe[1]) - 1]?.[Number(probe[2]) - 1] ? ["demo"] : [],
      };
    const m = /eval-(\d+)\/run-(\d+)$/.exec(req.label);
    const ok = evalRuns[Number(m?.[1]) - 1]?.[Number(m?.[2]) - 1] === true;
    return { files: ok ? { "answer.md": "x" } : {} };
  };
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    script,
    settings: { ...EXPLICIT, ...settings },
    change: (repo) =>
      fs.writeFileSync(path.join(repo.root, skillRel("demo"), "evals", "evals.json"), text),
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    const file = path.join(rig.repo.root, skillRel("demo"), "evals", "results.json");
    const attested = attestSelection(selectionOf(rig.repo, "demo"));
    return {
      r,
      s: r.results[0]!,
      rec: JSON.parse(fs.readFileSync(file, "utf8")),
      calls: rig.executor.calls.length,
      attested,
    };
  } finally {
    rig.cleanup();
  }
}

/** `passes` of the `perItem x items` runs of one pool pass, per stage (see stagedRuns). */
const pool = (items: number, passes: number[]): boolean[][] => stagedRuns(items, [2, 2], passes);
/** Probe runs: one per stage. */
const probePool = (items: number, passes: number[]): boolean[][] =>
  stagedRuns(items, [1, 1], passes);

test("R2: 5 evals with 9 of 10 passing meet 0.90 exactly: accepted at stage 1, no stage 2, status pass", async () => {
  const { s, rec, calls, attested } = await runTable(pool(5, [9]), []);
  assert.equal(s.status, "pass");
  assert.equal(rec.status, "pass");
  assert.equal(calls, 10, "two runs of each of 5 evals and nothing more");
  assert.deepEqual(rec.stage_reached, { evals: 1, probes: null });
  assert.deepEqual([rec.eval_passes, rec.eval_runs], [9, 10]);
  assert.equal(rec.eval_pass_rate, 0.9);
  assert.equal(attested.status, "pass", "the attestation recomputes the same decision (R4)");
});

test("R2: 8 of 10 continues to stage 2; 15 of 20 cumulative is accepted and 14 of 20 rejected", async () => {
  const ok = await runTable(pool(5, [8, 7]), []);
  assert.equal(ok.calls, 20);
  assert.deepEqual(ok.rec.stage_reached, { evals: 2, probes: null });
  assert.equal(ok.s.status, "pass");
  assert.equal(ok.attested.status, "pass");
  const low = await runTable(pool(5, [8, 6]), []);
  assert.equal(low.s.status, "fail");
  assert.equal(low.rec.status, "fail");
  assert.equal(low.attested.status, "fail");
  assert.match(low.r.text, /eval_pass_rate=0\.70 \(14\/20, stage 2\)/);
});

test("R2: 5 of 10 is rejected at stage 1 with no stage 2: fail after 10 runs", async () => {
  const none = await runTable(pool(5, [5]), []);
  assert.equal(none.s.status, "fail");
  assert.equal(none.calls, 10);
  assert.deepEqual(none.rec.stage_reached, { evals: 1, probes: null });
});

test("R2: the probe pool is decided apart: 8 of 8 probes accepted at stage 1 while the evals take stage 2", async () => {
  const t = await runTable(pool(5, [8, 10]), probePool(8, [8]));
  assert.equal(t.s.status, "pass");
  assert.deepEqual(t.rec.stage_reached, { evals: 2, probes: 1 });
  assert.equal(t.calls, 20 + 8);
  assert.match(t.r.text, /probe_pass_rate=1\.00 \(8\/8, stage 1\)/);
});

test("R2: 7 of 8 probes continue, and 16 probe runs are decided at 0.75", async () => {
  const ok = await runTable(pool(5, [10]), probePool(8, [7, 6]));
  assert.deepEqual(ok.rec.stage_reached, { evals: 1, probes: 2 });
  assert.equal(ok.calls, 10 + 16);
  assert.equal(ok.s.status, "pass", "13 of 16 is 0.8125");
  const low = await runTable(pool(5, [10]), probePool(8, [7, 4]));
  assert.equal(low.s.status, "fail", "11 of 16 is below 0.75");
});

test("R3: probes do not mask failing evals, and the rates are separate", async () => {
  const t = await runTable(pool(5, [5]), probePool(8, [8]));
  assert.equal(t.s.status, "fail");
  assert.match(
    t.r.text,
    /eval_pass_rate=0\.50 \(5\/10, stage 1\) probe_pass_rate=1\.00 \(8\/8, stage 1\)/,
  );
});

test("R3: a skill with no probe is graded on its evals alone and the probe figures are null", async () => {
  const ok = await runTable(pool(5, [10]), []);
  assert.equal(ok.s.status, "pass");
  assert.equal(ok.rec.probe_pass_rate, null);
  assert.equal(ok.rec.stage_reached.probes, null);
  assert.deepEqual([ok.rec.probe_passes, ok.rec.probe_runs], [0, 0]);
  assert.match(ok.r.text, /probe_pass_rate=n\/a/);
});

test("fail exits 0 and blocks only under fail-blocking, naming the skill; a pass never blocks", async () => {
  const open = await runTable(pool(5, [5]), []);
  assert.equal(open.s.status, "fail");
  assert.equal(open.r.exitCode, 0, "fail-blocking defaults to false");
  assert.equal(open.s.blocking, false);
  const closed = await runTable(pool(5, [5]), [], { failBlocking: true });
  assert.equal(closed.r.exitCode, 1);
  assert.match(closed.r.text, /^demo: status=fail /m);
  assert.equal(closed.s.blocking, true);
  assert.equal((await runTable(pool(5, [10]), [], { failBlocking: true })).r.exitCode, 0);
  assert.equal((await runTable(pool(5, [5]), [], { regressionBlocking: true })).r.exitCode, 0);
});

test("blocks(): each non-passing status blocks under its own knob only", () => {
  const knobs = (failBlocking: boolean, regressionBlocking: boolean) => ({
    failBlocking,
    regressionBlocking,
  });
  assert.equal(blocks("fail", knobs(false, false)), false);
  assert.equal(blocks("fail", knobs(true, false)), true);
  assert.equal(blocks("fail", knobs(false, true)), false);
  assert.equal(blocks("regression", knobs(true, false)), false, "a regression is not a fail");
  assert.equal(blocks("regression", knobs(false, true)), true);
  assert.equal(blocks("pass", knobs(true, true)), false);
});
