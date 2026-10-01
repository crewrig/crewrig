// ci-changeset-coverage.test.ts — black-box tests for scripts/ci-changeset-coverage.sh
// (spec 0147 R4/R5/R9/R10, issue #1402).
//
// Every fixture is a throwaway `git init` repository under os.tmpdir() holding a
// minimal ci/ci-capabilities.yml: one `changeset-gated` capability whose
// `paths:` is `docs/**` and whose command touches a marker file. The marker is
// the observable verdict: present means the full suite ran (a changed file was
// not covered, or the base could not be established), absent means the script
// was a no-op. The remote-tracking refs the script reads (`origin/main`,
// `origin/release/x`) are planted with `git update-ref`, so no remote is needed.
//
// The script under test is SCRIPT_UNDER_TEST (default: the real script), so the
// identical file can be pointed at a pre-fix copy. Each case is tagged:
//   discriminating — fails against the pre-fix script (it proves the fix);
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
const MARKER = ".fail-safe-ran";
const ZEROS = "0".repeat(40);
const MISSING_SHA = "1234567890abcdef1234567890abcdef12345678";

const REFERENCE = `capabilities:
  - id: gated
    changeset-gated: true
    trigger:
      - on: pull-request
        paths:
          - "docs/**"
    command:
      - touch ${MARKER}
`;

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The environment minus anything that would leak the caller's base ref or git state,
 * with the host's global and system git config switched off (a global
 * `core.hooksPath`, say, must not run inside the fixture repositories). Used by
 * both the fixture `git()` helper and the script under test.
 */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "CI_BASE_REF",
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

/** A repository whose `main` holds one commit: the reference plus a covered and an uncovered file. */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-changeset-coverage-"));
  temps.push(dir);
  git(dir, "init", "-q", "-b", "main");
  commit(dir, {
    "ci/ci-capabilities.yml": REFERENCE,
    "docs/seed.md": "seed\n",
    "README.txt": "seed\n",
  });
  return dir;
}

interface Run {
  status: number | null;
  out: string;
  err: string;
  suiteRan: boolean;
}

/** Run the script under test against `dir`, with only `vars` set among the base-ref variables. */
function run(dir: string, vars: Record<string, string> = {}): Run {
  const res = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: cleanEnv({ REPO_DIR: dir, ...vars }),
  });
  return {
    status: res.status,
    out: res.stdout,
    err: res.stderr,
    suiteRan: fs.existsSync(path.join(dir, MARKER)),
  };
}

/** Plant a remote-tracking ref without a remote. */
function plantRemoteRef(dir: string, name: string, sha: string): void {
  git(dir, "update-ref", `refs/remotes/origin/${name}`, sha);
}

interface ReleaseFixture {
  dir: string;
  seed: string;
  releaseTip: string;
}

/**
 * `release/x` diverges from `main` with an uncovered file; a PR branch is cut at the
 * release tip, adds `prFiles`, and HEAD is the merge commit of the PR into the
 * release tip (the `pull_request` checkout on GitHub). `origin/main` is the seed.
 */
function releasePr(prFiles: Record<string, string>): ReleaseFixture {
  const dir = repo();
  const seed = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "release/x");
  const releaseTip = commit(dir, { "release-only.txt": "release\n" });
  git(dir, "checkout", "-q", "-b", "pr");
  commit(dir, prFiles);
  git(dir, "checkout", "-q", "-b", "merge", "release/x");
  git(dir, "merge", "-q", "--no-ff", "-m", "merge pr", "pr");
  plantRemoteRef(dir, "main", seed);
  return { dir, seed, releaseTip };
}

