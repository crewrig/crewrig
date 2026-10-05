// windows-invocation.ts — how each CLI runs a hook command on Windows (rows 37,
// 37e and 37f of docs/cli-matrix.md), for the `windows-worktree-git-guard` job
// (spec 0248 R34(b)). Copied from usage-capture-windows.test.ts rather than
// extracted from it: that suite is left alone by this ticket and the dedupe
// belongs to J1a.

import { spawnSync } from "node:child_process";

import type { Cli, Interpreter } from "../../lib/hook-command.ts";
import type { Result } from "./worktree-fixtures.ts";

/** The Git Bash path row 37 records for Claude Code. */
export const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

export interface Invocation {
  readonly file: string;
  readonly args: string[];
  readonly verbatim: boolean;
}

/**
 * How Antigravity CLI runs a command on both its Windows surfaces (rows 37e and
 * 37f): `cmd /c "<command>"`, the whole command in one pair of quotes and each
 * inner `"` escaped as `\"`, passed verbatim so Node.js adds no quoting of its own.
 */
export function agyInvocation(command: string): Invocation {
  return { file: "cmd.exe", args: ["/c", `"${command.replaceAll('"', '\\"')}"`], verbatim: true };
}

/** The invocation rows 37 and 37e/37f record for each Windows interpreter. */
export function invocation(interpreter: Interpreter, command: string): Invocation {
  switch (interpreter) {
    case "git-bash":
      return { file: GIT_BASH, args: ["-c", command], verbatim: false };
    case "powershell-5.1":
      return {
        file: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", command],
        verbatim: false,
      };
    case "cmd.exe":
      return agyInvocation(command);
  }
}

/** The interpreter each CLI's hooks surface runs through on Windows. */
export const LEGS: ReadonlyArray<{ readonly cli: Cli; readonly interpreter: Interpreter }> = [
  { cli: "claude", interpreter: "git-bash" },
  { cli: "gemini", interpreter: "powershell-5.1" },
  { cli: "copilot", interpreter: "powershell-5.1" },
  { cli: "antigravity", interpreter: "cmd.exe" },
];

export function runInvocation(
  inv: Invocation,
  options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Result {
  const res = spawnSync(inv.file, inv.args, {
    encoding: "utf8",
    input: options.input ?? "",
    cwd: options.cwd,
    env: options.env ?? process.env,
    windowsVerbatimArguments: inv.verbatim,
  });
  return { status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr };
}
