// Tests of the experiment loop with a fake executor: pairing order, rerun of invalid runs, the
// extension rule, the cost guard and truncation mapping. No model call.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildCallLog, buildTranscript } from "../lib/rules-split-ab/fixture-cases.ts";
import type { RunRecord } from "../lib/rules-split-ab/compare.ts";
import { runExperiment } from "../lib/rules-split-ab/orchestrate.ts";
import type { ExecuteFn } from "../lib/rules-split-ab/orchestrate.ts";
import { SCENARIOS } from "../lib/rules-split-ab/scenarios.ts";

type Tools = Parameters<typeof buildTranscript>[0]["tools"];
const ok2: Tools = [{ name: "Edit", input: { file_path: "a" } }];

/** A passing transcript for each scenario. */
function passing(n: number): { tools: Tools; text: string } {
  switch (n) {
    case 1:
      return {
        tools: [
          {
            name: "mempalace_search",
            input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
          },
          {
            name: "mempalace_update_drawer",
            input: { drawer_id: "drw-42", content: "[TASK:checkpoint] x" },
          },
        ],
        text: "ok",
      };
    case 2:
      return { tools: ok2, text: "ok" };
    case 3:
      return {
        tools: [
          {
            name: "mempalace_add_drawer",
            input: { wing: "ab-scratch", room: "task-handoff", content: "h" },
          },
        ],
        text: "ok",
      };
    case 4:
      return {
        tools: [
          { name: "Bash", input: { command: "git checkout -b fix/0044-x" } },
          { name: "Edit", input: { file_path: "README.md" } },
        ],
        text: "ok",
      };
    case 5:
      return {
        tools: [
          {
            name: "obsidian_list_vaults",
            input: {},
            result: JSON.stringify([{ id: "scratch", name: "scratch-vault" }]),
          },
        ],
        text: "May I write it as an Obsidian note?",
      };
    case 6:
      return {
        tools: [
          {
            name: "mempalace_add_drawer",
            input: { wing: "ab-scratch", room: "plans", content: "p" },
          },
        ],
        text: "1. a\n2. b\nAlternatives: x\nChosen path: a",
      };
    case 7:
      return {
        tools: [
          {
            name: "mempalace_add_drawer",
            input: { wing: "harness-friction", room: "r", content: "c" },
          },
        ],
        text: "ok",
      };
    default:
      return {
        tools: [{ name: "Bash", input: { command: "gh pr view 7" } }],
        text: "need permission",
      };
  }
}
const failing = (n: number) => (n === 1 ? { tools: ok2, text: "ok" } : passing(n));

interface Opts {
  cost?: number;
  bFailScenario1?: boolean;
  truncateB1?: number;
  invalidOnce?: boolean;
}
function fake(o: Opts = {}) {
  const calls: Array<{
    scenario: number;
    arm: string;
    runIndex: number;
    attempt: number;
    maxBudgetUsd: number;
  }> = [];
  const execute: ExecuteFn = async (req) => {
    calls.push({
      scenario: req.scenario.id,
      arm: req.arm,
      runIndex: req.runIndex,
      attempt: req.attempt,
      maxBudgetUsd: req.maxBudgetUsd,
    });
    const cost = o.cost ?? 0.2;
    if (
      o.invalidOnce &&
      req.scenario.id === 2 &&
      req.arm === "A" &&
      req.runIndex === 1 &&
      req.attempt === 1
    ) {
      return { transcript: null, callLog: null };
    }
    if (o.truncateB1 && req.scenario.id === 1 && req.arm === "B" && req.runIndex <= o.truncateB1) {
      return {
        transcript: buildTranscript({ tools: [], text: "", subtype: "error_max_budget_usd", cost }),
        callLog: buildCallLog([]),
      };
    }
    const spec =
      o.bFailScenario1 && req.arm === "B" ? failing(req.scenario.id) : passing(req.scenario.id);
    return { transcript: buildTranscript({ ...spec, cost }), callLog: buildCallLog([]) };
  };
  return { execute, calls };
}

