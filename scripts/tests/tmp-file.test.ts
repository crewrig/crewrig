// tmp-file.test.ts — tests for scripts/lib/tmp-file.ts (spec 0240 R10).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { createTempNextTo, discardTemp, publishTemp, writeFileAtomic } from "../lib/tmp-file.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-tmp-")));
  temps.push(dir);
  return dir;
}

describe("createTempNextTo", () => {
  test("creates the file in the target's directory", () => {
    const dir = tempDir();
    const tmp = createTempNextTo(path.join(dir, "config.json"));
    try {
      assert.equal(path.dirname(tmp.path), dir);
      assert.match(path.basename(tmp.path), /^\.config\.json\.tmp-[0-9a-f]{12}$/);
      assert.ok(fs.existsSync(tmp.path));
    } finally {
      discardTemp(tmp);
    }
  });

  test("many calls for one target yield distinct names", async () => {
    const dir = tempDir();
    const target = path.join(dir, "shared.txt");
    const made = await Promise.all(
      Array.from({ length: 32 }, () => Promise.resolve().then(() => createTempNextTo(target))),
    );
    try {
      assert.equal(new Set(made.map((t) => t.path)).size, made.length);
    } finally {
      for (const tmp of made) discardTemp(tmp);
    }
  });

  test("restricts the file to its owner (mode 0o600)", (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX modes are not honoured on Windows");
      return;
    }
    const tmp = createTempNextTo(path.join(tempDir(), "secret"));
    try {
      assert.equal(fs.statSync(tmp.path).mode & 0o777, 0o600);
    } finally {
      discardTemp(tmp);
    }
  });

  test("rethrows a non-EEXIST error", () => {
    assert.throws(() => createTempNextTo(path.join(tempDir(), "no-such-dir", "file")), {
      code: "ENOENT",
    });
  });
});

describe("publishTemp", () => {
  test("renames the temporary file onto the target with its content", () => {
    const dir = tempDir();
    const target = path.join(dir, "out.txt");
    fs.writeFileSync(target, "old");
    publishTemp(createTempNextTo(target), "new");
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(dir), ["out.txt"]);
  });

  test("a failed publish leaves no temporary file and rethrows", () => {
    const dir = tempDir();
    // A non-empty directory as the target makes the final rename fail.
    const target = path.join(dir, "occupied");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep"), "");
    const tmp = createTempNextTo(target);
    assert.throws(() => publishTemp(tmp, "data"));
    assert.equal(fs.existsSync(tmp.path), false);
    assert.deepEqual(fs.readdirSync(dir), ["occupied"]);
  });
});

describe("writeFileAtomic", () => {
  test("creates a new file in one call", () => {
    const dir = tempDir();
    writeFileAtomic(path.join(dir, "fresh.txt"), "hello");
    assert.equal(fs.readFileSync(path.join(dir, "fresh.txt"), "utf8"), "hello");
    assert.deepEqual(fs.readdirSync(dir), ["fresh.txt"]);
  });
});