describe("ci-changeset-coverage.sh", () => {
  test("(a) [guard] PR merged into a diverged release tip, base supplied: fast no-op", () => {
    const { dir, releaseTip } = releasePr({ "docs/pr.md": "pr\n" });
    const r = run(dir, { CI_BASE_REF: releaseTip });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, false, r.out);
    assert.match(r.out, /fast no-op/);
  });

  test("(b) [guard] same topology, no base supplied: falls back to origin/main and flags the release delta", () => {
    const { dir } = releasePr({ "docs/pr.md": "pr\n" });
    const r = run(dir);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /release-only\.txt/);
  });

  test("(c) [guard] the PR itself adds an uncovered file: the full suite runs", () => {
    const { dir, releaseTip } = releasePr({ "docs/pr.md": "pr\n", "src/new.txt": "new\n" });
    const r = run(dir, { CI_BASE_REF: releaseTip });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /src\/new\.txt/);
    assert.doesNotMatch(r.out, /release-only\.txt/);
  });

  test("(d) [discriminating] base has commits HEAD lacks: only the PR's own files are evaluated", () => {
    const dir = repo();
    git(dir, "checkout", "-q", "-b", "pr");
    commit(dir, { "docs/pr.md": "pr\n" });
    git(dir, "checkout", "-q", "main");
    const baseTip = commit(dir, { "base-only.txt": "advanced\n" });
    git(dir, "checkout", "-q", "pr");
    const r = run(dir, { CI_BASE_REF: baseTip });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, false, r.out);
    assert.doesNotMatch(r.out, /base-only\.txt/);
  });

  test("(e) [discriminating] bare branch name resolves as origin/<name> and picks the right base", () => {
    const dir = repo();
    const seed = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "-b", "release/x");
    const releaseTip = commit(dir, { "release-only.txt": "release\n" });
    git(dir, "checkout", "-q", "-b", "pr");
    commit(dir, { "src/new.txt": "new\n" });
    git(dir, "branch", "-D", "release/x");
    plantRemoteRef(dir, "main", seed);
    plantRemoteRef(dir, "release/x", releaseTip);
    const r = run(dir, { CI_BASE_REF: "release/x" });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /base origin\/release\/x/);
    assert.match(r.out, /src\/new\.txt/);
    assert.doesNotMatch(r.out, /release-only\.txt/);
  });

  test("(f) [discriminating] all-zero base variables are unset and fall to origin/main", () => {
    const dir = repo();
    const seed = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "-b", "pr");
    commit(dir, { "src/new.txt": "new\n" });
    plantRemoteRef(dir, "main", seed);
    const r = run(dir, { CI_BASE_REF: ZEROS, CI_COMMIT_BEFORE_SHA: ZEROS });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /base origin\/main/);
    assert.match(r.out, /src\/new\.txt/);
  });

  test("(g) [discriminating] unresolvable base and no origin/main: fail-safe full suite, never a silent exit 0", () => {
    const dir = repo();
    const r = run(dir, { CI_BASE_REF: MISSING_SHA });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /fail-safe/);
    assert.match(r.err, /does not resolve/);
  });

  test("(h) [guard] empty diff and no skipped candidate (this is also the no-skip guard for (j)): nothing to cover, exit 0", () => {
    const dir = repo();
    const head = git(dir, "rev-parse", "HEAD");
    const r = run(dir, { CI_BASE_REF: head });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, false, r.out);
    assert.match(r.out, /nothing to cover/);
  });

  test("(i) [guard] frozen base older than the base tip in the merge commit: over-inclusive, suite runs", () => {
    const dir = repo();
    const frozenBase = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "-b", "pr");
    commit(dir, { "docs/pr.md": "pr\n" });
    git(dir, "checkout", "-q", "main");
    commit(dir, { "later-base.txt": "advanced\n" });
    git(dir, "checkout", "-q", "-b", "merge", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "merge pr", "pr");
    const r = run(dir, { CI_BASE_REF: frozenBase });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /later-base\.txt/);
  });

  test("(j) [discriminating] empty diff after a skipped base candidate (origin/main == HEAD): fail-safe full suite, never a silent exit 0", () => {
    const dir = repo();
    plantRemoteRef(dir, "main", git(dir, "rev-parse", "HEAD"));
    const r = run(dir, { CI_BASE_REF: MISSING_SHA });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.suiteRan, true, r.out);
    assert.match(r.out, /base origin\/main/);
    assert.match(r.err, /does not resolve/);
    assert.match(r.err, /emptiness cannot be trusted/);
    assert.doesNotMatch(r.out, /nothing to cover/);
  });
});
