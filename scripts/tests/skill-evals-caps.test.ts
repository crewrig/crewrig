// skill-evals-caps.test.ts — enforcement of the caps before any model call and at run time (spec
// 0304 R21, R22). Every refusal prints the spent figure, the worst case and the cap, exits 1 with
// status error and makes no model call; the per-skill cap is not reset by a new ticket label; a
// resume is checked with its remaining worst case; finalisation takes precedence over the at-cap
// refusal. Real (non-mock) runs with an injected executor; no model call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { planSkill, preflight, refuseSpend } from "../lib/skill-evals/budget.ts";
import type { Limits } from "../lib/skill-evals/budget.ts";
import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import {
  MAX_INVOCATION_USD,
  MAX_SKILL_USD,
  MAX_TICKET_USD,
  MAX_MEASUREMENT_USD,
  EXECUTOR_CONCURRENCY,
  PER_RUN_USD,
  MAX_EXECUTOR_RUNS,
  JUDGE_MAX_CALLS,
} from "../lib/skill-evals/settings.ts";
import { selectionOf, skillRel } from "./lib/skill-evals-fixtures.ts";
import { ledgerEntry, buildRecord, writeRecord } from "./lib/skill-evals-record.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";
import type { Rig } from "./lib/skill-evals-run-rig.ts";

const KEY = { mock: false as const, env: { ANTHROPIC_API_KEY: "sk-test" }, useApiKey: true };
const FOX = "Assistant: the quick brown fox";
const happy: MockScript = (req) =>
  req.label.includes("probe-")
    ? { skillsLoaded: ["demo"] }
    : { files: { "answer.md": "x" }, transcript: FOX, costUsd: 0.05 };
const HASH = `sha256:${"d".repeat(64)}`;
const fileOf = (rig: Rig, skill = "demo") =>
  path.join(rig.repo.root, skillRel(skill), "evals", "results.json");

/** Seed a results file of `skill` with a finished measurement of another hash costing `usd`. */
function seedSpent(
  rig: Rig,
  skill: string,
  usd: number,
  ticket = "1849",
  ledger = [] as ReturnType<typeof ledgerEntry>[],
) {
  const sel = selectionOf(rig.repo, skill);
  const rec = buildRecord(sel, {
    contentHash: HASH,
    ticket,
    ledger,
    declaredAt: "2026-01-05T00:00:00.000Z",
  });
  writeRecord(sel.skill.dirAbs, { ...rec, status: "fail", cost_usd: usd, judge_cost_usd: 0 });
}
/** An in-progress file of `demo` for the current content, holding `evalRuns` and costing `usd`. */
function seedInProgress(
  rig: Rig,
  runs: boolean[][],
  probeRuns: boolean[][],
  usd: number,
  ledger = [] as ReturnType<typeof ledgerEntry>[],
) {
  const sel = selectionOf(rig.repo, "demo");
  const rec = buildRecord(sel, {
    evalRuns: runs,
    probeRuns,
    ticket: "1849",
    ledger,
    costUsd: 0.05,
  });
  writeRecord(sel.skill.dirAbs, {
    ...rec,
    status: "in-progress",
    cost_usd: usd,
    judge_cost_usd: 0,
  } as never);
}
const pair = [
  [true, true],
  [true, true],
  [true, true],
  [true, true],
  [true, true],
  [true, true],
];

test("R22(d): a ticket whose recorded spend is 21 USD cannot start a 5 USD measurement: spent 21, worst case 5, cap 25", async () => {
  const rig = makeRig({ skills: ["demo", "other"], evalsCount: 1, ...KEY, script: happy });
  try {
    seedSpent(rig, "other", 21);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch }, ["demo"]);
    assert.equal(rig.executor.calls.length, 0, "no model call");
    assert.equal(r.exitCode, 1);
    assert.equal(r.results[0]?.status, "error");
    assert.match(
      r.stderr,
      /ticket 1849: spent 21\.00 USD plus the summed worst case 5\.00 USD exceeds max-ticket-usd 25 USD/,
    );
    assert.equal(fs.existsSync(fileOf(rig)), false, "nothing was declared");
  } finally {
    rig.cleanup();
  }
});

