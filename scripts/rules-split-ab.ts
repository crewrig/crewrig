// rules-split-ab.ts — the reduced paired A/B runner of spec 0308 (issue #1990, ADR-0025 O4).
//
// MANUAL AND PAID: 8 scenarios x 2 runs x 2 arms of headless `claude -p`, under a 12 USD cap.
// It is never wired into CI, `ci:pre-push` or a hook, and refuses to run (exit 3) when CI is set.
//
//   node scripts/rules-split-ab.ts --dry-run                       # print the plan, no model call
//   node scripts/rules-split-ab.ts [--arm-a-ref origin/main] [--out DIR]
//   node scripts/rules-split-ab.ts --arm-a-rule A.md --arm-b-rule B1.md --arm-b-rule B2.md
//   node scripts/rules-split-ab.ts --resume DIR --approved-cap 15  # after a cost-guard stop
//
// Options: --arm-a-ref <ref> (arm A: only 60-tools.md, via `git show <ref>:...`), --arm-a-rule and
// --arm-b-rule <path> (repeatable; override the refs and the working tree), --worker-settings <path>
// (passed as --settings in scenario 2 only), --scenarios 1,8, --runs 2, --model, --out, --keep-scratch.
// Exit: 0 done, 1 regression, 2 usage, 3 refused under CI, 4 cost guard stop, 5 auth error, 6 blocked
// (an invalid or truncated run prevents a conclusion).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { refuseInCi } from "./lib/fixed-context-probe.ts";
import type { RunRecord, ScenarioVerdict } from "./lib/rules-split-ab/compare.ts";
import { AuthError, makeClaudeExecutor } from "./lib/rules-split-ab/exec.ts";
import { runExperiment } from "./lib/rules-split-ab/orchestrate.ts";
import { renderReport } from "./lib/rules-split-ab/report.ts";
import { SCENARIOS } from "./lib/rules-split-ab/scenarios.ts";
import { buildClaudeArgs } from "./lib/rules-split-ab/scratch.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const RULES_DIR = "artifacts/core/rules";
const CAP = 12;
const PER_RUN = 0.6;

function usage(msg: string): never {
  process.stderr.write(`rules-split-ab: ${msg}\n`);
  process.exit(2);
}

