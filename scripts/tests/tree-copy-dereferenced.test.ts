// tree-copy-dereferenced.test.ts — copyTreeDereferenced (spec 0255 R16).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { copyTreeDereferenced } from "../lib/extension/tree-copy.ts";
import { ExtError } from "../lib/extension/types.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-dtc-")));
  temps.push(dir);
  return dir;
}

const posix = { skip: process.platform === "win32" };

test("copies bytes exactly, dotfiles included, with no CRLF conversion", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "s", "d"), { recursive: true });
  fs.writeFileSync(path.join(root, "s", ".hidden"), "h");
  fs.writeFileSync(path.join(root, "s", "d", "a.bin"), Buffer.from([0, 13, 10, 255]));
  assert.deepEqual(copyTreeDereferenced(path.join(root, "s"), path.join(root, "t")), []);
  assert.equal(fs.readFileSync(path.join(root, "t", ".hidden"), "utf8"), "h");
  assert.deepEqual([...fs.readFileSync(path.join(root, "t", "d", "a.bin"))], [0, 13, 10, 255]);
});

test("keeps mode bits and does not preserve mtimes", posix, () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "s"));
  const f = path.join(root, "s", "run");
  fs.writeFileSync(f, "x");
  fs.chmodSync(f, 0o751);
  fs.utimesSync(f, 1_000_000, 1_000_000);
  copyTreeDereferenced(path.join(root, "s"), path.join(root, "t"));
  const copied = fs.statSync(path.join(root, "t", "run"));
  assert.equal(copied.mode & 0o777, 0o751);
  assert.notEqual(Math.floor(copied.mtimeMs / 1000), 1_000_000);
});

test("copies a single file", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "f"), "one");
  copyTreeDereferenced(path.join(root, "f"), path.join(root, "g"));
  assert.equal(fs.readFileSync(path.join(root, "g"), "utf8"), "one");
});

test(
  "dereferences links, reports a dangling one and a cycle, and refuses a destination in the source",
  posix,
  () => {
    const root = tempDir();
    const s = path.join(root, "s");
    fs.mkdirSync(path.join(s, "d"), { recursive: true });
    fs.writeFileSync(path.join(root, "outside"), "o");
    fs.writeFileSync(path.join(s, "d", "x"), "x");
    fs.symlinkSync(path.join(root, "outside"), path.join(s, "f"));
    fs.symlinkSync(path.join(s, "d"), path.join(s, "dd"));
    fs.symlinkSync(path.join(root, "missing"), path.join(s, "dangling"));
    fs.symlinkSync(s, path.join(s, "d", "loop"));
    const notices = copyTreeDereferenced(s, path.join(root, "t"));
    assert.ok(!fs.lstatSync(path.join(root, "t", "f")).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(root, "t", "f"), "utf8"), "o");
    assert.equal(fs.readFileSync(path.join(root, "t", "dd", "x"), "utf8"), "x");
    assert.equal(fs.existsSync(path.join(root, "t", "dangling")), false);
    assert.ok(notices.some((n) => n.includes("dangling") && n.includes("does not exist")));
    assert.ok(notices.some((n) => n.includes("link cycle")));
    assert.throws(() => copyTreeDereferenced(s, path.join(s, "d", "in")), ExtError);
  },
);
