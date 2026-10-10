// install-extension-reentrancy.test.ts — the extension builders are re-entrant inside ONE process (spec
// 0255 plan assumption 1; spec 0254 R5). `install-extension-all` and the no-name `install-extension` loop
// call `buildMain` several times in one Node.js process, the way `installOne` does (`--target gemini
// <name>`, an `Io` that collects the lines); a module-level cache or a leftover working directory would
// show up as a second run that differs from the first. Each plugin target of `pluginMain` is called
// twice in the same way.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { buildMain } from "../lib/extension/build-main.ts";
import { pluginMain } from "../lib/extension/plugin-main.ts";
import type { EntryInput } from "../lib/extension/entry-ctx.ts";
import type { PluginTarget } from "../lib/extension/types.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { FixtureTree } from "./lib/build-fixture-tree.ts";
import { collectFiles } from "./lib/extension-run.ts";
import { fullTree, minimalTree, writeTree } from "./lib/extension-trees.ts";

interface Ran {
  readonly status: number;
  readonly lines: readonly string[];
}

function treeWithTwoExtensions(): FixtureTree {
  const tree = createFixtureTree();
  writeTree(path.join(tree.root, "extensions", "core", "minimal"), minimalTree());
  writeTree(path.join(tree.root, "extensions", "core", "full"), fullTree());
  return tree;
}

function input(tree: FixtureTree, script: string, argv: readonly string[], lines: string[]) {
  const push = (line: string): void => void lines.push(line);
  const entry: EntryInput = {
    argv,
    env: process.env,
    platform: process.platform,
    entryFile: path.join(tree.root, "scripts", script),
    io: { out: push, err: push, errRaw: push },
  };
  return entry;
}

async function build(tree: FixtureTree, name: string): Promise<Ran> {
  const lines: string[] = [];
  const argv = ["--target", "gemini", name];
  return { status: await buildMain(input(tree, "build-extension.ts", argv, lines)), lines };
}

async function plugin(tree: FixtureTree, target: PluginTarget, name: string): Promise<Ran> {
  const lines: string[] = [];
  const entry = input(tree, `build-${target}-plugin.ts`, [name], lines);
  return { status: await pluginMain(target, entry), lines };
}

/** Everything under the root but the dependency closure and the scripts copy, bytes included. */
function snapshot(tree: FixtureTree): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rel, bytes] of collectFiles(tree.root)) {
    if (rel.startsWith("node_modules/") || rel.startsWith("scripts/")) continue;
    out.set(rel, bytes.toString("base64"));
  }
  return out;
}

const changed = (before: Map<string, string>, after: Map<string, string>): string[] =>
  [...new Set([...before.keys(), ...after.keys()])]
    .filter((rel) => before.get(rel) !== after.get(rel))
    .sort();

describe("one process, several builds", () => {
  test("buildMain twice for two extensions, then again for the first: same output, nothing left over", async () => {
    const tree = treeWithTwoExtensions();
    const first = await build(tree, "minimal");
    const second = await build(tree, "full");
    assert.equal(first.status, 0, first.lines.join("\n"));
    assert.equal(second.status, 0, second.lines.join("\n"));
    assert.notDeepEqual(first.lines, second.lines);
    const settled = snapshot(tree);
    assert.ok(settled.has("build/extensions/minimal/gemini-extension.json"));
    assert.ok(settled.has("build/extensions/full/gemini-extension.json"));

    const again = await build(tree, "minimal");
    assert.deepEqual(again, first);
    assert.deepEqual(changed(settled, snapshot(tree)), []);
    tree.dispose();
  });
});

describe("one process, each plugin target twice", () => {
  const targets: readonly PluginTarget[] = ["claude", "copilot", "antigravity"];
  for (const target of targets) {
    test(`pluginMain(${target}) twice: same status, same lines, same bytes, nothing left over`, async () => {
      const tree = treeWithTwoExtensions();
      const first = await plugin(tree, target, "full");
      assert.equal(first.status, 0, first.lines.join("\n"));
      const settled = snapshot(tree);
      assert.ok(settled.size > 0);
      const again = await plugin(tree, target, "full");
      assert.deepEqual(again, first);
      assert.deepEqual(changed(settled, snapshot(tree)), []);
      tree.dispose();
    });
  }
});