describe("runExperiment", () => {
  test("8 scenarios x 2 runs x 2 arms = 32 runs in A1 B1 A2 B2 order when everything passes", async () => {
    const { execute, calls } = fake();
    const r = await runExperiment({ scenarios: SCENARIOS, execute });
    assert.equal(calls.length, 32);
    assert.deepEqual(
      calls.slice(0, 4).map((c) => `${c.arm}${c.runIndex}`),
      ["A1", "B1", "A2", "B2"],
    );
    assert.equal(r.stopped, null);
    assert.ok(Object.values(r.verdicts).every((v) => v.verdict === "no-regression"));
    assert.ok(Math.abs(r.ledger.spent - 32 * 0.2) < 1e-9);
  });

  test("disagreement extends that scenario only, to 5 runs per arm", async () => {
    const { execute, calls } = fake({ bFailScenario1: true });
    const r = await runExperiment({ scenarios: SCENARIOS, execute });
    const s1 = calls.filter((c) => c.scenario === 1);
    assert.equal(s1.length, 10);
    assert.equal(calls.filter((c) => c.scenario === 2).length, 4);
    assert.equal(r.verdicts[1]?.verdict, "regression");
  });

  test("runs beyond the pair use the extension indexes 3..5", async () => {
    const { execute, calls } = fake({ bFailScenario1: true });
    await runExperiment({ scenarios: [SCENARIOS[0]!], execute });
    assert.deepEqual(
      calls.map((c) => `${c.arm}${c.runIndex}`),
      ["A1", "B1", "A2", "B2", "A3", "B3", "A4", "B4", "A5", "B5"],
    );
  });

  test("an invalid run is rerun once and both attempts are charged", async () => {
    const { execute, calls } = fake({ invalidOnce: true });
    const r = await runExperiment({ scenarios: [SCENARIOS[1]!], execute });
    assert.equal(calls.filter((c) => c.arm === "A" && c.runIndex === 1).length, 2);
    assert.equal(calls.length, 5);
    const rec = r.records.find((x) => x.arm === "A" && x.runIndex === 1)!;
    assert.equal(rec.attempts.length, 2);
    assert.equal(rec.status, "pass");
    assert.equal(rec.attempts[0]?.status, "invalid");
    assert.ok(Math.abs(r.ledger.spent - (4 * 0.2 + 0.6)) < 1e-9); // missing cost charged the per-run cap
  });

  test("B truncated twice while A completes is a fail, then extended and a regression", async () => {
    const { execute } = fake({ truncateB1: 2 });
    const r = await runExperiment({ scenarios: [SCENARIOS[0]!], execute });
    const bRecs = r.records.filter((x) => x.arm === "B" && x.runIndex <= 2);
    assert.ok(bRecs.every((x) => x.truncatedTwice && x.status === "invalid"));
    assert.equal(r.verdicts[1]?.verdict, "regression");
  });

  test("the cost guard stops before a run that would pass the cap and reports", async () => {
    const { execute, calls } = fake({ cost: 0.5 });
    const r = await runExperiment({ scenarios: SCENARIOS, execute, cap: 2 });
    assert.ok(r.stopped);
    assert.match(r.stopped.reason, /coordinator/);
    assert.ok(r.ledger.spent < 2);
    assert.ok(calls.length < 32);
    const before = calls.length;
    assert.ok(before >= 2);
  });

  test("a stopped run never calls the executor again", async () => {
    const { execute, calls } = fake({ cost: 1 });
    const r = await runExperiment({ scenarios: SCENARIOS, execute, cap: 3 });
    assert.ok(r.stopped);
    assert.equal(calls.length, 2); // 1 spent, projected 1 -> second ok (2<3), third 2+1=3 not under 3
  });

  test("per-run budget passed to the executor is min(0.6, remaining cap)", async () => {
    const { execute, calls } = fake({ cost: 0.5 });
    await runExperiment({ scenarios: SCENARIOS, execute, cap: 1.4 });
    assert.equal(calls[0]?.maxBudgetUsd, 0.6);
    assert.ok(calls.every((c) => c.maxBudgetUsd <= 0.6 && c.maxBudgetUsd > 0));
  });

  test("prior completed records are skipped and their cost counted (resume)", async () => {
    const first = fake({ cost: 0.5 });
    const r1 = await runExperiment({ scenarios: SCENARIOS, execute: first.execute, cap: 2 });
    assert.ok(r1.stopped);
    const second = fake({ cost: 0.1 });
    const r2 = await runExperiment({
      scenarios: SCENARIOS,
      execute: second.execute,
      cap: 12,
      prior: r1.records,
    });
    assert.equal(r2.stopped, null);
    assert.equal(second.calls.length, 32 - r1.records.length);
    assert.ok(r2.ledger.spent > r1.ledger.spent);
  });
});

