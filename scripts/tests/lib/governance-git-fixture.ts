// governance-git-fixture.ts — hermetic throwaway git repositories for the governance-check
// replacement suites (spec 0265, row J2, P5). Replaces the Bash `new_repo` / `git init` idiom.
//
// API:
//   gitEnv(extra?)                  child env: CI, NODE_TEST_CONTEXT and BASE_REF deleted, LC_ALL=C,
//                                   GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL and HOME inside a
//                                   mkdtemp directory, fixed author and committer identity
//   git(dir, args)                  run git in `dir` with gitEnv(); throws on a non-zero status
//   initRepo(dir, branch?)          `git init -q` then `symbolic-ref HEAD refs/heads/<branch>`
//                                   (valid on every git version: no `-b`, no `branch -m`)
//   newRepo(branch?, prefix?)       makeSandbox + initRepo; returns the repository path
//   writeRel(dir, rel, content)     write a file (parents created) under `dir`
//   commitAll(dir, message)         `git add -A` then `git commit -q -m`
//   addSelfRemote(dir, name?)       `git remote add <name> <dir>` then `git fetch <name>`
//   runIn(entry, cwd, extraEnv?, args?)  runEntry with gitEnv(); an `undefined` env value removes a key
// Nothing here deletes a path it did not create with mkdtemp (cleanup is makeSandbox's).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv, makeSandbox, runEntry } from "./governance-sandbox.ts";
import type { RunResult } from "./governance-sandbox.ts";

let home: string | undefined;

/** The hermetic child environment of every git-backed fixture. */
export function gitEnv(
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  home ??= makeSandbox("governance-home-");
  return childEnv({
    BASE_REF: undefined,
    HOME: home,
    GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    ...extra,
  });
}

/** Run git in `dir`; returns trimmed stdout, throws on failure. */
export function git(dir: string, args: readonly string[]): string {
  const res = spawnSync("git", [...args], { cwd: dir, env: gitEnv(), encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

export function initRepo(dir: string, branch = "main"): void {
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  git(dir, ["config", "commit.gpgsign", "false"]);
}

export function newRepo(branch = "main", prefix = "governance-repo-"): string {
  const dir = makeSandbox(prefix);
  initRepo(dir, branch);
  return dir;
}

export function writeRel(dir: string, rel: string, content: string): void {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
}

/** Point remote `name` at the repository itself and fetch it (call BEFORE the change under test). */
export function addSelfRemote(dir: string, name = "crewrig"): void {
  git(dir, ["remote", "add", name, dir]);
  git(dir, ["fetch", "-q", name]);
}

/** Run the TypeScript `entry` with `cwd` = `cwd` under the hermetic git environment. */
export function runIn(
  entry: string,
  cwd: string,
  extraEnv: Readonly<Record<string, string | undefined>> = {},
  args: readonly string[] = [],
): RunResult {
  // runEntry re-applies process.env under this env, so an ambient BASE_REF (the pre-push wrapper
  // exports one, spec 0279 R8e) must be cleared explicitly or it leaks back into the child.
  return runEntry(entry, { cwd, args, env: { BASE_REF: undefined, ...gitEnv(extraEnv) } });
}
