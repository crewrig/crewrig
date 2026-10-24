// Tests for scripts/lib/taskfile-tree.ts, the include-aware Taskfile loader (spec 0278 R10, R6).
//
// Fixture trees live under scripts/tests/fixtures/taskfile-tree/. The live-repo block checks that the
// loader sees the same 129 names as the committed pre-split `task --list-all --json` baseline, and
// that the mapping fixture (plan decision D1) covers exactly that name set.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  TaskfileTreeError,
  loadTaskfileTree,
  resolveTaskRef,
  taskCmds,
  taskfilePaths,
} from "../lib/taskfile-tree.ts";

const fixtures = path.resolve(import.meta.dirname, "fixtures", "taskfile-tree");
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const fixture = (name: string) => loadTaskfileTree(path.join(fixtures, name));
const names = (tree: { tasks: { name: string }[] }) => tree.tasks.map((t) => t.name).sort();

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(fixtures, file), "utf8")) as T;
}

function treeError(name: string): TaskfileTreeError {
  try {
    fixture(name);
  } catch (err) {
    assert.ok(err instanceof TaskfileTreeError, `expected a TaskfileTreeError, got ${String(err)}`);
    return err;
  }
  assert.fail(`expected ${name} to throw`);
}

describe("taskfile tree loader: include forms", () => {
  it("loads a string include as a namespace of the same name", () => {
    const tree = fixture("string-include");
    assert.deepEqual(names(tree), ["default", "lib:alpha", "lib:beta"]);
    assert.deepEqual(tree.files, ["Taskfile.yml", "lib.yml"]);
    const alpha = tree.byName.get("lib:alpha");
    assert.equal(alpha?.localName, "alpha");
    assert.equal(alpha?.namespace, "lib");
    assert.equal(alpha?.file, "lib.yml");
  });

  it("loads an object include, a directory path, an optional miss and records extra keys", () => {
    const tree = fixture("object-include");
    assert.deepEqual(names(tree), ["default", "sub:inner", "tuned:knob"]);
    assert.deepEqual(tree.files, ["Taskfile.yml", "sub/Taskfile.yml", "tuned.yml"]);
    const root = tree.nodes[0];
    const tuned = root?.includes.find((i) => i.key === "tuned");
    assert.deepEqual(tuned?.extraKeys.sort(), ["dir", "excludes"]);
    assert.equal(root?.includes.find((i) => i.key === "skipped")?.optional, true);
  });

  it("flattens an include and keeps literal colons in names", () => {
    const tree = fixture("flatten");
    assert.deepEqual(names(tree), ["default", "e2e:base", "go", "last", "setup:thing"]);
    assert.equal(tree.byName.get("setup:thing")?.namespace, "");
    assert.equal(tree.byName.get("setup:thing")?.localName, "setup:thing");
  });

  it("follows nested includes", () => {
    const tree = fixture("nested");
    assert.deepEqual(names(tree), ["a:b:leaf", "a:mid"]);
    assert.equal(tree.byName.get("a:b:leaf")?.namespace, "a:b");
    assert.deepEqual(tree.files, ["Taskfile.yml", "a.yml", "b.yml"]);
  });

  it("gives a flatten inside a namespace the namespace of its parent", () => {
    const tree = fixture("flatten-in-namespace");
    assert.deepEqual(names(tree), ["e2e:base", "e2e:helper", "e2e:test", "hello"]);
    assert.equal(tree.byName.get("e2e:helper")?.file, "shared.yml");
  });

  it("exposes the file list through taskfilePaths", () => {
    assert.deepEqual(taskfilePaths(path.join(fixtures, "nested")), [
      "Taskfile.yml",
      "a.yml",
      "b.yml",
    ]);
  });
});

describe("taskfile tree loader: failures", () => {
  it("throws unreadable on a missing include", () => {
    const err = treeError("missing");
    assert.equal(err.kind, "unreadable");
    assert.equal(err.file, "nope.yml");
  });

  it("throws cycle on an include cycle", () => {
    const err = treeError("cycle");
    assert.equal(err.kind, "cycle");
    assert.match(err.message, /a\.yml -> b\.yml -> a\.yml/);
  });

  it("throws unparsable on a broken file, never a partial tree", () => {
    const err = treeError("unparsable");
    assert.equal(err.kind, "unparsable");
    assert.equal(err.file, "bad.yml");
  });

  it("throws unreadable when the root itself is missing", () => {
    assert.throws(
      () => loadTaskfileTree(path.join(fixtures, "no-such-dir")),
      (err: unknown) => err instanceof TaskfileTreeError && err.kind === "unreadable",
    );
  });
});