describe("runExperiment, single arm (calibration)", () => {
  test("arms: ['A'] runs only arm A and yields no verdict", async () => {
    const { execute, calls } = fake();
    const r = await runExperiment({ scenarios: [SCENARIOS[5]!], execute, arms: ["A"] });
    assert.deepEqual(
      calls.map((c) => `${c.arm}${c.runIndex}`),
      ["A1", "A2"],
    );
    assert.deepEqual(r.verdicts, {});
  });
});

describe("runExperiment, S5 invalid handling and budget (delta-02)", () => {
  const S5 = SCENARIOS.find((x) => x.id === 5)!;
  const silent = {
    tools: [
      {
        name: "obsidian_list_vaults",
        input: {},
        result: JSON.stringify([{ id: "scratch", name: "scratch-vault" }]),
      },
    ],
    text: "Done: the comment is added.",
  } as const;
  const scripted = (plan: (arm: string, idx: number, attempt: number) => "pass" | "silent") => {
    const calls: string[] = [];
    const execute: ExecuteFn = async (req) => {
      calls.push(`${req.arm}${req.runIndex}t${req.attempt}`);
      const spec = plan(req.arm, req.runIndex, req.attempt) === "pass" ? passing(5) : { ...silent };
      return {
        transcript: buildTranscript({ ...spec, tools: [...spec.tools], cost: 0.1 }),
        callLog: buildCallLog([]),
      };
    };
    return { execute, calls };
  };
  test("an invalid S5 run is rerun once and the rerun can pass", async () => {
    const { execute, calls } = scripted((a, i, t) =>
      a === "A" && i === 1 && t === 1 ? "silent" : "pass",
    );
    const r = await runExperiment({ scenarios: [S5], execute, arms: ["A"], runs: 2 });
    assert.deepEqual(calls, ["A1t1", "A1t2", "A2t1"]);
    assert.equal(r.records[0]?.status, "pass");
    assert.equal(r.records[0]?.attempts.length, 2);
  });
  test("a second invalid is recorded as invalid, never a pass, and blocks the verdict", async () => {
    const { execute, calls } = scripted((a, i) => (a === "B" && i === 1 ? "silent" : "pass"));
    const r = await runExperiment({ scenarios: [S5], execute, runs: 1 });
    assert.deepEqual(calls, ["A1t1", "B1t1", "B1t2"]);
    const b = r.records.find((x) => x.arm === "B")!;
    assert.equal(b.status, "invalid");
    assert.equal(b.attempts.length, 2);
    assert.equal(r.verdicts[5]?.verdict, "blocked");
  });
  test("the projection seed stops the runner before the first run when the cap is below it", async () => {
    const { execute, calls } = scripted(() => "pass");
    const r = await runExperiment({
      scenarios: [S5],
      execute,
      arms: ["A"],
      cap: 0.1,
      projectionSeed: 0.113,
    });
    assert.ok(r.stopped);
    assert.equal(calls.length, 0);
  });
  test("calibration allows up to 6 runs of arm A", async () => {
    const { execute, calls } = scripted(() => "pass");
    await runExperiment({ scenarios: [S5], execute, arms: ["A"], runs: 6 });
    assert.equal(calls.length, 6);
  });
  test("5 runs per arm compare both arms with no extension past 5", async () => {
    const { execute, calls } = scripted(() => "pass");
    const r = await runExperiment({ scenarios: [S5], execute, runs: 5 });
    assert.equal(calls.length, 10);
    assert.equal(r.verdicts[5]?.verdict, "no-regression");
  });
});

