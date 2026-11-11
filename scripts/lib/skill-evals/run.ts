// run.ts — orchestration of a skill eval run (spec 0290 R9-R14, R19-R24, R27-R33, R36).
//
// For each selected skill: classify (no-evals / invalid / ready), plan (R23, R28), then, after the
// credential and judge preflight and the usage declaration, execute the paired runs through a pool
// bounded by `executor-concurrency`, grade each run (checks first, then the judge), write
// grading.json / metrics.json / benchmark.json, compare head with the merge-base replay (R19) and
// write `evals/results.json` for a real run (R36). The head snapshot is read ONCE: the same bytes
// are hashed and installed. Mock mode runs no process and no model call and writes no results file.
//
// Exit codes (the entry maps them): 0 ok, 1 blocking outcome, 3 failed precondition (R33).
// Usage: runEvals(options, selections). Finding-line format: see report.ts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildBenchmark, configMean, isRegression, mean } from "./benchmark.ts";
import type { Configuration, RunRecord } from "./benchmark.ts";
import { CostMeter, planSkill, preflight, RunBudget } from "./budget.ts";
import type { Limits, SkillPlan } from "./budget.ts";
import { evalsViolations } from "./attest.ts";
import { planCredentials, readOverride } from "./credentials.ts";
import { ClaudeCodeExecutor } from "./executor/claude-code.ts";
import { MockExecutor } from "./executor/mock.ts";
import type { Executor, ExecOutcome } from "./executor/types.ts";
import { gradeRun, JudgeFailure } from "./grade.ts";
import type { Grading } from "./grade.ts";
import { installFiles } from "./hash.ts";
import type { SnapFile } from "./hash.ts";
import { createJudge } from "./judge.ts";
import type { Judge } from "./judge.ts";
import { outputsDirOf, runDir, skillOutDir, writeJson } from "./layout.ts";
import { formatReport } from "./report.ts";
import type { RunStatus, SkillResult } from "./report.ts";
import { writeResults } from "./results.ts";
import { validateEvals } from "./schema.ts";
import type { EvalsFile } from "./schema.ts";
import type { Selection } from "./select.ts";
import * as S from "./settings.ts";
import { declareUsage, resolveAsset } from "./usage.ts";

export interface RunSettings {
  tolerance: number;
  regressionBlocking: boolean;
  missingEvalsBlocking: boolean;
  maxExecutorRuns: number;
  judgeMaxCalls: number;
  maxInvocationUsd: number;
  executorConcurrency: number;
  perRunTurns: number;
  perRunSeconds: number;
  perRunUsd: number;
  executorModel: string;
}

export const DEFAULT_SETTINGS: RunSettings = {
  tolerance: S.TOLERANCE,
  regressionBlocking: S.REGRESSION_BLOCKING,
  missingEvalsBlocking: S.MISSING_EVALS_BLOCKING,
  maxExecutorRuns: S.MAX_EXECUTOR_RUNS,
  judgeMaxCalls: S.JUDGE_MAX_CALLS,
  maxInvocationUsd: S.MAX_INVOCATION_USD,
  executorConcurrency: S.EXECUTOR_CONCURRENCY,
  perRunTurns: S.PER_RUN_TURNS,
  perRunSeconds: S.PER_RUN_SECONDS,
  perRunUsd: S.PER_RUN_USD,
  executorModel: S.EXECUTOR_MODEL,
};

export interface RunOptions {
  readonly repoRoot: string;
  readonly out: string;
  readonly mock: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ticket?: string;
  readonly judgeConfigFile?: string;
  readonly settings?: Partial<RunSettings>;
  readonly executor?: Executor;
  readonly mockAnswer?: (
    expectation: string,
    m: { transcript: string; files: readonly { rel: string; content: string }[] },
  ) => string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly declare?: (asset: string) => { ok: true } | { ok: false; error: string };
  readonly now?: () => Date;
}

export interface RunReport {
  readonly exitCode: number;
  readonly results: SkillResult[];
  readonly text: string;
  /** Printed to stderr (preconditions, refusals). */
  readonly stderr: string;
}

interface Task {
  readonly evalIndex: number;
  readonly configuration: Configuration;
  readonly base: boolean;
}

interface SkillState {
  readonly sel: Selection;
  readonly evals: EvalsFile;
  readonly plan: SkillPlan;
  readonly replay: boolean;
  readonly budget: RunBudget;
  readonly judge: Judge;
  readonly controller: AbortController;
  readonly runs: RunRecord[];
  readonly baseRuns: RunRecord[];
  readonly costs: (number | null)[];
  readonly errors: string[];
}

