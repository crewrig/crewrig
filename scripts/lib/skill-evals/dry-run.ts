// dry-run.ts — the authoring guard: `task skill-evals -- <skill> --dry-run [--eval <id>]` (spec 0304
// R20).
//
// Per eval, a hand-written sample output under `evals/samples/<id>/` (any files at the paths a run
// would produce, plus an optional `transcript.md`) is checked: every deterministic check of the eval
// runs on the sample (a sample that fails its own check is `sample-invalid`, exit 1), then one judge
// call per eval that has expectations, with no executor run, applying the evidence rules and the
// re-ask; PASS or FAIL is printed per expectation. A FAIL on a conforming sample is a defect of the
// case or of the sample and does not change the exit code. An eval with no sample is skipped, and
// when none has one the command exits 1: nothing was checked. A dry-run writes no `results.json`,
// no ledger entry and nothing under the skill's `evals/`; its judge spend is checked against the
// per-skill and ticket caps with its own worst case, printed, and not persisted.
//
// Usage: dryRun(opts). Exit codes: 0 ok, 1 sample-invalid or no sample, 2 usage (unknown eval),
// 3 failed precondition. Finding-line format: `<skill>: eval <id>: <result>`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { refuseSpend } from "./budget.ts";
import { runCheck } from "./checks.ts";
import { gradeRun } from "./grade.ts";
import { createJudge } from "./judge.ts";
import type { Judge } from "./judge.ts";
import { skillOutDir } from "./layout.ts";
import { branchSpendOf, readHistory } from "./ledger.ts";
import { checkPreconditions } from "./preconditions.ts";
import { DEFAULT_SETTINGS } from "./run-settings.ts";
import type { RunSettings } from "./run-settings.ts";
import { validateEvals } from "./schema.ts";
import type { EvalCase } from "./schema.ts";
import type { SkillRef } from "./select.ts";
import { JUDGE_ASSUMED_USD } from "./settings.ts";
import { ticketSpend } from "./spend.ts";
import { declareUsage, resolveAsset } from "./usage.ts";

export interface DryRunOptions {
  readonly repoRoot: string;
  readonly out: string;
  readonly skill: SkillRef;
  readonly evalId?: number;
  readonly mergeBase: string | undefined;
  readonly mock: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ticket?: string;
  readonly judgeConfigFile?: string;
  readonly useApiKey?: boolean;
  readonly tempRoot?: string;
  readonly settings?: Partial<RunSettings>;
  readonly mockAnswer?: Parameters<typeof createJudge>[0]["mockAnswer"];
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly declare?: (asset: string) => { ok: true } | { ok: false; error: string };
}

export interface DryRunReport {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const TRANSCRIPT = "transcript.md";

/** Copy the sample's files (never `transcript.md`) into a throwaway outputs directory. */
function stageSample(sampleDir: string, into: string): void {
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (rel === "" && e.name === TRANSCRIPT) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) {
        const dest = path.join(into, ...r.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(dir, e.name), dest);
      }
    }
  };
  walk(sampleDir, "");
}

