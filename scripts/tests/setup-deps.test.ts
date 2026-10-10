// setup-deps.test.ts — the production-dependency step and the spawner of the setup graph (spec 0256
// requirements 20 and 39, plan v2 step B1.9). A fake Spawner and temporary directories: no npm runs.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { SpawnOptions, SpawnResult, Spawner } from "../lib/setup/context.ts";
import { installProductionDependencies, NPM_CI_ARGV } from "../lib/setup/deps-step.ts";
import { createSpawner } from "../lib/setup/spawner.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function mkTemp(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

const LOCK = '{"lockfileVersion":3}\n';
const lockHash = (text: string): string => createHash("sha256").update(text).digest("hex");
const OK: SpawnResult = { status: 0, stdout: "", stderr: "" };

interface Fixture {
  repo: string;
  bin: string;
  out: string[];
  err: string[];
  ctx: Parameters<typeof installProductionDependencies>[0]["ctx"];
}

function fixture(env: Record<string, string> = {}): Fixture {
  const repo = mkTemp("crewrig-deps-");
  const bin = path.join(repo, ".bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\n", { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "package.json"), "{}\n");
  fs.writeFileSync(path.join(repo, "package-lock.json"), LOCK);
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (line: string) => void out.push(line),
    err: (line: string) => void err.push(line),
    errRaw: (text: string) => void err.push(text),
  };
  const ctx = { io, env: { PATH: bin, ...env }, platform: process.platform, repoDir: repo };
  return { repo, bin, out, err, ctx };
}

const stampOf = (fx: Fixture): string =>
  path.join(fx.repo, ".crewrig-state", "production-deps.sha256");
const readStamp = (fx: Fixture): string | undefined =>
  fs.existsSync(stampOf(fx)) ? fs.readFileSync(stampOf(fx), "utf8") : undefined;

interface Call {
  argv: readonly string[];
  options: SpawnOptions | undefined;
}

/** A Spawner that records its calls and, on success, reifies `node_modules` as a real `npm ci` does. */
function fakeSpawner(fx: Fixture, result: SpawnResult = OK): { spawn: Spawner; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: Spawner = (argv, options) => {
    calls.push({ argv, options });
    if (result.status === 0) fs.mkdirSync(path.join(fx.repo, "node_modules"), { recursive: true });
    return result;
  };
  return { spawn, calls };
}

