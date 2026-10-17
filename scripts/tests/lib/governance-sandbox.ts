// governance-sandbox.ts — shared sandbox helpers of the governance-check replacement
// suites (spec 0265, row J2, P4). Replaces the per-suite `mktemp -d` + `trap` idiom.
//
// API:
//   REPO                          the checkout this helper lives in
//   makeSandbox(prefix?)          a fresh mkdtemp directory (physical path), removed by an
//                                 `after` hook registered on import
//   runEntry(entry, options?)     `node <entry> <args>` as a child; CI and NODE_TEST_CONTEXT
//                                 deleted, LC_ALL=C, GIT_CONFIG_NOSYSTEM=1
//   copyTracked(dest, paths)      copy the git-TRACKED files under the given repo-relative
//                                 paths (files or directories) into `dest`, same layout
//   stageNodeModules(dest)        REAL copy of the production closure of node_modules, the
//                                 root package.json and an empty `.git/` (loader refuses links)
// Nothing here deletes a path it did not create with mkdtemp.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { productionClosure, REPO } from "./build-fixture-tree.ts";

export { REPO };

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunEntryOptions {
  /** Working directory; default: the repository. */
  readonly cwd?: string;
  /** Extra environment; an `undefined` value removes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Arguments after the entry. */
  readonly args?: readonly string[];
}

const live = new Set<string>();
after(() => {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  live.clear();
});

/** A fresh temporary directory (physical path), removed when the importing test file ends. */
export function makeSandbox(prefix = "governance-"): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  live.add(dir);
  return dir;
}

/** The hermetic child environment: no CI / test-runner leakage, C locale, no system git config. */
export function childEnv(
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CI;
  delete env.NODE_TEST_CONTEXT;
  env.LC_ALL = "C";
  env.GIT_CONFIG_NOSYSTEM = "1";
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

/** Run the TypeScript entry `entry` (absolute path) with the current Node.js. */
export function runEntry(entry: string, options: RunEntryOptions = {}): RunResult {
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", entry, ...(options.args ?? [])],
    { cwd: options.cwd ?? REPO, env: childEnv(options.env), encoding: "utf8" },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Copy the git-tracked files under `paths` (repo-relative files or directories) into `dest`. */
export function copyTracked(dest: string, paths: readonly string[]): void {
  const listed = spawnSync("git", ["ls-files", "-z", "--", ...paths], {
    cwd: REPO,
    env: childEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  for (const rel of listed.stdout.split("\0").filter((p) => p !== "")) {
    const from = path.join(REPO, rel);
    if (!fs.lstatSync(from, { throwIfNoEntry: false })?.isFile()) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/** `.git/`, the root `package.json` and a REAL copy of the production closure into `dest`. */
export function stageNodeModules(dest: string): void {
  fs.mkdirSync(path.join(dest, ".git"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "package.json"), path.join(dest, "package.json"));
  fs.mkdirSync(path.join(dest, "node_modules"), { recursive: true });
  for (const name of productionClosure()) {
    const from = path.join(REPO, "node_modules", name);
    if (!fs.existsSync(from)) throw new Error(`${from} is missing: run the setup dependency step`);
    fs.cpSync(from, path.join(dest, "node_modules", name), { recursive: true, dereference: true });
  }
}
