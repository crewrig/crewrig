// worktree-claim-cli.test.ts — the surface and the exit contract of
// scripts/worktree-claim.ts (spec 0248 R14, R15, R16, R38(a); scenario 16).
//
// The error wording of every refusal is pinned by the golden record
// (worktree-claim-golden.test.ts); this suite covers what that record cannot
// say about itself: the `--help` block's invocation lines (R38(a)), options in
// any order, `--` ending option parsing, `CREWRIG_REPO_DIR`, the physical
// claim root from every working directory, ticket validation and a refusal
// that never lets the wrapped command start (R15).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  cleanEnv,
  cleanupAll,
  makeFixture,
  realTmp,
  runClaim,
  SKIP_POSIX,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

let fx: Fixture;
before(() => {
  fx = makeFixture();
});
after(cleanupAll);

describe("usage and help (R14, R38(a))", () => {
  test("no argument: the usage block on standard output, exit 1", () => {
    const res = runClaim([], { cwd: fx.wt });
    assert.equal(res.status, 1);
    assert.match(
      res.stdout,
      /^worktree-claim\.ts — exclusive, attributable claims|^worktree-claim/,
    );
    assert.equal(res.stderr, "");
  });

  test("--help and -h: exit 0, the same block", () => {
    const long = runClaim(["--help"], { cwd: fx.wt });
    const short = runClaim(["-h"], { cwd: fx.wt });
    assert.equal(long.status, 0);
    assert.equal(short.status, 0);
    assert.equal(long.stdout, short.stdout);
    assert.equal(runClaim([], { cwd: fx.wt }).stdout, long.stdout);
  });

  test("the invocation lines name the TypeScript tool, never the shell script (R38(a))", () => {
    const { stdout } = runClaim(["--help"], { cwd: fx.wt });
    for (const sub of ["run", "take", "release", "takeover", "status", "history"]) {
      assert.match(stdout, new RegExp(`^ {2}node scripts/worktree-claim\\.ts ${sub} `, "m"), sub);
    }
    assert.doesNotMatch(stdout, /bash scripts\/worktree-claim\.sh/);
  });

  test("the contract survives the port: exit codes, the overlap warning and the ignored-state limit", () => {
    const { stdout } = runClaim(["--help"], { cwd: fx.wt });
    assert.match(stdout, /Exit codes: 0 success \| 1 genuine failure \| 4 refused, claim state/);
    assert.match(stdout, /Those last four overlap\./);
    assert.match(stdout, /Branch on that output, not on the number alone\./);
    assert.match(stdout, /The claim protects work git can name as\ntracked or untracked/);
    assert.match(stdout, /A non-negative integer of at most 9 digits/);
  });

  test("no output line carries the text `worktree-claim.sh:` (the Bash oracle's want_no_shell_error)", () => {
    for (const args of [[], ["--help"], ["frobnicate"], ["take"], ["take", "--agent"]]) {
      const res = runClaim(args, { cwd: fx.wt });
      assert.doesNotMatch(res.stdout + res.stderr, /worktree-claim\.sh:/, args.join(" "));
    }
  });
});

describe("option parsing (R14)", () => {
  test("options come in any order and the last of a repeated option wins", () => {
    const res = runClaim(["take", "--operation", "x", "--ticket", "736", "--agent", "alice"], {
      cwd: fx.wt,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^operation: x$/m);
    runClaim(["release", "--agent", "alice"], { cwd: fx.wt });
    const twice = runClaim(["take", "--agent", "alice", "--agent", "bob"], { cwd: fx.wt });
    assert.match(twice.stdout, /^holder: bob$/m);
    runClaim(["release", "--agent", "bob"], { cwd: fx.wt });
  });

  test("status and history accept an --agent they do not need (the shell parser did)", () => {
    assert.equal(runClaim(["status", "--agent", "alice"], { cwd: fx.wt }).status, 0);
    assert.equal(runClaim(["history", "--agent", "alice"], { cwd: fx.wt }).status, 0);
  });

  test("`--` ends option parsing: the wrapped command keeps every argument, option-shaped or not", () => {
    const res = runClaim(
      [
        "run",
        "--agent",
        "alice",
        "--",
        process.execPath,
        "-p",
        "process.argv.slice(1).join('|')",
        "--",
        "--agent",
        "x",
        "--help",
        "--",
      ],
      { cwd: fx.wt },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), "--agent|x|--help|--");
  });
});

