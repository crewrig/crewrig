// worktree-claim-lock.test.ts — the claim as an atomic directory (spec 0248
// R17, R19; scenarios 10, 11).
//
// One winner among concurrent takers, the check/create/re-check order of
// `take` (a tree dirtied inside the window releases the claim, appends
// `take-aborted` and exits 5), a ledger that outlives the claim, a `git status`
// that fails is never read as a clean tree, and the gate runs on every
// invocation, a held claim included, but never on `takeover`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { gitShimEnv } from "./lib/git-shim.ts";
import {
  CLAIM_TS,
  cleanEnv,
  cleanupAll,
  makeFixture,
  read,
  runClaim,
  SKIP_POSIX,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const take = (fx: Fixture, agent: string, env = cleanEnv()) =>
  runClaim(["take", "--agent", agent], { cwd: fx.wt, env });
const dirty = (fx: Fixture, name = "dirt.txt"): void =>
  fs.writeFileSync(path.join(fx.wt, name), "dirt\n");

describe("take, status, release round trip (scenario 10)", () => {
  test("exit codes 0, 0, 4, 4, 0, 0 and the files that carry the answer", () => {
    const fx = makeFixture({ ticket: "736" });
    const codes: Array<number | null> = [];
    const run = (...args: string[]) => {
      const res = runClaim(args, { cwd: fx.wt });
      codes.push(res.status);
      return res;
    };
    run("take", "--agent", "alice");
    const status = run("status");
    const second = run("take", "--agent", "bob");
    const wrong = run("release", "--agent", "bob");
    run("release", "--agent", "alice");
    const history = run("history");
    assert.deepEqual(codes, [0, 0, 4, 4, 0, 0]);
    assert.match(status.stdout, /^state: claimed$/m);
    assert.match(status.stdout, /^holder: alice$/m);
    for (const refusal of [second, wrong]) {
      assert.match(refusal.stdout, /^holder: alice$/m);
      assert.match(refusal.stdout, /^since: \d{4}-/m);
    }
    assert.equal(fs.existsSync(fx.claimDir), false);
    assert.match(history.stdout, /\ttake\talice\t736\t/);
    assert.match(history.stdout, /\trelease\talice\t736\t/);
  });

  test("the claim directory holds holder, since, since_epoch and operation while claimed", () => {
    const fx = makeFixture();
    assert.equal(take(fx, "alice").status, 0);
    assert.deepEqual(fs.readdirSync(fx.claimDir).sort(), [
      "holder",
      "operation",
      "since",
      "since_epoch",
    ]);
  });
});

describe("a dirty tree and an unclaimed release (scenario 11; R19)", () => {
  test("an untracked file inside an untracked directory: 5, the nested file listed, no claim; release exits 6", () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.wt, "newdir"));
    fs.writeFileSync(path.join(fx.wt, "newdir", "f.txt"), "x\n");
    const res = take(fx, "alice");
    assert.equal(res.status, 5);
    assert.match(res.stdout, /^\?\? newdir\/f\.txt$/m, "git status --untracked-files=all");
    assert.equal(fs.existsSync(fx.claimDir), false);
    const release = runClaim(["release", "--agent", "alice"], { cwd: fx.wt });
    assert.equal(release.status, 6);
    assert.match(release.stdout, /^Notice: /);
  });

  test("the gate runs on every invocation, a claim already held included", () => {
    const fx = makeFixture();
    assert.equal(take(fx, "alice").status, 0);
    dirty(fx);
    assert.equal(take(fx, "alice").status, 5, "take by the holder");
    const run = runClaim(["run", "--agent", "alice", "--", "true"], { cwd: fx.wt });
    assert.equal(run.status, 5, "run by the holder");
    assert.match(run.stdout, /^Refused: /);
    assert.equal(fs.existsSync(fx.claimDir), true, "the held claim is left as it was");
  });

  test("takeover evaluates no gate and grants no waiver", () => {
    const fx = makeFixture();
    assert.equal(take(fx, "alice").status, 0);
    dirty(fx);
    const takeover = runClaim(["takeover", "--agent", "bob", "--stale-after", "0"], { cwd: fx.wt });
    assert.equal(takeover.status, 0, takeover.stderr);
    assert.equal(take(fx, "bob").status, 5, "the taker still meets the gate");
    assert.equal(runClaim(["status"], { cwd: fx.wt }).stdout.includes("holder: bob"), true);
  });

  test("no subcommand touches a working-tree file", () => {
    const fx = makeFixture();
    fx.git(["status", "--porcelain", "--untracked-files=all"], fx.wt);
    const before = fx.git(["status", "--porcelain", "--untracked-files=all"], fx.wt);
    for (const args of [
      ["take", "--agent", "alice"],
      ["status"],
      ["takeover", "--agent", "bob", "--stale-after", "0"],
      ["history"],
      ["release", "--agent", "bob"],
    ]) {
      runClaim(args, { cwd: fx.wt });
    }
    assert.equal(before, "");
    assert.equal(fx.git(["status", "--porcelain", "--untracked-files=all"], fx.wt), "");
    assert.equal(read(path.join(fx.wt, "tracked.txt")), "seed\n");
  });
});

