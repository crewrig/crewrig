// skill-evals-verify.test.ts — the shape of a schema-2 results file and the rule that the recorded
// status and figures must follow from the recorded runs (spec 0304 R6, R11, R14). Every
// inconsistency is `invalid`, the reason names the first difference. No model call.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestSelection } from "../lib/skill-evals/attest.ts";
import { KEYS } from "../lib/skill-evals/results.ts";
import type { ResultsRecord } from "../lib/skill-evals/results.ts";
import { shapeProblem, verifyRecord } from "../lib/skill-evals/results-verify.ts";
import { commitAll } from "./lib/skill-evals-fixtures.ts";
import {
  allPass,
  buildRecord,
  recompute,
  stagedRuns,
  writeRecord,
} from "./lib/skill-evals-record.ts";
import { sixRig } from "./lib/skill-evals-six.ts";

type Doc = Record<string, unknown>;
const doc = (r: ResultsRecord): Doc => JSON.parse(JSON.stringify(r)) as Doc;

/** The verifier on a (possibly broken) document of a 6-eval skill with one probe. */
function withRig<T>(
  f: (rig: ReturnType<typeof sixRig>, ctx: Parameters<typeof verifyRecord>[1]) => T,
): T {
  const rig = sixRig({ base: { evalRuns: allPass(6, 4) } });
  try {
    const sel = rig.sel();
    return f(rig, {
      skillName: "demo",
      baseText: sel.baseResultsText,
      mergeBase: sel.mergeBase ?? "",
    });
  } finally {
    rig.cleanup();
  }
}
const reason = (v: ReturnType<typeof verifyRecord>) => (v.ok ? "ok" : v.reason);

test("R6: a consistent file verifies for every final status and for in-progress", () => {
  withRig((rig, ctx) => {
    const sel = rig.sel();
    const cases: [string, ResultsRecord][] = [
      ["pass", rig.head({ evalRuns: allPass(6, 2) })],
      ["fail", rig.head({ evalRuns: stagedRuns(6, [2], [6]) })],
      ["regression", rig.head({ evalRuns: stagedRuns(6, [2, 2], [8, 12]) })],
      [
        "in-progress",
        {
          ...rig.head({ evalRuns: stagedRuns(6, [1], [3]).map((r) => [...r]) }),
          status: "in-progress",
        },
      ],
    ];
    for (const [want, rec] of cases) {
      const v = verifyRecord(
        doc(recompute(rec, sel, want === "in-progress" ? "in-progress" : undefined)),
        ctx,
      );
      assert.equal(v.ok, true, `${want}: ${reason(v)}`);
      if (v.ok && want !== "in-progress") assert.equal(v.decision.status, want);
    }
  });
});

test("R6: every key must be present and of the right type", () => {
  withRig((rig) => {
    const good = doc(rig.head({ evalRuns: allPass(6, 2) }));
    assert.equal(shapeProblem(good), undefined);
    assert.deepEqual(Object.keys(good), [...KEYS]);
    for (const k of KEYS) {
      const { [k]: _gone, ...rest } = good;
      assert.match(shapeProblem(rest) ?? "", new RegExp(`lacks the key ${k}$`), k);
    }
    const wrong: Record<string, unknown> = {
      schema_version: 1,
      skill_name: 1,
      content_hash: 1,
      runner_version: 1,
      executor_model: 1,
      judge_model: 1,
      effort: 1,
      plan: [],
      ticket: 1,
      declared_at: 1,
      date: 1,
      status: "done",
      stage_reached: 1,
      evals: {},
      probes: {},
      eval_passes: "1",
      eval_runs: "1",
      eval_pass_rate: "1",
      probe_passes: "1",
      probe_runs: "1",
      probe_pass_rate: "1",
      base: 1,
      regression: 1,
      errors: {},
      executor_runs: "1",
      judge_calls: "1",
      cost_usd: "1",
      judge_cost_usd: "1",
      ledger: {},
    };
    for (const k of KEYS)
      assert.match(
        shapeProblem({ ...good, [k]: wrong[k] }) ?? "",
        new RegExp(`${k} has the wrong type`),
        k,
      );
  });
});

