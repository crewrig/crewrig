// extension-sandbox.test.ts — the helper of the extension suites (scripts/tests/lib/extension-sandbox.ts):
// the staged packages are the production closure, the glob matcher keeps shell `case` semantics,
// `hookFilePresent` accepts exactly the state {ts}, and a mutation anchor that drifted throws.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { productionClosure } from "./lib/build-fixture-tree.ts";
import {
  STAGED_PACKAGES,
  globToRegExp,
  hookFilePresent,
  mutate,
  realSkeletonScan,
  treeDigest,
} from "./lib/extension-sandbox.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extension-sandbox-test-"));
  made.push(dir);
  return dir;
};

test("STAGED_PACKAGES equals the production closure of the lockfile", () => {
  assert.deepEqual([...STAGED_PACKAGES].sort(), productionClosure().sort());
});

describe("globToRegExp", () => {
  test("`*` crosses `/` as in shell `case`", () => {
    assert.ok(globToRegExp("commands/*.toml").test("commands/a/b.toml"));
    assert.ok(globToRegExp("skills/*-context/SKILL.md").test("skills/x-context/SKILL.md"));
  });
  test("an anchored literal does not match a longer path", () => {
    assert.equal(globToRegExp("hooks.json").test("hooks/hooks.json"), false);
    assert.equal(globToRegExp("observed-gaps.json").test("xobserved-gaps.json"), false);
  });
  test("the dot is literal and `?` is one character", () => {
    assert.equal(globToRegExp("a.json").test("aXjson"), false);
    assert.ok(globToRegExp("a?c").test("abc"));
  });
});

describe("hookFilePresent", () => {
  const states: [string, string[], 0 | 1 | 2][] = [
    ["ts only", ["hooks/h.ts"], 0],
    ["nothing", [], 1],
    ["sh only", ["hooks/h.sh"], 2],
    ["sh and ts", ["hooks/h.sh", "hooks/h.ts"], 2],
  ];
  for (const [label, files, want] of states) {
    test(`hooks/h.ts with ${label}`, () => {
      const root = tmp();
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
        fs.writeFileSync(path.join(root, f), "");
      }
      assert.equal(hookFilePresent(root, "hooks/h.ts"), want);
    });
  }
  test("the retired .sh spelling never passes; a non-hook probe is a plain existence check", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "hooks"));
    fs.writeFileSync(path.join(root, "hooks", "h.sh"), "");
    fs.writeFileSync(path.join(root, "CONTEXT.md"), "");
    assert.equal(hookFilePresent(root, "hooks/h.sh"), 2);
    assert.equal(hookFilePresent(root, "CONTEXT.md"), 0);
    assert.equal(hookFilePresent(root, "src/index.ts"), 1);
  });
});

test("mutate throws when the anchor is absent and replaces literally otherwise", () => {
  const file = path.join(tmp(), "f.txt");
  fs.writeFileSync(file, "a $& b\n");
  assert.throws(() => mutate(file, "missing", "x"), /anchor absent/);
  mutate(file, "$&", "$1");
  assert.equal(fs.readFileSync(file, "utf8"), "a $1 b\n");
});

test("treeDigest is path-sorted and content-addressed", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "d"));
  fs.writeFileSync(path.join(dir, "d", "b"), "1");
  fs.writeFileSync(path.join(dir, "a"), "1");
  const digest = treeDigest(dir);
  assert.deepEqual(Object.keys(digest), ["a", "d/b"]);
  assert.equal(digest["a"], digest["d/b"]);
});

test("realSkeletonScan is non-vacuous", () => {
  const scan = realSkeletonScan();
  assert.ok(scan.componentDirs > 0 && scan.classEntries > 0);
});