describe("installProductionDependencies", () => {
  test("miss: runs npm ci --omit=dev --workspaces=false at the repo, stdin ignored, stamp written after", () => {
    const fx = fixture();
    const { spawn, calls } = fakeSpawner(fx);
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn }), 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.argv, ["npm", "ci", "--omit=dev", "--workspaces=false"]);
    assert.deepEqual(NPM_CI_ARGV, calls[0]?.argv);
    assert.equal(calls[0]?.options?.cwd, fx.repo);
    assert.equal(calls[0]?.options?.inherit, true);
    assert.equal(calls[0]?.options?.input, undefined);
    assert.deepEqual(fx.out, [
      "Production dependencies: running 'npm ci --omit=dev --workspaces=false'...",
    ]);
    assert.equal(readStamp(fx), `${lockHash(LOCK)}\n`);
  });

  test("hit: the equal stamp skips npm and returns 0 with the shell's skip line", () => {
    const fx = fixture();
    const first = fakeSpawner(fx);
    installProductionDependencies({ ctx: fx.ctx, spawn: first.spawn });
    fx.out.length = 0;
    const second = fakeSpawner(fx);
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn: second.spawn }), 0);
    assert.equal(second.calls.length, 0);
    assert.deepEqual(fx.out, [
      `Production dependencies: skipped — package-lock.json unchanged since the last successful install (sha256 ${lockHash(LOCK).slice(0, 12)}). Delete .crewrig-state/production-deps.sha256 to force a re-install.`,
    ]);
  });

  test("a changed lockfile re-runs npm and re-records the stamp", () => {
    const fx = fixture();
    installProductionDependencies({ ctx: fx.ctx, spawn: fakeSpawner(fx).spawn });
    const changed = '{"lockfileVersion":3,"x":1}\n';
    fs.writeFileSync(path.join(fx.repo, "package-lock.json"), changed);
    const { spawn, calls } = fakeSpawner(fx);
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn }), 0);
    assert.equal(calls.length, 1);
    assert.equal(readStamp(fx), `${lockHash(changed)}\n`);
  });

  test("a removed node_modules invalidates the stamp", () => {
    const fx = fixture();
    installProductionDependencies({ ctx: fx.ctx, spawn: fakeSpawner(fx).spawn });
    fs.rmSync(path.join(fx.repo, "node_modules"), { recursive: true });
    const { spawn, calls } = fakeSpawner(fx);
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn }), 0);
    assert.equal(calls.length, 1);
  });

  test("failure: non-zero, ERROR line, no partial tree, no stamp, stale stamp dropped first", () => {
    const fx = fixture();
    fs.mkdirSync(path.join(fx.repo, ".crewrig-state"));
    fs.writeFileSync(stampOf(fx), "stale\n");
    const { spawn } = fakeSpawner(fx, { status: 1, stdout: "", stderr: "" });
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn }), 1);
    assert.deepEqual(fx.err, [
      "ERROR: production dependency install failed — setup aborted; re-run setup once the cause above is fixed.",
    ]);
    assert.equal(readStamp(fx), undefined);
    assert.equal(fs.existsSync(path.join(fx.repo, "node_modules")), false);
  });

  test("a launch failure message is printed before the ERROR line", () => {
    const fx = fixture();
    const { spawn } = fakeSpawner(fx, { status: 127, stdout: "", stderr: "Error: boom\n" });
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn }), 1);
    assert.equal(fx.err[0], "Error: boom\n");
    assert.match(fx.err[1] ?? "", /^ERROR: production dependency install failed/);
  });

  test("npm absent from PATH, or a foreign directory, returns 1 without spawning", () => {
    const fx = fixture();
    const { spawn, calls } = fakeSpawner(fx);
    const noNpm = { ...fx.ctx, env: { PATH: path.join(fx.repo, "nowhere") } };
    assert.equal(installProductionDependencies({ ctx: noNpm, spawn }), 1);
    assert.equal(fx.err[0], "Error: npm is required but not installed (it ships with Node.js).");
    fs.rmSync(path.join(fx.repo, "package.json"));
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn }), 1);
    assert.match(fx.err.at(-1) ?? "", /is not a repository checkout\.$/);
    assert.equal(calls.length, 0);
  });

  test("a failed stamp write only warns", () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.repo, ".crewrig-state"), "a file, not a directory");
    assert.equal(installProductionDependencies({ ctx: fx.ctx, spawn: fakeSpawner(fx).spawn }), 0);
    assert.match(
      fx.err[0] ?? "",
      /^WARNING: could not record .*production-deps\.sha256 — the next/,
    );
  });
});

