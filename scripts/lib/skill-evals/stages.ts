// stages.ts — the staged execution of one measurement (spec 0304 R5, R7, R9, R22, R27).
//
// `measureSkill` loops: decide the pools from the recorded runs (plan.ts), run the missing slots of
// the current stage through the shared pool, record every graded run (the file is rewritten
// atomically after each), and stop when no slot remains. A slot whose executor or judge fails
// without leaving a gradable run is recorded in `errors` and retried once in the same invocation;
// a second failure ends the skill, the file stays `in-progress`. A run that ends at a turn, time or
// cost limit is graded on what it produced and is a sample. The cost cap of the measurement is
// checked before each run starts: once reached no new run starts and the skill ends in error.
//
// Usage: measureSkill(ctx, live). Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import type { CostMeter } from "./budget.ts";
import type { Credential } from "./credentials.ts";
import type { Executor, ExecOutcome } from "./executor/types.ts";
import { gradeRun, JudgeFailure } from "./grade.ts";
import type { Grading } from "./grade.ts";
import { installFiles } from "./hash.ts";
import type { SnapFile } from "./hash.ts";
import { evalDir, outputsDirOf, probeDir, writeJson } from "./layout.ts";
import type { SkillDecision } from "./plan.ts";
import { applyDecision, persist } from "./progress.ts";
import type { LiveSkill } from "./progress.ts";
import type { RunSettings } from "./run-settings.ts";
import { collectOutputs, copyInputs } from "./workspace.ts";
import type { Semaphore } from "./workspace.ts";

export interface StageCtx {
  readonly out: string;
  readonly tempRoot: string;
  readonly mock: boolean;
  readonly cfg: RunSettings;
  readonly credential: Credential | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly executor: Executor;
  readonly sem: Semaphore;
  readonly invocation: AbortController;
  readonly invMeter: CostMeter;
  readonly now: () => Date;
  /** Set when the invocation-wide cost cap stopped every skill. */
  invocationError: string | undefined;
}

interface Slot {
  readonly kind: "eval" | "probe";
  readonly index: number;
  /** 1-based run number of the slot (R27). */
  readonly run: number;
}

type Attempt =
  | { readonly ok: true }
  | { readonly ok: false; readonly aborted: true }
  | {
      readonly ok: false;
      readonly aborted?: false;
      readonly kind: string;
      readonly message: string;
    };

const ABORTED: Attempt = { ok: false, aborted: true };

/** The missing runs of every eval and probe for the stage the recorded runs reach (R2, R8(a)). */
function slotsOf(s: LiveSkill, d: SkillDecision): Slot[] {
  const out: Slot[] = [];
  d.evals.remaining.forEach((n, index) => {
    const have = s.record.evals[index]?.runs.length ?? 0;
    for (let k = 1; k <= n; k++) out.push({ kind: "eval", index, run: have + k });
  });
  d.probes?.remaining.forEach((n, index) => {
    const have = s.record.probes[index]?.runs.length ?? 0;
    for (let k = 1; k <= n; k++) out.push({ kind: "probe", index, run: have + k });
  });
  return out;
}

function stopSkill(s: LiveSkill, message: string): void {
  s.stop ??= message;
  s.controller.abort();
}