function copyInputs(
  skillDirAbs: string,
  files: readonly string[],
  workspace: string,
): Map<string, Buffer> {
  const inputs = new Map<string, Buffer>();
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(skillDirAbs, f));
    const base = path.basename(f);
    fs.writeFileSync(path.join(workspace, base), bytes);
    inputs.set(base, bytes);
  }
  return inputs;
}

/** Copy what the run produced (anything but an unchanged input file) into `outputs/`. */
function collectOutputs(workspace: string, inputs: Map<string, Buffer>, outputsDir: string): void {
  fs.mkdirSync(outputsDir, { recursive: true });
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(workspace, abs).split(path.sep).join("/");
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const was = inputs.get(rel);
        const bytes = fs.readFileSync(abs);
        if (was !== undefined && was.equals(bytes)) continue;
        const dest = path.join(outputsDir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, bytes);
      }
    }
  };
  walk(workspace);
}

class Semaphore {
  private free: number;
  private waiters: (() => void)[] = [];
  constructor(n: number) {
    this.free = Math.max(1, n);
  }
  async acquire(): Promise<void> {
    if (this.free > 0) return void this.free--;
    await new Promise<void>((r) => this.waiters.push(r));
  }
  release(): void {
    const w = this.waiters.shift();
    if (w !== undefined) w();
    else this.free++;
  }
}