test("R6: an eval needs a sha256 case_hash and well-formed runs; a probe needs boolean runs", () => {
  withRig((rig) => {
    const good = doc(rig.head({ evalRuns: allPass(6, 2) }));
    const evals = good["evals"] as { case_hash: string; runs: Record<string, unknown>[] }[];
    const bad = (f: (e: typeof evals) => void) => {
      const copy = structuredClone(good);
      f(copy["evals"] as typeof evals);
      return shapeProblem(copy);
    };
    assert.match(
      bad((e) => void (e[0]!.case_hash = "md5:abc")) ?? "",
      /evals\[0\] needs an id and a sha256 case_hash/,
    );
    assert.match(
      bad((e) => void (e[1]!.runs[0]!["assertions"] = "1x")) ?? "",
      /evals\[1\]\.runs\[0\] is malformed/,
    );
    assert.match(
      bad((e) => void delete e[2]!.runs[1]!["reasked"]) ?? "",
      /evals\[2\]\.runs\[1\] is malformed/,
    );
    const probes = structuredClone(good);
    (probes["probes"] as { runs: unknown[] }[])[0]!.runs = ["yes"];
    assert.match(shapeProblem(probes) ?? "", /probes\[0\] is malformed/);
  });
});

test("R11: each recorded figure that differs from the recomputation is invalid, naming it", () => {
  withRig((rig, ctx) => {
    const good = doc(rig.head({ evalRuns: allPass(6, 2), probeRuns: [[true]] }));
    const cases: [string, unknown, RegExp][] = [
      ["eval_passes", 11, /eval_passes 11 differs from the recomputed 12/],
      ["eval_runs", 13, /eval_runs 13 differs from the recomputed 12/],
      ["eval_pass_rate", 0.5, /eval_pass_rate 0.5 differs/],
      ["probe_passes", 0, /probe_passes 0 differs from the recomputed 1/],
      ["probe_runs", 2, /probe_runs 2 differs from the recomputed 1/],
      ["probe_pass_rate", 0.5, /probe_pass_rate 0.5 differs/],
      ["stage_reached", { evals: 2, probes: 1 }, /stage_reached .* differs from the recomputed/],
    ];
    for (const [key, value, re] of cases) {
      const v = verifyRecord({ ...good, [key]: value }, ctx);
      assert.equal(v.ok, false, key);
      assert.match(reason(v), re, key);
    }
  });
});

test("R11: a rejected pool recorded as pass is invalid, and a passing one recorded as fail too", () => {
  withRig((rig, ctx) => {
    const failing = doc(rig.head({ evalRuns: stagedRuns(6, [2], [6]) }));
    assert.match(
      reason(verifyRecord({ ...failing, status: "pass" }, ctx)),
      /recorded status pass differs from the recomputed status fail/,
    );
    const passing = doc(rig.head({ evalRuns: allPass(6, 2) }));
    assert.match(
      reason(verifyRecord({ ...passing, status: "fail" }, ctx)),
      /recorded status fail differs from the recomputed status pass/,
    );
  });
});

test("R11: a regression recorded as pass, or a regression block that is missing, is invalid against the same base", () => {
  withRig((rig, ctx) => {
    const reg = doc(rig.head({ evalRuns: stagedRuns(6, [2, 2], [8, 12]) }));
    assert.equal(reg["status"], "regression");
    assert.match(
      reason(verifyRecord({ ...reg, status: "pass" }, ctx)),
      /recorded status pass differs from the recomputed status regression/,
    );
    assert.match(
      reason(verifyRecord({ ...reg, regression: null }, ctx)),
      /regression block differs/,
    );
    assert.match(
      reason(verifyRecord({ ...reg, regression: { drop: 0.5, p_value: 0.001 } }, ctx)),
      /recorded regression/,
    );
  });
});