function main(): void {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        "dry-run": { type: "boolean" },
        "arm-a-ref": { type: "string" },
        "arm-a-rule": { type: "string", multiple: true },
        "arm-b-rule": { type: "string", multiple: true },
        "worker-settings": { type: "string" },
        scenarios: { type: "string" },
        runs: { type: "string" },
        model: { type: "string" },
        out: { type: "string" },
        resume: { type: "string" },
        "approved-cap": { type: "string" },
        "keep-scratch": { type: "boolean" },
      },
      strict: true,
    }));
  } catch (e) {
    usage((e as Error).message);
  }

  const model = values.model ?? "claude-sonnet-5-5";
  const runs = Number(values.runs ?? "2");
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) usage("--runs must be an integer from 1 to 5");
  const ids = values.scenarios ? values.scenarios.split(",").map(Number) : SCENARIOS.map((s) => s.id);
  const scenarios = ids.map((id) => SCENARIOS.find((s) => s.id === id) ?? usage(`unknown scenario ${id}`));
  const cap = values["approved-cap"] !== undefined ? Number(values["approved-cap"]) : CAP;
  if (!Number.isFinite(cap) || cap <= 0) usage("--approved-cap must be a positive number");

  const aRef = values["arm-a-ref"] ?? "origin/main";
  const explicitA = values["arm-a-rule"];
  const armB = values["arm-b-rule"] ?? [path.join(repo, RULES_DIR, "60-tools.md"), path.join(repo, RULES_DIR, "60-memory.md")];
  const workerSettings = values["worker-settings"] ?? path.join(repo, "artifacts/core/claude-profiles/worker.settings.json");
  for (const f of [...(explicitA ?? []), ...armB]) if (!fs.existsSync(f)) usage(`rule file not found: ${f}`);

  if (values["dry-run"]) {
    dryRun({ scenarios, model, runs, cap, aRef, explicitA, armB, workerSettings });
    return;
  }

  const ci = refuseInCi(process.env);
  if (ci) {
    process.stderr.write(`rules-split-ab: refused: CI is set; this runner makes paid model calls and never runs in CI\n`);
    process.exit(3);
  }
  if (!fs.existsSync(workerSettings)) usage(`worker settings not found: ${workerSettings}`);

  const outDir = path.resolve(values.resume ?? values.out ?? path.join(os.tmpdir(), `rules-split-ab-${Date.now()}`));
  fs.mkdirSync(outDir, { recursive: true });
  let armA = explicitA;
  if (!armA) {
    const dir = path.join(outDir, "armA");
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync("git", ["show", `${aRef}:${RULES_DIR}/60-tools.md`], { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) usage(`git show ${aRef}:${RULES_DIR}/60-tools.md failed: ${r.stderr.trim()}`);
    fs.writeFileSync(path.join(dir, "60-tools.md"), r.stdout);
    armA = [path.join(dir, "60-tools.md")];
  }

  let prior: RunRecord[] = [];
  const ledgerFile = path.join(outDir, "ledger.json");
  if (values.resume && fs.existsSync(ledgerFile)) prior = (JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as { records: RunRecord[] }).records;

  const skillDir = path.join(repo, "artifacts/library/skills/harness-report");
  const execute = makeClaudeExecutor({
    armRules: { A: armA, B: armB },
    model,
    workerSettings,
    outDir,
    skillDirs: [skillDir],
    keepScratch: values["keep-scratch"],
  });

  const persist = (records: RunRecord[], spent: number, verdicts: Record<number, ScenarioVerdict>, stopped: { reason: string } | null): void => {
    fs.writeFileSync(ledgerFile, JSON.stringify({ records, spent, cap, stopped, verdicts }, null, 2));
    fs.writeFileSync(path.join(outDir, "report.md"), renderReport({ records, verdicts, spent, cap, stopped }));
  };

  runExperiment({ scenarios, execute, runs, cap, perRunCap: PER_RUN, prior })
    .then((r) => {
      persist(r.records, r.ledger.spent, r.verdicts, r.stopped);
      process.stdout.write(`report: ${path.join(outDir, "report.md")}\nspent: ${r.ledger.spent.toFixed(2)} USD of ${cap}\n`);
      const vs = Object.values(r.verdicts).map((v) => v.verdict);
      if (r.stopped) {
        process.stderr.write(`${r.stopped.reason}\nresume: node scripts/rules-split-ab.ts --resume ${outDir} --approved-cap <usd>\n`);
        process.exit(4);
      }
      process.exit(vs.includes("regression") ? 1 : vs.includes("blocked") ? 6 : 0);
    })
    .catch((e: unknown) => {
      process.stderr.write(`rules-split-ab: ${(e as Error).message}\n`);
      process.exit(e instanceof AuthError ? 5 : 1);
    });
}

function dryRun(p: {
  scenarios: typeof SCENARIOS;
  model: string;
  runs: number;
  cap: number;
  aRef: string;
  explicitA: string[] | undefined;
  armB: string[];
  workerSettings: string;
}): void {
  const out: string[] = [];
  out.push(`rules-split-ab dry run: cap ${p.cap} USD, per-run --max-budget-usd ${PER_RUN}, model ${p.model}, ${p.runs} runs per arm, no model call`);
  out.push(`arm A rules: ${p.explicitA ? p.explicitA.join(", ") : `git show ${p.aRef}:${RULES_DIR}/60-tools.md`}`);
  out.push(`arm B rules: ${p.armB.join(", ")}`);
  const n = p.scenarios.length * p.runs * 2;
  out.push(`worst case: ${n} runs x ${PER_RUN} = ${(n * PER_RUN).toFixed(1)} USD before extensions; the guard stops the runner at the cap`);
  for (const s of p.scenarios) {
    for (const arm of ["A", "B"] as const) {
      const scratch = { root: "<scratch>", home: "<scratch>/home", proj: "<scratch>/proj", bin: "<scratch>/bin", mcpJson: "<scratch>/mcp.json", callLog: "<scratch>/calls.jsonl", ghLog: "<scratch>/gh.log" };
      const args = buildClaudeArgs({ scratch, scenario: s, model: p.model, maxBudgetUsd: PER_RUN, workerSettings: p.workerSettings });
      out.push(`scenario ${s.id} arm ${arm} (${s.role}): HOME=<scratch>/home claude ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    }
  }
  process.stdout.write(out.join("\n") + "\n");
}

main();
