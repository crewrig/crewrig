// git.ts — the only subprocess the claim code spawns (spec 0248 R24).
//
// An argument vector and no shell, so no argument is ever read as syntax. A
// non-zero exit, a missing `git` and a missing working directory are all
// returned as a failed result: the caller decides, nothing here throws.

import { spawnSync } from "node:child_process";

export interface GitResult {
  readonly ok: boolean;
  /** Exit status; 127 when `git` could not be started or ended by a signal. */
  readonly status: number;
  /** Standard output, decoded as UTF-8; empty when `git` did not run. */
  readonly stdout: string;
}

/** Run `git <args>` with `cwd` as its working directory (the `git -C` of the shell tool). */
export function runGit(args: readonly string[], cwd: string): GitResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = result.error === undefined ? result.status : null;
  if (status === null) return { ok: false, status: 127, stdout: "" };
  return { ok: status === 0, status, stdout: result.stdout };
}

/** The shell's `$(…)`: standard output without its trailing line feeds. */
export function stripTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}
