// Tests for the GIT_* scrub of the pre-push guard (spec 0279 delta-02, R21): .githooks/pre-push,
// taskEnv/runTasks in scripts/lib/ci-pre-push/run.ts and scrubGitEnv in scripts/lib/git-env.ts.
// A fake `task` in a mkdtemp bin directory records the GIT_* names it receives, then runs git in
// its own mkdtemp directory with the environment it was given: if git's hook variables leaked, that
// git would act on the sacrificial repository. Every repository, worktree and bare remote is a
// mkdtemp sandbox under a hermetic HOME; the mutation proofs break copies inside such sandboxes only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runTasks, taskEnv } from "../lib/ci-pre-push/run.ts";
import { scrubGitEnv } from "../lib/git-env.ts";
import {
  commitAll,
  gitEnv,
  git as gitIn,
  newRepo,
  writeRel,
} from "./lib/governance-git-fixture.ts";
import { makeSandbox, REPO } from "./lib/governance-sandbox.ts";

const POSIX = { skip: process.platform === "win32" };
const HOOK = path.join(REPO, ".githooks", "pre-push");
const RUN_TS = path.join(REPO, "scripts", "lib", "ci-pre-push", "run.ts");
const GIT_ENV_TS = path.join(REPO, "scripts", "lib", "git-env.ts");

// Records its GIT_* names, then does git work in its own fresh mkdtemp directory (under $TMPDIR,
// which the test points into a sandbox it removes itself) with the environment it received.
const FAKE_TASK = `#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const names = Object.keys(process.env).filter((k) => /^git_/i.test(k));
fs.appendFileSync(process.env.FAKE_MARKER, JSON.stringify(names) + "\\n");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-task-work-"));
for (const args of [
  ["init", "-q"],
  ["config", "user.name", "Test"],
  ["config", "user.email", "test@example.com"],
  ["config", "commit.gpgsign", "false"],
  ["commit", "--allow-empty", "-q", "-m", "fx"],
  ["checkout", "-q", "-b", "other"],
]) spawnSync("git", args, { cwd: dir, env: process.env, stdio: "ignore" });
`;

const KEYS_TASK = `#!/usr/bin/env node
process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => /^git_/i.test(k))) + "\\n");
`;

/** A bin directory holding `task` (with the given source) plus symlinks to the real node and git. */
function binDir(taskSource: string): string {
  const bin = makeSandbox("env-scrub-bin-");
  fs.writeFileSync(path.join(bin, "task"), taskSource, { mode: 0o755 });
  fs.chmodSync(path.join(bin, "task"), 0o755);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(gitPath, path.join(bin, "git"));
  return bin;
}

const g = (cwd: string, args: readonly string[]): string => {
  const r = spawnSync("git", [...args], { cwd, env: gitEnv(), encoding: "utf8" });
  return `${r.status}\n${r.stdout}`;
};

/** Byte snapshot of everything a leaked GIT_DIR would have changed in the sacrificial repository. */
function snapshot(repo: string): string[] {
  const wtRoot = path.join(repo, ".git", "worktrees");
  const heads = fs.existsSync(wtRoot)
    ? fs
        .readdirSync(wtRoot)
        .sort()
        .map((n) => fs.readFileSync(path.join(wtRoot, n, "HEAD"), "utf8"))
    : [];
  return [
    fs.readFileSync(path.join(repo, ".git", "config"), "utf8"),
    fs.readFileSync(path.join(repo, ".git", "HEAD"), "utf8"),
    ...heads,
    g(repo, ["for-each-ref"]),
    g(repo, ["worktree", "list", "--porcelain"]),
  ];
}

interface PushOutcome {
  status: number | null;
  stderr: string;
  marker: string[][];
  before: string[];
  after: string[];
}

