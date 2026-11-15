// rules-split-ab.ts — the reduced paired A/B runner of spec 0308 (issue #1990, ADR-0025 O4).
//
// MANUAL AND PAID: 8 scenarios x 2 runs x 2 arms of headless `claude -p`, under a 12 USD cap.
// It is never wired into CI, `ci:pre-push` or a hook, and refuses to run (exit 3) when CI is set.
//
//   node scripts/rules-split-ab.ts --dry-run                       # print the plan, no model call
//   node scripts/rules-split-ab.ts [--arm-a-ref origin/main] [--out DIR]
//   node scripts/rules-split-ab.ts --arm-a-rule A.md --arm-b-rule B1.md --arm-b-rule B2.md
//   node scripts/rules-split-ab.ts --resume DIR --approved-cap 15  # after a cost-guard stop
//   node scripts/rules-split-ab.ts --rescore DIR [DIR ...] --scenario 1   # offline, no model call
//   node scripts/rules-split-ab.ts --scenarios 5 --arms A --runs 6 --cap 2.4 --out FRESH_DIR
//
// Options: --arm-a-ref <ref> (arm A: only 60-tools.md, via `git show <ref>:...`), --arm-a-rule and
// --arm-b-rule <path> (repeatable; override the refs and the working tree), --worker-settings <path>
// --arms A|B|A,B (a single arm is a calibration run, no verdict), --out must be a fresh directory.
// --cap <usd> is the remaining cap of this invocation (default 12; the ledger of each invocation
// starts at zero, so pass what is left). The guard stops (exit 4) when the running cost plus the mean
// cost per run so far, seeded by 0.113 USD, would reach the cap. --approved-cap is the same flag
// under its resume name. --runs is 1 to 5, or 1 to 6 with a single arm (S5 calibration).
// (scratch-HOME mode: passed as --settings in scenario 2 only; real-HOME mode: merged into the
// per-run settings file in scenario 2), --scenarios 1,8, --runs 2, --model, --out, --keep-scratch.
//
// Auth modes (--auth-home auto|scratch|real, default auto). `scratch` overrides HOME, so the arm's
// rules are the only user rules, but the macOS keychain login is out of reach (needs
// ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN). `real` keeps HOME and isolates instead:
// --setting-sources project,local (no user settings, hooks or plugins), the arm's rules in the
// scratch project's .claude/rules (loaded as project memory), and a generated --settings file whose
// claudeMdExcludes holds <real home>/.claude/** (no personal CLAUDE.md, RTK.md or rule), merged with
// the worker profile in scenario 2. `auto` tries scratch and falls back to real on an auth failure.
// Nothing is written under the real ~/.claude by the runner.
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
import { formatRescore, rescoreDirs } from "./lib/rules-split-ab/rescore.ts";
import { SCENARIOS } from "./lib/rules-split-ab/scenarios.ts";
import { buildClaudeArgs } from "./lib/rules-split-ab/scratch.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const RULES_DIR = "artifacts/core/rules";
const CAP = 12;
const PER_RUN = 0.6;
/** Observed mean cost per run (delta-02 ADDED 6): the projection before any run is charged. */
const SEED = 0.113;

function usage(msg: string): never {
  process.stderr.write(`rules-split-ab: ${msg}\n`);
  process.exit(2);
}

