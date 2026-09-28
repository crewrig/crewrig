// check-typescript.ts — TypeScript toolchain gate (spec 0238 R4-R8, R12).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-typescript.ts
//          [--step typecheck|erasable|lint|format|all]
//
// Steps (default `all`; every selected step runs and the worst exit wins, so
// one run shows every finding):
//   typecheck  `tsc -p tsconfig.json` in strict mode (R4);
//   erasable   no syntax Node's type stripping cannot erase (R5), via
//              scripts/lib/erasable-syntax.ts;
//   lint       Oxlint type-aware strict typing + non-blocking max-lines (R6, R7);
//   format     Oxfmt check mode on *.ts only (R8).
// `lint` and `format` delegate to the pr-reviewer skill's lint-typescript.ts,
// so CI and the independent reviewer pass run one implementation (R14).
// Scope: tracked *.ts outside the four built-copy trees (R12).
//
// Exit: 0 clean, 1 findings, 2 wiring fault (a tool is missing — run
// `task lint-bootstrap` — or a step could not run).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { checkErasable, formatFinding, parseTs1294 } from "./lib/erasable-syntax.ts";
import { WiringError, repoRoot, trackedTsFiles } from "./lib/ts-scope.ts";

const STEPS = ["typecheck", "erasable", "lint", "format"] as const;
type Step = (typeof STEPS)[number];
const LINTER = "artifacts/core/skills/pr-reviewer/scripts/lint-typescript.ts";

function selectedSteps(argv: string[]): Step[] {
  const i = argv.indexOf("--step");
  const value =
    i === -1 ? (argv.find((a) => a.startsWith("--step="))?.slice(7) ?? "all") : (argv[i + 1] ?? "");
  if (value === "all") return [...STEPS];
  const step = STEPS.find((s) => s === value);
  if (step === undefined)
    throw new WiringError(`unknown --step '${value}' (expected ${STEPS.join("|")}|all)`);
  return [step];
}

let tscOutput: string | undefined;

/** Run `tsc` once per invocation; its output feeds both typecheck and erasable. */
function runTsc(root: string): string {
  if (tscOutput !== undefined) return tscOutput;
  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc))
    throw new WiringError("tsc not found in node_modules/.bin (run `task lint-bootstrap`)");
  const res = spawnSync(tsc, ["-p", "tsconfig.json", "--pretty", "false"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined) throw new WiringError(`tsc could not run: ${res.error.message}`);
  tscOutput = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return tscOutput;
}

function typecheck(root: string): number {
  let status = 0;
  for (const line of runTsc(root).split("\n")) {
    if (line.trim() === "" || / error TS1294:/.test(line)) continue;
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (m !== null) {
      const [, file = "", ln = "", code = "", message = ""] = m;
      console.log(`typecheck: ${code}: ${file}:${ln}: ${message}`);
    } else {
      console.log(`typecheck: ${line.trim()}`);
    }
    status = 1;
  }
  return status;
}

function erasable(root: string, files: string[]): number {
  const findings = checkErasable(root, files, parseTs1294(runTsc(root)));
  for (const f of findings) console.log(formatFinding(f));
  return findings.length > 0 ? 1 : 0;
}

function delegate(root: string, mode: "lint" | "format", files: string[]): number {
  const res = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(root, LINTER),
      "--require-tools",
      "--mode",
      mode,
      ...files,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(res.stdout ?? "");
  process.stderr.write(res.stderr ?? "");
  return res.status ?? 2;
}

function main(): number {
  const steps = selectedSteps(process.argv.slice(2));
  const root = repoRoot();
  const files = trackedTsFiles();
  let worst = 0;
  for (const step of steps) {
    let status: number;
    try {
      if (step === "typecheck") status = typecheck(root);
      else if (step === "erasable") status = erasable(root, files);
      else status = delegate(root, step, files);
    } catch (err) {
      console.log(
        `check-typescript: ${step}: error: ${err instanceof Error ? err.message : String(err)}`,
      );
      status = 2;
    }
    console.log(
      `check-typescript: ${step}: ${status === 0 ? "OK" : status === 1 ? "FAILED" : "ERROR"}`,
    );
    worst = Math.max(worst, status);
  }
  return worst;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`check-typescript: error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
