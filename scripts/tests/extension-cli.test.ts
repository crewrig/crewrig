// extension-cli.test.ts — the `build-extension` entry: grammar, resolution, exit codes (spec 0254 R5, R19).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { extensionRoot, runTs } from "./lib/extension-run.ts";
import type { FixtureTree } from "./lib/extension-run.ts";
import { fullTree, invalidTree, minimalTree } from "./lib/extension-trees.ts";
import type { FileMap } from "./lib/extension-trees.ts";

const trees: FixtureTree[] = [];
after(() => {
  for (const tree of trees) tree.dispose();
});

function root(subjects: Readonly<Record<string, FileMap>>): FixtureTree {
  const tree = extensionRoot(subjects);
  trees.push(tree);
  return tree;
}

const build = (tree: FixtureTree, ...args: string[]) => runTs(tree, "build-extension", args);

describe("build-extension grammar", () => {
  const tree = root({ minimal: minimalTree() });

  it("refuses an unknown target with status 2", () => {
    const r = build(tree, "--target", "bogus");
    assert.equal(r.status, 2);
    assert.equal(
      r.stderr,
      "Error: --target must be one of gemini, claude, copilot, antigravity, all (got 'bogus').\n",
    );
    assert.equal(r.stdout, "");
  });

  it("refuses a missing or empty target value with status 1", () => {
    for (const args of [["--target"], ["--target", ""]]) {
      const r = build(tree, ...args);
      assert.equal(r.status, 1);
      assert.equal(r.stderr, "Error: --target requires a value\n");
    }
  });

  it("reports an unknown extension on stderr with status 1", () => {
    const r = build(tree, "nope");
    assert.equal(r.status, 1);
    assert.equal(r.stderr, "Error: extension directory or name 'nope' not found.\n");
  });

  it("reports a name that exists in two tiers", () => {
    const dup = root({ minimal: minimalTree() });
    const other = path.join(dup.root, "extensions", "library", "minimal");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "extension.json"), "{}\n");
    const r = build(dup, "minimal");
    assert.equal(r.status, 1);
    assert.equal(
      r.stderr,
      "Error: extension 'minimal' exists in multiple tiers; names must be unique.\n",
    );
  });
});

describe("build-extension build mode", () => {
  it("renders a single target by name, prints Done., and writes no gap file", () => {
    const tree = root({ minimal: minimalTree() });
    const r = build(tree, "--target", "gemini", "minimal");
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split("\n");
    assert.equal(lines[0], "Extension render — BUILD (--target gemini)");
    assert.equal(lines[1], "Building extension: minimal");
    assert.equal(r.stdout.endsWith("\nDone.\n"), true);
    assert.equal(fs.existsSync(path.join(tree.root, "build", "extensions", "minimal")), true);
    assert.equal(fs.existsSync(path.join(tree.root, "build", "gaps", "minimal")), false);
  });

  it("writes the gap file only for a full render, and accepts a path argument", () => {
    const tree = root({ minimal: minimalTree() });
    const dir = path.join(tree.root, "extensions", "core", "minimal");
    const r = build(tree, dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Extension render — BUILD \(--target all\)\n/);
    const gaps = path.join(tree.root, "build", "gaps", "minimal", "observed-gaps.json");
    assert.equal(fs.readFileSync(gaps, "utf8"), "[]\n");
  });

  it("stops at the first failing extension: status 1, no Done., nothing after it", () => {
    const tree = root({ invalid: invalidTree(), minimal: minimalTree() });
    const r = build(tree);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.includes("Done."), false);
    assert.match(r.stderr, /VALIDATION-ERROR/);
    assert.match(
      r.stderr,
      /FAIL: .*invalid — manifest validation failed \(see VALIDATION-ERROR lines above\)\n/,
    );
    assert.equal(fs.existsSync(path.join(tree.root, "build", "extensions", "minimal")), false);
  });

  it("builds an extension that sorts before the failing one, then stops", () => {
    const tree = root({
      aaa: {
        ...minimalTree(),
        "extension.json": minimalTree()["extension.json"]!.replace("minimal", "aaa"),
      },
      invalid: invalidTree(),
      zzz: minimalTree(),
    });
    const r = build(tree, "--target", "gemini");
    assert.equal(r.status, 1);
    assert.equal(r.stdout.includes("Building extension: aaa"), true);
    assert.equal(r.stdout.includes("Done."), false);
    assert.equal(fs.existsSync(path.join(tree.root, "build", "extensions", "minimal")), false);
  });
});

describe("build-extension check mode", () => {
  it("passes on a clean extension and closes with the OK line", () => {
    const tree = root({ minimal: minimalTree() });
    fs.mkdirSync(path.join(tree.root, "extension-skeleton"), { recursive: true });
    const r = build(tree, "--check");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /^Extension render — CHECK \(no committed generated output, fresh render, exact declared set\)\n/,
    );
    assert.match(
      r.stdout,
      /\nOK: every extension carries no committed generated output, renders cleanly, and matches its declared set\.\n$/,
    );
  });

  it("removes the plugin staging directory after a check, and keeps it after a build", () => {
    const tree = root({ full: fullTree() });
    const staged = path.join(tree.root, "extensions", "core", "full", "dist-claude-plugin");
    build(tree, "--target", "claude", "full");
    assert.equal(fs.existsSync(staged), true);
    const r = build(tree, "--check", "full");
    assert.equal(r.status === 0 || r.status === 1, true);
    assert.equal(fs.existsSync(staged), false);
  });
});
