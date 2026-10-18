// reserve-spec-id-fixture.ts — two-remote scratch fixture and tool runners for the
// reserve-spec-id-*.test.ts files (replaces the fixture half of scripts/tests/test-reserve-spec-id.sh).
//
// Every bare remote, work clone, HOME, stub `gh` and hook lives under ONE fs.mkdtempSync root. The
// real origin and the real refs/spec-ids/* are never contacted: the work clone is built with
// `git init`, and assertRemotesUnderScratch runs before every tool call.
//
// One harness rule that is load-bearing: namespace-separation reads use `git ls-remote <bare>
// '<pattern>'` (remoteLs), never `git for-each-ref`. The two disagree: ls-remote's `*` crosses `/`,
// so a nested refs/spec-ids/org/<ID> shows up in an upstream read, for-each-ref would hide it.
// Use serverRefs (full, unfiltered, immune to transfer.hideRefs) only for "nothing was pushed".

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertRemotesUnderScratch, FIXED_GIT_ENV, git, writeStubGh } from "./scratch-remote.ts";

export { assertRemotesUnderScratch, git };

/** The canonical empty tree: reservation objects carry only a message and no parent. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const POSIX_ONLY =
  process.platform === "win32" ? "POSIX-only: git two-remote fixture" : false;

export interface Fixture {
  readonly root: string;
  readonly bare: string;
  readonly work: string;
  readonly home: string;
  readonly bin: string;
}
export interface ToolResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface ToolOpts {
  /** Checkout holding scripts/reserve-spec-id.ts: REPO or a realpath under os.tmpdir() only. */
  repo?: string;
  env?: Record<string, string>;
}

export function makeRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "reserve-spec-id-")));
}
/** Remove a root this module created with makeRoot (never any other path). */
export function removeRoot(root: string): void {
  if (
    path.dirname(root) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(root).startsWith("reserve-spec-id-")
  )
    throw new Error(`not a makeRoot dir: ${root}`);
  fs.rmSync(root, { recursive: true, force: true });
}

function gitEnv(fx: Fixture): NodeJS.ProcessEnv {
  return { HOME: fx.home, USERPROFILE: fx.home, GIT_CONFIG_NOSYSTEM: "1" };
}
/** git in the work clone, with scratch HOME. */
export function gw(fx: Fixture, args: string[]): string {
  return git(fx.work, args, gitEnv(fx));
}

/** Build <root>/<name>/{bare.git,work}: main with the given spec paths, both remotes on bare. */
export function newFixture(root: string, name: string, specs: string[] = []): Fixture {
  const dir = path.join(root, name);
  const fx: Fixture = {
    root,
    bare: path.join(dir, "bare.git"),
    work: path.join(dir, "work"),
    home: path.join(dir, "home"),
    bin: path.join(dir, "bin"),
  };
  for (const d of [fx.bare, fx.work, fx.home, fx.bin, path.join(fx.work, ".crewrig")])
    fs.mkdirSync(d, { recursive: true });
  writeStubGh(fx.bin);
  git(fx.root, ["init", "-q", "--bare", "-b", "main", fx.bare], gitEnv(fx));
  gw(fx, ["init", "-q", "-b", "main"]);
  for (const [k, v] of [
    ["user.email", "test@example.com"],
    ["user.name", "Test"],
    ["commit.gpgsign", "false"],
  ])
    gw(fx, ["config", k, v]);
  setCarrier(fx, "refs/spec-ids/");
  for (const spec of specs) {
    fs.mkdirSync(path.dirname(path.join(fx.work, spec)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, spec), "# placeholder\n");
  }
  gw(fx, ["add", "-A"]);
  gw(fx, ["commit", "-q", "-m", "fixture"]);
  for (const remote of ["crewrig", "origin"]) gw(fx, ["remote", "add", remote, fx.bare]);
  assertRemotesUnderScratch(fx.work, fx.root);
  gw(fx, ["push", "-q", "crewrig", "main"]);
  gw(fx, ["fetch", "-q", "crewrig"]);
  gw(fx, ["fetch", "-q", "origin"]);
  return fx;
}

const carrierFile = (fx: Fixture): string => path.join(fx.work, ".crewrig", "spec-id-carrier");
export function setCarrier(fx: Fixture, value: string): void {
  fs.writeFileSync(carrierFile(fx), `# fixture carrier setting\ncarrier=${value}\n`);
}
export function writeCarrierRaw(fx: Fixture, text: string): void {
  fs.writeFileSync(carrierFile(fx), text);
}
export function dropCarrier(fx: Fixture): void {
  fs.rmSync(carrierFile(fx), { force: true });
}

/** Plant a reservation exactly as the tool would: a parentless object, message per PLAN step 1. */
export function makeReservation(fx: Fixture, ref: string, id: string, issue: number): void {
  assertRemotesUnderScratch(fx.work, fx.root);
  const obj = gw(fx, ["commit-tree", "-m", `reserve ${id} for issue #${issue}`, EMPTY_TREE]).trim();
  gw(fx, ["push", "-q", "crewrig", `${obj}:${ref}`]);
}

