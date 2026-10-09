// build-components-differential.test.ts — the UNCHANGED shell script against the TypeScript entry
// over a fixture matrix (spec 0250 R6, R8, R9, R13, R33; plan step 22; Linux gate, or
// CREWRIG_SHELL_PARITY=1: it spawns `bash` and `yq`; it retires in PR D, which replaces the
// shell script). The real tree is in -differential-real.test.ts, the closed deviations that
// change what is built in -differential-deviations.test.ts.
//
// Per row (fixtures/build-components/differential-compare.ts): exit status, standard output,
// standard error, the produced tree (path, mode, content hash) and what is left under `TMPDIR`
// must be equal after the scratch roots, temporary names and merge pids are normalised. A row
// may declare `deviation: R33(<letter>)`: the table there maps each letter to the transform
// that turns the shell's outcome into the entry's, the transform MUST change something (a listed
// deviation that vanishes fails), and anything else that differs fails (an unlisted difference).
// The shell side runs under LC_ALL=C (R33(l)).

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { compare, expectSame } from "./fixtures/build-components/differential-compare.ts";
import {
  makePair,
  normalise,
  runShell,
  runTs,
  splitProgress,
} from "./fixtures/build-components/differential-kit.ts";
import { collision, rich } from "./fixtures/build-components/differential-trees.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const SKIP = parityGate();
describe(
  "the rich tree: every target and tier filter builds the same bytes",
  { skip: SKIP },
  () => {
    const rows: Array<[string, string[]]> = [
      ["--target gemini", ["--target", "gemini"]],
      ["--target claude", ["--target", "claude"]],
      ["--target copilot", ["--target", "copilot"]],
      ["--target antigravity", ["--target", "antigravity"]],
      ["--target all (default)", []],
      ["--target nope (no CLI)", ["--target", "nope"]],
      ["--tier core", ["--tier", "core"]],
      [
        "--tier library --tier community --target claude",
        ["--tier", "library", "--tier", "community", "--target", "claude"],
      ],
      ["--tier nope", ["--tier", "nope"]],
    ];
    for (const [label, args] of rows) {
      test(label, () => {
        compare(makePair(rich), { args });
      });
    }

    test("the progress lines test-component-tier-resolution.sh filters on are byte-identical, and so is the rest", () => {
      const { shell, ts } = compare(makePair(rich), { args: [] });
      const [s, t] = [splitProgress(shell.stdout), splitProgress(ts.stdout)];
      assert.ok(
        s.progress.length > 25,
        "the filter keyed on the banner, `--- Tier:`, `Building ...:` and `Done.` saw the build",
      );
      assert.deepEqual(t.progress, s.progress);
      assert.deepEqual(t.view, s.view);
    });

    test("a second build over the first rewrites in place and prints the same lines", () => {
      const pair = makePair(rich);
      compare(pair, { args: [] });
      const [sh, ts] = [runShell(pair.a, pair.tmpA, []), runTs(pair.b, pair.tmpB, [])];
      expectSame(
        "second build",
        normalise(sh, [pair.a], [pair.tmpA]),
        normalise(ts, [pair.b], [pair.tmpB]),
      );
    });
  },
);

describe("--check", { skip: SKIP }, () => {
  test("a clean built tree: OK verdict, overlay tiers staged and discarded (R33(c): no assembly tail)", () => {
    const { ts } = compare(makePair(rich), { args: ["--check"], prebuild: true, deviation: ["c"] });
    assert.match(ts.stdout, /<STAGING>\/library/);
    assert.match(ts.stdout, /OK: All generated files match source\.\n$/);
  });

  test("drift: a missing, a differing and a stale resource file (R33(a) the hint, R33(c))", () => {
    const tamper = (root: string): void => {
      fs.rmSync(`${root}/.claude/skills/plain/SKILL.md`);
      fs.writeFileSync(`${root}/.gemini/agents/prof.md`, "stale\n");
      fs.appendFileSync(`${root}/.agents/skills/x/assets/blob.bin`, "x");
    };
    const { ts } = compare(makePair(rich), {
      args: ["--check"],
      prebuild: true,
      tamper,
      deviation: ["a", "c"],
    });
    assert.match(
      ts.stdout,
      /DRIFT: <ROOT>\/\.claude\/skills\/plain\/SKILL\.md does not exist \(expected from source\)/,
    );
    assert.match(ts.stdout, /DRIFT: <ROOT>\/\.gemini\/agents\/prof\.md differs from source/);
    assert.equal(ts.status, 1);
  });

  test("a collision refuses before any write, in build and in --check (spec Scenario 6)", () => {
    for (const args of [["--target", "claude", "--tier", "library"], ["--check"]]) {
      const { ts } = compare(makePair(collision), { args });
      assert.equal(ts.status, 1, args.join(" "));
      assert.match(
        ts.stderr,
        /FAILED: two components would be installed under one name into one landing zone\./,
      );
      assert.deepEqual(
        ts.tree.filter((r) => /\.(claude|gemini|github|agents)\//.test(r)),
        [],
      );
    }
  });
});
