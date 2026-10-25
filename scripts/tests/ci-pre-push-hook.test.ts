// Tests for .githooks/pre-push, scripts/ci-pre-push.ts and scripts/lib/ci-pre-push/run.ts
// (spec 0279 R12, R13, R14, R18). A fake `task` executable written into a mkdtemp bin directory
// stands in for the real Task; every repository lives in a mkdtemp directory under a hermetic HOME.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runTasks, taskEnv } from "../lib/ci-pre-push/run.ts";
import {
  commitAll,
  gitEnv,
  git as gitIn,
  newRepo,
  runIn,
  writeRel,
} from "./lib/governance-git-fixture.ts";
import { makeSandbox, REPO } from "./lib/governance-sandbox.ts";

const POSIX = { skip: process.platform === "win32" };
const HOOK = path.join(REPO, ".githooks", "pre-push");
const WRAPPER = path.join(REPO, "scripts", "ci-pre-push.ts");

const FAKE_TASK = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  pwd: process.env.PWD ?? null,
  refs: process.env.CREWRIG_PRE_PUSH_REFS,
  draft: process.env.CREWRIG_PR_DRAFT ?? null,
  base: process.env.BASE_REF ?? null,
}) + "\\n");
process.stderr.write("fake-task-stderr\\n");
process.exit(Number(process.env.FAKE_TASK_EXIT ?? 0));
`;

/** A bin directory holding a fake `task`, plus symlinks to the real node and git only. */
function binDir(withTask: boolean): string {
  const bin = makeSandbox("ci-pre-push-bin-");
  if (withTask) {
    fs.writeFileSync(path.join(bin, "task"), FAKE_TASK, { mode: 0o755 });
    fs.chmodSync(path.join(bin, "task"), 0o755);
  }
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(gitPath, path.join(bin, "git"));
  return bin;
}

/** A CrewRig-shaped repository: the real hook and an empty taskfiles/ci.yml. */
function crewrigRepo(): string {
  const dir = newRepo();
  writeRel(dir, "taskfiles/ci.yml", "version: '3.54'\ntasks: {}\n");
  fs.mkdirSync(path.join(dir, ".githooks"));
  fs.copyFileSync(HOOK, path.join(dir, ".githooks", "pre-push"));
  fs.chmodSync(path.join(dir, ".githooks", "pre-push"), 0o755);
  return dir;
}

function runHook(
  cwd: string,
  bin: string,
  args: readonly string[],
  input = "",
  extra: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const hook = path.join(cwd, ".githooks", "pre-push");
  const env = { ...gitEnv(extra), PATH: `${bin}${path.delimiter}/usr/bin:/bin` };
  const r = spawnSync(hook, [...args], { cwd, env, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface FakeCall {
  argv: string[];
  cwd: string;
  pwd: string | null;
  refs: string;
  draft: string | null;
  base: string | null;
}

const fakeCall = (stdout: string): FakeCall =>
  JSON.parse(stdout.trim().split("\n")[0] ?? "{}") as FakeCall;

describe("pre-push hook", () => {
  it("relays the exit status and the output of the task", POSIX, () => {
    const dir = crewrigRepo();
    const ok = runHook(dir, binDir(true), ["origin", "u"], "refs/heads/x a b c\n");
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /fake-task-stderr/);
    const bad = runHook(dir, binDir(true), ["origin", "u"], "", { FAKE_TASK_EXIT: "7" });
    assert.equal(bad.status, 7);
    assert.equal(fakeCall(bad.stdout).refs, "");
  });

  it("hands Task the toplevel as PWD even when the push starts in a stale directory", POSIX, () => {
    const dir = crewrigRepo();
    const sub = path.join(dir, "sub");
    fs.mkdirSync(sub);
    const env = { ...gitEnv({ PWD: sub }), PATH: `${binDir(true)}${path.delimiter}/usr/bin:/bin` };
    const r = spawnSync(path.join(dir, ".githooks", "pre-push"), ["origin", "u"], {
      cwd: sub,
      env,
      input: "",
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const call = fakeCall(r.stdout);
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(dir));
    assert.equal(fs.realpathSync(call.pwd ?? ""), fs.realpathSync(dir));
  });

  it("passes remote, URL and the stdin refs through as literal arguments", POSIX, () => {
    const dir = crewrigRepo();
    const marker = path.join(dir, "X");
    const r = runHook(dir, binDir(true), ["/tmp/a b;c.git", "$(touch X)"], "refs/heads/f a b c\n");
    assert.equal(r.status, 0, r.stderr);
    const call = fakeCall(r.stdout);
    assert.deepEqual(call.argv, ["ci:pre-push", "--", "/tmp/a b;c.git", "$(touch X)"]);
    assert.equal(call.refs, "refs/heads/f a b c\n");
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(path.join(path.dirname(dir), "X")), false);
  });

  it(
    "fails with the installation page when task is not on PATH, with no shell error text of its own",
    POSIX,
    () => {
      const dir = crewrigRepo();
      const r = runHook(dir, binDir(false), ["origin", "u"]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /taskfile\.dev\/installation/);
      assert.doesNotMatch(r.stdout + r.stderr, /command not found/);
    },
  );

  it("exits 0 with a notice outside a CrewRig checkout", POSIX, () => {
    const dir = crewrigRepo();
    fs.rmSync(path.join(dir, "taskfiles", "ci.yml"));
    const r = runHook(dir, binDir(true), ["origin", "u"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not a CrewRig checkout/);
    assert.equal(r.stdout.includes('"argv"'), false, "the task must not run");
  });

  it("runs in the toplevel of each git worktree of one repository", POSIX, () => {
    const dir = crewrigRepo();
    commitAll(dir, "base");
    gitIn(dir, ["config", "--local", "core.hooksPath", ".githooks"]);
    const wt = path.join(makeSandbox("ci-pre-push-wt-"), "wt");
    gitIn(dir, ["worktree", "add", "-q", "-b", "other", wt]);
    const bin = binDir(true);
    const sub = path.join(wt, "taskfiles");
    for (const [top, cwd] of [
      [dir, dir],
      [wt, sub],
    ] as const) {
      const r = spawnSync(path.join(top, ".githooks", "pre-push"), ["origin", "u"], {
        cwd,
        env: { ...gitEnv(), PATH: `${bin}${path.delimiter}/usr/bin:/bin` },
        input: "",
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(fs.realpathSync(fakeCall(r.stdout).cwd), fs.realpathSync(top));
    }
  });
});

describe("ci-pre-push wrapper without node_modules", () => {
  it("fails closed naming `task lint-bootstrap`", POSIX, () => {
    const dir = newRepo();
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.copyFileSync(WRAPPER, path.join(dir, "scripts", "ci-pre-push.ts"));
    const lib = path.join(dir, "scripts", "lib", "ci-pre-push");
    fs.mkdirSync(lib, { recursive: true });
    for (const f of ["hooks.ts", "select.ts", "run.ts"])
      fs.copyFileSync(path.join(REPO, "scripts", "lib", "ci-pre-push", f), path.join(lib, f));
    const r = runIn(path.join(dir, "scripts", "ci-pre-push.ts"), dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /run task lint-bootstrap/);
    assert.doesNotMatch(r.stdout + r.stderr, /command not found|ERR_MODULE_NOT_FOUND/);
  });

  it("treats a git remote named `hooks` as a push, not as the hooks subcommand", POSIX, () => {
    const dir = newRepo();
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.copyFileSync(WRAPPER, path.join(dir, "scripts", "ci-pre-push.ts"));
    const lib = path.join(dir, "scripts", "lib", "ci-pre-push");
    fs.mkdirSync(lib, { recursive: true });
    for (const f of ["hooks.ts", "select.ts", "run.ts"])
      fs.copyFileSync(path.join(REPO, "scripts", "lib", "ci-pre-push", f), path.join(lib, f));
    const entry = path.join(dir, "scripts", "ci-pre-push.ts");
    // Push mode reaches the node_modules check; the subcommand mode would print its usage line.
    const push = runIn(entry, dir, {}, ["--", "hooks", "https://example.invalid/r.git"]);
    assert.notEqual(push.status, 0);
    assert.match(push.stderr, /run task lint-bootstrap/);
    assert.doesNotMatch(push.stdout + push.stderr, /usage: ci-pre-push hooks/);
    const sub = runIn(entry, dir, {}, ["hooks", "bogus"]);
    assert.notEqual(sub.status, 0);
    assert.match(sub.stdout + sub.stderr, /lint-bootstrap|usage/);
  });
});

describe("draft signal confined to ci:lint-specs (R12)", () => {
  const opts = {
    cwd: "/x",
    env: { CREWRIG_PR_DRAFT: "false", PATH: "/usr/bin" },
    baseRef: "origin/main",
  };

  it("sets CREWRIG_PR_DRAFT=true for lint-specs only and exports BASE_REF to all", () => {
    assert.equal(taskEnv("lint-specs", opts)["CREWRIG_PR_DRAFT"], "true");
    assert.equal(taskEnv("lint-markdown", opts)["CREWRIG_PR_DRAFT"], undefined);
    assert.equal(
      taskEnv("lint-markdown", { ...opts, env: { CREWRIG_PR_DRAFT: "true" } })["CREWRIG_PR_DRAFT"],
      undefined,
    );
    assert.equal(taskEnv("lint-markdown", opts)["BASE_REF"], "origin/main");
    const bin = path.join("/repo", "node_modules", ".bin");
    assert.equal(
      taskEnv("lint-markdown", { ...opts, cwd: "/repo", env: { PATH: "/usr/bin" } })["PATH"],
      `${bin}${path.delimiter}/usr/bin`,
    );
    assert.equal(taskEnv("lint-markdown", { ...opts, baseRef: null })["BASE_REF"], undefined);
  });

  it("reaches the spawned task: only ci:lint-specs sees the signal", POSIX, async () => {
    const dir = newRepo();
    const bin = binDir(true);
    const report = await runTasks(["lint-specs", "lint-markdown"], {
      cwd: dir,
      baseRef: "origin/main",
      poolSize: 1,
      env: { PATH: `${bin}${path.delimiter}/usr/bin:/bin`, CREWRIG_PR_DRAFT: "true" },
      log: () => undefined,
    });
    assert.deepEqual(report.failed, []);
    const call = (id: string): FakeCall => {
      const r = report.results.find((x) => x.id === id);
      return fakeCall(r?.output ?? "");
    };
    assert.equal(call("lint-specs").draft, "true");
    assert.equal(call("lint-markdown").draft, null);
    assert.deepEqual(call("lint-specs").argv, ["ci:lint-specs"]);
    assert.equal(call("lint-markdown").base, "origin/main");
  });
});
