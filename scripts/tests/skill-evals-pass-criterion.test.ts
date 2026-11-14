// skill-evals-pass-criterion.test.ts — the pass rule (#1963, which narrows spec 0290 R46): the
// skill loads in every eval and the score does not regress; the 0.80 bar and the probe rate are
// advisory. Runs go through the real runner with a scripted
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
  /** Eval ids (1-based) whose run does not load the skill. */
  notLoaded: number[] = [],
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
    return { files, ...(notLoaded.includes(id) ? { skillsLoaded: [] } : {}) };
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

test("a score under the 0.80 bar passes with an advisory line and never blocks", async () => {
  const low = await runTable(flags(3, 5), flags(1, 5));
  assert.equal(low.s.status, "pass");
  assert.equal(low.rec.status, "pass");
  assert.equal(low.r.exitCode, 0);
  assert.equal(low.s.blocking, false);
  assert.match(low.r.text, /advisory: eval pass rate 0\.60 is below 0\.80; not a failure/);
  assert.equal(low.rec.eval_pass_rate, 0.6);
  assert.equal(low.rec.probe_pass_rate, 0.2);
  assert.equal(low.rec.tolerance, 0.2, "the tolerance is one case");
  assert.equal(low.rec.skill_loaded, 5);
  const none = await runTable(flags(4, 5), []);
  assert.equal(none.rec.probe_pass_rate, null);
  assert.match(none.r.text, /probe_pass_rate=n\/a/);
});

test("a skill that does not load in every eval is a blocking fail whatever its score", async () => {
  const miss = await runTable(flags(5, 5), [], {}, [2]);
  assert.equal(miss.s.status, "fail");
  assert.equal(miss.rec.status, "fail");
  assert.equal(miss.rec.skill_loaded, 4);
  assert.equal(miss.r.exitCode, 1);
  assert.equal(miss.s.blocking, true);
  assert.match(miss.r.text, /^demo: status=fail .*skill_loaded=4\/5/m);
  const open = await runTable(flags(5, 5), [], { failBlocking: false }, [2]);
  assert.equal(open.r.exitCode, 0, "the knob still gates the condition");
});

test("decide(): non-regression is base minus one case; loading is the only fail; the threshold is advisory", () => {
  const f = {
    evalPassRate: 0.6,
    probePassRate: 0.2,
    baseEvalPassRate: null,
    threshold: 0.8,
    tolerance: 0.2,
    evalsTotal: 5,
    skillLoaded: 5,
  };
  const low = decide(f);
  assert.deepEqual(low, { fail: false, regression: false, belowThreshold: true, status: "pass" });
  // 5 evals, base 4/5: 3/5 is one case below, within the tolerance; 2/5 is a regression
  assert.equal(decide({ ...f, baseEvalPassRate: 0.8 }).status, "pass");
  assert.equal(decide({ ...f, evalPassRate: 0.4, baseEvalPassRate: 0.8 }).status, "regression");
  // an unknown count of loads (a file of an older runner) is not a fail
  assert.equal(decide({ ...f, skillLoaded: null }).fail, false);
  const miss = decide({ ...f, evalPassRate: 0.4, baseEvalPassRate: 0.8, skillLoaded: 4 });
  assert.deepEqual(miss, { fail: true, regression: true, belowThreshold: true, status: "fail" });
  const knobs = (failBlocking: boolean, regressionBlocking: boolean) => ({
    failBlocking,
    regressionBlocking,
  });
  const reg = decide({ ...f, evalPassRate: 0.4, baseEvalPassRate: 0.8 });
  assert.equal(blocks(low, knobs(true, true)), false, "a low score never blocks");
  assert.equal(blocks(reg, knobs(false, true)), true);
  assert.equal(blocks(reg, knobs(true, false)), false, "a regression is not a fail");
  assert.equal(blocks(miss, knobs(true, false)), true);
});
