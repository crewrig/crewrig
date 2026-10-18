// model-resolve-golden-containment.test.ts — pins the containment refusal of the golden replay
// (issue #1673, review N4): a stored file key that leaves the merge directory throws and writes
// nothing. Only paths made here with mkdtemp are touched.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { restoreFiles } from "./lib/model-resolve-golden.ts";

let root: string;
let merge: string;
let canary: string;
const CANARY_TEXT = "canary: never rewritten\n";

const listing = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).map((e) => {
    const p = path.join(e.parentPath, e.name);
    return `${path.relative(dir, p)}${e.isFile() ? `=${fs.readFileSync(p, "utf8")}` : "/"}`;
  });

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-golden-contain-")));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("restoreFiles containment", () => {
  const fresh = (): void => {
    merge = fs.mkdtempSync(path.join(root, "merge-"));
    canary = fs.mkdtempSync(path.join(root, "canary-"));
    fs.writeFileSync(path.join(canary, "keep.txt"), CANARY_TEXT);
  };
  // The absolute key points at a file inside this test's own canary directory, so a write
  // would be observable and can never touch anything real.
  const escaping: Record<string, (canaryDir: string) => string> = {
    "a `..` key": () => "../x",
    "an absolute key": (canaryDir) => path.join(canaryDir, "abs-key-written.txt"),
    "a nested `a/../../x` key": () => "a/../../x",
  };

  for (const [name, keyOf] of Object.entries(escaping)) {
    test(`${name} throws and writes nothing`, () => {
      fresh();
      const key = keyOf(canary);
      const beforeRoot = listing(root);
      // a clean key listed first must not be written either: every key is checked first
      assert.throws(
        () => restoreFiles(merge, { "clean.txt": "ok\n", [key]: "bad\n" }),
        /golden key escapes the merge directory/,
      );
      assert.deepEqual(listing(merge), []);
      assert.deepEqual(listing(root), beforeRoot);
      assert.equal(fs.readFileSync(path.join(canary, "keep.txt"), "utf8"), CANARY_TEXT);
      assert.equal(fs.existsSync(path.join(canary, "abs-key-written.txt")), false);
    });
  }

  test("a clean nested key restores and an existing file is not overwritten", () => {
    fresh();
    fs.writeFileSync(path.join(merge, "old.txt"), "kept\n");
    restoreFiles(merge, { "a/b/new.txt": "new\n", "old.txt": "replaced\n" });
    assert.equal(fs.readFileSync(path.join(merge, "a", "b", "new.txt"), "utf8"), "new\n");
    assert.equal(fs.readFileSync(path.join(merge, "old.txt"), "utf8"), "kept\n");
    assert.equal(fs.readFileSync(path.join(canary, "keep.txt"), "utf8"), CANARY_TEXT);
  });
});
