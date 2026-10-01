// ci-changeset-coverage.test.ts — black-box tests for scripts/ci-changeset-coverage.sh
// as the EXHAUSTIVE RUN (spec 0147 delta-01 R21/R22/R23, issue #1405).
//
// The script used to be a pull-request fail-safe: it computed a diff against a
// base ref and ran the full suite only when a changed file was unowned. After
// the path-ownership check (R11-R18) took that job over, it is repurposed: it
// executes the commands of EVERY `changeset-gated: true` capability,
// unconditionally, with no diff and no base ref. These tests pin that contract.
//
// Every fixture is a throwaway directory holding a minimal
// ci/ci-capabilities.yml. Each command appends its tag to a log file in the
// fixture, so the log is the observable verdict: which gated commands ran, and
// in which order. The script is run from a foreign working directory, so a tag
// landing in the fixture also proves the commands run inside REPO_DIR.
//
// The script under test is SCRIPT_UNDER_TEST (default: the real script), so the
// identical file can be pointed at a pre-change copy. Each case is tagged:
//   discriminating — fails against the pre-change (fail-safe) script;
//   guard          — same outcome before and after (protects what must not regress).
// Standard library only, so it runs before `npm ci`, like the ratchet.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT =
  process.env["SCRIPT_UNDER_TEST"] ?? path.join(REPO, "scripts", "ci-changeset-coverage.sh");
const LOG = "ran.log";
const ZEROS = "0".repeat(40);
const MISSING_SHA = "1234567890abcdef1234567890abcdef12345678";

/**
 * Four gated capabilities and two that are not. `alpha` has a `paths:` filter and two commands;
 * `beta` has no `paths:`; `gamma` is push-only. `plain` has a pull-request `paths:` set but is not
 * gated, and `explicit-off` says `changeset-gated: false`: neither may run.
 */
const REFERENCE = `capabilities:
  - id: alpha
    changeset-gated: true
    trigger:
      - on: pull-request
        paths:
          - "docs/**"
    command:
      - echo alpha-1 >> ${LOG}
      - echo alpha-2 >> ${LOG}
  - id: beta
    changeset-gated: true
    trigger:
      - on: pull-request
    command:
      - echo beta >> ${LOG}
  - id: gamma
    changeset-gated: true
    trigger:
      - on: push
        paths:
          - "src/**"
    command:
      - echo gamma >> ${LOG}
  - id: plain
    trigger:
      - on: pull-request
        paths:
          - "docs/**"
    command:
      - echo plain >> ${LOG}
  - id: explicit-off
    changeset-gated: false
    trigger:
      - on: pull-request
    command:
      - echo explicit-off >> ${LOG}
`;

/** Gated commands in reference order. */
const ALL_GATED = ["alpha-1", "alpha-2", "beta", "gamma"];

/** A failing command first, then a passing one in the same capability, then a later capability. */
const FAILING_REFERENCE = `capabilities:
  - id: first
    changeset-gated: true
    trigger:
      - on: pull-request
    command:
      - echo first-1 >> ${LOG}
      - "echo first-2-failing >> ${LOG}; false"
      - echo first-3 >> ${LOG}
  - id: second
    changeset-gated: true
    trigger:
      - on: pull-request
    command:
      - echo second >> ${LOG}
`;

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The environment minus anything that would leak the caller's base ref or git state,
 * with the host's global and system git config switched off. Used by both the fixture
 * `git()` helper and the script under test.
 */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "CI_BASE_REF",
    "BASE_REF",
    "CI_MERGE_REQUEST_TARGET_BRANCH_SHA",
    "CI_COMMIT_BEFORE_SHA",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
  ]) {
    delete env[key];
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

function git(dir: string, ...args: string[]): string {
  const res = spawnSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8", env: cleanEnv({}) },
  );
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

/** Commit `files` (repository-relative path to content) on the current branch. */
function commit(dir: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "fixture");
  return git(dir, "rev-parse", "HEAD");
}

/** A directory holding only the reference: not a git repository. */
function plainDir(reference: string = REFERENCE): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-changeset-coverage-"));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, "ci"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ci", "ci-capabilities.yml"), reference);
  return dir;
}

/** A repository whose `main` holds the reference and a covered file. */
function repo(reference: string = REFERENCE): string {
  const dir = plainDir(reference);
  git(dir, "init", "-q", "-b", "main");
  commit(dir, { "docs/seed.md": "seed\n", "README.txt": "seed\n" });
  return dir;
}

interface Run {
  status: number | null;
  out: string;
  err: string;
  ran: string[];
}

/** Tags the commands appended to the fixture's log, in order. */
function readLog(dir: string): string[] {
  const file = path.join(dir, LOG);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

/**
 * Run the script under test against `dir`, from a foreign working directory, with
 * `vars` as the only base-ref variables (REPO_DIR is how the script finds the fixture).
 */
function run(dir: string, vars: Record<string, string> = {}): Run {
  const res = spawnSync("bash", [SCRIPT], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: cleanEnv({ REPO_DIR: dir, ...vars }),
  });
  return { status: res.status, out: res.stdout, err: res.stderr, ran: readLog(dir) };
}