test("R22(d): three skills under a ticket that already spent 12 USD: 12 + 3 x 5 = 27 against 25 is refused once, naming the sum", async () => {
  const rig = makeRig({ skills: ["a", "b", "c", "other"], evalsCount: 1, ...KEY, script: happy });
  try {
    seedSpent(rig, "other", 12);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch }, ["a", "b", "c"]);
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    const lines = r.stderr.trim().split("\n");
    assert.deepEqual(
      lines.length,
      1,
      `each skill passes its own cap; the ticket cap is checked once: ${r.stderr}`,
    );
    assert.match(
      lines[0] ?? "",
      /spent 12\.00 USD plus the summed worst case 15\.00 USD exceeds max-ticket-usd 25 USD/,
    );
  } finally {
    rig.cleanup();
  }
});

test("R22(c): a skill that already holds 6 USD since the merge-base is refused (6 + 5 above 10), and a new ticket label resets nothing", async () => {
  const rig = makeRig({ evalsCount: 1, ...KEY, script: happy });
  try {
    seedSpent(rig, "demo", 6, "1849");
    const r = await rig.run({ fetchImpl: judgeFetch().fetch, ticket: "777" });
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(
      r.stderr,
      /demo: spent since the merge-base 6\.00 USD plus the worst case 5\.00 USD exceeds max-skill-usd 10 USD/,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(fileOf(rig), "utf8")).content_hash,
      HASH,
      "the file is untouched",
    );
  } finally {
    rig.cleanup();
  }
});

test("R22(c): 4 USD since the merge-base is allowed (4 + 5 is within 10): the measurement runs", async () => {
  const rig = makeRig({ evalsCount: 1, ...KEY, script: happy });
  try {
    seedSpent(rig, "demo", 4);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.ok(rig.executor.calls.length > 0);
  } finally {
    rig.cleanup();
  }
});

test("R22: the refusals and the spend counting are pure functions of the figures", () => {
  const limits: Limits = {
    maxExecutorRuns: MAX_EXECUTOR_RUNS,
    judgeMaxCalls: JUDGE_MAX_CALLS,
    maxInvocationUsd: MAX_INVOCATION_USD,
    perRunUsd: PER_RUN_USD,
    maxMeasurementUsd: MAX_MEASUREMENT_USD,
    maxSkillUsd: MAX_SKILL_USD,
    maxTicketUsd: MAX_TICKET_USD,
    executorConcurrency: EXECUTOR_CONCURRENCY,
  };
  const rows = (spent: number[]) => spent.map((s, i) => ({ skill: `s${i}`, spent: s, worst: 5 }));
  assert.deepEqual(refuseSpend(rows([5]), "1", 0, limits), [], "5 + 5 is within 10");
  assert.equal(refuseSpend(rows([5.01]), "1", 0, limits).length, 1);
  assert.deepEqual(
    refuseSpend(rows([0, 0, 0, 0]), "1", 5, limits),
    [],
    "5 + 4 x 5 = 25 is at the cap",
  );
  assert.equal(refuseSpend(rows([0, 0, 0, 0]), "1", 5.01, limits).length, 1);
  assert.equal(
    refuseSpend(rows([9, 0]), "1", 16, limits).length,
    2,
    "one per-skill and one ticket refusal",
  );
  // the aggregate bound: 9 per skill with the declared values, so the three wave skills are 27 of 100
  const plan = (skill: string, evals: number, probes: number) =>
    planSkill(skill, {
      skill_name: skill,
      evals: Array.from({ length: evals }, (_, i) => ({
        id: i + 1,
        prompt: "p",
        expected_output: "o",
        files: [],
        expectations: ["e"],
        checks: [],
      })),
      trigger_probes: Array.from({ length: probes }, () => ({ query: "q", should_trigger: true })),
    });
  assert.equal(plan("wave", 6, 12).executorRuns, 48);
  assert.deepEqual(preflight([plan("a", 6, 8), plan("b", 6, 12), plan("c", 6, 12)], limits), []);
  assert.equal(
    preflight(
      Array.from({ length: 12 }, (_, i) => plan(`s${i}`, 6, 12)),
      limits,
    ).length,
    1,
    "12 x 9 = 108 against 100",
  );
  assert.match(
    preflight(
      Array.from({ length: 12 }, (_, i) => plan(`s${i}`, 6, 12)),
      limits,
    )[0] ?? "",
    /planned worst-case cost 108.00 dollars/,
  );
});

