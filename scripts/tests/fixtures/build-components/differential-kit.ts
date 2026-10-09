// differential-kit.ts — the harness of the shell-versus-TypeScript differential suites (spec
// 0250 R13, R33; plan step 22). Linux gate (or `CREWRIG_SHELL_PARITY=1`): spawns `bash` and
// `yq` through the UNCHANGED `scripts/build-components.sh`, retires in PR D with that script.
//
// A pair is two identical scratch roots, A for the shell and B for the entry, each with its own
// `TMPDIR`. An `Outcome` holds the exit status, both streams, the produced tree (path, mode and
// content hash of every entry, from `snapshot`) and what was left under the run's `TMPDIR`; the
// scratch roots, temporary directories, staging suffixes and merge-root pids are normalised so
// a remaining difference is a behavioural one. The shell runs under `LC_ALL=C` (the shell's
// `sort` is locale-collated and the twin sorts by code unit: R33(l), neutralised here).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO } from "./entry-kit.ts";
import { snapshot } from "./skill-fixture.ts";

export { REPO };

const SHELL = path.join(REPO, "scripts", "build-components.sh");
const ENTRY = path.join(REPO, "scripts", "build-components.ts");

export type Put = (rel: string, content: string | Buffer, mode?: number) => void;

export interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
  tree: string[];
  /** Files left under the run's `TMPDIR`, relative, sorted. */
  tmp: string[];
}

export interface Pair {
  readonly a: string;
  readonly b: string;
  readonly tmpA: string;
  readonly tmpB: string;
}

const made: string[] = [];
after(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

export function mkdir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `bcd-${prefix}-`)));
  made.push(dir);
  return dir;
}

const putter =
  (root: string): Put =>
  (rel, content, mode) => {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (mode !== undefined) fs.chmodSync(file, mode);
  };

/** Two identical roots, each populated by `populate(put, root)`, and a `TMPDIR` for each. */
export function makePair(populate: (put: Put, root: string) => void): Pair {
  const a = mkdir("a");
  const b = mkdir("b");
  populate(putter(a), a);
  populate(putter(b), b);
  return { a, b, tmpA: mkdir("ta"), tmpB: mkdir("tb") };
}

function listTmp(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
}

function env(root: string, tmp: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    ...process.env,
    REPO_DIR: root,
    TMPDIR: tmp,
    LC_ALL: "C",
    ...extra,
  };
  return out;
}

function outcome(
  root: string,
  tmp: string,
  res: { status: number | null; stdout: string; stderr: string },
  withTree = true,
): Outcome {
  const tree = withTree ? snapshot(root) : [];
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, tree, tmp: listTmp(tmp) };
}

/** Run the unchanged shell script on `root`. */
export function runShell(
  root: string,
  tmp: string,
  args: string[],
  extra: Record<string, string> = {},
): Outcome {
  const res = spawnSync("bash", [SHELL, ...args], {
    cwd: root,
    env: env(root, tmp, extra),
    encoding: "utf8",
  });
  return outcome(root, tmp, { status: res.status, stdout: res.stdout, stderr: res.stderr });
}

/** Run the entry on `root`. */
export function runTs(
  root: string,
  tmp: string,
  args: string[],
  extra: Record<string, string> = {},
): Outcome {
  const res = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: root,
    env: env(root, tmp, extra),
    encoding: "utf8",
  });
  return outcome(root, tmp, { status: res.status, stdout: res.stdout, stderr: res.stderr });
}

/** Async twin of `runShell` / `runTs`, for the long real-tree runs that go in parallel. */
export function runAsync(
  kind: "shell" | "ts",
  root: string,
  tmp: string,
  args: string[],
  withTree = true,
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const [cmd, argv] =
      kind === "shell" ? ["bash", [SHELL, ...args]] : [process.execPath, [ENTRY, ...args]];
    const child = spawn(cmd as string, argv as string[], { cwd: root, env: env(root, tmp, {}) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (status) =>
      resolve(outcome(root, tmp, { status, stdout, stderr }, withTree)),
    );
  });
}

/** Replace the scratch roots, temporary directories, staging suffixes and merge pids by tokens. */
export function normalise(o: Outcome, roots: readonly string[], tmps: readonly string[]): Outcome {
  const fix = (text: string): string => {
    // macOS `mktemp -t` ignores TMPDIR (it uses the user's temporary directory), GNU honours it:
    // the staging directory, whatever its parent, is one token (the TMPDIR claim is the (j) row).
    let out = text.replace(/[^\s()]*crewrig-check-staging[.-][A-Za-z0-9.]+/g, "<STAGING>");
    for (const r of roots) out = out.split(r).join("<ROOT>");
    for (const t of tmps) out = out.split(t).join("<TMP>");
    return out.replace(/crewrig-mapping-\d+/g, "crewrig-mapping-<PID>");
  };
  return { ...o, stdout: fix(o.stdout), stderr: fix(o.stderr), tmp: o.tmp.map(fix) };
}

/** The shell's own progress-line filter of `test-component-tier-resolution.sh` (`report_view`). */
export const PROGRESS =
  /^(--- Tier:|Building (skill|command|agent):|=+$| +(Target|Mode):| +Community Component Builder$|Done\.$|$)/;

export function splitProgress(stdout: string): { progress: string[]; view: string[] } {
  const progress: string[] = [];
  const view: string[] = [];
  for (const line of stdout.split("\n")) (PROGRESS.test(line) ? progress : view).push(line);
  return { progress, view };
}
