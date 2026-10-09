// build-components-differential-deviations-diag.test.ts — the rest of the CLOSED list of
// deviations from the shell (spec 0250 R33 (d), (h), (i), (j); plan step 22): the merged mapping
// document, the diagnostic wording of flags and keys, the temporary names and the physical path.
// Same method as build-components-differential-deviations.test.ts: each row carries
// `deviation: R33(<letter>)` and asserts BOTH sides. Linux gate or CREWRIG_SHELL_PARITY=1;
// retires in PR D. Harness: fixtures/build-components/differential-*.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  makePair,
  mkdir,
  normalise,
  runShell,
  runTs,
} from "./fixtures/build-components/differential-kit.ts";
import type { Pair } from "./fixtures/build-components/differential-kit.ts";
import { CONFIG, skill, source } from "./fixtures/build-components/entry-kit.ts";
import { rich } from "./fixtures/build-components/differential-trees.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const SKIP = parityGate();
const TARGET = ["--target", "claude"];

/** Both outcomes of one row, normalised, plus the raw ones. */
function both(pair: Pair, args: string[], extra: Record<string, string> = {}) {
  const rawShell = runShell(pair.a, pair.tmpA, args, extra);
  const rawTs = runTs(pair.b, pair.tmpB, args, extra);
  return {
    rawShell,
    rawTs,
    shell: normalise(rawShell, [pair.a], [pair.tmpA]),
    ts: normalise(rawTs, [pair.b], [pair.tmpB]),
  };
}

describe(
  "(h) the merged mapping document is equal after loading, not byte-identical",
  { skip: SKIP },
  () => {
    test("deviation: R33(h): same digest directory and same loaded value, different bytes", () => {
      const pair = makePair((put, root) => {
        rich(put, root);
      });
      const env = (tmp: string): Record<string, string> => ({
        MAPPING_MERGE_DIR: path.join(tmp, "merge"),
      });
      runShell(pair.a, pair.tmpA, TARGET, env(pair.tmpA));
      runTs(pair.b, pair.tmpB, TARGET, env(pair.tmpB));
      const docOf = (tmp: string): { digest: string; text: string } => {
        const digest =
          fs.readdirSync(path.join(tmp, "merge")).find((n) => /^[0-9a-f]{64}$/.test(n)) ?? "";
        return {
          digest,
          text: fs.readFileSync(path.join(tmp, "merge", digest, "claude.yml"), "utf8"),
        };
      };
      const [sh, ts] = [docOf(pair.tmpA), docOf(pair.tmpB)];
      assert.ok(sh.digest !== "" && sh.digest === ts.digest);
      assert.notEqual(ts.text, sh.text, "the entry dumps every scalar quoted: not byte-identical");
      const load = (text: string): unknown => yamlLib.load(text, { schema: yamlLib.CORE_SCHEMA });
      assert.deepEqual(load(ts.text), load(sh.text));
    });
  },
);

describe(
  "(i) diagnostics wording: a flag in final position, an unreadable --resolve source, an invalid key",
  { skip: SKIP },
  () => {
    const empty = (): Pair => makePair((put) => put("crewrig.config.toml", CONFIG));
    test("deviation: R33(i): a value-taking flag in final position: status 1 and empty stdout on both, other wording", () => {
      for (const args of [
        ["--target"],
        ["--tier"],
        ["--diagnostics"],
        ["--resolve"],
        ["--resolve", "only"],
      ]) {
        const { shell, ts } = both(empty(), args);
        assert.equal(shell.status, 1, args.join(" "));
        assert.equal(ts.status, 1, args.join(" "));
        assert.equal(shell.stdout + ts.stdout, "");
        assert.match(shell.stderr, /unbound variable/);
        assert.match(ts.stderr, /^Error: --(target|tier|diagnostics|resolve) requires /);
      }
    });

    test("deviation: R33(i): an unreadable --resolve source: exit 2 on both, one Error: line against awk's lines", () => {
      const { shell, ts } = both(empty(), ["--resolve", "nope.md", "claude"]);
      assert.equal(shell.status, 2);
      assert.equal(ts.status, 2);
      assert.match(shell.stderr, /nope\.md/);
      assert.match(ts.stderr, /^Error: cannot read --resolve source: .*nope\.md.*\n$/);
      assert.equal(ts.stdout, "");
    });

    test("deviation: R33(i): a key that is not a valid identifier: shell status 1 or 2, entry 1, both name the key", () => {
      for (const [line, key] of [
        ["a-b = 1", "a-b"],
        ["[table]", "table"],
        ["a.b = 1", "a.b"],
        ["k$ = 1", "k"],
      ]) {
        const pair = makePair((put) => put("crewrig.config.toml", `${line}\n`));
        const { shell, ts } = both(pair, TARGET);
        assert.ok([1, 2].includes(shell.status ?? -1), `${line}: shell status ${shell.status}`);
        assert.equal(ts.status, 1, line);
        assert.match(shell.stderr, new RegExp(key.toUpperCase().replace(".", "\\.")));
        assert.match(
          ts.stderr,
          new RegExp(`^Error: <ROOT>/crewrig\\.config\\.toml: line 1: '.*${key.slice(0, 1)}`),
        );
      }
    });
  },
);

describe("(j) temporary names and (d) the physical path", { skip: SKIP }, () => {
  test("deviation: R33(j): the staging root is crewrig-check-staging.XXXXXX in the shell, crewrig-check-staging-XXXXXX and under TMPDIR in the entry", () => {
    const pair = makePair((put) => {
      put("crewrig.config.toml", CONFIG);
      put("artifacts/community/skills/c/SKILL.md", skill("c"));
    });
    const { rawShell, rawTs } = both(pair, ["--check"]);
    assert.match(rawShell.stdout, /crewrig-check-staging\.[A-Za-z0-9.]+\/community/);
    assert.match(
      rawTs.stdout,
      new RegExp(`output root: ${pair.tmpB}/crewrig-check-staging-[A-Za-z0-9]{6}/community`),
    );
    assert.deepEqual(rawTs.tmp, [], "removed on exit");
  });

  test("deviation: R33(d): REPO_DIR unset, a checkout reached through a symbolic link prints its physical path where the shell printed the logical one", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/skills/s/SKILL.md", skill("s"));
    const link = path.join(mkdir("link"), "checkout");
    fs.symlinkSync(tree.root, link);
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
    delete env["REPO_DIR"];
    const run = (cmd: string, args: string[]): string => {
      const res = spawnSync(cmd, args, { cwd: link, env, encoding: "utf8" });
      assert.equal(res.status, 0, res.stderr);
      return res.stdout;
    };
    const shellOut = run("bash", [path.join(link, "scripts/build-components.sh"), ...TARGET]);
    const tsOut = run(process.execPath, [
      path.join(link, "scripts/build-components.ts"),
      ...TARGET,
    ]);
    assert.match(shellOut, new RegExp(`output root: ${link}\\)`));
    assert.match(tsOut, new RegExp(`output root: ${tree.root}\\)`));
    assert.equal(shellOut.split(link).join(tree.root), tsOut);
  });
});
