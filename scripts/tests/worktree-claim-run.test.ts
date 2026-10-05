// worktree-claim-run.test.ts — `run` (spec 0248 R21, R22; scenarios 12-14, 17;
// v1-F7).
//
// Release only when this invocation acquired the claim and still holds it; the
// claim is never released while the wrapped command runs, an interrupt or a
// termination request included (the shell tool's deferred trap); the wrapped
// command's code is `run`'s own, with 126, 127 and 128 plus the signal number
// for a command that cannot start or that a signal ended. The signal legs are
// POSIX only; the Windows legs are in worktree-claim-windows.test.ts.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  CLAIM_TS,
  cleanEnv,
  cleanupAll,
  makeFixture,
  read,
  realTmp,
  runClaim,
  SKIP_POSIX,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const node = (script: string): string[] => [process.execPath, "-e", script];
const run = (fx: Fixture, agent: string, command: string[], cwd = fx.wt) =>
  runClaim(["run", "--agent", agent, "--", ...command], { cwd });
const ledger = (fx: Fixture): string[] =>
  fs.existsSync(fx.ledger) ? read(fx.ledger).split("\n").filter(Boolean) : [];
const actions = (fx: Fixture): string[] => ledger(fx).map((line) => line.split("\t")[1] ?? "");

describe("release on both outcomes and the wrapped code (scenario 12)", () => {
  test("0 and 42: no claim remains, the ledger records `take` and `release alice <ticket> run`", () => {
    const fx = makeFixture();
    assert.equal(run(fx, "alice", ["true"]).status, 0);
    assert.equal(run(fx, "alice", node("process.exit(42)")).status, 42);
    assert.equal(fs.existsSync(fx.claimDir), false);
    assert.deepEqual(actions(fx), ["take", "release", "take", "release"]);
    assert.match(ledger(fx)[1] ?? "", /\trelease\talice\t736\trun$/);
    assert.match(ledger(fx)[0] ?? "", /\ttake\talice\t736\trun: true$/);
  });

  test("the wrapped command's streams are inherited unchanged", () => {
    const fx = makeFixture();
    const res = run(fx, "alice", node("process.stdout.write('out'); process.stderr.write('err')"));
    assert.equal(res.stdout, "out");
    assert.equal(res.stderr, "err");
  });

  test("the claim is held for the whole duration of the command, and not released while it runs", () => {
    const fx = makeFixture();
    const probe = `process.exit(require("node:fs").existsSync(${JSON.stringify(fx.claimDir)}) ? 0 : 9)`;
    assert.equal(run(fx, "alice", node(probe)).status, 0);
  });
});

describe("the working directory (scenario 13)", () => {
  test("the wrapped command runs at the toplevel whichever directory the caller stood in", () => {
    const fx = makeFixture();
    const res = run(fx, "alice", node("process.stdout.write(process.cwd())"), fx.sub);
    assert.equal(fs.realpathSync(res.stdout), fx.wt);
  });
});

describe("re-entrance (R21)", () => {
  test("a caller that already holds the claim proceeds without acquiring and does not release it", () => {
    const fx = makeFixture();
    runClaim(["take", "--agent", "alice"], { cwd: fx.wt });
    assert.equal(run(fx, "alice", ["true"]).status, 0);
    assert.equal(fs.existsSync(fx.claimDir), true, "alice's own hold survives the run");
    assert.deepEqual(actions(fx), ["take", "run-reentrant"]);
  });
});

describe("a claim that changes under the run (scenario 14)", () => {
  test("a takeover inside the run survives it: release-declined, no `release alice`", () => {
    const fx = makeFixture();
    const script = `
      const fs = require("node:fs");
      fs.writeFileSync(${JSON.stringify(path.join(fx.claimDir, "since_epoch"))}, "1\\n");
      const r = require("node:child_process").spawnSync(process.execPath,
        [${JSON.stringify(CLAIM_TS)}, "takeover", "--agent", "bob"], { stdio: "inherit" });
      process.exit(r.status);`;
    const res = run(fx, "alice", node(script));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Took over '736' from 'alice'/);
    assert.match(res.stderr, /^Notice: 'bob' took over the claim on '736' while this run$/m);
    assert.match(res.stderr, /left intact and the ledger records a declined release\.$/m);
    assert.equal(read(path.join(fx.claimDir, "holder")), "bob\n");
    assert.equal(runClaim(["take", "--agent", "carol"], { cwd: fx.wt }).status, 4);
    assert.ok(!ledger(fx).some((line) => /\trelease\talice\t/.test(line)), "no release alice");
    assert.ok(
      ledger(fx).some((line) =>
        /\trelease-declined\talice\t736\trun: displaced by 'bob'; claim left intact$/.test(line),
      ),
    );
  });

  test("a claim that is gone at exit is not released again: release-declined, the two-line Notice, the wrapped code kept", () => {
    const fx = makeFixture();
    const script = `require("node:fs").rmSync(${JSON.stringify(fx.claimDir)}, { recursive: true }); process.exit(7)`;
    const res = run(fx, "alice", node(script));
    assert.equal(res.status, 7);
    assert.match(
      res.stderr,
      /^Notice: the claim on '736' was already gone when this run exited;$/m,
    );
    assert.match(res.stderr, /nothing was released\. Run 'history' to see what happened to it\.$/m);
    assert.deepEqual(actions(fx), ["take", "release-declined"]);
  });
});