export async function runEvals(
  opts: RunOptions,
  selections: readonly Selection[],
): Promise<RunReport> {
  const cfg: RunSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const results: SkillResult[] = [];
  const done = (exitCode: number, stderr = ""): RunReport => ({
    exitCode,
    results,
    text: formatReport(results),
    stderr,
  });
  const blank = (
    skill: string,
    status: RunStatus,
    blocking: boolean,
    messages: string[],
  ): SkillResult => ({
    skill,
    status,
    blocking,
    executorRuns: 0,
    judgeCalls: 0,
    costUsd: 0,
    messages,
  });

  // 1. Credentials and judge configuration (R33): no model call is made if this fails.
  const ov = readOverride(opts.judgeConfigFile ?? opts.env["SKILL_EVALS_JUDGE_CONFIG"]);
  if ("error" in ov) return done(3, `${ov.error}\n`);
  const cred = planCredentials({ env: opts.env, override: ov.override, mock: opts.mock });
  if (!cred.ok) return done(3, `${cred.message}\n`);

  // 2. Classification and planning of every skill (no model call).
  const ready: SkillState[] = [];
  for (const sel of selections) {
    const name = sel.skill.name;
    if (!fs.existsSync(path.join(sel.skill.dirAbs, "evals"))) {
      results.push(
        blank(name, "no-evals", cfg.missingEvalsBlocking, [
          `warning: ${name} has no evals/ directory`,
        ]),
      );
      continue;
    }
    if (sel.head.kind === "invalid") {
      results.push(blank(name, "invalid", true, sel.head.problems));
      continue;
    }
    const rel = `${sel.skill.dirRel}/evals/evals.json`;
    const bad = evalsViolations(sel.skill.dirAbs, name, rel);
    if (sel.head.kind !== "ok" || sel.headHash === undefined || bad.length > 0) {
      results.push(
        blank(name, "invalid", true, bad.length > 0 ? bad : ["the skill cannot be read"]),
      );
      continue;
    }
    const parsed = validateEvals(
      fs.readFileSync(path.join(sel.skill.dirAbs, "evals", "evals.json"), "utf8"),
      {
        file: rel,
        skillDir: sel.skill.dirAbs,
        skillName: name,
      },
    );
    if (parsed.evals === undefined) {
      results.push(
        blank(
          name,
          "invalid",
          true,
          parsed.violations.map((v) => `${v.file}: ${v.path}: ${v.rule}: ${v.message}`),
        ),
      );
      continue;
    }
    const replay = !sel.isNew && !sel.installedEqual;
    const plan = planSkill(name, parsed.evals, replay);
    const judge = createJudge({
      dir: path.join(skillOutDir(opts.out, name), ".judge"),
      judge: cred.judge,
      credential: cred.credential,
      maxCalls: cfg.judgeMaxCalls,
      baseEnv: opts.env,
      mock: opts.mock,
      ...(opts.mockAnswer !== undefined ? { mockAnswer: opts.mockAnswer } : {}),
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
    });
    ready.push({
      sel,
      evals: parsed.evals,
      plan,
      replay,
      budget: new RunBudget(cfg.maxExecutorRuns),
      judge,
      controller: new AbortController(),
      runs: [],
      baseRuns: [],
      costs: [],
      errors: [],
    });
  }

  const finish = (): RunReport => {
    const blocking = results.some((r) => r.blocking);
    return done(blocking ? 1 : 0);
  };
  if (ready.length === 0) return finish();

  // 3. Pre-flight caps (R23, R28): refuse before any model call.
  const limits: Limits = {
    maxExecutorRuns: cfg.maxExecutorRuns,
    judgeMaxCalls: cfg.judgeMaxCalls,
    maxInvocationUsd: cfg.maxInvocationUsd,
    perRunUsd: cfg.perRunUsd,
  };
  const refusals = preflight(
    ready.map((s) => s.plan),
    limits,
  );
  if (refusals.length > 0) {
    for (const s of ready)
      results.push(
        blank(
          s.sel.skill.name,
          "error",
          true,
          refusals.map((m) => `refused before any model call: ${m}`),
        ),
      );
    return done(1, `${refusals.join("\n")}\n`);
  }

  // 4. Judge preflight (before any executor spawn) and the usage declaration (R23).
  const pf = await ready[0]!.judge.preflight();
  if (!pf.ok)
    return done(
      3,
      `judge backend ${pf.backend}: ${pf.reason === "auth-missing" ? "no credentials" : pf.detail}. No model call was made.\n`,
    );
  if (!opts.mock) {
    const asset = resolveAsset(opts.repoRoot, opts.ticket);
    if ("error" in asset) return done(3, `${asset.error}\n`);
    const d = (opts.declare ?? ((a: string) => declareUsage(opts.repoRoot, a)))(asset.asset);
    if (!d.ok) return done(3, `${d.error}\n`);
  }

  // 5. Execute, grade, account.
  const executor: Executor =
    opts.executor ?? (opts.mock ? new MockExecutor() : new ClaudeCodeExecutor());
  const meter = new CostMeter(cfg.maxInvocationUsd);
  const sem = new Semaphore(cfg.executorConcurrency);
  const invocation = new AbortController();
  let invocationError: string | undefined;
  const breach = (s: SkillState | undefined, msg: string) => {
    if (s !== undefined) {
      s.errors.push(msg);
      s.controller.abort();
    } else {
      invocationError ??= msg;
      invocation.abort();
      for (const x of ready) x.controller.abort();
    }
  };

  const runTask = async (s: SkillState, t: Task): Promise<void> => {
    const name = s.sel.skill.name;
    const ev = s.evals.evals[t.evalIndex]!;
    const label = `${name}/eval-${ev.id}/${t.configuration}${t.base ? " (base)" : ""}`;
    let outcome: ExecOutcome | undefined;
    let dir = "";
    let inputs = new Map<string, Buffer>();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-run-"));
    try {
      await sem.acquire();
      try {
        if (s.controller.signal.aborted || invocation.signal.aborted) return;
        if (meter.reached)
          return breach(
            undefined,
            `max-invocation-usd ${cfg.maxInvocationUsd} reached (measured ${meter.spent.toFixed(2)})`,
          );
        if (!s.budget.reserve())
          return breach(s, `max-executor-runs ${cfg.maxExecutorRuns} reached`);
        const workspace = path.join(root, "workspace");
        const home = path.join(root, "home");
        fs.mkdirSync(workspace, { recursive: true });
        fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
        inputs = copyInputs(s.sel.skill.dirAbs, ev.files, workspace);
        if (t.configuration === "with_skill") {
          const files: readonly SnapFile[] =
            t.base && s.sel.base.kind === "ok"
              ? s.sel.base.files
              : (s.sel.head as { files: SnapFile[] }).files;
          installFiles(files, path.join(home, ".claude", "skills", name));
        }
        const signal = AbortSignal.any([s.controller.signal, invocation.signal]);
        outcome = await executor.run({
          prompt: ev.prompt,
          workspaceDir: workspace,
          homeDir: home,
          model: cfg.executorModel,
          limits: { turns: cfg.perRunTurns, seconds: cfg.perRunSeconds, usd: cfg.perRunUsd },
          credential: cred.credential,
          signal,
          baseEnv: opts.env,
          label,
        });
        dir = runDir(opts.out, name, ev.id, t.configuration, t.base);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        if (outcome.aborted !== true) collectOutputs(workspace, inputs, outputsDirOf(dir));
      } finally {
        sem.release();
      }
      if (outcome === undefined || outcome.aborted === true) return;
      s.costs.push(outcome.costUsd);
      meter.add(outcome.costUsd);
      fs.writeFileSync(
        path.join(dir, "transcript.md"),
        outcome.transcript.endsWith("\n") ? outcome.transcript : `${outcome.transcript}\n`,
      );
      writeJson(path.join(dir, "metrics.json"), {
        eval_id: ev.id,
        configuration: t.configuration,
        base: t.base,
        model: cfg.executorModel,
        cost_usd: outcome.costUsd,
        usage: outcome.usage,
        turns: outcome.turns,
        seconds: outcome.seconds,
        limit: outcome.limit ?? null,
        ...(opts.mock ? { mock: true } : {}),
      });
      if (outcome.failure !== undefined) {
        s.errors.push(`${label}: executor failure: ${outcome.failure}`);
        s.controller.abort();
        return;
      }
      let grading: Grading;
      try {
        grading = await gradeRun({
          evalCase: ev,
          outputsDir: outputsDirOf(dir),
          skillDir: s.sel.skill.dirAbs,
          transcript: outcome.transcript,
          judge: s.judge.fn,
          mock: opts.mock,
        });
      } catch (e) {
        if (e instanceof JudgeFailure) {
          s.errors.push(`${label}: judge: ${e.message}`);
          s.controller.abort();
          return;
        }
        throw e;
      }
      writeJson(path.join(dir, "grading.json"), grading);
      (t.base ? s.baseRuns : s.runs).push({
        evalId: ev.id,
        configuration: t.configuration,
        summary: grading.summary,
        timeSeconds: outcome.seconds,
      });
    } catch (e) {
      s.errors.push(`${label}: ${(e as Error).message}`);
      s.controller.abort();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  const pending: Promise<void>[] = [];
  for (const s of ready)
    s.evals.evals.forEach((_, i) => {
      pending.push(runTask(s, { evalIndex: i, configuration: "with_skill", base: false }));
      if (s.replay)
        pending.push(runTask(s, { evalIndex: i, configuration: "with_skill", base: true }));
      pending.push(runTask(s, { evalIndex: i, configuration: "without_skill", base: false }));
    });
  await Promise.all(pending);

  // 6. Per-skill outcome.
  const date = (opts.now ?? (() => new Date()))().toISOString();
  for (const s of ready) {
    const name = s.sel.skill.name;
    const judgeCalls = s.judge.callsUsed();
    const unknown = s.costs.filter((c) => c === null).length;
    const known = Math.round(s.costs.reduce<number>((n, c) => n + (c ?? 0), 0) * 1e6) / 1e6;
    const base = {
      skill: name,
      executorRuns: s.budget.used,
      judgeCalls,
      costUsd: unknown > 0 ? null : known,
      costLowerBound: known,
      probes: s.evals.trigger_probes.length,
    };
    const errors = [...s.errors, ...(invocationError !== undefined ? [invocationError] : [])];
    if (errors.length > 0 || s.runs.length + s.baseRuns.length < s.plan.executorRuns) {
      const msgs = errors.length > 0 ? errors : ["not every planned run completed"];
      results.push({
        ...base,
        status: "error",
        blocking: true,
        messages: [...msgs, `executor runs used ${s.budget.used}, judge calls used ${judgeCalls}`],
      });
      continue;
    }
    const bench = buildBenchmark(s.runs, { skill: name, mock: opts.mock });
    writeJson(path.join(skillOutDir(opts.out, name), "benchmark.json"), bench);
    const withMean = configMean(s.runs, "with_skill");
    const withoutMean = configMean(s.runs, "without_skill");
    const baseMean = s.replay ? mean(s.baseRuns.map((r) => r.summary.pass_rate)) : null;
    const delta = withMean - withoutMean;
    let status: RunStatus;
    if (opts.mock) status = "mock";
    else if (s.sel.isNew) status = "new";
    else if (baseMean !== null && isRegression(withMean, baseMean, cfg.tolerance))
      status = "regression";
    else status = "pass";
    const blocking = status === "regression" && cfg.regressionBlocking;
    const messages: string[] = [];
    if (unknown > 0)
      messages.push(`cost unknown for ${unknown} run(s); the total is a lower bound`);
    results.push({
      ...base,
      status,
      blocking,
      withSkillMean: withMean,
      withoutSkillMean: withoutMean,
      baseMean,
      deltaValue: delta,
      tolerance: cfg.tolerance,
      messages,
    });
    if (!opts.mock && (status === "pass" || status === "regression" || status === "new"))
      writeResults(s.sel.skill.dirAbs, {
        skill_name: name,
        content_hash: s.sel.headHash!,
        runner_version: S.RUNNER_VERSION,
        executor_model: cfg.executorModel,
        judge_model: cred.judge.model,
        date,
        status,
        benchmark: {
          with_skill_mean: withMean,
          without_skill_mean: withoutMean,
          base_mean: baseMean,
          delta_value: delta,
          tolerance: cfg.tolerance,
        },
        executor_runs: s.budget.used,
        judge_calls: judgeCalls,
        cost_usd: unknown > 0 ? null : known,
      });
  }
  return finish();
}
