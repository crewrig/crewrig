// git.ts — the few git calls of the framework release scripts, with the GIT_* variables scrubbed
// (spec 0279 delta-02) so a hook environment never redirects them to another repository.

import { spawnSync } from "node:child_process";

import { scrubGitEnv } from "../git-env.ts";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function git(repo: string, args: readonly string[]): GitResult {
  const res = spawnSync("git", [...args], {
    cwd: repo,
    encoding: "utf8",
    env: scrubGitEnv(process.env),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Standard output of a git call that must succeed. */
export function gitText(repo: string, args: readonly string[]): string {
  const res = git(repo, args);
  if (res.status !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed: ${res.stderr.trim() || `exit ${res.status}`}`);
  }
  return res.stdout;
}
