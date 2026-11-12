// skill-evals-pass-criterion.test.ts — the R46 pass criterion and the `fail-blocking` knob
// (spec 0290 R46, R20 as modified by delta-04, R25). Runs go through the real runner with a scripted
// mock executor: an eval passes by its one deterministic check (no judge call), a probe passes when
// the script reports the skill as loaded. No model call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import { blocks, decide } from "../lib/skill-evals/results.ts";
import { skillRel } from "./lib/skill-evals-fixtures.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";

/** The caps and thresholds are passed explicitly: the declared caps are provisional (#1882). */
const EXPLICIT = {
  tolerance: 0.05,
  passThreshold: 0.8,
  maxExecutorRuns: 100,
  judgeMaxCalls: 100,
  maxInvocationUsd: 1000,
} as const;

/**
 * `evalPass[i]` says whether eval i+1 passes; `probePass[j]` whether probe j+1 passes (every probe
 * has should_trigger true, so it passes exactly when the skill is observed loaded).
 */
async function runTable(
  evalPass: boolean[],
  probePass: boolean[],
  settings: Record<string, unknown> = {},
) {
  const evals = evalPass.map((_, i) => ({
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
    ...(probePass.length > 0
      ? {
          trigger_probes: probePass.map((_, j) => ({
            query: `probe ${j + 1}`,
            should_trigger: true,
          })),
        }
      : {}),
  });
  const script: MockScript = (req) => {
    const probe = /probe-(\d+)$/.exec(req.label);
    if (probe !== null) return { skillsLoaded: probePass[Number(probe[1]) - 1] ? ["demo"] : [] };
    const id = Number(/eval-(\d+)$/.exec(req.label)?.[1]);
    const files: Record<string, string> = evalPass[id - 1] ? { "answer.md": "x" } : {};
    return { files };
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
    return { r, s: r.results[0]!, rec: JSON.parse(fs.readFileSync(file, "utf8")) };
  } finally {
    rig.cleanup();
  }
}

const flags = (passing: number, total: number): boolean[] =>
  Array.from({ length: total }, (_, i) => i < passing);

test("R46: 5 evals with 4 passing and 5 probes with 4 passing (both 0.8, the boundary) give pass", async () => {
  const { s, rec } = await runTable(flags(4, 5), flags(4, 5));
  assert.equal(s.status, "pass");
  assert.equal(rec.status, "pass");
  assert.equal(rec.eval_pass_rate, 0.8);
  assert.equal(rec.probe_pass_rate, 0.8);
  assert.equal(rec.threshold, 0.8);
  assert.deepEqual(
    [rec.evals_passed, rec.evals_total, rec.probes_passed, rec.probes_total],
    [4, 5, 4, 5],
  );
});

test("R46: probes do not mask failing evals: 2 evals both failing with 10 probes passing, and 6 of 8 evals with 8 of 8 probes, give fail with separate rates", async () => {
  const none = await runTable(flags(0, 2), flags(10, 10));
  assert.equal(none.s.status, "fail");
  assert.match(none.r.text, /eval_pass_rate=0\.00 \(0\/2\) probe_pass_rate=1\.00 \(10\/10\)/);
  assert.equal(none.rec.status, "fail");
  assert.equal(none.rec.eval_pass_rate, 0);
  assert.equal(none.rec.probe_pass_rate, 1);
  const six = await runTable(flags(6, 8), flags(8, 8));
  assert.equal(six.s.status, "fail", "0.75 of the evals is below 0.8 whatever the probes do");
  assert.match(six.r.text, /eval_pass_rate=0\.75 \(6\/8\) probe_pass_rate=1\.00 \(8\/8\)/);
  assert.equal(six.rec.eval_pass_rate, 0.75);
  assert.equal(six.rec.probe_pass_rate, 1);
});

test("R46: a probe pass rate of 0.6 with every eval passing gives fail", async () => {
  const { s, rec } = await runTable(flags(5, 5), flags(3, 5));
  assert.equal(s.status, "fail");
  assert.equal(rec.eval_pass_rate, 1);
  assert.equal(rec.probe_pass_rate, 0.6);
});

test("R46: a skill with no probe is graded on its evals alone, and the probe rate is absent", async () => {
  const ok = await runTable(flags(4, 5), []);
  assert.equal(ok.s.status, "pass");
  assert.equal(ok.rec.probe_pass_rate, null);
  assert.deepEqual([ok.rec.probes_passed, ok.rec.probes_total], [0, 0]);
  assert.match(ok.r.text, /probe_pass_rate=n\/a/);
  const low = await runTable(flags(3, 5), []);
  assert.equal(low.s.status, "fail");
});

test("R46: 4 evals with 3 passing (0.75) is fail with exit 0, and with fail-blocking true exits non-zero naming the skill", async () => {
  const open = await runTable(flags(3, 4), flags(2, 2));
  assert.equal(open.s.status, "fail");
  assert.equal(open.r.exitCode, 0, "fail-blocking defaults to false");
  assert.equal(open.s.blocking, false);
  const closed = await runTable(flags(3, 4), flags(2, 2), { failBlocking: true });
  assert.equal(closed.r.exitCode, 1);
  assert.match(closed.r.text, /^demo: status=fail /m);
  assert.equal(closed.s.blocking, true);
  // the knob gates the same condition only: a pass never blocks, and regression-blocking does not gate a fail
  assert.equal((await runTable(flags(4, 4), flags(2, 2), { failBlocking: true })).r.exitCode, 0);
  assert.equal((await runTable(flags(3, 4), [], { regressionBlocking: true })).r.exitCode, 0);
});

test("R46: the threshold is one setting and applies to both rates", async () => {
  // 3 of 4 evals (0.75) and 3 of 4 probes (0.75): fail at 0.8, pass at 0.7
  assert.equal((await runTable(flags(3, 4), flags(3, 4))).s.status, "fail");
  const lowered = await runTable(flags(3, 4), flags(3, 4), { passThreshold: 0.7 });
  assert.equal(lowered.s.status, "pass");
  assert.equal(lowered.rec.threshold, 0.7);
});

test("decide() is the one function: fail wins over regression, the boundary is inclusive, and each condition blocks under its own knob", () => {
  const f = {
    evalPassRate: 0.8,
    probePassRate: null,
    baseEvalPassRate: null,
    threshold: 0.8,
    tolerance: 0.05,
  };
  assert.equal(decide(f).status, "pass", "at the threshold");
  assert.equal(decide({ ...f, evalPassRate: 0.79 }).status, "fail");
  assert.equal(decide({ ...f, probePassRate: 0.6 }).status, "fail");
  assert.equal(decide({ ...f, probePassRate: 0.8 }).status, "pass");
  const reg = { ...f, evalPassRate: 0.85, baseEvalPassRate: 0.95 };
  assert.deepEqual(decide(reg), { fail: false, regression: true, status: "regression" });
  const both = { ...f, evalPassRate: 0.6, baseEvalPassRate: 0.95 };
  assert.deepEqual(decide(both), { fail: true, regression: true, status: "fail" });
  const knobs = (failBlocking: boolean, regressionBlocking: boolean) => ({
    failBlocking,
    regressionBlocking,
  });
  assert.equal(blocks(decide(both), knobs(false, false)), false);
  assert.equal(blocks(decide(both), knobs(true, false)), true);
  assert.equal(blocks(decide(both), knobs(false, true)), true);
  assert.equal(blocks(decide(reg), knobs(true, false)), false, "a regression is not a fail");
  assert.equal(blocks(decide(reg), knobs(false, true)), true);
});
