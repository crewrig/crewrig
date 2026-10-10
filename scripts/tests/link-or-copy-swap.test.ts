// link-or-copy-swap.test.ts — tests for scripts/lib/link-or-copy-swap.ts (spec 0255 R14, R16).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  RENAME_ATTEMPTS,
  RENAME_DELAY_MS,
  discardStage,
  renameRetry,
  stagedName,
  swapIn,
} from "../lib/link-or-copy-swap.ts";
import type { SwapFs } from "../lib/link-or-copy-swap.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-swap-")));
  temps.push(dir);
  return dir;
}

function makeStage(dir: string, dest: string, content: string): string {
  const stage = stagedName(dest);
  fs.mkdirSync(stage);
  fs.writeFileSync(path.join(stage, "f.txt"), content);
  return stage;
}

function leftovers(dir: string): string[] {
  return fs.readdirSync(dir).filter((n) => n.includes(".crewrig-tmp-") || n.includes(".old-"));
}

const realFs: SwapFs = {
  lstatSync: (p) => fs.lstatSync(p),
  mkdirSync: (p, o) => fs.mkdirSync(p, o),
  renameSync: (a, b) => fs.renameSync(a, b),
  rmSync: (p, o) => fs.rmSync(p, o),
};

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("stagedName", () => {
  test("is a hidden sibling of the destination, fresh on each call", () => {
    const dest = path.join("/x", "y", "skill");
    const a = stagedName(dest);
    assert.equal(path.dirname(a), path.join("/x", "y"));
    assert.match(path.basename(a), /^\.skill\.crewrig-tmp-[0-9a-f]{12}$/);
    assert.notEqual(a, stagedName(dest));
  });
});

describe("swapIn over each destination state", () => {
  test("absent destination: the parent is created", () => {
    const dir = tempDir();
    const dest = path.join(dir, "deep", "er", "skill");
    const stage = stagedName(dest);
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, "f.txt"), "new");
    assert.equal(swapIn(stage, dest), "absent");
    assert.equal(fs.readFileSync(path.join(dest, "f.txt"), "utf8"), "new");
    assert.deepEqual(leftovers(path.dirname(dest)), []);
  });

  test("file destination", () => {
    const dir = tempDir();
    const dest = path.join(dir, "skill");
    fs.writeFileSync(dest, "old");
    assert.equal(swapIn(makeStage(dir, dest, "new"), dest), "other");
    assert.equal(fs.readFileSync(path.join(dest, "f.txt"), "utf8"), "new");
    assert.deepEqual(leftovers(dir), []);
  });

  test("directory destination", () => {
    const dir = tempDir();
    const dest = path.join(dir, "skill");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "old.txt"), "old");
    assert.equal(swapIn(makeStage(dir, dest, "new"), dest), "other");
    assert.deepEqual(fs.readdirSync(dest), ["f.txt"]);
    assert.deepEqual(leftovers(dir), []);
  });

  test("symlink destination: removed as a link, its target untouched", () => {
    const dir = tempDir();
    const target = path.join(dir, "target");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep.txt"), "keep");
    const dest = path.join(dir, "skill");
    fs.symlinkSync(target, dest, "dir");
    assert.equal(swapIn(makeStage(dir, dest, "new"), dest), "symlink");
    assert.equal(fs.lstatSync(dest).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "keep");
    assert.deepEqual(leftovers(dir), []);
  });

  test("dangling symlink destination", () => {
    const dir = tempDir();
    const dest = path.join(dir, "skill");
    fs.symlinkSync(path.join(dir, "gone"), dest, "dir");
    assert.equal(fs.existsSync(dest), false);
    assert.equal(swapIn(makeStage(dir, dest, "new"), dest), "symlink");
    assert.equal(fs.readFileSync(path.join(dest, "f.txt"), "utf8"), "new");
    assert.deepEqual(leftovers(dir), []);
  });
});