describe("a wrapped command that cannot start (scenario 17; R22)", () => {
  test("not found: 127, a diagnostic naming the command, the claim released", () => {
    const fx = makeFixture();
    const res = run(fx, "alice", ["no-such-command-xyz"]);
    assert.equal(res.status, 127);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /no-such-command-xyz/);
    assert.match(res.stderr, /^Error: /);
    assert.doesNotMatch(res.stderr, /line \d+:/, "no shell worded it");
    assert.equal(fs.existsSync(fx.claimDir), false);
  });

  test(
    "not executable, and a directory: 126, a diagnostic naming the command, the claim released",
    { skip: SKIP_POSIX },
    () => {
      const fx = makeFixture();
      const dir = realTmp("crewrig-launch-");
      const plain = path.join(dir, "plain.sh");
      fs.writeFileSync(plain, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
      for (const target of [plain, dir]) {
        const res = run(fx, "alice", [target]);
        assert.equal(res.status, 126, `${target}: ${res.stderr}`);
        assert.ok(res.stderr.includes(target), res.stderr);
        assert.equal(fs.existsSync(fx.claimDir), false);
      }
    },
  );

  test("a command ended by a signal gives 128 plus the signal number", { skip: SKIP_POSIX }, () => {
    const fx = makeFixture();
    assert.equal(run(fx, "alice", node("process.kill(process.pid, 'SIGTERM')")).status, 143);
    assert.equal(run(fx, "alice", node("process.kill(process.pid, 'SIGKILL')")).status, 137);
    assert.equal(run(fx, "alice", node("process.kill(process.pid, 'SIGINT')")).status, 130);
    assert.equal(fs.existsSync(fx.claimDir), false, "released after each");
  });

  test("no shell reads the arguments: metacharacters reach the command as they are", () => {
    const fx = makeFixture();
    const res = run(fx, "alice", [
      process.execPath,
      "-p",
      "process.argv.slice(1).join('|')",
      "--",
      "a b",
      "$HOME",
      "x;touch pwned",
      "`id`",
    ]);
    assert.equal(res.stdout.trim(), "a b|$HOME|x;touch pwned|`id`");
    assert.equal(fs.existsSync(path.join(fx.wt, "pwned")), false);
  });
});

interface Live {
  readonly pid: number;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly stderr: () => string;
}

/** Start `run` as a child and wait until its claim exists, so a signal lands while the command runs. */
async function startRun(fx: Fixture, command: string[], detached: boolean): Promise<Live> {
  const child = spawn(process.execPath, [CLAIM_TS, "run", "--agent", "alice", "--", ...command], {
    cwd: fx.wt,
    env: cleanEnv(),
    detached,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  for (let i = 0; i < 200 && !fs.existsSync(path.join(fx.claimDir, "holder")); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(fs.existsSync(fx.claimDir), "the claim was taken");
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { pid: child.pid ?? 0, closed, stderr: () => stderr };
}

const sleeper = (marker: string, ms: number): string[] =>
  node(
    `setTimeout(() => { require("node:fs").writeFileSync(${JSON.stringify(marker)}, "done"); }, ${ms})`,
  );

describe("interrupt and termination (R21, POSIX)", { skip: SKIP_POSIX }, () => {
  test("SIGTERM to run alone: the command is untouched, the claim is held until it ends, then released; the code is the command's", async () => {
    const fx = makeFixture();
    const marker = path.join(realTmp("crewrig-marker-"), "done");
    const live = await startRun(fx, sleeper(marker, 1500), false);
    process.kill(live.pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(fs.existsSync(fx.claimDir), true, "not released while the command still runs");
    assert.equal(fs.existsSync(marker), false, "the command was not interrupted");
    const end = await live.closed;
    assert.equal(end.signal, null, "run did not die of the signal");
    assert.equal(end.code, 0, live.stderr());
    assert.equal(fs.existsSync(marker), true);
    assert.equal(fs.existsSync(fx.claimDir), false, "released after the command ended");
    assert.deepEqual(actions(fx), ["take", "release"]);
  });

  test("SIGINT to the whole process group: the command dies of it, run exits 130 and releases the claim", async () => {
    const fx = makeFixture();
    const marker = path.join(realTmp("crewrig-marker-"), "done");
    const live = await startRun(fx, sleeper(marker, 5000), true);
    process.kill(-live.pid, "SIGINT");
    const end = await live.closed;
    assert.equal(end.code, 130, `${end.signal} ${live.stderr()}`);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(fx.claimDir), false, "released once the command ended");
    assert.deepEqual(actions(fx), ["take", "release"]);
  });

  test("SIGHUP is not handled: run is ended by it at once (v1-F7), as the shell tool's INT/TERM-only trap left it", async () => {
    const fx = makeFixture();
    const marker = path.join(realTmp("crewrig-marker-"), "done");
    const live = await startRun(fx, sleeper(marker, 1500), true);
    process.kill(live.pid, "SIGHUP");
    const started = Date.now();
    const end = await live.closed;
    assert.equal(end.signal, "SIGHUP", `code ${end.code}`);
    assert.ok(Date.now() - started < 1000, "run did not wait for the command");
    // The orphaned command finishes by itself; the claim it leaves is the shell tool's too.
    process.kill(-live.pid, "SIGKILL");
  });
});
