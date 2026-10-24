// spec-id-fixture.ts — scratch fixtures and runner for the check-spec-id-reserved.ts tests.
// Replaces the fixture half of scripts/tests/test-check-spec-id-reserved.sh (spec 0265, row J2).
//
// Safety: every bare remote, work clone, HOME and stub `gh` lives under ONE mkdtemp root made by
// `createRoot`. Remote URLs are literal `<root>/<case>/bare.git` strings built here, never taken
// from env or argv, and `assertRemotesUnderScratch` runs before every push and every tool call.
// Nothing here touches the real origin, `refs/spec-ids/*`, a real HOME or the real forge CLI.
// POSIX only: the runner merges stdout and stderr with `sh` (`2>&1`), like the Bash suite did.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertInside } from "./differential-guard.ts";
import { assertRemotesUnderScratch, git, writeStubGh } from "./scratch-remote.ts";
import {
  CLEARED_VARS,
  EMPTY_TREE,
  REFERENCE_REPO,
  SKIP,
  UNSECURED_MARK,
  renderSpec,
} from "./spec-id-constants.ts";
import { scrubGitEnv } from "../../lib/git-env.ts";

export { assertRemotesUnderScratch } from "./scratch-remote.ts";

export { CLEARED_VARS, EMPTY_TREE, REFERENCE_REPO, SKIP, UNSECURED_MARK, renderSpec };

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const ENTRY = path.join(REPO, "scripts", "check-spec-id-reserved.ts");
const PREFIX = "spec-id-check-";

export type Kind = "main" | "develop" | "release";

export interface Fixture {
  readonly root: string;
  readonly dir: string;
  readonly bare: string;
  readonly work: string;
  readonly home: string;
  readonly bin: string;
}

export interface Run {
  readonly status: number | null;
  /** stdout and stderr merged in emission order (`2>&1`), as one stream. */
  readonly log: string;
}

export function createRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
}

/** Remove a root made by `createRoot` and nothing else. */
export function removeRoot(root: string): void {
  const tmp = fs.realpathSync(os.tmpdir());
  if (path.dirname(root) !== tmp || !path.basename(root).startsWith(PREFIX))
    throw new Error(`refusing to remove a path createRoot did not make: ${root}`);
  fs.rmSync(root, { recursive: true, force: true });
}

function gitEnv(fx: Fixture): NodeJS.ProcessEnv {
  return { HOME: fx.home, GIT_CONFIG_GLOBAL: path.join(fx.home, "gitconfig") };
}

function wg(fx: Fixture, args: string[]): string {
  return git(fx.work, args, gitEnv(fx));
}

/** Run git in the fixture's work clone with the scratch HOME and global config. */
export const gitIn = wg;

/** Delete a file of the work clone (containment-checked), as the Bash suite's `rm -f` did. */
export function deleteWorkFile(fx: Fixture, rel: string): void {
  const file = path.join(fx.work, rel);
  assertInside(fx.work, file);
  fs.rmSync(file, { force: true });
}

function push(fx: Fixture, args: string[]): void {
  assertRemotesUnderScratch(fx.work, fx.root);
  wg(fx, ["push", "-q", ...args]);
}

/** Child env: ambient values of the ten variables dropped, then the case's own added. */
export function childEnv(
  fx: Fixture,
  extra: Record<string, string> = {},
  ambient: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = scrubGitEnv(ambient);
  for (const key of [...CLEARED_VARS, "NODE_TEST_CONTEXT"]) delete env[key];
  return {
    ...env,
    ...gitEnv(fx),
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
    PATH: `${fx.bin}${path.delimiter}${env.PATH ?? ""}`,
    CREWRIG_REPO_DIR: fx.work,
    ...extra,
  };
}

