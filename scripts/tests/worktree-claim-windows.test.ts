// worktree-claim-windows.test.ts — the `windows-worktree-git-guard` job's claim
// proof (spec 0248 R34(d), R22, plan verification duty 1; scenarios 16, 25).
//
// The sequence of R34(d) runs on every platform, so the Linux capability
// exercises it too: `take`, `status`, the refusal 4 of a second agent, the
// refusal 5 of a dirty tree, `release`, the notice 6, `history`, `takeover` and
// `run` propagating a wrapped `git` command's code, with the claim directory
// and the ledger in the format of R18. The Windows legs need Windows and are
// skipped elsewhere with an explicit SKIP line: launching `.cmd` shims and
// `.exe` files without a shell, a planted `npm.cmd` or `git.exe` that must not
// run, a command that is not found, and a ticket id with a backslash.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  cleanupAll,
  makeFixture,
  read,
  runClaim,
  SKIP_WINDOWS,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

let fx: Fixture;
before(() => {
  fx = makeFixture({ ticket: "1328" });
});
after(cleanupAll);

const claim = (...args: string[]) => runClaim(args, { cwd: fx.wt });

describe("the sequence of R34(d), from a worktree under .worktrees/", () => {
  test("take, status, the second agent's refusal, the dirty tree's refusal, release, the notice, history, takeover", () => {
    const taken = claim("take", "--agent", "alice", "--operation", "windows proof");
    assert.equal(taken.status, 0, taken.stderr);
    assert.match(claim("status").stdout, /^state: claimed$/m);

    const second = claim("take", "--agent", "bob");
    assert.equal(second.status, 4);
    assert.match(second.stdout, /^holder: alice$/m);

    assert.deepEqual(fs.readdirSync(fx.claimDir).sort(), [
      "holder",
      "operation",
      "since",
      "since_epoch",
    ]);
    assert.equal(read(path.join(fx.claimDir, "holder")), "alice\n");
    assert.match(read(path.join(fx.claimDir, "since")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
    assert.match(read(path.join(fx.claimDir, "since_epoch")), /^\d+\n$/);
    assert.equal(read(path.join(fx.claimDir, "operation")), "windows proof\n");

    assert.equal(claim("release", "--agent", "alice").status, 0);
    assert.equal(claim("release", "--agent", "alice").status, 6, "the notice");

    fs.writeFileSync(path.join(fx.wt, "dirt.txt"), "x\n");
    const dirtyTake = claim("take", "--agent", "alice");
    assert.equal(dirtyTake.status, 5);
    assert.match(dirtyTake.stdout, /dirt\.txt/);
    fs.rmSync(path.join(fx.wt, "dirt.txt"));

    assert.equal(claim("take", "--agent", "alice").status, 0);
    assert.equal(claim("takeover", "--agent", "bob", "--stale-after", "0").status, 0);
    assert.match(claim("status").stdout, /^holder: bob$/m);
    assert.equal(claim("release", "--agent", "bob").status, 0);

    const history = claim("history");
    assert.equal(history.status, 0);
    const lines = read(fx.ledger).split("\n").filter(Boolean);
    for (const line of lines) {
      assert.equal(line.split("\t").length, 5, line);
      assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\t/);
    }
    assert.deepEqual(
      lines.map((line) => line.split("\t")[1]),
      ["take", "release", "take", "takeover", "release"],
    );
    assert.ok(history.stdout.includes("takeover\tbob\t1328\tdisplaced=alice"));
    assert.ok(!read(fx.ledger).includes("\r"), "LF line endings, as the shell tool wrote");
  });

  test("run propagates a wrapped git command's code: git exits 0, then 1", () => {
    const ok = claim("run", "--agent", "alice", "--", "git", "--version");
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^git version /);
    const bad = claim("run", "--agent", "alice", "--", "git", "no-such-subcommand-xyz");
    assert.equal(bad.status, 1, "git's own 1 is the wrapped code, with git's own diagnostic");
    assert.match(bad.stderr, /not a git command/);
    assert.equal(fs.existsSync(fx.claimDir), false);
    const code = claim("run", "--agent", "alice", "--", process.execPath, "-e", "process.exit(42)");
    assert.equal(code.status, 42);
  });

  test("the wrapped command runs in the worktree root", () => {
    const res = runClaim(
      ["run", "--agent", "alice", "--", process.execPath, "-p", "process.cwd()"],
      { cwd: fx.sub },
    );
    assert.equal(fs.realpathSync(res.stdout.trim()), fx.wt);
  });

  test("a ticket id that leaves the claim root is refused (scenario 16)", () => {
    const res = claim("status", "--ticket", "../x");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: invalid --ticket '\.\.\/x'/);
  });
});

