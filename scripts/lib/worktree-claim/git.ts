// git.ts — the only subprocess the claim code spawns (spec 0248 R24).
//
// An argument vector and no shell, so no argument is ever read as syntax. A
// non-zero exit, a missing `git` and a missing working directory are all
// returned as a failed result: the caller decides, nothing here throws.

import { spawnSync } from "node:child_process";
import { defaultIsFile, resolveOnPath } from "./launch-windows.ts";

export interface GitResult {
  readonly ok: boolean;
  /** Exit status; 127 when `git` could not be started or ended by a signal. */
  readonly status: number;
  /** Standard output, decoded as UTF-8; empty when `git` did not run. */
  readonly stdout: string;
}

let resolvedGit: string | undefined | null = null;

/**
 * The `git` to spawn, resolved once. On Windows libuv searches the `cwd` option
 * before `PATH`, which would run a `git.exe` planted in a worktree root, so the
 * name is resolved through `PATH` only and the absolute path is spawned; only
 * `.exe` is accepted (a `.cmd` makes `spawnSync` fail with EINVAL). Elsewhere the
 * name is returned unchanged. `undefined` when nothing resolves.
 */
function gitCommand(): { file: string | undefined; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv =
    process.platform === "win32" ? { ...process.env, PATHEXT: ".EXE" } : process.env;
  if (resolvedGit === null) {
    resolvedGit = resolveOnPath("git", { platform: process.platform, env, isFile: defaultIsFile });
  }
  return { file: resolvedGit, env };
}

/** Run `git <args>` with `cwd` as its working directory (the `git -C` of the shell tool). */
export function runGit(args: readonly string[], cwd: string): GitResult {
  const git = gitCommand();
  if (git.file === undefined) return { ok: false, status: 127, stdout: "" };
  const result = spawnSync(git.file, [...args], {
    cwd,
    env: git.env,
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
