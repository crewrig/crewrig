// check-timing-budget.ts — reusable timing-assertion harness (spec 0240 R13-R14).
//
// Usage:
//   node scripts/check-timing-budget.ts --runs <N> --budget-ms <M> [--expect-exit <code>] -- <node argv…>
//
// Runs `node <node argv…>` N times with the current Node.js binary, timing each
// run from spawn to exit with `performance.now()`, so Node.js start-up is
// included. Every run slower than the budget prints
//   timing-budget: <script> exceeded <M> ms: measured <t> ms (run <i>/<N>)
// and the harness exits 1. A run whose exit code differs from --expect-exit
// (default 0) also fails the check. On success it prints min / median / max.
//
// The budget lives in each CI job's own command line, not in a manifest, so a
// later sub-spec copies the job and states its own budget next to its script.
// Standard library only (spec 0240 R16). Exit codes: 0 pass, 1 budget or exit
// code violated, 2 usage error.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export interface Options {
  runs: number;
  budgetMs: number;
  expectExit: number;
  argv: string[];
}

export interface RunResult {
  ms: number;
  status: number | null;
}

/** Spawns one run and returns its exit status; injectable for tests. */
export type Runner = (argv: readonly string[]) => number | null;
/** Returns a monotonic timestamp in milliseconds; injectable for tests. */
export type Clock = () => number;

export class UsageError extends Error {}

function positiveInt(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 0) {
    throw new UsageError(`${flag} needs a non-negative integer, got '${raw ?? ""}'`);
  }
  return value;
}

/** Parse the command line (without `node` and the script path). */
export function parseArgs(args: readonly string[]): Options {
  const sep = args.indexOf("--");
  if (sep === -1 || sep === args.length - 1) {
    throw new UsageError("missing '-- <node argv…>' naming the script to time");
  }
  const flags = args.slice(0, sep);
  let runs: number | undefined;
  let budgetMs: number | undefined;
  let expectExit = 0;
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (flag === "--runs") runs = positiveInt(flag, value);
    else if (flag === "--budget-ms") budgetMs = positiveInt(flag, value);
    else if (flag === "--expect-exit") expectExit = positiveInt(flag, value);
    else throw new UsageError(`unknown option '${flag ?? ""}'`);
  }
  if (runs === undefined || runs < 1) throw new UsageError("--runs <N> (N >= 1) is required");
  if (budgetMs === undefined) throw new UsageError("--budget-ms <M> is required");
  return { runs, budgetMs, expectExit, argv: args.slice(sep + 1) };
}

/** The default runner: the current Node.js binary, output discarded. */
export const spawnNode: Runner = (argv) =>
  spawnSync(process.execPath, argv, { stdio: "ignore" }).status;

/** Time `opts.runs` runs of `opts.argv`. */
export function measure(
  opts: Options,
  run: Runner = spawnNode,
  clock: Clock = performance.now.bind(performance),
): RunResult[] {
  const results: RunResult[] = [];
  for (let i = 0; i < opts.runs; i++) {
    const start = clock();
    const status = run(opts.argv);
    results.push({ ms: clock() - start, status });
  }
  return results;
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Turn measured runs into report lines and a verdict. */
export function evaluate(
  opts: Options,
  results: readonly RunResult[],
): { ok: boolean; lines: string[] } {
  const script = opts.argv.find((a) => !a.startsWith("-")) ?? opts.argv.join(" ");
  const lines: string[] = [];
  results.forEach((r, i) => {
    const tag = `(run ${i + 1}/${results.length})`;
    if (r.status !== opts.expectExit) {
      lines.push(
        `timing-budget: ${script} exited ${String(r.status)}, expected ${opts.expectExit} ${tag}`,
      );
    }
    if (r.ms > opts.budgetMs) {
      lines.push(
        `timing-budget: ${script} exceeded ${opts.budgetMs} ms: measured ${r.ms.toFixed(1)} ms ${tag}`,
      );
    }
  });
  if (lines.length > 0) return { ok: false, lines };
  const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
  const fmt = (n: number): string => n.toFixed(1);
  lines.push(
    `timing-budget: ${script} within ${opts.budgetMs} ms over ${results.length} runs: ` +
      `min ${fmt(sorted[0] ?? 0)} ms, median ${fmt(median(sorted))} ms, max ${fmt(sorted.at(-1) ?? 0)} ms`,
  );
  return { ok: true, lines };
}

/** Entry point: returns the process exit code. */
export function main(args: readonly string[], run?: Runner, clock?: Clock): number {
  let opts: Options;
  try {
    opts = parseArgs(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(
      `timing-budget: ${error.message}\nusage: check-timing-budget.ts --runs <N> --budget-ms <M> [--expect-exit <code>] -- <node argv…>\n`,
    );
    return 2;
  }
  const verdict = evaluate(opts, measure(opts, run, clock));
  const out = verdict.ok ? process.stdout : process.stderr;
  for (const line of verdict.lines) out.write(`${line}\n`);
  return verdict.ok ? 0 : 1;
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(fs.realpathSync(invokedPath)).href
) {
  process.exitCode = main(process.argv.slice(2));
}
