// extension-entry-ctx.test.ts — the entry context (spec 0254 R5, R15).
// Each case imports the module from a throwaway tree, so `js-yaml` is resolved there.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import type { EntryInput } from "../lib/extension/entry-ctx.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";

interface Loaded {
  createCtx(input: EntryInput): Promise<import("../lib/extension/types.ts").ExtCtx | null>;
}

async function load(root: string): Promise<Loaded> {
  const file = path.join(root, "scripts", "lib", "extension", "entry-ctx.ts");
  return (await import(pathToFileURL(file).href)) as Loaded;
}

function input(root: string, out: string[], err: string[]): EntryInput {
  return {
    argv: [],
    env: {},
    platform: process.platform,
    entryFile: path.join(root, "scripts", "build-extension.ts"),
    io: {
      out: (l) => void out.push(l),
      err: (l) => void err.push(l),
      errRaw: (t) => void err.push(t),
    },
  };
}

describe("createCtx", () => {
  test("without js-yaml: the diagnostic on io.err and null", async () => {
    const tree = createFixtureTree({ deps: "no-packages" });
    const err: string[] = [];
    const { createCtx } = await load(tree.root);
    assert.equal(await createCtx(input(tree.root, [], err)), null);
    assert.equal(err.length, 1);
    assert.match(err[0] as string, /'js-yaml'/);
    assert.match(err[0] as string, /re-run setup/);
  });

  test("with js-yaml: repoDir, libDir, table and a working renderer", async () => {
    const tree = createFixtureTree();
    const err: string[] = [];
    const { createCtx } = await load(tree.root);
    const ctx = await createCtx(input(tree.root, [], err));
    assert.ok(ctx);
    assert.deepEqual(err, []);
    assert.equal(ctx.repoDir, fs.realpathSync(tree.root));
    assert.equal(ctx.libDir, path.join(tree.root, "scripts", "lib"));
    assert.ok(ctx.table.claude.rootToken.length > 0);
    const cmd = tree.write("c.md", "---\nname: hello\ndescription: d\n---\nbody\n");
    assert.equal(ctx.renderCommand.yamlField(cmd, "name"), "hello");
  });

  test("repoDir is the physical grandparent of the entry file, never found via .git", async () => {
    const tree = createFixtureTree();
    const link = path.join(path.dirname(tree.root), `${path.basename(tree.root)}-link`);
    fs.symlinkSync(tree.root, link);
    try {
      const { createCtx } = await load(tree.root);
      const ctx = await createCtx({
        ...input(tree.root, [], []),
        entryFile: path.join(link, "scripts", "build-extension.ts"),
      });
      assert.ok(ctx);
      assert.equal(ctx.repoDir, fs.realpathSync(tree.root));
    } finally {
      fs.rmSync(link, { force: true });
    }
  });
});
