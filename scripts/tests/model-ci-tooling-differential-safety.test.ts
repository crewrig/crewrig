// model-ci-tooling-differential-safety.test.ts — the structural guard of the differential helpers
// (issue #1673): nothing outside the helper's own mkdtemp root is ever deleted, restored or
// overwritten. Every negative case uses a canary directory this test creates with its own mkdtemp
// OUTSIDE the helper root; no real path (Homebrew, HOME, the checkout) is ever named as a target.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  assertInside,
  assertRoot,
  createRoot,
  isInside,
  tmpEnv,
} from "./lib/differential-guard.ts";
import { findShared, rewind, settle, takePre, type Shared } from "./lib/differential-shared.ts";
import { git } from "./lib/scratch-remote.ts";

const made: string[] = [];
const mk = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
const repoIn = (dir: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "f"), "x\n");
  return dir;
};

/** Names, modes, mtimes and content digests of everything below `dir`. */
function digest(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      const st = fs.lstatSync(full);
      const body = e.isFile()
        ? createHash("sha256").update(fs.readFileSync(full)).digest("hex")
        : "";
      out.push(`${path.relative(dir, full)}:${st.mode}:${st.mtimeMs}:${body}`);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.join("\n");
}

let root: string;
let canary: string;
let before0: string;

before(() => {
  root = createRoot("differential-safety-");
  made.push(root);
  canary = repoIn(path.join(mk("safety-canary-"), "fake-homebrew"));
  before0 = digest(canary);
});
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe("assertInside", () => {
  test("accepts a path strictly inside the root, existing or not", () => {
    assert.doesNotThrow(() => assertInside(root, path.join(root, "tmp")));
    assert.doesNotThrow(() => assertInside(root, path.join(root, "not", "yet", "there")));
  });

  test("rejects /opt/homebrew, the root itself and the filesystem root (string checks only)", () => {
    assert.throws(() => assertInside(root, "/opt/homebrew"), /outside/);
    assert.throws(() => assertInside(root, root), /outside/);
    assert.throws(() => assertInside(root, path.parse(root).root), /outside/);
  });

  test("rejects a prefix lookalike of the root", () => {
    assert.equal(isInside(root, `${root}-evil`), false);
    assert.equal(isInside(root, `${root}-evil/x`), false);
  });

  test("rejects .. traversal", () => {
    assert.throws(() => assertInside(root, path.join(root, "tmp", "..", "..", "x")), /outside/);
    assert.throws(() => assertInside(root, `${root}/../${path.basename(canary)}`), /outside/);
  });

  test("rejects a symlink inside the root that points outside, and paths below it", () => {
    const link = path.join(root, "tmp", "escape");
    fs.symlinkSync(canary, link);
    assert.throws(() => assertInside(root, link), /outside/);
    assert.throws(() => assertInside(root, path.join(link, "f")), /outside/);
    assert.equal(digest(canary), before0);
  });

  test("assertRoot refuses a directory that createRoot did not make", () => {
    assert.throws(() => assertRoot(canary), /not a differential root/);
    assert.doesNotThrow(() => assertRoot(root));
  });

  test("tmpEnv confines TMPDIR, TEMP and TMP to the root", () => {
    for (const v of Object.values(tmpEnv(root))) assert.equal(isInside(root, v), true);
  });
});

describe("findShared and the restore", () => {
  test("a repository named by HOMEBREW_PREFIX, GIT_DIR or HOME outside the root is ignored", () => {
    const keys = ["HOMEBREW_PREFIX", "GIT_DIR", "HOME"] as const;
    const saved = keys.map((k) => process.env[k]);
    try {
      process.env.HOMEBREW_PREFIX = canary;
      process.env.GIT_DIR = path.join(canary, ".git");
      process.env.HOME = canary;
      const values = Object.values(process.env).filter((v): v is string => !!v);
      assert.deepEqual(findShared([...values, canary], root, []), []);
    } finally {
      keys.forEach((k, i) => {
        const v = saved[i];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
    }
    assert.equal(digest(canary), before0, "the canary must be byte-unchanged");
  });

  test("a remote URL or a symlink leading outside the root is ignored", () => {
    const inside = repoIn(path.join(root, "tmp", "work"));
    git(inside, ["remote", "add", "origin", canary]);
    fs.symlinkSync(canary, path.join(root, "tmp", "link-to-canary"));
    const found = findShared([inside, path.join(root, "tmp", "link-to-canary")], root, []);
    assert.deepEqual(
      found.map((s) => s.dir),
      [fs.realpathSync(inside)],
    );
    assert.equal(digest(canary), before0);
  });

  test("a repository inside the root, named by an env-style value, is found", () => {
    const bare = path.join(root, "tmp", "remote.git");
    fs.mkdirSync(bare);
    git(bare, ["init", "--bare", "--quiet"]);
    assert.deepEqual(
      findShared([bare], root, []).map((s) => s.dir),
      [fs.realpathSync(bare)],
    );
  });

  test("snapshot and restore refuse a repository outside the root and delete nothing", () => {
    const snap = path.join(root, "tmp", "snaps");
    fs.mkdirSync(snap);
    const rogue: Shared = { root, dir: canary };
    assert.throws(() => takePre([rogue], snap), /outside/);
    assert.throws(() => rewind([{ ...rogue, pre: canary }], snap), /outside/);
    assert.throws(() => settle([{ ...rogue, post: canary }], [""]), /outside/);
    assert.equal(digest(canary), before0, "the canary must be byte-unchanged");
    assert.equal(fs.existsSync(path.join(canary, ".git")), true);
  });

  test("a restore from a snapshot located outside the root is refused", () => {
    const inside = repoIn(path.join(root, "tmp", "victim"));
    const mine = digest(inside);
    const s: Shared = { root, dir: fs.realpathSync(inside), post: canary };
    assert.throws(() => settle([s], [""]), /outside|differ/);
    assert.equal(digest(canary), before0);
    assert.equal(fs.existsSync(inside), true);
    assert.ok(mine.length > 0);
  });
});
