// worktree-claim-golden.test.ts — the TypeScript claim tool against the shell
// tool's recorded behaviour (spec 0248 R18, scenario "Both implementations
// share a repository", plan steps 19-20 and verification duty 5).
//
// scripts/tests/fixtures/worktree-claim/golden/ holds data captured from the
// shell tool at 7302366 (`git show 7302366:scripts/worktree-claim.sh`), run on
// macOS over a scripted matrix:
//   - seeds/<name>/        claim directories and ledgers the shell tool wrote
//                          (`since` and `since_epoch` pinned to fixed values so
//                          the seeds do not age);
//   - matrix.json          each scenario's steps and, per step, the shell tool's
//                          exit status, standard streams and the state of the
//                          claim root afterwards, with the fixture paths, the
//                          ISO timestamps and the held-for-seconds count replaced
//                          by placeholders.
// Replaying a scenario against scripts/worktree-claim.ts must give the same
// record: the same answer over state the shell tool wrote, and files the shell
// tool would read back byte for byte. The reverse direction (the shell tool over
// state this tool wrote) follows from the byte identity asserted here; CI cannot
// hold a shell copy of the tool (ratchet), so it is shown once by the DEV
// differential run recorded on the logbook.
//
// The golden record comes from a POSIX host: paths print in the platform's
// native form on Windows (R23), so these legs are skipped there and the
// `windows-latest` job asserts the format instead (worktree-claim-windows).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { replayScenario, type GoldenOutcome, type GoldenScenario } from "./lib/golden-replay.ts";
import {
  CLAIM_TS,
  cleanEnv,
  cleanupAll,
  makeFixture,
  read,
  REPO,
  runClaim,
  SKIP_POSIX,
} from "./lib/worktree-fixtures.ts";

const GOLDEN = path.join(REPO, "scripts", "tests", "fixtures", "worktree-claim", "golden");
const SEEDS = path.join(GOLDEN, "seeds");

interface Matrix {
  readonly source: string;
  readonly scenarios: ReadonlyArray<GoldenScenario & { readonly expect: GoldenOutcome[] }>;
}

const matrix = JSON.parse(read(path.join(GOLDEN, "matrix.json"))) as Matrix;

after(cleanupAll);

describe("the golden record is well formed", () => {
  test("every scenario has one recorded outcome per step", () => {
    assert.ok(matrix.scenarios.length >= 20, "the matrix is not empty");
    for (const scenario of matrix.scenarios) {
      assert.equal(scenario.expect.length, scenario.steps.length, scenario.id);
    }
  });

  test("the seeds are the on-disk format of R18: four one-line files and a five-field ledger", () => {
    for (const name of fs.readdirSync(SEEDS)) {
      const claim = path.join(SEEDS, name, "736");
      if (fs.existsSync(claim)) {
        assert.deepEqual(fs.readdirSync(claim).sort(), [
          "holder",
          "operation",
          "since",
          "since_epoch",
        ]);
        assert.match(read(path.join(claim, "since")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
        assert.match(read(path.join(claim, "since_epoch")), /^\d+\n$/);
      }
      for (const line of read(path.join(SEEDS, name, "736.log"))
        .split("\n")
        .filter(Boolean)) {
        assert.equal(line.split("\t").length, 5, `${name}: ${JSON.stringify(line)}`);
      }
    }
  });
});

describe("the TypeScript tool reproduces the shell tool's record", { skip: SKIP_POSIX }, () => {
  const tsRunner = (
    args: readonly string[],
    options: { cwd: string; env: Record<string, string> },
  ) => runClaim(args, { cwd: options.cwd, env: cleanEnv(options.env) });

  for (const scenario of matrix.scenarios) {
    test(`${scenario.id}: ${scenario.description}`, () => {
      const got = replayScenario(scenario, tsRunner, SEEDS, `node ${CLAIM_TS}`);
      assert.equal(got.length, scenario.expect.length);
      scenario.steps.forEach((step, i) => {
        const label = `step ${i} ${JSON.stringify(step.args)} in ${step.cwd ?? "wt"}`;
        const want = scenario.expect[i] as GoldenOutcome;
        const have = got[i] as GoldenOutcome;
        assert.equal(have.exit, want.exit, `${label}: exit status`);
        assert.equal(have.stdout, want.stdout, `${label}: standard output`);
        assert.equal(have.stderr, want.stderr, `${label}: standard error`);
        assert.deepEqual(have.files, want.files, `${label}: claim root afterwards`);
      });
    });
  }
});

describe("what this tool writes, byte for byte (R18)", { skip: SKIP_POSIX }, () => {
  test("take writes holder, since, since_epoch and operation, one line each, LF-terminated", () => {
    const fx = makeFixture();
    const before = Math.floor(Date.now() / 1000);
    const res = runClaim(["take", "--agent", "alice", "--operation", "unit tests"], { cwd: fx.wt });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readdirSync(fx.claimDir).sort(), [
      "holder",
      "operation",
      "since",
      "since_epoch",
    ]);
    assert.equal(read(path.join(fx.claimDir, "holder")), "alice\n");
    assert.equal(read(path.join(fx.claimDir, "operation")), "unit tests\n");
    assert.match(read(path.join(fx.claimDir, "since")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
    const epoch = read(path.join(fx.claimDir, "since_epoch"));
    assert.match(epoch, /^[1-9]\d{9}\n$/);
    assert.ok(Math.abs(Number(epoch) - before) < 30, "since_epoch is the wall clock, in seconds");
    // `since` and `since_epoch` name the same second.
    const iso = read(path.join(fx.claimDir, "since")).trim();
    assert.equal(Date.parse(iso) / 1000, Number(epoch));
  });

  test("the ledger is a sibling of the claim directory: five tab-separated fields per event, append-only", () => {
    const fx = makeFixture();
    runClaim(["take", "--agent", "alice", "--operation", "a\tb\nc\rd"], { cwd: fx.wt });
    runClaim(["release", "--agent", "alice"], { cwd: fx.wt });
    assert.equal(path.dirname(fx.ledger), path.dirname(fx.claimDir));
    const lines = read(fx.ledger).split("\n");
    assert.equal(lines.pop(), "", "the last line ends with a line feed");
    assert.equal(lines.length, 2);
    const [take, release] = lines.map((line) => line.split("\t"));
    assert.equal(take?.length, 5);
    assert.match(take?.[0] ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(take?.slice(1), ["take", "alice", "736", "a b c d"]);
    assert.deepEqual(release?.slice(1), ["release", "alice", "736", ""]);
    assert.ok(
      fs.existsSync(fx.ledger) && !fs.existsSync(fx.claimDir),
      "the ledger outlives the claim",
    );
  });
});
