// governance-core-paths-fixtures.ts — fixtures of the core-paths replacement suites
// (spec 0265, row J2, P4): git repositories under mkdtemp, a manifest writer, the five
// TypeScript stub builders and a runner of scripts/check-core-paths.ts.
//
// API:
//   initGitRepo(dir)                     `git init` with a local identity, no signing
//   makeInitialCommit(repo, files)       write `files` (rel -> content) and commit them
//   writeManifest(repo, content)         `.crewrig/core-paths.txt`
//   STUB_NONE / STUB_NEWCLI / STUB_UNCLASSIFIABLE / STUB_NESTED_CALL / STUB_INDENTED_COMMENT
//                                        scripts/build-components.ts stand-ins
//   runCorePaths(repo)                   the check against `repo`, hermetic git environment
//   scenario(stub, manifest, extra?)     a committed repo (stub builder + `real.txt` + extra)
//                                        and the result of the check on it
// Every path written is under a `makeSandbox()` directory.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeSandbox, REPO, runEntry } from "./governance-sandbox.ts";
import type { RunResult } from "./governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-core-paths.ts");

function git(repo: string, args: readonly string[]): void {
  const res = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv(repo) });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

/** An empty global git config inside the sandbox: no host configuration leaks in. */
function gitEnv(repo: string): Record<string, string> {
  const empty = path.join(path.dirname(repo), "empty-gitconfig");
  if (!fs.existsSync(empty)) fs.writeFileSync(empty, "");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.GIT_CONFIG_GLOBAL = empty;
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
}

export function initGitRepo(dir: string): void {
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
}

export function makeInitialCommit(repo: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(repo, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    git(repo, ["add", rel]);
  }
  git(repo, ["commit", "-q", "-m", "initial"]);
}

export function writeManifest(repo: string, content: string): void {
  fs.mkdirSync(path.join(repo, ".crewrig"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".crewrig", "core-paths.txt"), content);
}

/** `--list-output-dirs` prints `dirs` and exits `code` (stderr line `message` when given). */
function listStub(dirs: readonly string[], body = "", code = 0, message?: string): string {
  const lines = dirs.map((d) => `  console.log(${JSON.stringify(d)});`);
  if (message !== undefined) lines.push(`  console.error(${JSON.stringify(message)});`);
  lines.push(`  process.exit(${code});`);
  return `if (process.argv[2] === "--list-output-dirs") {\n${lines.join("\n")}\n}\n${body}`;
}

export const STUB_NONE = listStub([], 'console.log("stub");\n');
export const STUB_NEWCLI = listStub([".newcli/skills"]);
export const STUB_UNCLASSIFIABLE = listStub([], "", 2, "Error: simulated failure");
export const STUB_NESTED_CALL = listStub(
  [".newcli/skills"],
  'for (const name of ["demo"]) {\n  checkOrWrite(`.newcli/skills/${name}/SKILL.md`);\n}\n',
);
export const STUB_INDENTED_COMMENT = listStub(
  [".newcli/skills"],
  '// checkOrWrite is a helper\nfor (const name of ["demo"]) {\n  // checkOrWrite(x)\n}\n',
);

export function runCorePaths(repo: string): RunResult {
  return runEntry(ENTRY, {
    env: {
      CREWRIG_REPO_DIR: repo,
      GIT_CONFIG_GLOBAL: path.join(path.dirname(repo), "empty-gitconfig"),
    },
  });
}

/** A committed repo holding `real.txt`, the stub builder and `extra`, plus the manifest. */
export function newRepo(
  stub: string,
  manifest: string,
  extra: Record<string, string> = {},
): string {
  const repo = fs.mkdtempSync(path.join(makeSandbox("core-paths-"), "repo-"));
  initGitRepo(repo);
  makeInitialCommit(repo, {
    "real.txt": "tracked content",
    ...extra,
    "scripts/build-components.ts": stub,
  });
  writeManifest(repo, manifest);
  return repo;
}

export function scenario(
  stub: string,
  manifest: string,
  extra: Record<string, string> = {},
): RunResult {
  return runCorePaths(newRepo(stub, manifest, extra));
}