describe("exactly one winner (R17)", () => {
  test("eight concurrent takers by different agents: one exit 0, seven exit 4", async () => {
    const fx = makeFixture();
    const outcomes = await Promise.all(
      Array.from(
        { length: 8 },
        (_, i) =>
          new Promise<number | null>((resolve) => {
            const child = spawn(process.execPath, [CLAIM_TS, "take", "--agent", `agent${i}`], {
              cwd: fx.wt,
              env: cleanEnv(),
              stdio: "ignore",
            });
            child.on("close", resolve);
          }),
      ),
    );
    assert.equal(outcomes.filter((code) => code === 0).length, 1, outcomes.join(","));
    assert.equal(outcomes.filter((code) => code === 4).length, 7, outcomes.join(","));
    const holder = read(path.join(fx.claimDir, "holder")).trim();
    const ledger = read(fx.ledger).split("\n").filter(Boolean);
    assert.equal(ledger.length, 1, "only the winner wrote a ledger line");
    assert.match(ledger[0] ?? "", new RegExp(`\ttake\t${holder}\t736\t`));
  });
});

describe("take: check, create, re-check (R17)", { skip: SKIP_POSIX }, () => {
  test("a tree dirtied inside the window releases the claim, logs take-aborted and exits 5", () => {
    const fx = makeFixture();
    const count = path.join(fx.root, "status-count");
    const env = gitShimEnv(
      [
        `    n=$(cat ${JSON.stringify(count)} 2>/dev/null || echo 0)`,
        `    n=$((n + 1)); echo "$n" > ${JSON.stringify(count)}`,
        '    "$REAL" "$@"; rc=$?',
        `    [ "$n" = 1 ] && echo dirt > ${JSON.stringify(path.join(fx.wt, "dirt.txt"))}`,
        "    exit $rc",
      ].join("\n"),
    );
    const res = take(fx, "alice", env);
    assert.equal(res.status, 5, res.stderr);
    assert.match(res.stdout, /dirt\.txt/);
    assert.equal(fs.existsSync(fx.claimDir), false, "the claim is released");
    const lines = read(fx.ledger).split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? "",
      /\ttake-aborted\talice\t736\ttree became dirty inside the claim window$/,
    );
  });

  test("a git status that fails is never read as a clean tree: exit 1, the shell tool's diagnostic, no claim", () => {
    const fx = makeFixture();
    const env = gitShimEnv('    echo "fatal: boom" >&2; exit 3');
    for (const args of [
      ["take", "--agent", "alice"],
      ["run", "--agent", "alice", "--", "true"],
    ]) {
      const res = runClaim(args, { cwd: fx.wt, env });
      assert.equal(res.status, 1, `${args[0]}: ${res.stdout}${res.stderr}`);
      assert.match(
        res.stderr,
        /^Error: 'git status' failed in '.*' \(exit 3\), so this run proves$/m,
      );
      assert.match(res.stderr, /nothing about the tree\. Refusing to report it clean\./);
      assert.equal(fs.existsSync(fx.claimDir), false);
    }
  });

  test("an unwritable common directory is a genuine failure: exit 1", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const fx = makeFixture();
    const parent = path.join(fx.common, "crewrig");
    fs.mkdirSync(parent);
    fs.chmodSync(parent, 0o555);
    try {
      const res = take(fx, "alice");
      assert.equal(res.status, 1);
      assert.match(
        res.stderr,
        /^Error: cannot create '.*worktree-claims' — the git common directory is not writable\./,
      );
    } finally {
      fs.chmodSync(parent, 0o755);
    }
  });
});