export async function dryRun(o: DryRunOptions): Promise<DryRunReport> {
  const cfg: RunSettings = { ...DEFAULT_SETTINGS, ...o.settings };
  const name = o.skill.name;
  const lines: string[] = [];
  const out = (exitCode: number, stderr = ""): DryRunReport => ({
    exitCode,
    stdout: `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`,
    stderr,
  });
  const rel = `${o.skill.dirRel}/evals/evals.json`;
  let text: string;
  try {
    text = fs.readFileSync(path.join(o.skill.dirAbs, "evals", "evals.json"), "utf8");
  } catch {
    return out(1, `${rel}: evals/ exists but evals/evals.json is missing\n`);
  }
  const parsed = validateEvals(text, { file: rel, skillDir: o.skill.dirAbs, skillName: name });
  if (parsed.evals === undefined)
    return out(
      1,
      `${parsed.violations.map((v) => `${v.file}: ${v.path}: ${v.rule}: ${v.message}`).join("\n")}\n`,
    );
  const selected: EvalCase[] =
    o.evalId === undefined
      ? parsed.evals.evals
      : parsed.evals.evals.filter((e) => e.id === o.evalId);
  if (selected.length === 0) return out(2, `unknown eval id ${String(o.evalId)} for ${name}\n`);
  const samples = selected.filter((e) =>
    fs.existsSync(path.join(o.skill.dirAbs, "evals", "samples", String(e.id))),
  );
  for (const e of selected) if (!samples.includes(e)) lines.push(`no sample for eval ${e.id}`);
  if (samples.length === 0) {
    lines.push(`dry-run: no sample for ${name}`);
    return out(1);
  }
  const tempRoot = o.tempRoot ?? os.tmpdir();
  const pre = await checkPreconditions({
    env: o.env,
    judgeConfigFile: o.judgeConfigFile,
    mock: o.mock,
    useApiKey: o.useApiKey === true,
    tempRoot,
  });
  if (!pre.ok) return out(pre.exit, pre.stderr);
  const judged = samples.filter((e) => e.expectations.length > 0);
  let asset: { asset: string } | undefined;
  if (!o.mock) {
    const a = resolveAsset(o.repoRoot, o.ticket);
    if ("error" in a) return out(3, `${a.error}\n`);
    asset = a;
    const ticket = /#(\d+)$/.exec(a.asset)?.[1] ?? "0";
    // R22: the worst case of a dry-run is one re-asked judge call per eval with a sample.
    const worst = judged.length * 2 * JUDGE_ASSUMED_USD;
    const hist = readHistory(o.repoRoot, o.mergeBase, o.skill.dirRel);
    const rf = path.join(o.skill.dirAbs, "evals", "results.json");
    const spent = branchSpendOf(fs.existsSync(rf) ? fs.readFileSync(rf, "utf8") : undefined, hist);
    const refusals = refuseSpend(
      [{ skill: name, spent, worst }],
      ticket,
      ticketSpend(o.repoRoot, ticket),
      cfg,
    );
    if (refusals.length > 0) return out(1, `${refusals.join("\n")}\n`);
  }
  const judge: Judge = createJudge({
    dir: path.join(skillOutDir(o.out, name), ".judge"),
    judge: pre.cred.judge,
    credential: pre.cred.credential,
    maxCalls: cfg.judgeMaxCalls,
    effort: cfg.effort,
    baseEnv: o.env,
    mock: o.mock,
    ...(o.mockAnswer !== undefined ? { mockAnswer: o.mockAnswer } : {}),
    ...(o.fetchImpl !== undefined ? { fetchImpl: o.fetchImpl } : {}),
    ...(o.sleep !== undefined ? { sleep: o.sleep } : {}),
  });
  if (!o.mock && judged.length > 0) {
    const pf = await judge.preflight();
    if (!pf.ok)
      return out(
        3,
        `judge backend ${pf.backend}: ${pf.reason === "auth-missing" ? "no credentials" : pf.detail}. No model call was made.\n`,
      );
    if (asset !== undefined) {
      const d = (o.declare ?? ((a: string) => declareUsage(o.repoRoot, a)))(asset.asset);
      if (!d.ok) return out(3, `${d.error}\n`);
    }
  }
  let invalid = false;
  for (const e of samples) {
    const sampleDir = path.join(o.skill.dirAbs, "evals", "samples", String(e.id));
    const outputs = fs.mkdtempSync(path.join(tempRoot, "skill-evals-sample-"));
    try {
      stageSample(sampleDir, outputs);
      const failed: string[] = [];
      for (const c of e.checks) {
        const r = await runCheck(c, { outputsDir: outputs, skillDir: o.skill.dirAbs });
        if (!r.passed) failed.push(`${r.text}: ${r.evidence}`);
      }
      if (failed.length > 0) {
        invalid = true;
        for (const f of failed) lines.push(`${name}: eval ${e.id}: sample-invalid: ${f}`);
        continue;
      }
      if (e.expectations.length === 0) {
        lines.push(
          `${name}: eval ${e.id}: sample passes its ${e.checks.length} check(s); no expectation to judge`,
        );
        continue;
      }
      if (o.mock) {
        lines.push(`${name}: eval ${e.id}: sample passes its checks; no judge call under --mock`);
        continue;
      }
      const tFile = path.join(sampleDir, TRANSCRIPT);
      const g = await gradeRun({
        evalCase: { ...e, checks: [] },
        outputsDir: outputs,
        skillDir: o.skill.dirAbs,
        transcript: fs.existsSync(tFile) ? fs.readFileSync(tFile, "utf8") : "",
        judge: judge.fn,
      });
      lines.push(
        `${name}: eval ${e.id}: ${g.expectations.length} expectation(s) judged on the sample`,
      );
      for (const x of g.expectations) {
        lines.push(`  ${x.passed ? "PASS" : "FAIL"}: ${x.text}`);
        if (!x.passed)
          lines.push(
            `    defect of the case or of the sample on a conforming sample: ${x.evidence}`,
          );
      }
    } finally {
      fs.rmSync(outputs, { recursive: true, force: true });
    }
  }
  const calls = judge.callsUsed();
  const measured = judge.costUsd();
  lines.push(
    `dry-run spend: ${(measured ?? calls * JUDGE_ASSUMED_USD).toFixed(2)} (${calls} judge calls, ${measured === null && calls > 0 ? "assumed" : "measured"})`,
  );
  return out(invalid ? 1 : 0);
}
