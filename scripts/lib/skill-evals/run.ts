// run.ts — orchestration of a skill eval run (spec 0290 R9-R13, R19-R24, R27-R33, R36, R45-R48;
// spec 0304 R5-R10, R21-R23).
//
// For each selected skill: classify (no-evals / invalid / ready), plan the caps (R22), decide how the
// measurement starts (resume, restart or refuse, R8), declare the measurement in `evals/results.json`
// as `in-progress` BEFORE the first model call (R5), then execute the two-stage sampling plan
// through a pool bounded by `executor-concurrency` (stages.ts): each graded run is recorded and the
// file rewritten atomically. The status comes from plan.ts over the recorded runs. The head snapshot
// is read ONCE: the same bytes are hashed and installed. Mock mode runs no process and no model call
// and writes no results file.
//
// Credential step (R33, R41, R32), skipped in mock mode: the credential source is chosen, the
// temporary directory is checked (outside HOME and any git work tree), and in session mode the
// login is probed once per invocation (no model call). Each run's workspace is a directory under
// the temporary root; each run has the skill installed at project scope in it
// (`<workspace>/.claude/skills/<name>/`), and the top-level `.claude/` is never collected as output.
//
// Exit codes (the entry maps them): 0 ok, 1 blocking outcome, 3 failed precondition (R33, R41, R32).
// Usage: runEvals(options, selections). Finding-line format: see report.ts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CostMeter, preflight, refuseSpend, RunBudget } from "./budget.ts";
import type { Limits } from "./budget.ts";
import type { CredentialSource } from "./credentials.ts";
import { ClaudeCodeExecutor } from "./executor/claude-code.ts";
import { MockExecutor } from "./executor/mock.ts";
import type { Executor } from "./executor/types.ts";
import { createJudge } from "./judge.ts";
import { HistoryError } from "./ledger.ts";
import { skillOutDir } from "./layout.ts";
import { checkPreconditions } from "./preconditions.ts";
import { classify, refusedResult, startSkills } from "./prepare.ts";
import { persist, skillResult } from "./progress.ts";
import type { LiveSkill } from "./progress.ts";
import { formatReport } from "./report.ts";
import type { SkillResult } from "./report.ts";
import { blocks, resultsPath } from "./results.ts";
import { DEFAULT_SETTINGS } from "./run-settings.ts";
import type { RunSettings } from "./run-settings.ts";
import type { Selection } from "./select.ts";
import { measureSkill } from "./stages.ts";
import type { StageCtx } from "./stages.ts";
import { MeasureMeter, ticketSpend } from "./spend.ts";
import { declareUsage, resolveAsset } from "./usage.ts";
import { Semaphore } from "./workspace.ts";

export { DEFAULT_SETTINGS };
export type { RunSettings };

