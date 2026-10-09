// build-components-dependency.test.ts — the missing-dependency diagnostic and the premises of
// `loadDependency` the fixture trees rest on (spec 0250 R4, R5, R24; spec Scenarios 2, 20; plan
// step 21). `js-yaml` is the build's one third-party package; a machine that lacks it is told
// which package and which step, writes nothing, and still answers `--list-output-dirs`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { FixtureTree } from "./lib/build-fixture-tree.ts";
import { CONFIG, REPO, builtFiles, skill } from "./fixtures/build-components/entry-kit.ts";

const MISSING =
  "crewrig: required package 'js-yaml' is not installed — re-run setup (e.g. task setup-claude-interactive).\n";
const MODULE_ERROR =
  /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|node:internal|at .*\(.*:\d+:\d+\)/;
const POSIX = process.platform === "win32" ? "skipped: symbolic links need privileges" : undefined;

function seeded(deps: "full" | "no-packages" | "none" = "no-packages"): FixtureTree {
  const tree = createFixtureTree({ deps });
  tree.config(CONFIG);
  tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
  return tree;
}

/** Everything under the root except `scripts/` and `node_modules/`, as sorted relative paths. */
function userFiles(tree: FixtureTree): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(tree.root, rel), { withFileTypes: true })) {
      const sub = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (sub === "scripts" || sub === "node_modules" || sub === ".git") continue;
      if (entry.isDirectory()) walk(sub);
      else found.push(sub);
    }
  };
  walk("");
  return found.sort();
}

describe("a checkout without js-yaml (R24, spec Scenario 20)", () => {
  const tree = seeded("no-packages");
  const before = userFiles(tree);

  test("a build exits 1 with the diagnostic naming js-yaml and the setup, and no module-resolution error", () => {
    const res = tree.run([]);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, MISSING);
    assert.doesNotMatch(res.stderr, MODULE_ERROR);
    assert.match(res.stderr, /'js-yaml'/);
    assert.match(res.stderr, /re-run setup/);
  });

  test("it writes nothing: no standard output, no built file, the tree unchanged", () => {
    for (const args of [[], ["--check"], ["--target", "claude", "--tier", "core"]]) {
      const res = tree.run(args);
      assert.equal(res.status, 1, args.join(" "));
      assert.equal(res.stdout, "", args.join(" "));
    }
    assert.deepEqual(builtFiles(tree), []);
    assert.deepEqual(userFiles(tree), before);
  });

  test("--resolve needs the library too: the same diagnostic, before the source is read", () => {
    const res = tree.run(["--resolve", "does-not-exist.md", "claude"]);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, MISSING);
  });

  test("an argument error still wins over the dependency check (order of operations, R8)", () => {
    const res = tree.run(["--target"]);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, "Error: --target requires a value\n");
  });

  test("--list-output-dirs still succeeds, with the same lines as a full checkout", () => {
    const full = seeded("full").run([
      "--list-output-dirs",
      "--tier",
      "community",
      "--target",
      "claude",
    ]);
    const res = tree.run(["--list-output-dirs", "--tier", "community", "--target", "claude"]);
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "");
    assert.equal(res.stdout, "dist/community/.claude/agents\ndist/community/.claude/skills\n");
    assert.deepEqual(res, full);
  });

  test("an empty js-yaml directory is a missing package too", () => {
    const empty = seeded("full");
    fs.rmSync(empty.resolve("node_modules/js-yaml"), { recursive: true });
    fs.mkdirSync(empty.resolve("node_modules/js-yaml"));
    const res = empty.run([]);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, MISSING);
  });
});

describe("a checkout with neither a .git entry nor a library (R5)", () => {
  test("--list-output-dirs answers; a build names its own missing root, not a module error", () => {
    const tree = seeded("none");
    const list = tree.run(["--list-output-dirs"]);
    assert.equal(list.status, 0);
    assert.equal(list.stderr, "");
    assert.equal(list.stdout.split("\n").length, 10);
    const build = tree.run([]);
    assert.equal(build.status, 1);
    assert.match(build.stderr, /^Error: no repository root \(\.git\) above /);
    assert.equal(build.stdout, "");
  });
});

describe("the premises of loadDependency the fixture trees rest on (R4)", { skip: POSIX }, () => {
  test("a symbolic link as js-yaml, or as node_modules, is refused: the diagnostic, no build", () => {
    const linked = seeded("full");
    fs.rmSync(linked.resolve("node_modules/js-yaml"), { recursive: true });
    fs.symlinkSync(path.join(REPO, "node_modules/js-yaml"), linked.resolve("node_modules/js-yaml"));
    const res = linked.run([]);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, MISSING);

    const whole = seeded("full");
    fs.renameSync(whole.resolve("node_modules"), whole.resolve("real-node-modules"));
    fs.symlinkSync(whole.resolve("real-node-modules"), whole.resolve("node_modules"));
    const res2 = whole.run([]);
    assert.equal(res2.status, 1);
    assert.equal(res2.stderr, MISSING);
    assert.deepEqual(builtFiles(whole), []);
  });

  test("the root is the nearest ancestor with a .git entry: a copy of scripts/ below a complete root builds its own tree", () => {
    const outer = seeded("full");
    const inner = "nested";
    fs.cpSync(outer.resolve("scripts"), outer.resolve(`${inner}/scripts`), { recursive: true });
    outer.write(`${inner}/crewrig.config.toml`, CONFIG);
    outer.write(`${inner}/artifacts/core/skills/inner/SKILL.md`, skill("inner"));
    const res = outer.run(["--target", "claude"], {
      entry: `${inner}/scripts/build-components.ts`,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      outer.exists(`${inner}/.claude/skills/inner/SKILL.md`),
      true,
      "the nested directory is REPO_DIR",
    );
    assert.equal(
      outer.exists(".claude/skills/probe/SKILL.md"),
      false,
      "the outer tree is untouched",
    );
  });

  test("once the copy has a .git entry of its own, that is the root and it needs its own package.json and closure", () => {
    const outer = seeded("full");
    fs.cpSync(outer.resolve("scripts"), outer.resolve("nested/scripts"), { recursive: true });
    fs.mkdirSync(outer.resolve("nested/.git"));
    outer.write("nested/artifacts/core/skills/inner/SKILL.md", skill("inner"));
    const res = outer.run(["--target", "claude"], { entry: "nested/scripts/build-components.ts" });
    assert.equal(res.status, 1);
    assert.notEqual(res.stderr, "");
    assert.doesNotMatch(res.stderr, MODULE_ERROR);
    assert.equal(outer.exists("nested/.claude"), false);
  });
});