function main(): void {
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
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
        "auth-home": { type: "string" },
        arms: { type: "string" },
        cap: { type: "string" },
        rescore: { type: "string", multiple: true },
        scenario: { type: "string" },
      },
      strict: true,
      allowPositionals: true,
    }));
  } catch (e) {
    usage((e as Error).message);
  }

  if (values.rescore) {
    const n = Number(values.scenario);
    if (!Number.isInteger(n) || n < 1) usage("--rescore needs --scenario <number>");
    try {
      process.stdout.write(formatRescore(rescoreDirs([...values.rescore, ...positionals], n)));
    } catch (e) {
      usage((e as Error).message);
    }
    return;
  }
  if (positionals.length > 0) usage(`unexpected argument ${positionals[0]}`);

  const authHome = values["auth-home"] ?? "auto";
  if (authHome !== "auto" && authHome !== "scratch" && authHome !== "real")
    usage("--auth-home must be auto, scratch or real");
  const armsArg = values.arms ?? "A,B";
  if (!["A", "B", "A,B", "B,A"].includes(armsArg)) usage("--arms must be A, B or A,B");
  const arms = armsArg.split(",") as Array<"A" | "B">;
  const model = values.model ?? "claude-sonnet-5-5";
  const runs = Number(values.runs ?? "2");
  const maxRuns = arms.length === 1 ? 6 : 5;
  if (!Number.isInteger(runs) || runs < 1 || runs > maxRuns)
    usage(`--runs must be an integer from 1 to ${maxRuns} (6 only with a single arm)`);
  const ids = values.scenarios
    ? values.scenarios.split(",").map(Number)
    : SCENARIOS.map((s) => s.id);
  const scenarios = ids.map(
    (id) => SCENARIOS.find((s) => s.id === id) ?? usage(`unknown scenario ${id}`),
  );
  if (values.cap !== undefined && values["approved-cap"] !== undefined)
    usage("--cap and --approved-cap are the same flag: pass one");
  const capArg = values.cap ?? values["approved-cap"];
  const cap = capArg !== undefined ? Number(capArg) : CAP;
  if (!Number.isFinite(cap) || cap <= 0) usage("--cap must be a positive number");

  const aRef = values["arm-a-ref"] ?? "origin/main";
  const explicitA = values["arm-a-rule"];
  const armB = values["arm-b-rule"] ?? [
    path.join(repo, RULES_DIR, "60-tools.md"),
    path.join(repo, RULES_DIR, "60-memory.md"),
  ];
  const workerSettings =
    values["worker-settings"] ??
    path.join(repo, "artifacts/core/claude-profiles/worker.settings.json");
  for (const f of [...(explicitA ?? []), ...armB])
    if (!fs.existsSync(f)) usage(`rule file not found: ${f}`);

  if (values["dry-run"]) {
    dryRun({ authHome, scenarios, arms, model, runs, cap, aRef, explicitA, armB, workerSettings });
    return;
  }

  const ci = refuseInCi(process.env);
  if (ci) {
    process.stderr.write(
      `rules-split-ab: refused: CI is set; this runner makes paid model calls and never runs in CI\n`,
    );
    process.exit(3);
  }
  if (!fs.existsSync(workerSettings)) usage(`worker settings not found: ${workerSettings}`);

  const outDir = path.resolve(
    values.resume ?? values.out ?? path.join(os.tmpdir(), `rules-split-ab-${Date.now()}`),
  );
  if (!values.resume && fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0)
    usage(
      `--out ${outDir} is not empty: use a fresh directory, or --resume to continue a stopped run`,
    );
  fs.mkdirSync(outDir, { recursive: true });
  let armA = explicitA;
  if (!armA) {
    const dir = path.join(outDir, "armA");
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync("git", ["show", `${aRef}:${RULES_DIR}/60-tools.md`], {
      cwd: repo,
      encoding: "utf8",
    });
    if (r.status !== 0)
      usage(`git show ${aRef}:${RULES_DIR}/60-tools.md failed: ${r.stderr.trim()}`);
    fs.writeFileSync(path.join(dir, "60-tools.md"), r.stdout);
    armA = [path.join(dir, "60-tools.md")];
  }

  let prior: RunRecord[] = [];
  const ledgerFile = path.join(outDir, "ledger.json");
  if (values.resume && fs.existsSync(ledgerFile))
    prior = (JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as { records: RunRecord[] }).records;

  const skillDir = path.join(repo, "artifacts/library/skills/harness-report");
  const execute = makeClaudeExecutor({
    armRules: { A: armA, B: armB },
    model,
    workerSettings,
    outDir,
    skillDirs: [skillDir],
    keepScratch: values["keep-scratch"],
    authHome,
  });

  const persist = (
    records: RunRecord[],
    spent: number,
    verdicts: Record<number, ScenarioVerdict>,
    stopped: { reason: string } | null,
  ): void => {
    fs.writeFileSync(
      ledgerFile,
      JSON.stringify({ records, spent, cap, stopped, verdicts }, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, "report.md"),
      renderReport({ records, verdicts, spent, cap, stopped }),
    );
  };

  runExperiment({
    scenarios,
    execute,
    runs,
    arms,
    cap,
    perRunCap: PER_RUN,
    projectionSeed: SEED,
    prior,
  })
    .then((r) => {
      persist(r.records, r.ledger.spent, r.verdicts, r.stopped);
      process.stdout.write(
        `report: ${path.join(outDir, "report.md")}\nspent: ${r.ledger.spent.toFixed(2)} USD of ${cap}\n`,
      );
      const vs = Object.values(r.verdicts).map((v) => v.verdict);
      if (r.stopped) {
        process.stderr.write(
          `${r.stopped.reason}\nresume: node scripts/rules-split-ab.ts --resume ${outDir} --approved-cap <usd>\n`,
        );
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
  authHome: "auto" | "scratch" | "real";
  scenarios: typeof SCENARIOS;
  arms: Array<"A" | "B">;
  model: string;
  runs: number;
  cap: number;
  aRef: string;
  explicitA: string[] | undefined;
  armB: string[];
  workerSettings: string;
}): void {
  const out: string[] = [];
  out.push(
    `rules-split-ab dry run: cap ${p.cap} USD, per-run --max-budget-usd ${PER_RUN}, model ${p.model}, ${p.runs} runs per arm, projection seed ${SEED} USD per run, no model call`,
  );
  out.push(
    `arm A rules: ${p.explicitA ? p.explicitA.join(", ") : `git show ${p.aRef}:${RULES_DIR}/60-tools.md`}`,
  );
  out.push(`arm B rules: ${p.armB.join(", ")}`);
  const n = p.scenarios.length * p.runs * p.arms.length;
  out.push(
    `worst case: ${n} runs x ${PER_RUN} = ${(n * PER_RUN).toFixed(1)} USD before extensions; the guard stops the runner at the cap`,
  );
  out.push(
    p.authHome === "real"
      ? "auth: real HOME kept (keychain); isolation by --setting-sources project,local, the arm rules in <scratch>/proj/.claude/rules and a per-run --settings file excluding <real home>/.claude/**"
      : p.authHome === "scratch"
        ? "auth: scratch HOME (no keychain login: needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)"
        : "auth: scratch HOME first; once its auth check fails the runner switches to the real-HOME mode (--auth-home real)",
  );
  for (const s of p.scenarios) {
    for (const arm of p.arms) {
      const real = p.authHome === "real";
      const scratch = {
        root: "<scratch>",
        home: real ? "<real home>" : "<scratch>/home",
        proj: "<scratch>/proj",
        bin: "<scratch>/bin",
        mcpJson: "<scratch>/mcp.json",
        callLog: "<scratch>/calls.jsonl",
        ghLog: "<scratch>/gh.log",
        authHome: p.authHome === "real" ? ("real" as const) : ("scratch" as const),
        settingsFile: real ? "<scratch>/run.settings.json" : null,
      };
      const args = buildClaudeArgs({
        scratch,
        scenario: s,
        model: p.model,
        maxBudgetUsd: PER_RUN,
        workerSettings: p.workerSettings,
      });
      out.push(
        `scenario ${s.id} arm ${arm} (${s.role}): ${p.authHome === "real" ? "" : "HOME=<scratch>/home "}claude ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
      );
    }
  }
  process.stdout.write(out.join("\n") + "\n");
}

main();