/** A sacrificial CrewRig repository with `hookSource` as its pre-push hook, pushed to a bare remote. */
function pushScenario(hookSource: string): PushOutcome {
  const repo = newRepo("main", "env-scrub-repo-");
  writeRel(repo, "taskfiles/ci.yml", "version: '3.39'\ntasks: {}\n");
  fs.mkdirSync(path.join(repo, ".githooks"));
  fs.writeFileSync(path.join(repo, ".githooks", "pre-push"), hookSource, { mode: 0o755 });
  fs.chmodSync(path.join(repo, ".githooks", "pre-push"), 0o755);
  commitAll(repo, "base");
  gitIn(repo, ["config", "--local", "core.hooksPath", ".githooks"]);
  const bare = makeSandbox("env-scrub-bare-");
  gitIn(bare, ["init", "--bare", "-q"]);
  const wt = path.join(makeSandbox("env-scrub-wt-"), "wt");
  gitIn(repo, ["worktree", "add", "-q", "-b", "feat/x", wt]);
  writeRel(wt, "change.txt", "x\n");
  commitAll(wt, "change");

  const work = makeSandbox("env-scrub-tmp-");
  const marker = path.join(work, "marker");
  const bin = binDir(FAKE_TASK);
  const before = snapshot(repo);
  const r = spawnSync("git", ["push", bare, "feat/x"], {
    cwd: wt,
    env: gitEnv({
      PATH: `${bin}${path.delimiter}/usr/bin:/bin`,
      FAKE_MARKER: marker,
      TMPDIR: work,
    }),
    encoding: "utf8",
  });
  const lines = fs.existsSync(marker)
    ? fs.readFileSync(marker, "utf8").split("\n").filter(Boolean)
    : [];
  return {
    status: r.status,
    stderr: r.stderr,
    marker: lines.map((l) => JSON.parse(l) as string[]),
    before,
    after: snapshot(repo),
  };
}

describe("pre-push hook scrub through a real git push (R21)", () => {
  it("hands the task no GIT_* variable and leaves the repository untouched", POSIX, () => {
    const out = pushScenario(fs.readFileSync(HOOK, "utf8"));
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.marker.length, 1, "the fake task must run exactly once");
    assert.deepEqual(out.marker[0], []);
    assert.deepEqual(out.after, out.before);
  });
});

describe("taskEnv and runTasks scrub (R21)", () => {
  const parent = {
    GIT_DIR: "/real/.git",
    GIT_INDEX_FILE: "/real/.git/index",
    GIT_WORK_TREE: "/real",
    GIT_EXEC_PATH: "/usr/libexec/git-core",
    GIT_PREFIX: "sub/",
    KEEP_ME: "1",
    PATH: "/usr/bin",
  };

  it("drops every GIT_* key and keeps the rest of the contract", () => {
    const opts = { cwd: "/repo", env: parent, baseRef: "origin/main" };
    const env = taskEnv("lint-specs", opts);
    assert.deepEqual(
      Object.keys(env).filter((k) => k.startsWith("GIT_")),
      [],
    );
    assert.equal(env["KEEP_ME"], "1");
    assert.equal(env["PWD"], "/repo");
    assert.equal(env["BASE_REF"], "origin/main");
    assert.equal(
      env["PATH"],
      `${path.join("/repo", "node_modules", ".bin")}${path.delimiter}/usr/bin`,
    );
    assert.equal(env["CREWRIG_PR_DRAFT"], "true");
    assert.equal(taskEnv("lint-markdown", opts)["CREWRIG_PR_DRAFT"], undefined);
    assert.equal(parent.GIT_DIR, "/real/.git", "the parent env is not mutated");
  });

  it("reaches every spawned task without a GIT_* variable", POSIX, async () => {
    const bin = binDir(KEYS_TASK);
    const ids = ["lint-specs", "lint-markdown", "lint-ts"];
    const report = await runTasks(ids, {
      cwd: newRepo(),
      baseRef: "origin/main",
      poolSize: 1,
      env: { ...parent, PATH: `${bin}${path.delimiter}/usr/bin:/bin` },
      log: () => undefined,
    });
    assert.deepEqual(report.failed, []);
    assert.equal(report.results.length, ids.length);
    for (const r of report.results) assert.equal(r.output.trim(), "[]", r.id);
  });
});