test("R11: more runs and fewer runs than the stage path prescribes are both invalid, naming the eval and the count", () => {
  withRig((rig, ctx) => {
    const extra = allPass(6, 2);
    extra[2] = [true, true, true];
    const three = recompute(rig.head({ evalRuns: extra }), rig.sel());
    assert.match(
      reason(verifyRecord(doc(three), ctx)),
      /eval 3 holds 3 runs; the stage path prescribes 2/,
    );
    const four = allPass(6, 2).map((r, i) => (i === 0 ? [true, true, true, true] : r));
    assert.match(
      reason(verifyRecord(doc(recompute(rig.head({ evalRuns: four }), rig.sel())), ctx)),
      /eval 1 holds 4 runs; the stage path prescribes 2/,
    );
    const short = allPass(6, 2).map((r, i) => (i === 5 ? [true] : r));
    const v = verifyRecord(doc(recompute(rig.head({ evalRuns: short }), rig.sel(), "pass")), ctx);
    assert.match(
      reason(v),
      /status pass is recorded while the eval pool has not run its first stage in full/,
    );
  });
});

test("R11: after a continuing stage 1 every eval holds 4 runs; 2 for one eval, with a final status, is invalid", () => {
  withRig((rig, ctx) => {
    const runs = stagedRuns(6, [2, 2], [8, 12]).map((r, i) => (i === 4 ? r.slice(0, 2) : r));
    const v = verifyRecord(doc(recompute(rig.head({ evalRuns: runs }), rig.sel(), "pass")), ctx);
    assert.match(
      reason(v),
      /status pass is recorded while the eval pool has not run its second stage in full/,
    );
    const probes = verifyRecord(
      doc(recompute(rig.head({ evalRuns: allPass(6, 2), probeRuns: [[true, true]] }), rig.sel())),
      ctx,
    );
    assert.match(reason(probes), /probe 1 holds 2 runs; the stage path prescribes 1/);
  });
});

test("R11: an in-progress file with a partial stage is consistent, and a schema-1 file is not verified here", () => {
  withRig((rig, ctx) => {
    const part = recompute(
      rig.head({ evalRuns: stagedRuns(6, [2], [4]).map((r) => r.slice(0, 1)) }),
      rig.sel(),
      "in-progress",
    );
    assert.equal(verifyRecord(doc(part), ctx).ok, true);
    assert.match(
      reason(verifyRecord({ skill_name: "demo", status: "pass" }, ctx)),
      /lacks the key|wrong type/,
    );
  });
});

test("R14: an eval recorded but absent from the tree, or in the tree but not recorded, makes the file stale naming it", () => {
  const rig = sixRig({ evals: 6 });
  try {
    const rec = buildRecord(rig.sel(), { evalRuns: allPass(6, 2) });
    const settings = {
      regressionBlocking: false,
      failBlocking: false,
      missingEvalsBlocking: false,
    };
    const attest = () => attestSelection(rig.sel(), settings, rig.repo.root);
    const without = recompute({ ...rec, evals: rec.evals.filter((e) => e.id !== 4) }, rig.sel());
    writeRecord(rig.dir, without);
    commitAll(rig.repo, "r");
    const missing = attest();
    assert.equal(missing.status, "stale");
    assert.match(missing.reason, /eval 4 is in the tree but was not recorded/);
    const ghost = { id: 7, case_hash: `sha256:${"0".repeat(64)}`, runs: rec.evals[0]!.runs };
    writeRecord(rig.dir, recompute({ ...rec, evals: [...rec.evals, ghost] }, rig.sel()));
    const extra = attest();
    assert.equal(extra.status, "stale", extra.reason);
    assert.match(extra.reason, /eval 7 was recorded but is absent from the tree/);
    assert.equal(fs.existsSync(path.join(rig.dir, "evals", "results.json")), true);
  } finally {
    rig.cleanup();
  }
});