describe("createSpawner", () => {
  type Run = NonNullable<Parameters<typeof createSpawner>[1]>["run"];
  interface Seen {
    file: string;
    args: readonly string[];
    options: SpawnSyncOptions;
  }
  const recorder =
    (seen: Seen[]): NonNullable<Run> =>
    (file, args, options) => {
      seen.push({ file, args, options });
      return { status: 0, signal: null, output: [], pid: 1, stdout: "o", stderr: "e" };
    };

  test("the child sees the context environment with the CA variables, overrides apply, stdin is ignored", () => {
    const seen: Seen[] = [];
    const env = { PATH: "/bin", NODE_EXTRA_CA_CERTS: "/ca.pem", DROP: "1" };
    const spawn = createSpawner(
      { env, platform: "linux", repoDir: "/repo" },
      { run: recorder(seen) },
    );
    const res = spawn(NPM_CI_ARGV, { cwd: "/repo", env: { DROP: undefined, EXTRA: "x" } });
    assert.deepEqual(res, { status: 0, stdout: "o", stderr: "e" });
    assert.equal(seen[0]?.file, "npm");
    assert.deepEqual(seen[0]?.args, ["ci", "--omit=dev", "--workspaces=false"]);
    assert.deepEqual(seen[0]?.options.env, {
      PATH: "/bin",
      NODE_EXTRA_CA_CERTS: "/ca.pem",
      EXTRA: "x",
    });
    assert.deepEqual(seen[0]?.options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(seen[0]?.options.cwd, "/repo");
  });

  test("inherit hands the streams to the parent; input opens a pipe for stdin", () => {
    const seen: Seen[] = [];
    const spawn = createSpawner(
      { env: {}, platform: "linux", repoDir: "/r" },
      { run: recorder(seen) },
    );
    spawn(["x"], { inherit: true });
    spawn(["x"], { input: "hello" });
    assert.deepEqual(seen[0]?.options.stdio, ["ignore", "inherit", "inherit"]);
    assert.deepEqual(seen[1]?.options.stdio, ["pipe", "pipe", "pipe"]);
    assert.equal(seen[1]?.options.input, "hello");
  });

  test("a tool that cannot start returns 127 with the message in stderr", () => {
    const run: NonNullable<Run> = () => ({
      status: null,
      signal: null,
      output: [],
      pid: 0,
      stdout: "",
      stderr: "",
      error: new Error("spawn nope ENOENT"),
    });
    const spawn = createSpawner({ env: {}, platform: "linux", repoDir: "/r" }, { run });
    assert.deepEqual(spawn(["nope"]), {
      status: 127,
      stdout: "",
      stderr: "Error: cannot run 'nope': spawn nope ENOENT\n",
    });
  });

  test("win32: npm resolves to npm.cmd and is launched through cmd.exe with an argument array", () => {
    const seen: Seen[] = [];
    const env = {
      PATH: "C:\\tools",
      PATHEXT: ".EXE;.CMD",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    };
    const isFile = (candidate: string): boolean => candidate === "C:\\tools\\npm.CMD";
    const spawn = createSpawner(
      { env, platform: "win32", repoDir: "C:\\repo" },
      { run: recorder(seen), isFile },
    );
    assert.equal(spawn(NPM_CI_ARGV, { cwd: "C:\\repo", inherit: true }).status, 0);
    assert.equal(seen[0]?.file, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(seen[0]?.args, [
      "/d",
      "/s",
      "/c",
      '""C:\\tools\\npm.CMD" ci --omit=dev --workspaces=false"',
    ]);
    assert.equal(seen[0]?.options.windowsVerbatimArguments, true);
  });

  test("win32: a name that is on no PATH entry returns 127 without starting anything", () => {
    const seen: Seen[] = [];
    const spawn = createSpawner(
      { env: { PATH: "C:\\tools" }, platform: "win32", repoDir: "C:\\repo" },
      { run: recorder(seen), isFile: () => false },
    );
    const res = spawn(["npm"]);
    assert.equal(res.status, 127);
    assert.equal(res.stderr, "Error: 'npm' was not found on PATH.\n");
    assert.equal(seen.length, 0);
  });

  test("a real child: captured stdout and stderr, the exit status, stdin only on request", () => {
    const spawn = createSpawner({
      env: process.env,
      platform: process.platform,
      repoDir: os.tmpdir(),
    });
    const script = "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)";
    assert.deepEqual(spawn([process.execPath, "-e", script]), {
      status: 3,
      stdout: "out",
      stderr: "err",
    });
    const echo = "process.stdin.pipe(process.stdout)";
    assert.equal(spawn([process.execPath, "-e", echo], { input: "piped" }).stdout, "piped");
    assert.equal(spawn([process.execPath, "-e", echo]).stdout, "");
  });
});