/** Replace the single occurrence of `from`; the replacement count is asserted (vacuity guard). */
function mutateOnce(source: string, from: string, to: string): string {
  assert.equal(source.split(from).length - 1, 1, `${from} must occur exactly once`);
  return source.replace(from, () => to);
}

describe("mutation proofs: the tests above fail without the scrub (v1-F3)", () => {
  it(
    "a hook that does not filter leaks GIT_DIR and damages the sacrificial repository",
    POSIX,
    () => {
      const mutated = mutateOnce(fs.readFileSync(HOOK, "utf8"), "!gitVar.test(name)", "true");
      const out = pushScenario(mutated);
      assert.equal(out.status, 0, out.stderr);
      assert.equal(out.marker.length, 1, "the mutated hook must still reach the fake task");
      assert.ok(out.marker[0]?.includes("GIT_DIR"), "GIT_DIR must be recorded");
      assert.notDeepEqual(
        out.after,
        out.before,
        "the leaked environment must change the repository",
      );
    },
  );

  it("a taskEnv that copies the parent env leaks GIT_DIR; the real one does not", async () => {
    const tree = makeSandbox("env-scrub-mut-");
    fs.mkdirSync(path.join(tree, "scripts", "lib", "ci-pre-push"), { recursive: true });
    fs.copyFileSync(GIT_ENV_TS, path.join(tree, "scripts", "lib", "git-env.ts"));
    const mutatedRun = path.join(tree, "scripts", "lib", "ci-pre-push", "run.ts");
    fs.writeFileSync(
      mutatedRun,
      mutateOnce(
        fs.readFileSync(RUN_TS, "utf8"),
        "scrubGitEnv(opts.env ?? process.env)",
        "{ ...(opts.env ?? process.env) }",
      ),
    );
    const mod = (await import(mutatedRun)) as { taskEnv: typeof taskEnv };
    const opts = { cwd: "/repo", env: { GIT_DIR: "/real/.git", PATH: "/usr/bin" } };
    assert.equal(mod.taskEnv("lint-markdown", opts)["GIT_DIR"], "/real/.git");
    assert.equal(taskEnv("lint-markdown", opts)["GIT_DIR"], undefined);
  });
});

describe("scrubGitEnv", () => {
  it("removes GIT_* on POSIX and keeps look-alikes", () => {
    const out = scrubGitEnv(
      { GIT_DIR: "a", GIT_FUTURE_VAR: "b", git_dir: "c", NOT_GIT_X: "d", HOME: "/h" },
      "linux",
    );
    assert.deepEqual(out, { git_dir: "c", NOT_GIT_X: "d", HOME: "/h" });
  });

  it("matches case-insensitively on win32", () => {
    const out = scrubGitEnv(
      { GIT_DIR: "a", git_dir: "c", Git_Prefix: "p", NOT_GIT_X: "d" },
      "win32",
    );
    assert.deepEqual(out, { NOT_GIT_X: "d" });
  });

  it("does not mutate its input and accepts an empty env", () => {
    const input = { GIT_DIR: "a", KEEP: "b" };
    const out = scrubGitEnv(input, "linux");
    assert.deepEqual(input, { GIT_DIR: "a", KEEP: "b" });
    assert.notEqual(out, input);
    assert.deepEqual(scrubGitEnv({}, "linux"), {});
  });
});

describe("hook size guard", () => {
  it("stays a thin Node bootstrap of at most 45 lines", () => {
    const text = fs.readFileSync(HOOK, "utf8");
    assert.ok(text.startsWith("#!/usr/bin/env node\n"));
    assert.ok(text.split("\n").length - 1 <= 45, "the hook grew beyond 45 lines");
  });
});