async function attempt(ctx: StageCtx, s: LiveSkill, slot: Slot): Promise<Attempt> {
  const name = s.sel.skill.name;
  const isProbe = slot.kind === "probe";
  const ev = isProbe ? undefined : s.evals.evals[slot.index]!;
  const probe = isProbe ? s.evals.trigger_probes[slot.index]! : undefined;
  const label = isProbe
    ? `${name}/probe-${slot.index + 1}/run-${slot.run}`
    : `${name}/eval-${ev!.id}/run-${slot.run}`;
  let outcome: ExecOutcome | undefined;
  let dir = "";
  let inputs = new Map<string, Buffer>();
  const root = fs.mkdtempSync(path.join(ctx.tempRoot, "skill-evals-run-"));
  try {
    await ctx.sem.acquire();
    try {
      if (s.controller.signal.aborted || ctx.invocation.signal.aborted) return ABORTED;
      if (ctx.invMeter.reached) {
        ctx.invocationError ??= `max-invocation-usd ${ctx.cfg.maxInvocationUsd} reached (measured ${ctx.invMeter.spent.toFixed(2)})`;
        ctx.invocation.abort();
        return ABORTED;
      }
      if (s.meter.total >= ctx.cfg.maxMeasurementUsd) {
        stopSkill(
          s,
          `the measurement is at its cap: ${s.meter.total.toFixed(2)} USD reached max-measurement-usd ${ctx.cfg.maxMeasurementUsd}; no new run started`,
        );
        return ABORTED;
      }
      if (!s.budget.reserve()) {
        stopSkill(s, `max-executor-runs ${ctx.cfg.maxExecutorRuns} reached`);
        return ABORTED;
      }
      const workspace = path.join(root, "workspace");
      fs.mkdirSync(workspace, { recursive: true });
      if (ev !== undefined) inputs = copyInputs(s.sel.skill.dirAbs, ev.files, workspace);
      installFiles(
        (s.sel.head as { files: SnapFile[] }).files,
        path.join(workspace, ".claude", "skills", name),
      );
      outcome = await ctx.executor.run({
        prompt: ev?.prompt ?? probe!.query,
        workspaceDir: workspace,
        model: ctx.cfg.executorModel,
        // R45: a probe has no tool but Skill and is bounded to one assistant turn.
        ...(isProbe ? { tools: ["Skill"] } : {}),
        effort: ctx.cfg.effort,
        limits: {
          turns: isProbe ? 1 : ctx.cfg.perRunTurns,
          seconds: ctx.cfg.perRunSeconds,
          usd: ctx.cfg.perRunUsd,
        },
        credential: ctx.credential,
        signal: AbortSignal.any([s.controller.signal, ctx.invocation.signal]),
        baseEnv: ctx.env,
        label,
      });
      dir = isProbe
        ? probeDir(ctx.out, name, slot.index + 1, slot.run)
        : evalDir(ctx.out, name, ev!.id, slot.run);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      if (outcome.aborted !== true && !isProbe)
        collectOutputs(workspace, inputs, outputsDirOf(dir));
    } finally {
      ctx.sem.release();
    }
    if (outcome === undefined || outcome.aborted === true) return ABORTED;
    const assumed = outcome.costUsd === null && s.meter.assumed;
    s.meter.addRun(outcome.costUsd);
    ctx.invMeter.add(outcome.costUsd);
    fs.writeFileSync(
      path.join(dir, "transcript.md"),
      outcome.transcript.endsWith("\n") ? outcome.transcript : `${outcome.transcript}\n`,
    );
    const loaded = outcome.skillsLoaded.includes(name);
    // R45: reaching the one-turn bound is the early stop of a probe, not a limit.
    const limit = isProbe && outcome.limit === "turns" ? null : (outcome.limit ?? null);
    writeJson(path.join(dir, "metrics.json"), {
      ...(ev !== undefined ? { eval_id: ev.id, skill_loaded: loaded } : {}),
      model: ctx.cfg.executorModel,
      effort: ctx.cfg.effort,
      cost_usd: outcome.costUsd,
      usage: outcome.usage,
      turns: outcome.turns,
      seconds: outcome.seconds,
      limit,
      ...(ctx.mock ? { mock: true } : {}),
    });
    if (outcome.failure !== undefined)
      return { ok: false, kind: "executor", message: outcome.failure };
    if (probe !== undefined) {
      const passed = loaded === probe.should_trigger;
      writeJson(path.join(dir, "probe.json"), {
        query: probe.query,
        should_trigger: probe.should_trigger,
        observed: loaded,
        passed,
        ...(ctx.mock ? { mock: true } : {}),
      });
      s.record.probes[slot.index]!.runs.push(passed);
    } else {
      let grading: Grading;
      try {
        grading = await gradeRun({
          evalCase: ev!,
          outputsDir: outputsDirOf(dir),
          skillDir: s.sel.skill.dirAbs,
          transcript: outcome.transcript,
          judge: s.judge.fn,
          judgeRawFile: path.join(dir, "judge.txt"),
          mock: ctx.mock,
        });
      } catch (e) {
        if (e instanceof JudgeFailure) return { ok: false, kind: "judge", message: e.message };
        throw e;
      }
      writeJson(path.join(dir, "grading.json"), grading);
      const accepted = grading.expectations.filter((x) => x.evidence_match !== undefined);
      s.evidence.accepted += accepted.length;
      s.evidence.window += accepted.filter((x) => x.evidence_match === "window").length;
      // R46: an eval passes when every one of its checks and expectations passes.
      s.record.evals[slot.index]!.runs.push({
        passed: grading.summary.total > 0 && grading.summary.failed === 0,
        assertions: grading.expectations.map((x) => (x.passed ? "1" : "0")).join(""),
        skill_loaded: loaded,
        cost_usd: outcome.costUsd,
        ...(assumed ? { cost_assumed: true as const } : {}),
        reasked: grading.reasked === true,
      });
    }
    try {
      persist(s, ctx.now().toISOString());
    } catch (e) {
      stopSkill(
        s,
        `cannot write ${s.sel.skill.dirRel}/evals/results.json: ${(e as Error).message}`,
      );
    }
    return { ok: true };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** One slot, retried once on an infrastructure failure (R9); a second failure ends the skill. */
async function runSlot(ctx: StageCtx, s: LiveSkill, slot: Slot): Promise<void> {
  const label =
    slot.kind === "eval"
      ? `eval-${s.evals.evals[slot.index]!.id}/run-${slot.run}`
      : `probe-${slot.index + 1}/run-${slot.run}`;
  for (let a = 0; a < 2; a++) {
    let r: Attempt;
    try {
      r = await attempt(ctx, s, slot);
    } catch (e) {
      r = { ok: false, kind: "exception", message: (e as Error).message };
    }
    if (r.ok || r.aborted === true) return;
    s.record.errors.push({
      slot: label,
      kind: r.kind,
      message: r.message,
      time: ctx.now().toISOString(),
    });
    try {
      persist(s, ctx.now().toISOString());
    } catch (e) {
      return stopSkill(
        s,
        `cannot write ${s.sel.skill.dirRel}/evals/results.json: ${(e as Error).message}`,
      );
    }
    if (a === 1)
      return stopSkill(s, `${s.sel.skill.name}/${label}: failed twice (${r.kind}): ${r.message}`);
  }
}

/** Run the missing slots stage by stage until the plan has no slot left or the skill stops. */
export async function measureSkill(ctx: StageCtx, s: LiveSkill): Promise<void> {
  for (;;) {
    const d = applyDecision(s, ctx.now().toISOString());
    const slots = slotsOf(s, d);
    if (slots.length === 0 || s.stop !== undefined || ctx.invocation.signal.aborted) return;
    await Promise.all(slots.map((slot) => runSlot(ctx, s, slot)));
    if (s.stop !== undefined) return;
  }
}