test("R22 runtime: when the measured cost reaches the cap no new run starts, the skill ends in error and the file stays in-progress", async () => {
  const rig = makeRig({
    evalsCount: 6,
    ...KEY,
    settings: {
      maxMeasurementUsd: 1,
      executorConcurrency: 1,
      maxExecutorRuns: 100,
      judgeMaxCalls: 100,
      maxInvocationUsd: 1000,
    },
    script: (req) =>
      req.label.includes("probe-")
        ? { skillsLoaded: ["demo"] }
        : { files: { "answer.md": "x" }, transcript: FOX, costUsd: 0.5 },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "error", r.text);
    assert.equal(r.exitCode, 1);
    assert.match(
      r.text,
      /the measurement is at its cap: [\d.]+ USD reached max-measurement-usd 1; no new run started/,
    );
    assert.ok(
      rig.executor.calls.length <= 3 && rig.executor.calls.length >= 2,
      `${rig.executor.calls.length} runs started`,
    );
    assert.equal(JSON.parse(fs.readFileSync(fileOf(rig), "utf8")).status, "in-progress");
  } finally {
    rig.cleanup();
  }
});

test("R22: the resume of a measurement whose recorded cost reached the cap, with slots open, is refused: exit 1, no call", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, script: happy });
  try {
    seedInProgress(rig, [[true, true], [], [], [], [], []], [[]], 5);
    const before = fs.readFileSync(fileOf(rig), "utf8");
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /is at its cap: 5\.00 USD recorded, max-measurement-usd 5/);
    assert.equal(
      fs.readFileSync(fileOf(rig), "utf8"),
      before,
      "whatever the ticket's remaining budget",
    );
  } finally {
    rig.cleanup();
  }
});

test("R22: a plan with no remaining slot is finalised with no model call and is not refused, whatever its recorded cost", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, script: happy });
  try {
    seedInProgress(rig, pair, [[true]], 5);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(rig.executor.calls.length, 0, "no model call");
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.exitCode, 0);
    assert.equal(JSON.parse(fs.readFileSync(fileOf(rig), "utf8")).status, "pass");
  } finally {
    rig.cleanup();
  }
});

test("R22: a resume with 3 USD recorded has a worst case of 2 USD: it passes the per-skill cap where a fresh 5 would not, and the slots run", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, script: happy });
  try {
    // 4.5 USD of earlier measurements + 3 recorded = 7.5; 7.5 + 2 = 9.5 fits 10, 7.5 + 5 would not
    seedInProgress(rig, [[true, true], [true, true], [true, true], [true, true], [], []], [[]], 3, [
      ledgerEntry({ cost_usd: 4.5, judge_cost_usd: 0, declared_at: "2025-12-01T00:00:00.000Z" }),
    ]);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.deepEqual(rig.executor.calls.map((c) => c.label).sort(), [
      "demo/eval-5/run-1",
      "demo/eval-5/run-2",
      "demo/eval-6/run-1",
      "demo/eval-6/run-2",
      "demo/probe-1/run-1",
    ]);
  } finally {
    rig.cleanup();
  }
});

test("R22: the same resume is refused by the per-skill cap once the earlier spend leaves less than its worst case", async () => {
  const rig = makeRig({ evalsCount: 6, ...KEY, script: happy });
  try {
    seedInProgress(rig, [[true, true], [], [], [], [], []], [[]], 3, [
      ledgerEntry({ cost_usd: 5.5, judge_cost_usd: 0, declared_at: "2025-12-01T00:00:00.000Z" }),
    ]);
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(r.exitCode, 1);
    assert.match(
      r.stderr,
      /spent since the merge-base 8\.50 USD plus the worst case 2\.00 USD exceeds max-skill-usd 10 USD/,
    );
  } finally {
    rig.cleanup();
  }
});

test("R21: the caps are constants with no command-line, environment or file override", () => {
  const dir = path.resolve(import.meta.dirname, "../lib/skill-evals");
  const settings = fs.readFileSync(path.join(dir, "settings.ts"), "utf8");
  for (const c of [
    "MAX_MEASUREMENT_USD",
    "MAX_SKILL_USD",
    "MAX_TICKET_USD",
    "MAX_EXECUTOR_RUNS",
    "JUDGE_MAX_CALLS",
    "JUDGE_ASSUMED_USD",
    "RUN_ASSUMED_USD",
  ])
    assert.match(settings, new RegExp(`export const ${c} = [\\d.]+;`), c);
  const cli = fs.readFileSync(path.join(dir, "cli.ts"), "utf8");
  assert.doesNotMatch(cli, /--max-|process\.env\[.*MAX_|SKILL_EVALS_MAX/);
  assert.equal(MAX_TICKET_USD, 25);
  assert.equal(MAX_SKILL_USD, 10);
});