function write(fx: Fixture, rel: string, body: string): void {
  const file = path.join(fx.work, rel);
  assertInside(fx.work, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function commitAll(fx: Fixture, msg: string): void {
  wg(fx, ["add", "-A"]);
  wg(fx, ["commit", "-q", "-m", msg]);
}

function fetchBoth(fx: Fixture): void {
  assertRemotesUnderScratch(fx.work, fx.root);
  wg(fx, ["fetch", "-q", "crewrig"]);
  wg(fx, ["fetch", "-q", "origin"]);
}

/**
 * `<root>/<name>/{bare.git,work}`; `work` sits on `feature`, whose merge base with the base
 * branch is the fixture commit. `develop` has no `main` anywhere; `release` adds `release/1.x`
 * carrying a third party's hotfix spec 0300 (issue #700) that main never got, with `feature`
 * branched from it.
 */
export function newFixture(root: string, name: string, kind: Kind = "main"): Fixture {
  const dir = path.join(root, name);
  const fx: Fixture = {
    root,
    dir,
    bare: path.join(dir, "bare.git"),
    work: path.join(dir, "work"),
    home: path.join(dir, "home"),
    bin: path.join(dir, "bin"),
  };
  for (const d of [fx.bare, fx.work, fx.home, fx.bin]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(fx.home, "gitconfig"), "");
  // The stub fails on any call: the script under test must not reach the forge CLI.
  writeStubGh(fx.bin, { status: 1 });
  const trunk = kind === "develop" ? "develop" : "main";
  git(dir, ["init", "-q", "--bare", fx.bare], gitEnv(fx));
  wg(fx, ["init", "-q", "-b", trunk]);
  // The sync manifest as the real repository carries it: org-owned paths come from `excluded`.
  write(fx, ".crewrig/core-paths.txt", "specs\tstrict\nspecs/org\texcluded\n");
  write(fx, "README.md", "# base\n");
  commitAll(fx, kind === "release" ? "root" : "base");
  wg(fx, ["remote", "add", "crewrig", fx.bare]);
  wg(fx, ["remote", "add", "origin", fx.bare]);
  push(fx, ["crewrig", trunk]);
  if (kind === "release") {
    wg(fx, ["checkout", "-q", "-b", "release/1.x"]);
    write(
      fx,
      "specs/0300-someone-elses-hotfix.md",
      renderSpec("0300", "someone-elses-hotfix", "700"),
    );
    commitAll(fx, "release: a hotfix spec belonging to issue #700");
    push(fx, ["crewrig", "release/1.x"]);
  }
  fetchBoth(fx);
  wg(fx, ["checkout", "-q", "-b", "feature"]);
  return fx;
}

/** Add a spec to main BEFORE the branch point, so it is not part of the change under test. */
export function addToBase(fx: Fixture, rel: string, id: string, slug: string, issue: string): void {
  wg(fx, ["checkout", "-q", "main"]);
  write(fx, rel, renderSpec(id, slug, issue));
  commitAll(fx, `base: ${rel}`);
  push(fx, ["crewrig", "main"]);
  fetchBoth(fx);
  wg(fx, ["branch", "-q", "-f", "feature", "main"]);
  wg(fx, ["checkout", "-q", "feature"]);
}

/** The pull request adds a spec file on the feature branch. */
export function addSpec(
  fx: Fixture,
  rel: string,
  id: string,
  slug: string,
  issue: string,
  extra = "",
): void {
  write(fx, rel, renderSpec(id, slug, issue, extra));
  commitAll(fx, `add ${rel}`);
}

/** Rename with the frontmatter rewritten, so filename id and frontmatter id agree. */
export function renameSpec(
  fx: Fixture,
  from: string,
  to: string,
  id: string,
  slug: string,
  issue: string,
): void {
  wg(fx, ["mv", from, to]);
  write(fx, to, renderSpec(id, slug, issue));
  commitAll(fx, `rename ${from} -> ${to}`);
}

/** Parentless object of the empty tree, message `reserve <id> for issue #<n>`, pushed to `ref`. */
export function reserve(fx: Fixture, ref: string, id: string, issue: string): void {
  commitObject(fx, ref, `reserve ${id} for issue #${issue}`);
}

/** Same push with an arbitrary message (a record that names no ticket). */
export function commitObject(fx: Fixture, ref: string, message: string): void {
  const obj = wg(fx, ["commit-tree", "-m", message, EMPTY_TREE]).trim();
  push(fx, ["crewrig", `${obj}:${ref}`]);
}

/**
 * A reservation ref that `ls-remote` lists and `fetch` refuses (`upload-pack: not our ref`): the
 * ref file is written straight into the bare repository, pointing at an object never created.
 */
export function dangleReservation(fx: Fixture, ref: string): void {
  const file = path.join(fx.bare, ref);
  assertInside(fx.bare, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");
}

/** Point both remotes at a path under the scratch root that does not exist. */
export function breakRemote(fx: Fixture): void {
  const absent = path.join(fx.dir, "absent.git");
  wg(fx, ["remote", "set-url", "crewrig", absent]);
  wg(fx, ["remote", "set-url", "origin", absent]);
}

/** The stub `gh` logs only when called: any `gh.log` means the tool reached the forge CLI. */
export function assertGhNotCalled(fx: Fixture): void {
  if (fs.existsSync(path.join(fx.bin, "gh.log"))) throw new Error("the stub gh was called");
}

/** BASE_REF is exported when `base` is non-empty; an empty `base` leaves it unset. */
export function runCheckBased(fx: Fixture, base: string, extra: Record<string, string> = {}): Run {
  assertRemotesUnderScratch(fx.work, fx.root);
  const env = childEnv(fx, base === "" ? extra : { BASE_REF: base, ...extra });
  const res = spawnSync(
    "sh",
    [
      "-c",
      'exec "$0" "$@" 2>&1',
      process.execPath,
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      ENTRY,
    ],
    { cwd: fx.work, env, encoding: "utf8", maxBuffer: 1 << 26 },
  );
  assertGhNotCalled(fx);
  return { status: res.status, log: res.stdout };
}

export function runCheck(fx: Fixture, extra: Record<string, string> = {}): Run {
  return runCheckBased(fx, "origin/main", extra);
}

/** The GitLab pair, same repository: the default for cases not about origin detection. */
export function runCheckSameRepo(fx: Fixture): Run {
  return runCheck(fx, {
    CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: REFERENCE_REPO,
    CI_PROJECT_PATH: REFERENCE_REPO,
  });
}

/** Verdict assertions on a run; the message carries the merged log. */
export function expectExit0(r: Run): void {
  if (r.status !== 0) throw new Error(`expected exit 0, got ${r.status}\n${r.log}`);
}
export function expectNonZero(r: Run): void {
  if (r.status === 0 || r.status === null)
    throw new Error(`expected a non-zero exit, got ${r.status}\n${r.log}`);
}