export interface RunOptions {
  readonly repoRoot: string;
  readonly out: string;
  readonly mock: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ticket?: string;
  readonly judgeConfigFile?: string;
  /** `--use-api-key`: use ANTHROPIC_API_KEY as the credential (R33). */
  readonly useApiKey?: boolean;
  /** Test seam: the temporary root of workspaces (default `os.tmpdir()`), subject to the R32 guard. */
  readonly tempRoot?: string;
  readonly settings?: Partial<RunSettings>;
  readonly executor?: Executor;
  readonly mockAnswer?: (
    expectations: readonly string[],
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
  /** R43: the credential source in use; absent in mock mode and before the credential step succeeds. */
  readonly credentialSource?: CredentialSource;
}

export async function runEvals(
  opts: RunOptions,
  selections: readonly Selection[],
): Promise<RunReport> {
  const cfg: RunSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const results: SkillResult[] = [];
  const tempRoot = opts.tempRoot ?? os.tmpdir();
  const nowFn = opts.now ?? (() => new Date());
  let source: CredentialSource | undefined;
  const done = (exitCode: number, stderr = ""): RunReport => ({
    exitCode,
    results,
    text: formatReport(results, source),
    stderr,
    ...(source !== undefined ? { credentialSource: source } : {}),
  });
  const finish = (): RunReport => done(results.some((r) => r.blocking) ? 1 : 0);

  // 1. Credentials and judge configuration (R33): no model call is made if this fails.
  const pre = await checkPreconditions({
    env: opts.env,
    judgeConfigFile: opts.judgeConfigFile,
    mock: opts.mock,
    useApiKey: opts.useApiKey === true,
    tempRoot,
  });
  if (!pre.ok) return done(pre.exit, pre.stderr);
  const cred = pre.cred;
  source = pre.source;

  // 2. Classification, the caps of the plan (R22 a, b) and the ticket label (no model call).
  const cls = classify(selections, cfg);
  results.push(...cls.results);
  if (cls.candidates.length === 0) return finish();
  const asset = opts.mock ? undefined : resolveAsset(opts.repoRoot, opts.ticket);
  if (asset !== undefined && "error" in asset) return done(3, `${asset.error}\n`);
  const ticket =
    asset === undefined ? (opts.ticket ?? "0") : (/#(\d+)$/.exec(asset.asset)?.[1] ?? "0");
  const limits: Limits = {
    maxExecutorRuns: cfg.maxExecutorRuns,
    judgeMaxCalls: cfg.judgeMaxCalls,
    maxInvocationUsd: cfg.maxInvocationUsd,
    perRunUsd: cfg.perRunUsd,
    maxMeasurementUsd: cfg.maxMeasurementUsd,
    maxSkillUsd: cfg.maxSkillUsd,
    maxTicketUsd: cfg.maxTicketUsd,
    executorConcurrency: cfg.executorConcurrency,
  };
  const refuseAll = (refusals: string[]): RunReport => {
    for (const c of cls.candidates)
      results.push(
        refusedResult(c.sel.skill.name, `refused before any model call: ${refusals.join("; ")}`),
      );
    return done(1, `${refusals.join("\n")}\n`);
  };
  const planRefusals = preflight(
    cls.candidates.map((c) => c.plan),
    limits,
  );
  if (planRefusals.length > 0) return refuseAll(planRefusals);

  // 3. How each measurement starts (R8) and the spend caps (R22 c, d).
  const nowIso = nowFn().toISOString();
  let st: ReturnType<typeof startSkills>;
  try {
    st = startSkills({
      repoRoot: opts.repoRoot,
      mock: opts.mock,
      candidates: cls.candidates,
      ticket,
      cfg,
      now: nowIso,
      judgeModel: cred.judge.model,
    });
  } catch (e) {
    if (e instanceof HistoryError) return done(3, `${e.message}\n`);
    throw e;
  }
  results.push(...st.results);
  if (st.started.length === 0) return finish();
  if (!opts.mock) {
    const spendRefusals = refuseSpend(st.rows, ticket, ticketSpend(opts.repoRoot, ticket), limits);
    if (spendRefusals.length > 0) return refuseAll(spendRefusals);
  }

  // 4. Judge preflight (before any executor spawn) and the usage declaration (R23).
  const live: LiveSkill[] = st.started.map(({ cand, accepted }) => {
    const name = cand.sel.skill.name;
    const judge = createJudge({
      dir: path.join(skillOutDir(opts.out, name), ".judge"),
      judge: cred.judge,
      credential: cred.credential,
      maxCalls: cfg.judgeMaxCalls,
      effort: cfg.effort,
      baseEnv: opts.env,
      mock: opts.mock,
      ...(opts.mockAnswer !== undefined ? { mockAnswer: opts.mockAnswer } : {}),
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
    });
    const record = accepted.record;
    return {
      sel: cand.sel,
      evals: cand.evals,
      record,
      priorRuns: record.executor_runs,
      priorJudgeCalls: record.judge_calls,
      baseText: cand.sel.baseResultsText,
      mergeBase: cand.sel.mergeBase ?? "",
      budget: new RunBudget(cfg.maxExecutorRuns),
      judge,
      meter: new MeasureMeter(accepted.resumed ? structuredClone(record) : undefined, judge),
      controller: new AbortController(),
      write: !opts.mock,
      branchCount: accepted.branchCount,
      stop: undefined,
      evidence: { accepted: 0, window: 0 },
    };
  });
  const needsModel = st.started.some((x) => !x.finalise);
  if (needsModel) {
    const pf = await live[0]!.judge.preflight();
    if (!pf.ok)
      return done(
        3,
        `judge backend ${pf.backend}: ${pf.reason === "auth-missing" ? "no credentials" : pf.detail}. No model call was made.\n`,
      );
    if (asset !== undefined && !opts.mock) {
      const d = (opts.declare ?? ((a: string) => declareUsage(opts.repoRoot, a)))(asset.asset);
      if (!d.ok) return done(3, `${d.error}\n`);
    }
  }

  // 5. Declare each measurement (R5): the file exists as in-progress before the first model call.
  const running: LiveSkill[] = [];
  for (const s of live) {
    try {
      persist(s, nowIso);
      running.push(s);
    } catch (e) {
      results.push(
        refusedResult(
          s.sel.skill.name,
          `cannot write ${resultsPath(s.sel.skill.dirAbs)}: ${(e as Error).message}; no model call was made`,
        ),
      );
    }
  }

  // 6. Execute, grade, account (stages.ts).
  const ctx: StageCtx = {
    out: opts.out,
    tempRoot,
    mock: opts.mock,
    cfg,
    credential: cred.credential,
    env: opts.env,
    executor: opts.executor ?? (opts.mock ? new MockExecutor() : new ClaudeCodeExecutor()),
    sem: new Semaphore(cfg.executorConcurrency),
    invocation: new AbortController(),
    invMeter: new CostMeter(cfg.maxInvocationUsd),
    now: nowFn,
    invocationError: undefined,
  };
  await Promise.all(running.map((s) => measureSkill(ctx, s)));

  // 7. Per-skill outcome (a skill that did not finish stays `in-progress` on disk and is an error).
  for (const s of running) {
    let d;
    let writeFailed = false;
    try {
      d = persist(s, nowFn().toISOString());
    } catch (e) {
      writeFailed = true;
      s.stop ??= `cannot write ${resultsPath(s.sel.skill.dirAbs)}: ${(e as Error).message}`;
      d = persist({ ...s, write: false }, nowFn().toISOString());
    }
    const errors = [
      ...(s.stop !== undefined ? [s.stop] : []),
      ...(ctx.invocationError !== undefined ? [ctx.invocationError] : []),
    ];
    if (d.status === "in-progress" || writeFailed) {
      const used = `executor runs used ${s.budget.used}, judge calls used ${s.judge.callsUsed()}`;
      results.push(
        skillResult(
          s,
          d,
          opts.mock,
          true,
          [...(errors.length > 0 ? errors : ["not every planned run completed"]), used],
          "error",
        ),
      );
      continue;
    }
    results.push(skillResult(s, d, opts.mock, !opts.mock && blocks(d.status, cfg), []));
  }
  return finish();
}