/** Run with no `yq` reachable: a PATH holding nothing, and an absolute bash. */
function runWithoutYq(dir: string): Run {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ci-changeset-coverage-path-"));
  temps.push(empty);
  const res = spawnSync("/bin/bash", [SCRIPT], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: cleanEnv({ REPO_DIR: dir, PATH: empty }),
  });
  return { status: res.status, out: res.stdout, err: res.stderr, ran: readLog(dir) };
}

describe("ci-changeset-coverage.sh (exhaustive run)", () => {
  test("(a) [discriminating] every changed file is covered: every gated command still runs", () => {
    const dir = repo();
    const base = git(dir, "rev-parse", "HEAD");
    commit(dir, { "docs/pr.md": "pr\n" });
    const r = run(dir, { CI_BASE_REF: base });
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.ran, ALL_GATED);
  });

  test("(b) [discriminating] empty diff against the base: every gated command still runs", () => {
    const dir = repo();
    const head = git(dir, "rev-parse", "HEAD");
    const r = run(dir, { CI_BASE_REF: head });
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.ran, ALL_GATED);
  });

  test("(c) [guard] an uncovered change makes no difference either", () => {
    const dir = repo();
    const base = git(dir, "rev-parse", "HEAD");
    commit(dir, { "src/new.txt": "new\n", "unowned/file.bin": "x\n" });
    const r = run(dir, { CI_BASE_REF: base });
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.ran, ALL_GATED);
  });

  test("(d) [discriminating] no git repository at all: runs everything, no base-ref complaint", () => {
    const dir = plainDir();
    const r = run(dir);
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.ran, ALL_GATED);
    assert.doesNotMatch(r.err, /does not resolve|merge-base|no base ref/i);
    assert.doesNotMatch(r.out, /base ref|merge-base|fast no-op|nothing to cover/i);
  });

  test("(e) [discriminating] garbage, unresolvable and all-zero base variables are never consulted", () => {
    const dir = repo();
    const r = run(dir, {
      CI_BASE_REF: "not-a-ref",
      CI_MERGE_REQUEST_TARGET_BRANCH_SHA: MISSING_SHA,
      CI_COMMIT_BEFORE_SHA: ZEROS,
      BASE_REF: "refs/heads/does-not-exist",
    });
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.ran, ALL_GATED);
    assert.doesNotMatch(r.err, /does not resolve|merge-base|emptiness/i);
  });

  test("(f) [guard] a non-gated capability's command never runs, whether or not it has paths:", () => {
    const dir = repo();
    const r = run(dir);
    assert.equal(r.status, 0, r.err);
    assert.ok(!r.ran.includes("plain"), r.ran.join(","));
    assert.ok(!r.ran.includes("explicit-off"), r.ran.join(","));
  });

  test("(g) [guard] gated capabilities run whatever their triggers: no paths:, push-only", () => {
    const r = run(plainDir());
    assert.ok(r.ran.includes("beta"), "gated, no paths:");
    assert.ok(r.ran.includes("gamma"), "gated, push-only trigger");
  });

  test("(h) [guard] commands run in reference order, from REPO_DIR, not the caller's directory", () => {
    const dir = plainDir();
    const r = run(dir);
    assert.deepEqual(r.ran, ALL_GATED);
    assert.equal(
      fs.existsSync(path.join(os.tmpdir(), LOG)),
      false,
      "log leaked into the caller's cwd",
    );
  });

  test("(i) [guard] a failing command does not stop the others and the exit is 1", () => {
    const dir = plainDir(FAILING_REFERENCE);
    const r = run(dir);
    assert.equal(r.status, 1, r.out + r.err);
    assert.deepEqual(r.ran, ["first-1", "first-2-failing", "first-3", "second"]);
  });

  test("(j) [guard] a failure is reported on stderr, not only in a log (R22)", () => {
    const r = run(plainDir(FAILING_REFERENCE));
    assert.equal(r.status, 1);
    assert.match(r.err, /fail/i);
  });

  test("(k) [guard] missing yq exits 2 and runs nothing", () => {
    const dir = plainDir();
    const r = runWithoutYq(dir);
    assert.equal(r.status, 2, r.err);
    assert.deepEqual(r.ran, []);
  });

  test("(l) [guard] a missing reference exits 2 and runs nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-changeset-coverage-"));
    temps.push(dir);
    const r = run(dir);
    assert.equal(r.status, 2, r.err);
    assert.deepEqual(r.ran, []);
  });

  test("(m) [discriminating] the script computes no diff and resolves no base ref (R21)", () => {
    const code = fs
      .readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    for (const forbidden of [
      /merge-base/,
      /base-ref-resolve/,
      /resolve_remote_ref/,
      /CI_BASE_REF/,
      /BASE_REF/,
      /CI_COMMIT_BEFORE_SHA/,
      /CI_MERGE_REQUEST_TARGET_BRANCH_SHA/,
      /git\b[^\n]*\bdiff\b/,
    ]) {
      assert.doesNotMatch(code, forbidden);
    }
  });
});