describe(
  "Windows: a ticket id with a backslash is a separator (R16, scenario 16)",
  { skip: SKIP_WINDOWS },
  () => {
    test("status --ticket ..\\x is refused naming the invalid ticket; nothing outside the claim root is read or written", () => {
      const res = claim("status", "--ticket", "..\\x");
      assert.equal(res.status, 1);
      assert.match(res.stderr, /^Error: invalid --ticket '\.\.\\x'/);
      assert.equal(fs.existsSync(path.join(fx.common, "crewrig", "x")), false);
    });
  },
);

describe(
  "Windows: launching the wrapped command without a shell (R22, duty 1)",
  { skip: SKIP_WINDOWS },
  () => {
    /** A fresh worktree whose planted files are excluded from the status the gate reads. */
    function planted(): Fixture {
      const own = makeFixture({ ticket: "1329" });
      fs.mkdirSync(path.join(own.common, "info"), { recursive: true });
      fs.appendFileSync(path.join(own.common, "info", "exclude"), "npm.cmd\ngit.exe\nran.txt\n");
      return own;
    }

    test("(a) npm --version: a .cmd shim, exit 0, a version on standard output", () => {
      const res = claim("run", "--agent", "alice", "--", "npm", "--version");
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+/);
    });

    test("(b) git --version: an .exe, started directly", () => {
      const res = claim("run", "--agent", "alice", "--", "git", "--version");
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /^git version /);
    });

    test("(c) npm with an argument cmd.exe would read as syntax: exit 1 with Error: before any claim", () => {
      const own = makeFixture({ ticket: "1330" });
      const res = runClaim(["run", "--agent", "alice", "--", "npm", "a&b"], { cwd: own.wt });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /^Error: /);
      assert.equal(fs.existsSync(own.claimDir), false, "no claim was taken");
      assert.equal(fs.existsSync(own.ledger), false, "no take line either");
    });

    test("(d) a planted npm.cmd and git.exe in the worktree root are not run; the control shows the plant would run from there", () => {
      const own = planted();
      const log = path.join(own.wt, "ran.txt");
      fs.writeFileSync(path.join(own.wt, "npm.cmd"), `@echo planted>> "${log}"\r\n`);
      fs.copyFileSync(process.execPath, path.join(own.wt, "git.exe"));

      // Control: a bare spawn from that directory runs the plant (node.exe renamed git.exe prints a Node version).
      const control = spawnSync("git", ["--version"], { cwd: own.wt, encoding: "utf8" });
      assert.match(
        control.stdout,
        /^v\d+\./,
        "the premise of D2 moved: a bare name is no longer resolved from the working directory first; revisit the PATH-only reading",
      );

      const git = runClaim(["run", "--agent", "alice", "--", "git", "--version"], { cwd: own.wt });
      assert.equal(git.status, 0, git.stderr);
      assert.match(git.stdout, /^git version /, "the real git ran, not the planted node.exe");
      const npm = runClaim(["run", "--agent", "alice", "--", "npm", "--version"], { cwd: own.wt });
      assert.equal(npm.status, 0, npm.stderr);
      assert.equal(fs.existsSync(log), false, "the planted npm.cmd did not run");
    });

    test("(e) a command that does not exist: 127, the claim released", () => {
      const own = makeFixture({ ticket: "1331" });
      const res = runClaim(["run", "--agent", "alice", "--", "no-such-command-xyz"], {
        cwd: own.wt,
      });
      assert.equal(res.status, 127);
      assert.match(res.stderr, /no-such-command-xyz/);
      assert.equal(fs.existsSync(own.claimDir), false);
    });
  },
);