describe("runExperiment, S5 control gate and seeded arm A (delta-03)", () => {
  const S5 = SCENARIOS.find((x) => x.id === 5)!;
  const dismiss = { tools: [], text: "Obsidian is not relevant here." } as const;
  const make = (ok: (arm: string, idx: number) => boolean) => {
    const calls: string[] = [];
    const execute: ExecuteFn = async (req) => {
      calls.push(`${req.arm}${req.runIndex}t${req.attempt}`);
      const spec = ok(req.arm, req.runIndex) ? passing(5) : { ...dismiss };
      return {
        transcript: buildTranscript({ ...spec, tools: [...spec.tools], cost: 0.1 }),
        callLog: buildCallLog([]),
      };
    };
    return { execute, calls };
  };
  const seeded = (idx: number, status: "pass" | "invalid"): RunRecord => ({
    scenario: 5,
    arm: "A",
    runIndex: idx,
    attempts: [
      { status, note: "", subtype: "success", costUsd: 0.07, charged: 0, firstCallTokens: null },
    ],
    status,
    truncatedTwice: false,
    seeded: true,
  });
  test("arm A runs first, B is compared only when A passes at least 4 of 5", async () => {
    const { execute, calls } = make(() => true);
    const r = await runExperiment({ scenarios: [S5], execute, runs: 5 });
    assert.deepEqual(calls.slice(0, 5), ["A1t1", "A2t1", "A3t1", "A4t1", "A5t1"]);
    assert.equal(calls.length, 10);
    assert.equal(r.verdicts[5]?.verdict, "no-regression");
  });
  test("a failed control gate withholds the verdict and does not run arm B", async () => {
    const { execute, calls } = make((arm, idx) => !(arm === "A" && idx <= 2));
    const r = await runExperiment({ scenarios: [S5], execute, runs: 5 });
    assert.ok(calls.every((c) => c.startsWith("A")));
    assert.equal(r.verdicts[5]?.verdict, "control-failed");
  });
  test("4 passes of 5 holds the gate", async () => {
    const { execute } = make((arm, idx) => !(arm === "A" && idx === 3));
    const r = await runExperiment({ scenarios: [S5], execute, runs: 5 });
    assert.notEqual(r.verdicts[5]?.verdict, "control-failed");
  });
  test("seeded records count as run indexes 1 to 3: only A4 and A5 are executed, uncharged", async () => {
    const { execute, calls } = make(() => true);
    const r = await runExperiment({
      scenarios: [S5],
      execute,
      arms: ["A"],
      runs: 5,
      prior: [seeded(1, "pass"), seeded(2, "pass"), seeded(3, "pass")],
    });
    assert.deepEqual(calls, ["A4t1", "A5t1"]);
    assert.equal(r.records.length, 5);
    assert.ok(Math.abs(r.ledger.spent - 0.2) < 1e-9);
    assert.equal(r.ledger.charges.length, 2);
  });
  test("a seeded first attempt that is invalid is rerun from scratch", async () => {
    const { execute, calls } = make(() => true);
    await runExperiment({
      scenarios: [S5],
      execute,
      arms: ["A"],
      runs: 2,
      prior: [seeded(1, "pass"), seeded(2, "invalid")],
    });
    assert.deepEqual(calls, ["A2t1"]);
  });
  test("the cap stops the runner when the running cost plus one attempt would exceed it", async () => {
    const { execute, calls } = make(() => true);
    const r = await runExperiment({
      scenarios: [S5],
      execute,
      arms: ["A"],
      runs: 5,
      cap: 0.25,
      projectionSeed: 0.08,
    });
    assert.ok(r.stopped);
    assert.equal(calls.length, 2);
    assert.deepEqual(r.verdicts, {});
  });
});
