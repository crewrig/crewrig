// checks.ts — deterministic checks of a run (spec 0290 R4, R12).
//
// A check is evaluated before any judge call. `path` is relative to the run's `outputs/`
// directory and never escapes it (guard on the resolved real path). `exit_code` runs a script of
// the HEAD skill directory (the measuring instrument, R19) with a minimal environment: PATH, a
// throwaway HOME, LANG and no credential variable.
//
// Usage: const r = await runCheck(check, { outputsDir, skillDir });  // { passed, evidence }
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Check } from "./schema.ts";

export interface CheckContext {
  readonly outputsDir: string;
  /** The head skill directory: `exit_code` scripts are run from here. */
  readonly skillDir: string;
  /** Wall-clock limit of an `exit_code` script, milliseconds. */
  readonly timeoutMs?: number;
}

export interface CheckResult {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence: string;
}

/** The `text` of a check's grading entry, derived from its type and arguments (R11). */
export function checkText(c: Check): string {
  switch (c.type) {
    case "exit_code":
      return `check exit_code: ${[c.script, ...c.args].join(" ")} exits with ${c.expected}`;
    case "file_exists":
      return `check file_exists: ${c.path}`;
    case "file_contains":
      return `check file_contains: ${c.path} matches /${c.pattern}/`;
    case "file_not_contains":
      return `check file_not_contains: ${c.path} does not match /${c.pattern}/`;
  }
}

/** Resolve `rel` under `base`; undefined when it escapes (including through a symlink). */
export function resolveInside(base: string, rel: string): string | undefined {
  if (path.isAbsolute(rel)) return undefined;
  const abs = path.resolve(base, rel);
  const within = (root: string, p: string) => p === root || p.startsWith(root + path.sep);
  if (!within(path.resolve(base), abs)) return undefined;
  try {
    const realBase = fs.realpathSync(base);
    const realAbs = fs.realpathSync(abs);
    if (!within(realBase, realAbs)) return undefined;
  } catch {
    // the file does not exist (yet): the lexical check above stands
  }
  return abs;
}

export async function runCheck(c: Check, ctx: CheckContext): Promise<CheckResult> {
  const text = checkText(c);
  if (c.type === "file_exists" || c.type === "file_contains" || c.type === "file_not_contains") {
    const abs = resolveInside(ctx.outputsDir, c.path);
    if (abs === undefined)
      return {
        text,
        passed: false,
        evidence: `observed: path "${c.path}" escapes the run's outputs directory`,
      };
    let st: fs.Stats | undefined;
    try {
      st = fs.statSync(abs);
    } catch {
      st = undefined;
    }
    if (st === undefined || !st.isFile())
      return {
        text,
        passed: false,
        evidence: `observed: file "${c.path}" was not produced by the run`,
      };
    if (c.type === "file_exists")
      return {
        text,
        passed: true,
        evidence: `observed: file "${c.path}" exists (${st.size} bytes)`,
      };
    const content = fs.readFileSync(abs, "utf8");
    const m = new RegExp(c.pattern).exec(content);
    // an absence expectation: the file must exist (it was produced) and the pattern must not occur
    if (c.type === "file_not_contains")
      return m === null
        ? {
            text,
            passed: true,
            evidence: `observed: file "${c.path}" does not match /${c.pattern}/`,
          }
        : {
            text,
            passed: false,
            evidence: `observed: file "${c.path}" matches /${c.pattern}/ at "${m[0].slice(0, 80)}"`,
          };
    if (m === null)
      return {
        text,
        passed: false,
        evidence: `observed: file "${c.path}" does not match /${c.pattern}/`,
      };
    return {
      text,
      passed: true,
      evidence: `observed: file "${c.path}" matches /${c.pattern}/ at "${m[0].slice(0, 80)}"`,
    };
  }
  const script = path.resolve(ctx.skillDir, c.script);
  if (!script.startsWith(path.resolve(ctx.skillDir) + path.sep) || !fs.existsSync(script))
    return {
      text,
      passed: false,
      evidence: `observed: script "${c.script}" not found in the skill directory`,
    };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-check-"));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    for (const k of ["PATH", "LANG"]) if (process.env[k] !== undefined) env[k] = process.env[k];
    const code = await new Promise<number | string>((resolve) => {
      const child = spawn(script, c.args, {
        cwd: ctx.outputsDir,
        env,
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve("timeout");
      }, ctx.timeoutMs ?? 60_000);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve(`spawn error: ${e.message}`);
      });
      child.on("close", (status, signal) => {
        clearTimeout(timer);
        resolve(status ?? `signal ${signal}`);
      });
    });
    const passed = code === c.expected;
    return {
      text,
      passed,
      evidence: `observed: exit code ${code} (expected ${c.expected})`,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
