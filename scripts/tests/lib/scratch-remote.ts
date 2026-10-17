// scratch-remote.ts — scratch bare remote, scratch HOME, runtime-generated stub `gh`, the
// remote-URL-under-scratch guard (spec 0262 req 22) and the real-HOME leak check (req 28).
// POSIX-oriented: the stub `gh` is a shell script generated at runtime (no tracked `#!` file).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fixed identity and dates, so parentless commits hash identically on both sides. */
export const FIXED_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Differential",
  GIT_AUTHOR_EMAIL: "differential@example.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Differential",
  GIT_COMMITTER_EMAIL: "differential@example.invalid",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const full: NodeJS.ProcessEnv = {
    ...process.env,
    ...FIXED_GIT_ENV,
    GIT_CONFIG_NOSYSTEM: "1",
    ...env,
  };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete full[key];
  const res = spawnSync("git", args, { cwd, env: full, encoding: "utf8", maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

export interface ScratchRemote {
  /** Scratch root (everything below it is disposable). */
  readonly root: string;
  /** Bare remote repository. */
  readonly bare: string;
  /** Scratch HOME, empty except for what a test writes. */
  readonly home: string;
  /** Directory for stub executables (put it first on PATH). */
  readonly bin: string;
}

/** Create a scratch bare remote seeded with one parentless commit, plus a scratch HOME and bin. */
export function createScratchRemote(parent: string, name = "scratch"): ScratchRemote {
  const root = path.join(parent, name);
  const bare = path.join(root, "remote.git");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  for (const dir of [bare, home, bin]) fs.mkdirSync(dir, { recursive: true });
  git(root, ["init", "--bare", "--quiet", "-b", "main", bare]);
  const seed = path.join(root, "seed");
  fs.mkdirSync(seed);
  git(seed, ["init", "--quiet", "-b", "main"]);
  fs.writeFileSync(path.join(seed, "README"), "seed\n");
  git(seed, ["add", "README"]);
  git(seed, ["commit", "--quiet", "-m", "seed"]);
  git(seed, ["push", "--quiet", bare, "main"]);
  fs.rmSync(seed, { recursive: true, force: true });
  return { root, bare, home, bin };
}

/** `git for-each-ref` of a repository: the ref state left behind, hash-comparable. */
export function refsOf(repo: string): string {
  return git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"]);
}

/**
 * Write a stub `gh` into `bin`. It appends its argv (one line per call) to `<bin>/gh.log`, prints
 * `stdout` and exits with `status`. The file is generated here, never tracked.
 */
export function writeStubGh(bin: string, opts: { stdout?: string; status?: number } = {}): string {
  const file = path.join(bin, "gh");
  const out = (opts.stdout ?? "").replaceAll("'", "'\\''");
  const body = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$(dirname "$0")/gh.log"\nprintf '%s' '${out}'\nexit ${opts.status ?? 0}\n`;
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

/** Req 22: throw when any configured remote URL of `repo` is not under `scratchRoot`. */
export function assertRemotesUnderScratch(repo: string, scratchRoot: string): void {
  const root = fs.realpathSync(scratchRoot);
  const urls = git(repo, ["remote", "-v"], { GIT_CONFIG_GLOBAL: "/dev/null" });
  for (const line of urls.split("\n").filter(Boolean)) {
    const url = (line.split("\t")[1] ?? "").replace(/ \((fetch|push)\)$/, "");
    const resolved = url.startsWith("file://") ? url.slice(7) : url;
    const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    if (!real.startsWith(root + path.sep) && real !== root)
      throw new Error(`remote URL escapes the scratch directory: ${url}`);
  }
}

// Req 28: the real home is only ever listed, never written. Volatile Claude Code state is skipped.
const HOME_ROOTS = [".gemini/extensions", ".claude", ".copilot"];
const VOLATILE = new Set([
  "projects",
  "sessions",
  "shell-snapshots",
  "todos",
  "statsig",
  "ide",
  "file-history",
  "debug",
  "history.jsonl",
  "plugins",
  "cache",
  "telemetry",
  "backups",
  "tasks",
  "session-env",
  "logs",
  "paste-cache",
  "image-cache",
  "usage-data",
  "mcp-needs-auth-cache.json",
  "settings.local.json",
]);

function listInto(dir: string, out: Set<string>, top: boolean): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (top && VOLATILE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    out.add(full);
    if (e.isDirectory()) listInto(full, out, false);
  }
}

/** Listing of the REAL home's agent directories (account home, never `process.env.HOME`). */
export function listRealHome(home = os.userInfo().homedir): Set<string> {
  const out = new Set<string>();
  for (const rel of HOME_ROOTS) listInto(path.join(home, rel), out, rel === ".claude");
  return out;
}

/** Throw when `after` holds files absent from `before`. */
export function assertNoHomeLeak(before: ReadonlySet<string>, after = listRealHome()): void {
  const added = [...after].filter((f) => !before.has(f)).sort();
  if (added.length > 0) throw new Error(`real HOME gained files:\n${added.join("\n")}`);
}
