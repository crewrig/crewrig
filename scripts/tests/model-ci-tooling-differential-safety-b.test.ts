// model-ci-tooling-differential-safety-b.test.ts — second half of the differential safety tests
// (issue #1673): the call lock is bounded and never removes a lock outside the helper root, and a
// failed restore leaves the original target untouched. Every path is under this test's own mkdtemp.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { acquireLock } from "./lib/bash-suite-differential.ts";
import { createRoot } from "./lib/differential-guard.ts";
import { settle, takePre, type Shared } from "./lib/differential-shared.ts";
import { git } from "./lib/scratch-remote.ts";

const made: string[] = [];
let root: string;
let outside: string;

before(() => {
  root = createRoot("differential-safety-b-");
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safety-b-outside-")));
  made.push(root, outside);
});
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe("acquireLock", () => {
  test("a fresh lock that outlasts the wait fails naming the lock path", () => {
    const lock = path.join(root, "fresh.lock");
    fs.mkdirSync(lock);
    assert.throws(
      () => acquireLock(root, lock, 200),
      (e: Error) => e.message.includes(lock),
    );
    assert.equal(fs.existsSync(lock), true, "a live lock is left alone");
  });

  test("a stale lock inside the root is removed and taken", () => {
    const lock = path.join(root, "stale.lock");
    fs.mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    acquireLock(root, lock, 200);
    assert.equal(fs.existsSync(lock), true);
  });

  test("a lock outside the root is refused and never deleted", () => {
    const lock = path.join(outside, "x.lock");
    fs.mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    assert.throws(() => acquireLock(root, lock, 200), /outside/);
    assert.equal(fs.existsSync(lock), true);
  });
});

describe("snapshot and restore", () => {
  test("a snapshot directory outside the root is refused", () => {
    const dir = path.join(root, "tmp", "snapsrc");
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ["init", "--quiet", "-b", "main"]);
    assert.throws(() => takePre([{ root, dir }], outside), /outside/);
    assert.deepEqual(
      fs.readdirSync(outside).filter((n) => n.startsWith("snapsrc")),
      [],
    );
  });

  test("a failed copy leaves the original target intact", (t) => {
    if (process.getuid?.() === 0) return t.skip("root bypasses file permissions");
    const target = path.join(root, "tmp", "keep");
    fs.mkdirSync(target, { recursive: true });
    git(target, ["init", "--quiet", "-b", "main"]);
    fs.writeFileSync(path.join(target, "mine"), "original\n");
    const from = path.join(root, "tmp", "broken-snapshot");
    fs.mkdirSync(from);
    fs.writeFileSync(path.join(from, "secret"), "x");
    fs.chmodSync(path.join(from, "secret"), 0o000);
    const s: Shared = { root, dir: fs.realpathSync(target), post: from };
    try {
      assert.throws(() => settle([s], [""]));
    } finally {
      fs.chmodSync(path.join(from, "secret"), 0o600);
    }
    assert.equal(fs.readFileSync(path.join(target, "mine"), "utf8"), "original\n");
    assert.equal(fs.existsSync(path.join(target, ".git")), true);
    assert.deepEqual(
      fs.readdirSync(path.dirname(target)).filter((n) => n.startsWith("keep.")),
      [],
      "no half-copied sibling is left behind",
    );
  });
});
