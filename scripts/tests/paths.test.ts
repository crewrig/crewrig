// paths.test.ts — tests for scripts/lib/paths.ts (spec 0240 R8).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { joinPath, repoRootFrom, resolveReal } from "../lib/paths.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-paths-")));
  temps.push(dir);
  return dir;
}

/** A fake script file at `<root>/scripts/tool.ts`, returned as a file URL. */
function scriptUrlIn(root: string): string {
  const script = path.join(root, "scripts", "tool.ts");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "");
  return pathToFileURL(script).href;
}

describe("joinPath", () => {
  test("joins with the host separator and normalises", () => {
    assert.equal(joinPath("a", "b", "..", "c"), `a${path.sep}c`);
  });
});

describe("resolveReal", () => {
  test("returns an absolute path", () => {
    const dir = tempDir();
    assert.ok(path.isAbsolute(resolveReal(path.relative(process.cwd(), dir))));
  });

  test("resolves a symbolic link to its target", (t) => {
    const dir = tempDir();
    const target = path.join(dir, "target.txt");
    fs.writeFileSync(target, "x");
    const link = path.join(dir, "link.txt");
    try {
      fs.symlinkSync(target, link);
    } catch {
      t.skip("symbolic links unavailable on this host");
      return;
    }
    assert.equal(resolveReal(link), target);
  });

  test("throws on a missing path", () => {
    assert.throws(() => resolveReal(path.join(tempDir(), "absent")), { code: "ENOENT" });
  });
});

describe("repoRootFrom", () => {
  test("finds a root whose .git is a directory", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".git"));
    assert.equal(repoRootFrom(scriptUrlIn(root)), root);
  });

  test("finds a worktree-style root whose .git is a file", () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
    assert.equal(repoRootFrom(scriptUrlIn(root)), root);
  });

  test("locates this repository from this test file", () => {
    const root = repoRootFrom(import.meta.url);
    assert.ok(fs.existsSync(path.join(root, "scripts", "lib", "paths.ts")));
  });
});
