// Tests of the experiment loop with a fake executor: pairing order, rerun of invalid runs, the
// extension rule, the cost guard and truncation mapping. No model call.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildCallLog, buildTranscript } from "../lib/rules-split-ab/fixture-cases.ts";
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
      return { tools: [], text: "May I write it?" };
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