describe("taskfile tree loader: per-task view", () => {
  it("slices the source of one task without its neighbours or their comments", () => {
    const tree = fixture("string-include");
    const alpha = tree.byName.get("lib:alpha")?.source ?? "";
    assert.ok(alpha.startsWith("  alpha:"));
    assert.ok(alpha.includes("- task: beta"));
    assert.ok(!alpha.includes("beta:"));
    assert.ok(!alpha.includes("Leading comment"));
    assert.equal(
      tree.byName.get("lib:beta")?.source,
      "  beta:\n    cmd: echo beta\n    deps: [alpha]",
    );
  });

  it("slices a quoted key and the last task of a file", () => {
    const tree = fixture("flatten");
    assert.equal(tree.byName.get("setup:thing")?.source, '  "setup:thing":\n    cmd: echo thing');
    assert.equal(tree.byName.get("last")?.source, "  last:\n    cmd: echo last");
  });

  it("returns cmds and cmd items in order and skips task calls", () => {
    const tree = fixture("string-include");
    assert.deepEqual(taskCmds(tree, "lib:alpha"), ["echo one", "echo two"]);
    assert.deepEqual(taskCmds(tree, "lib:beta"), ["echo beta"]);
    assert.deepEqual(taskCmds(tree, "no-such-task"), []);
  });
});

describe("taskfile tree loader: resolveTaskRef (R20)", () => {
  const tree = fixture("flatten-in-namespace");

  it("resolves a plain name relative to the namespace of a namespaced file", () => {
    assert.equal(resolveTaskRef(tree, "e2e.yml", "base")?.name, "e2e:base");
  });

  it("resolves a root-anchored name from the root", () => {
    assert.equal(resolveTaskRef(tree, "e2e.yml", ":hello")?.name, "hello");
  });

  it("does not resolve a global name from inside a namespace", () => {
    assert.equal(resolveTaskRef(tree, "e2e.yml", "hello"), undefined);
    assert.equal(resolveTaskRef(tree, "e2e.yml", ":base"), undefined);
  });

  it("resolves a flattened file in the namespace of its parent", () => {
    assert.equal(resolveTaskRef(tree, "shared.yml", "base")?.name, "e2e:base");
  });

  it("resolves a global name in the root file and a namespaced name from a flattened file", () => {
    assert.equal(resolveTaskRef(tree, "Taskfile.yml", "hello")?.name, "hello");
    assert.equal(resolveTaskRef(tree, "Taskfile.yml", "e2e:base")?.name, "e2e:base");
    const flat = fixture("flatten");
    assert.equal(resolveTaskRef(flat, "flat.yml", "e2e:base")?.name, "e2e:base");
    assert.equal(resolveTaskRef(flat, "flat.yml", "base"), undefined);
  });
});

describe("taskfile tree loader: live repository", () => {
  const tree = loadTaskfileTree(repoRoot);
  const baseline = readJson<{ name: string; desc: string }[]>("baseline-list-all.json");
  const mapping = readJson<Record<string, string>>("mapping.json");

  it("reports exactly the baseline name set", () => {
    assert.equal(baseline.length, 173);
    assert.deepEqual([...tree.byName.keys()].sort(), baseline.map((b) => b.name).sort());
  });

  it("has no duplicate effective name", () => {
    assert.equal(tree.tasks.length, tree.byName.size);
  });

  it("covers the baseline names with the mapping fixture and nothing else", () => {
    assert.deepEqual(Object.keys(mapping).sort(), baseline.map((b) => b.name).sort());
  });

  it("keeps the descriptions of the baseline", () => {
    for (const { name, desc } of baseline) {
      const definition = tree.byName.get(name)?.definition;
      const actual =
        typeof definition === "object" && definition !== null && "desc" in definition
          ? String(definition.desc)
          : "";
      assert.equal(actual, desc, name);
    }
  });
});
