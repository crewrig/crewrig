// Self-test of lib/build-sandbox.ts (spec 0265, annex P1 step 1). The repository under
// copy is a throwaway one made by mkdtemp: the checkout is never edited.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import {
  baseEnv,
  copyFromHead,
  copyFromWorktree,
  fenceSplit,
  readFrontmatter,
} from "./lib/build-sandbox.ts";

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "build-sandbox-test-")));
after(() => fs.rmSync(repo, { recursive: true, force: true }));
const git = (...args: string[]): void => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
  assert.equal(r.status, 0, String(r.stderr));
};
git("init", "-q");
fs.writeFileSync(path.join(repo, "a.txt"), "committed\n");
git("add", "a.txt");
git("commit", "-q", "-m", "init");
fs.writeFileSync(path.join(repo, "a.txt"), "edited\n");

describe("build-sandbox", () => {
  test("copyFromHead reads the HEAD blob, copyFromWorktree the working-tree edit", () => {
    const head = createFixtureTree({ deps: "none" });
    const work = createFixtureTree({ deps: "none" });
    assert.deepEqual(copyFromHead(head, ["a.txt"], repo), ["a.txt"]);
    assert.deepEqual(copyFromWorktree(work, ["a.txt"], repo), ["a.txt"]);
    assert.equal(head.read("a.txt"), "committed\n");
    assert.equal(work.read("a.txt"), "edited\n");
  });

  test("baseEnv drops CI and pins LC_ALL", () => {
    const tree = createFixtureTree({ deps: "none" });
    tree.write("probe.ts", "process.stdout.write(`${process.env.CI}|${process.env.LC_ALL}`);\n");
    const r = tree.run([], { entry: "probe.ts", env: { ...baseEnv(), CI: undefined } });
    assert.equal(r.stdout, "undefined|C");
  });

  test("fenceSplit and readFrontmatter", () => {
    assert.deepEqual(fenceSplit("x\n---\na: 1\n---\nbody\n"), { front: "a: 1", body: "body\n" });
    assert.equal(fenceSplit("no fence"), null);
    assert.deepEqual(readFrontmatter("---\nname: n\n---\nb\n"), { name: "n" });
  });
});
