// worktree-guard-graph.test.ts — the claim module graph and the processes the guard starts
// (spec 0248 R3, R11, R12, R24; scenarios 1, 2).
//
// Black-box: every test spawns the real entry the way a CLI does (see
// worktree-guard-decision.test.ts for the conventions). Allowed outcomes are
// asserted silent (R10), refusals exact (R9).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { allowed, payload, refused } from "./lib/guard-asserts.ts";
import { makeGuardTree, MARKER_CLAIM_STATE, type GuardTree } from "./lib/guard-tree.ts";
import type { SpyRecord } from "./lib/spawn-spy.ts";
import {
  cleanEnv,
  cleanupAll,
  makeFixture,
  realTmp,
  runGuard,
  SKIP_POSIX,
  writeClaim,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

const SPY = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "spawn-spy.ts");

let unclaimed: Fixture;
let claimed: Fixture;

before(() => {
  unclaimed = makeFixture({ ticket: "771" });
  claimed = makeFixture({ ticket: "771" });
  writeClaim(claimed, { holder: "alice" });
});
after(cleanupAll);

describe("the claim module graph is loaded only when needed (R11; scenarios 1, 2)", () => {
  let tree: GuardTree;
  let n = 0;
  before(() => {
    tree = makeGuardTree({ claimState: MARKER_CLAIM_STATE });
  });
  after(() => tree.cleanup());

  function fire(input: string, stub: string, cwd = unclaimed.wt, args: string[] = []) {
    n += 1;
    const marker = path.join(tree.root, `marker-${n}`);
    const res = runGuard(input, {
      cwd,
      args,
      entry: tree.entry,
      env: cleanEnv({ MARKER: marker, STUB_STATE: stub }),
    });
    return {
      res,
      marker,
      lines: fs.existsSync(marker)
        ? fs.readFileSync(marker, "utf8").split("\n").filter(Boolean)
        : [],
    };
  }

  test("a safe command in a ticket worktree: allowed, graph not loaded", () => {
    const run = fire(payload("git status", unclaimed.wt), "unclaimed");
    allowed(run.res);
    assert.deepEqual(run.lines, []);
  });

  test("a stash verb the exemption allows: graph not loaded", () => {
    const run = fire(payload("git stash list", unclaimed.wt), "unclaimed");
    allowed(run.res);
    assert.deepEqual(run.lines, []);
  });

  test("a working directory outside any worktree: allowed, graph not loaded", () => {
    const run = fire(payload("git reset --hard", "/tmp/some-dir"), "unclaimed");
    allowed(run.res);
    assert.deepEqual(run.lines, []);
  });

  test("an empty ticket id: allowed, graph not loaded", () => {
    const run = fire(payload("git reset --hard", "/x/.worktrees/"), "unclaimed");
    allowed(run.res);
    assert.deepEqual(run.lines, []);
  });

  for (const [name, input] of [
    ["an unparsable payload", "not json"],
    ["an empty payload", ""],
    ["a JSON array", "[1]"],
  ] as const) {
    test(`${name}: allowed, graph not loaded`, () => {
      const run = fire(input, "unclaimed");
      allowed(run.res);
      assert.deepEqual(run.lines, []);
    });
  }

  test("a prohibited command in a ticket worktree loads the graph exactly once and reads the ticket", () => {
    const run = fire(payload("git reset --hard", unclaimed.wt), "unclaimed");
    refused(run.res, "771");
    assert.deepEqual(run.lines, ["loaded", "called 771"]);
  });

  test("the stub's `claimed` allows and its `undetermined` refuses", () => {
    const yes = fire(payload("git reset --hard", unclaimed.wt), "claimed");
    allowed(yes.res);
    assert.deepEqual(yes.lines, ["loaded", "called 771"]);
    const unknown = fire(payload("git reset --hard", unclaimed.wt), "undetermined");
    refused(unknown.res, "771");
  });

  test("canary: an entry that loads the graph before it decides is caught by this harness", () => {
    const source = fs.readFileSync(tree.entry, "utf8");
    const marked = source.replace(
      /(process\.removeAllListeners\(["']warning["']\);?)/,
      '$1\nimport("../scripts/lib/worktree-claim/claim-state.ts").catch(() => {});',
    );
    assert.notEqual(marked, source, "the entry's first statement is the listener removal (R10)");
    const variant = path.join(tree.root, "hooks", "regressed-guard.ts");
    fs.writeFileSync(variant, marked);
    n += 1;
    const marker = path.join(tree.root, `marker-${n}`);
    runGuard(payload("git status", unclaimed.wt), {
      cwd: unclaimed.wt,
      entry: variant,
      env: cleanEnv({ MARKER: marker, STUB_STATE: "unclaimed" }),
    });
    assert.ok(fs.existsSync(marker), "the regressed variant loads the graph for a safe command");
  });
});

describe(
  "no other process is started (R3, R11, R12, R24; scenario 1)",
  { skip: SKIP_POSIX },
  () => {
    function spawned(input: string, cwd: string, env: NodeJS.ProcessEnv = cleanEnv()): SpyRecord[] {
      const logFile = path.join(realTmp("crewrig-spy-"), "spy.log");
      runGuard(input, {
        cwd,
        nodeArgs: ["--import", SPY],
        env: { ...env, SPAWN_SPY_LOG: logFile },
      });
      return fs.existsSync(logFile)
        ? fs
            .readFileSync(logFile, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as SpyRecord)
        : [];
    }

    test("the fast path starts no process", () => {
      assert.deepEqual(spawned(payload("git status", unclaimed.wt), unclaimed.wt), []);
      assert.deepEqual(spawned(payload("git reset --hard", "/tmp/x"), unclaimed.wt), []);
      assert.deepEqual(spawned("not json", unclaimed.wt), []);
    });

    test("the slow path starts git and nothing else: no bash, sh, jq, no claim tool", () => {
      for (const fixture of [unclaimed, claimed]) {
        const records = spawned(payload("git reset --hard", fixture.wt), fixture.wt);
        assert.ok(records.length > 0, "git is consulted for the repository");
        for (const record of records) {
          assert.match(path.basename(record.file), /^git(\.exe)?$/, JSON.stringify(record));
        }
      }
    });
  },
);