describe("a refusal run raises itself never starts the wrapped command (R15)", () => {
  function marker(): { file: string; command: string[] } {
    const file = path.join(realTmp("crewrig-marker-"), "ran");
    return {
      file,
      command: [
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(file)}, "ran")`,
      ],
    };
  }

  test("claimed by another agent: exit 4, Refused: on stdout, no wrapped output", () => {
    const own = makeFixture();
    runClaim(["take", "--agent", "alice"], { cwd: own.wt });
    const m = marker();
    const res = runClaim(["run", "--agent", "bob", "--", ...m.command], { cwd: own.wt });
    assert.equal(res.status, 4);
    assert.match(res.stdout, /^Refused: /);
    assert.equal(fs.existsSync(m.file), false);
  });

  test("a dirty tree: exit 5, Refused: on stdout", () => {
    const own = makeFixture();
    fs.writeFileSync(path.join(own.wt, "d.txt"), "x");
    const m = marker();
    const res = runClaim(["run", "--agent", "bob", "--", ...m.command], { cwd: own.wt });
    assert.equal(res.status, 5);
    assert.match(res.stdout, /^Refused: /);
    assert.equal(fs.existsSync(m.file), false);
  });

  test("outside .worktrees/: exit 1, Error: on stderr", () => {
    const m = marker();
    const res = runClaim(["run", "--agent", "bob", "--", ...m.command], { cwd: fx.main });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: /);
    assert.equal(fs.existsSync(m.file), false);
  });
});

describe("repository context (R16; oracle case 12)", () => {
  test("the claim root prints as one physical string from the main checkout, the worktree and each subdirectory", () => {
    const own = makeFixture();
    const cwds = [own.main, path.join(own.main, "sub"), own.wt, own.sub];
    const roots = cwds.map((cwd) => {
      const res = runClaim(["status", "--ticket", "736"], { cwd });
      assert.equal(res.status, 0, `${cwd}: ${res.stderr}`);
      return /^claim-root: (.*)$/m.exec(res.stdout)?.[1];
    });
    assert.deepEqual(new Set(roots), new Set([own.claimRoot]));
  });

  test("through a symlink the answer is still the physical string", { skip: SKIP_POSIX }, () => {
    const own = makeFixture();
    assert.ok(own.link !== null, "the fixture built its symlink");
    for (const sub of ["repo", "repo/sub"]) {
      const res = runClaim(["status", "--ticket", "736"], { cwd: path.join(own.link ?? "", sub) });
      assert.equal(/^claim-root: (.*)$/m.exec(res.stdout)?.[1], own.claimRoot, sub);
    }
  });

  test("CREWRIG_REPO_DIR names the repository inspected, and the tree `run` executes in", () => {
    const own = makeFixture();
    const elsewhere = realTmp("crewrig-elsewhere-");
    const env = cleanEnv({ CREWRIG_REPO_DIR: own.wt });
    assert.match(runClaim(["status"], { cwd: elsewhere, env }).stdout, /^ticket: 736$/m);
    const run = runClaim(
      ["run", "--agent", "alice", "--", process.execPath, "-p", "process.cwd()"],
      {
        cwd: elsewhere,
        env,
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.realpathSync(run.stdout.trim()), own.wt);
  });

  test("status and history answer from the main checkout after the worktree is removed", () => {
    const own = makeFixture();
    runClaim(["take", "--agent", "alice"], { cwd: own.wt });
    runClaim(["release", "--agent", "alice"], { cwd: own.wt });
    own.git(["worktree", "remove", "--force", own.wt]);
    const history = runClaim(["history", "--ticket", "736"], { cwd: own.main });
    assert.equal(history.status, 0);
    assert.match(history.stdout, /\ttake\talice\t736\t/);
    assert.match(
      runClaim(["status", "--ticket", "736"], { cwd: own.main }).stdout,
      /last-action: release/,
    );
  });

  test("a ticket id is a single path component (scenario 16)", () => {
    for (const ticket of ["../x", "..", ".", "a/b", "x/"]) {
      const res = runClaim(["status", "--ticket", ticket], { cwd: fx.wt });
      assert.equal(res.status, 1, ticket);
      assert.match(res.stderr, /^Error: invalid --ticket /, ticket);
    }
    assert.equal(fs.existsSync(path.join(fx.common, "crewrig", "x")), false);
  });

  test("an invalid ticket from --ticket also refuses the mutating subcommands, before any write", () => {
    const own = makeFixture();
    const res = runClaim(["take", "--agent", "a", "--ticket", ".."], { cwd: own.wt });
    assert.equal(res.status, 1);
    assert.equal(fs.existsSync(own.claimRoot), false);
  });
});
