// run.ts — concurrent runner of the selected `ci:<id>` tasks (spec 0279 R9, R12, R8e, R13).
//
// Usage: imported by scripts/ci-pre-push.ts.
// Exit: runTasks resolves a RunReport; `failed` non-empty means the entry exits 1.
// Finding format: one status line per task (`ok|FAILED <id> <seconds>s`), buffered output of a
//   failed task, a timing summary, and a warning (never a failure) above the 60 s budget.
//
// Tasks run as `task ci:<id>` through an argument array, never a shell.

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const BUDGET_SECONDS = 60;
export const DRAFT_TASK = "lint-specs";

export interface TaskResult {
  id: string;
  code: number;
  seconds: number;
  output: string;
}

export interface RunReport {
  results: TaskResult[];
  failed: string[];
  wallSeconds: number;
}

export interface RunOptions {
  cwd: string;
  /** Exported as BASE_REF to every task; omit when the target ref does not resolve locally. */
  baseRef?: string | null;
  env?: NodeJS.ProcessEnv;
  poolSize?: number;
  log?: (line: string) => void;
}

/** Environment of one task: BASE_REF for all, CREWRIG_PR_DRAFT=true for `lint-specs` only. */
export function taskEnv(id: string, opts: RunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
  delete env["CREWRIG_PR_DRAFT"];
  // Task derives REPO_DIR from $PWD: a stale PWD (a push started from a subdirectory) would aim the
  // task at the wrong tree.
  env["PWD"] = opts.cwd;
  // CI installs markdownlint-cli globally; a development checkout has it only in node_modules/.bin
  // after `task lint-bootstrap`, so that directory goes first on PATH (the key is `Path` on Windows).
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const bin = path.join(opts.cwd, "node_modules", ".bin");
  env[pathKey] = [bin, env[pathKey] ?? process.env[pathKey]]
    .filter((v) => v !== undefined && v !== "")
    .join(path.delimiter);
  if (opts.baseRef !== undefined && opts.baseRef !== null) env["BASE_REF"] = opts.baseRef;
  if (id === DRAFT_TASK) env["CREWRIG_PR_DRAFT"] = "true";
  return env;
}

function runOne(id: string, opts: RunOptions): Promise<TaskResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({ id, code, seconds: (Date.now() - started) / 1000, output });
    };
    const child = spawn("task", [`ci:${id}`], {
      cwd: opts.cwd,
      env: taskEnv(id, opts),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (err) => {
      output += `could not start 'task ci:${id}': ${err.message}\n`;
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

/** Run `ids` with a pool of min(4, availableParallelism); output is buffered, shown on failure. */
export async function runTasks(ids: readonly string[], opts: RunOptions): Promise<RunReport> {
  const log = opts.log ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const size = Math.max(1, opts.poolSize ?? Math.min(4, os.availableParallelism()));
  const started = Date.now();
  const results: TaskResult[] = [];
  const queue = [...ids];
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const r = await runOne(id, opts);
      results.push(r);
      log(`ci-pre-push: ${r.code === 0 ? "ok    " : "FAILED"} ${id} ${r.seconds.toFixed(1)}s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, worker));
  const failed = results.filter((r) => r.code !== 0);
  for (const r of failed) {
    log(`ci-pre-push: ---- output of ci:${r.id} (exit ${r.code}) ----`);
    log(r.output.replace(/\n$/, ""));
  }
  const wallSeconds = (Date.now() - started) / 1000;
  const sum = results.reduce((a, r) => a + r.seconds, 0);
  log(
    `ci-pre-push: ${results.length} task(s), ${failed.length} failed, wall-clock ${wallSeconds.toFixed(1)}s (sum ${sum.toFixed(1)}s)`,
  );
  if (wallSeconds > BUDGET_SECONDS)
    log(
      `ci-pre-push: WARNING wall-clock ${wallSeconds.toFixed(0)}s exceeds the ${BUDGET_SECONDS}s budget`,
    );
  return { results, failed: failed.map((r) => r.id), wallSeconds };
}
