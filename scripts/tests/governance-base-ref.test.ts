// governance-base-ref.test.ts — substitute for the in-process Bash group `r`
// of test-check-test-strays.sh (resolve_remote_ref unit cases), which retires
// with scripts/lib/base-ref-resolve.sh (spec 0262 requirement 17).
//
// One test per former `rr` row, on scratch git repos in the CI topology of
// issue #1401 (detached HEAD, no local trunk, remote-tracking refs only). A
// mutation case copies the module, inverts the remote-preference rule and
// asserts the key case then fails, so the suite can fail. A differential leg
// compares the retiring shell function while it still exists (non-Windows).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveRemoteRef } from "../lib/governance/base-ref.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, "..", "lib");
const SHELL_LIB = path.join(LIB, "base-ref-resolve.sh");

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};
// The module under test spawns git with the process environment.
Object.assign(process.env, GIT_ENV);

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

/** CI topology: remote-tracking refs only, detached HEAD, no local `main`. */
function mkCiRepo(root: string, name: string, remote: string): string {
  const repo = path.join(root, name);
  const bare = path.join(root, `${name}.git`);
  fs.mkdirSync(repo);
  git(repo, "init", "-q");
  git(repo, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "a.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  git(repo, "branch", "-M", "main");
  git(root, "init", "--bare", "-q", bare);
  git(repo, "remote", "add", remote, bare);
  const emptyTree = spawnSync("git", ["mktree"], {
    cwd: repo,
    env: GIT_ENV,
    input: "",
    encoding: "utf8",
  }).stdout.trim();
  const orphan = git(repo, "commit-tree", "-m", "orphan", emptyTree);
  git(
    repo,
    "push",
    "-q",
    remote,
    "main",
    "HEAD:refs/heads/release/x",
    `${orphan}:refs/heads/orphan`,
  );
  git(repo, "push", "-q", remote, "main:refs/heads/shared");
  git(repo, "fetch", "-q", remote);
  git(repo, "checkout", "-q", "--detach");
  git(repo, "branch", "-D", "main");
  return repo;
}

describe("resolveRemoteRef (substitute for case-r of test-check-test-strays.sh)", () => {
  let root = "";
  let repo = "";
  let elsewhere = "";
  let headSha = "";

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "base-ref-"));
    repo = mkCiRepo(root, "repo", "origin");
    git(repo, "branch", "localonly", "HEAD");
    git(repo, "branch", "shared", "HEAD");
    git(repo, "tag", "treetag", git(repo, "rev-parse", "HEAD^{tree}"));
    headSha = git(repo, "rev-parse", "HEAD");
    elsewhere = fs.mkdtempSync(path.join(root, "elsewhere-"));
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Runs from a directory that is NOT the repo, so <repo-dir> must be honoured.
  const rr = (name: string, remote?: string, dir?: string): string | null =>
    resolveRemoteRef(name, remote, elsewhere, dir ?? repo);

  test("bare local branch is returned as given", () => {
    assert.equal(rr("localonly", "origin"), "localonly");
  });
  test("bare name wins over the remote-tracking ref when both verify", () => {
    assert.equal(rr("shared", "origin"), "shared");
  });
  test("remote-only branch resolves to origin/<name>", () => {
    assert.equal(rr("main", "origin"), "origin/main");
  });
  test("slash-bearing name resolves to origin/<name>", () => {
    assert.equal(rr("release/x", "origin"), "origin/release/x");
  });
  test("unresolvable name yields null", () => {
    assert.equal(rr("nope", "origin"), null);
  });
  test("already-prefixed name is returned as given", () => {
    assert.equal(rr("origin/main", "origin"), "origin/main");
  });
  test("already-prefixed unresolvable yields null, no double prefix", () => {
    assert.equal(rr("origin/nope", "origin"), null);
  });
  test("empty name yields null", () => {
    assert.equal(rr("", "origin"), null);
  });
  test("a leading dash never resolves", () => {
    assert.equal(rr("--all", "origin"), null);
  });
  test("remote that does not exist yields null", () => {
    assert.equal(rr("main", "crewrig"), null);
  });
  test("a commit SHA resolves as given", () => {
    assert.equal(rr(headSha, "origin"), headSha);
  });
  test("a tag peeling to a tree is not a commit", () => {
    assert.equal(rr("treetag", "origin"), null);
  });
  test("custom <remote> is honoured", () => {
    const other = mkCiRepo(root, "other", "crewrig");
    assert.equal(rr("main", "crewrig", other), "crewrig/main");
  });
  test("<remote> defaults to origin and <repo-dir> to the working directory", () => {
    assert.equal(resolveRemoteRef("main", undefined, repo), "origin/main");
  });

  test("mutation: with the remote-preference rule inverted, the key case fails", async () => {
    const dir = fs.mkdtempSync(path.join(root, "mutant-"));
    const gov = path.join(LIB, "governance");
    fs.copyFileSync(path.join(gov, "git-run.ts"), path.join(dir, "git-run.ts"));
    const src = fs.readFileSync(path.join(gov, "base-ref.ts"), "utf8");
    const bareFirst = "[name, `${remote}/${name}`]";
    assert.ok(src.includes(bareFirst), "mutation anchor missing from base-ref.ts");
    fs.writeFileSync(
      path.join(dir, "base-ref.ts"),
      src.replace(bareFirst, "[`${remote}/${name}`, name]"),
    );
    const mutant = (await import(pathToFileURL(path.join(dir, "base-ref.ts")).href)) as {
      resolveRemoteRef: typeof resolveRemoteRef;
    };
    assert.notEqual(mutant.resolveRemoteRef("shared", "origin", elsewhere, repo), "shared");
  });

  test(
    "differential: matches the retiring shell resolve_remote_ref",
    { skip: process.platform === "win32" || !fs.existsSync(SHELL_LIB) },
    () => {
      const names = [
        "localonly",
        "shared",
        "main",
        "release/x",
        "nope",
        "origin/main",
        "",
        headSha,
        "treetag",
      ];
      for (const name of names) {
        const sh = spawnSync(
          "bash",
          ["-c", `source "${SHELL_LIB}"; resolve_remote_ref "$1" origin "$2"`, "_", name, repo],
          { cwd: elsewhere, env: GIT_ENV, encoding: "utf8" },
        );
        const expected = sh.status === 0 ? sh.stdout : null;
        assert.equal(rr(name, "origin"), expected, `name '${name}'`);
      }
    },
  );
});