/** Widen the read-to-update window so two clients both see the ref absent (git 2.55: one winner). */
export function installSleepingHook(fx: Fixture, seconds: number): string {
  const hook = path.join(fx.bare, "hooks", "pre-receive");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nsleep ${seconds}\nexit 0\n`, { mode: 0o755 });
  if (!fs.existsSync(hook)) throw new Error("sleeping hook missing: the race would be vacuous");
  return hook;
}
export function removeHook(fx: Fixture): void {
  fs.rmSync(path.join(fx.bare, "hooks", "pre-receive"), { force: true });
}

/** Replace both fixture remotes by one bearing an arbitrary name. */
export function useSingleRemote(fx: Fixture, remote: string): void {
  gw(fx, ["remote", "remove", "crewrig"]);
  gw(fx, ["remote", "remove", "origin"]);
  gw(fx, ["remote", "add", remote, fx.bare]);
  assertRemotesUnderScratch(fx.work, fx.root);
  gw(fx, ["fetch", "-q", remote]);
}

/** Point both remotes at a path under the root that does not exist. */
export function useAbsentRemote(fx: Fixture): void {
  const absent = path.join(fx.root, path.basename(path.dirname(fx.bare)), "absent.git");
  for (const r of ["crewrig", "origin"]) gw(fx, ["remote", "set-url", r, absent]);
  assertRemotesUnderScratch(fx.work, fx.root);
}

/** The read the tool itself performs (see header rule). */
export function remoteLs(fx: Fixture, pattern: string): string[] {
  return git(fx.work, ["ls-remote", fx.bare, pattern], gitEnv(fx)).split("\n").filter(Boolean);
}
export function remoteCount(fx: Fixture, pattern: string): number {
  return remoteLs(fx, pattern).length;
}
/** Every ref the bare repository holds, unfiltered. */
export function serverRefs(fx: Fixture): string[] {
  return git(fx.bare, ["for-each-ref", "--format=%(refname)"], gitEnv(fx))
    .split("\n")
    .filter(Boolean);
}
export function reservationMessage(fx: Fixture, ref: string): string {
  return git(fx.bare, ["log", "-1", "--format=%s", ref], gitEnv(fx)).trim();
}

/** Throws when `repo` is neither the checkout nor a realpath under os.tmpdir(). */
function guardRepo(repo: string): string {
  const real = fs.realpathSync(repo);
  const tmp = fs.realpathSync(os.tmpdir());
  if (real !== fs.realpathSync(REPO) && !real.startsWith(tmp + path.sep))
    throw new Error(`refusing to run a tool from ${repo}`);
  return real;
}

function childEnv(fx: Fixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("CREWRIG_SPEC_ID_")) delete env[k];
  for (const k of [
    "NODE_TEST_CONTEXT",
    "CI",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "BASE_REF",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
  ])
    delete env[k];
  return {
    ...env,
    ...FIXED_GIT_ENV,
    LC_ALL: "C",
    HOME: fx.home,
    USERPROFILE: fx.home,
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: `${fx.bin}${path.delimiter}${process.env.PATH ?? ""}`,
    CREWRIG_REPO_DIR: fx.work,
    ...extra,
  };
}
function toolArgs(repo: string, args: string[]): string[] {
  return [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    path.join(repo, "scripts", "reserve-spec-id.ts"),
    ...args,
  ];
}
function noGh(fx: Fixture): void {
  if (fs.existsSync(path.join(fx.bin, "gh.log")))
    throw new Error("the tool called a forge CLI (gh)");
}

export function runTool(fx: Fixture, args: string[], opts: ToolOpts = {}): ToolResult {
  const repo = guardRepo(opts.repo ?? process.env.CREWRIG_REPO_UNDER_TEST ?? REPO);
  assertRemotesUnderScratch(fx.work, fx.root);
  const r = spawnSync(process.execPath, toolArgs(repo, args), {
    cwd: fx.work,
    env: childEnv(fx, opts.env),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1 << 24,
  });
  noGh(fx);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Same, but asynchronous so two invocations genuinely overlap (30 s per call). */
export function runToolAsync(
  fx: Fixture,
  args: string[],
  opts: ToolOpts = {},
): Promise<ToolResult> {
  const repo = guardRepo(opts.repo ?? process.env.CREWRIG_REPO_UNDER_TEST ?? REPO);
  assertRemotesUnderScratch(fx.work, fx.root);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, toolArgs(repo, args), {
      cwd: fx.work,
      env: childEnv(fx, opts.env),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      try {
        noGh(fx);
        resolve({ status, stdout, stderr });
      } catch (e) {
        reject(e);
      }
    });
  });
}
