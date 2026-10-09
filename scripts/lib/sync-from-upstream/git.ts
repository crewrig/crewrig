// git.ts — the one place the sync spawns git (spec 0253 R19, R20). The shell script piped
// git output through grep, sed and sort; the port reads the output as text and does that in
// process. Output is decoded as UTF-8 and split on "\n" by the callers, which is what the
// shell's `while read` loops did with the same bytes (`git ls-tree` C-quotes control
// characters but prints a space verbatim).

import { spawnSync } from "node:child_process";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitOptions {
  /** Working directory; the process cwd when absent (the shell's no-`-C` calls). */
  readonly cwd?: string;
}

/** Run git, capturing both streams; never throws. A spawn failure reports status 127. */
export function git(args: readonly string[], options: GitOptions = {}): GitResult {
  const result = spawnSync("git", [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.error !== undefined || result.status === null) {
    return { status: 127, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** `git -C <repoDir> ...`: the shell's `git -C "$REPO_DIR"` calls. */
export function gitIn(repoDir: string, args: readonly string[]): GitResult {
  return git(["-C", repoDir, ...args]);
}

/** Run git with this process's stdout and stderr (the shell's unredirected calls); returns the status. */
export function gitInherit(args: readonly string[], options: GitOptions = {}): number {
  const result = spawnSync("git", [...args], { cwd: options.cwd, stdio: "inherit" });
  return result.error !== undefined || result.status === null ? 127 : result.status;
}

/** The lines of a captured output: split on "\n", empty lines dropped (`[ -n "$x" ] || continue`). */
export function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}