describe("swapIn rollback", () => {
  test("restores the old entry when the second rename fails", () => {
    const dir = tempDir();
    const dest = path.join(dir, "skill");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "old.txt"), "old");
    const stage = makeStage(dir, dest, "new");
    const failing: SwapFs = {
      ...realFs,
      renameSync: (from, to) => {
        if (from === stage) throw errno("EXDEV");
        fs.renameSync(from, to);
      },
    };
    assert.throws(() => swapIn(stage, dest, { fsImpl: failing }), { code: "EXDEV" });
    assert.equal(fs.readFileSync(path.join(dest, "old.txt"), "utf8"), "old");
    assert.deepEqual(leftovers(dir), []);
  });

  test("names the aside path when the rollback fails too", () => {
    const dir = tempDir();
    const dest = path.join(dir, "skill");
    fs.mkdirSync(dest);
    const stage = makeStage(dir, dest, "new");
    let calls = 0;
    const failing: SwapFs = {
      ...realFs,
      renameSync: (from, to) => {
        if (++calls >= 2) throw errno("EXDEV");
        fs.renameSync(from, to);
      },
    };
    assert.throws(() => swapIn(stage, dest, { fsImpl: failing }), /previous entry is at '.*\.old-/);
  });
});

describe("renameRetry", () => {
  function flaky(code: string, failures: number): { fsImpl: SwapFs; attempts: () => number } {
    let n = 0;
    return {
      attempts: () => n,
      fsImpl: {
        ...realFs,
        renameSync: () => {
          if (++n <= failures) throw errno(code);
        },
      },
    };
  }

  test("win32 EPERM/EBUSY: five attempts, 50 ms apart, then the error", () => {
    for (const code of ["EPERM", "EBUSY"]) {
      const { fsImpl, attempts } = flaky(code, 99);
      const sleeps: number[] = [];
      assert.throws(
        () => renameRetry("a", "b", { fsImpl, platform: "win32", sleep: (ms) => sleeps.push(ms) }),
        { code },
      );
      assert.equal(attempts(), RENAME_ATTEMPTS);
      assert.deepEqual(sleeps, Array(RENAME_ATTEMPTS - 1).fill(RENAME_DELAY_MS));
    }
  });

  test("succeeds as soon as an attempt does", () => {
    const { fsImpl, attempts } = flaky("EBUSY", 2);
    renameRetry("a", "b", { fsImpl, platform: "win32", sleep: () => {} });
    assert.equal(attempts(), 3);
  });

  test("no retry on POSIX, nor for another code", () => {
    const posix = flaky("EPERM", 99);
    assert.throws(() => renameRetry("a", "b", { fsImpl: posix.fsImpl, platform: "linux" }));
    assert.equal(posix.attempts(), 1);
    const other = flaky("EXDEV", 99);
    assert.throws(() =>
      renameRetry("a", "b", { fsImpl: other.fsImpl, platform: "win32", sleep: () => {} }),
    );
    assert.equal(other.attempts(), 1);
  });

  test("swapIn on a persistent win32 EBUSY fails with the old entry intact and no leftover", () => {
    const dir = tempDir();
    const dest = path.join(dir, "skill");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "old.txt"), "old");
    const stage = makeStage(dir, dest, "new");
    const busy: SwapFs = {
      ...realFs,
      renameSync: (from, to) => {
        if (from === stage) throw errno("EBUSY");
        fs.renameSync(from, to);
      },
    };
    const sleeps: number[] = [];
    assert.throws(
      () => swapIn(stage, dest, { fsImpl: busy, platform: "win32", sleep: (m) => sleeps.push(m) }),
      {
        code: "EBUSY",
      },
    );
    assert.equal(sleeps.length, RENAME_ATTEMPTS - 1);
    assert.equal(fs.readFileSync(path.join(dest, "old.txt"), "utf8"), "old");
    assert.deepEqual(leftovers(dir), []);
  });
});

describe("discardStage", () => {
  test("removes a directory and tolerates an absent path", () => {
    const dir = tempDir();
    const stage = makeStage(dir, path.join(dir, "skill"), "x");
    discardStage(stage);
    discardStage(stage);
    assert.deepEqual(leftovers(dir), []);
  });
});
