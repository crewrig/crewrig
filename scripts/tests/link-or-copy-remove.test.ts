// link-or-copy-remove.test.ts — removePlaced and summarizeFallbacks (spec 0255 R18, R19).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { linkOrCopy, placeCopy, removePlaced, summarizeFallbacks } from "../lib/link-or-copy.ts";
import type { LinkOutcome } from "../lib/link-or-copy.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-loc-")));
  temps.push(dir);
  return dir;
}

function sandbox(): { root: string; src: string; dest: string } {
  const root = tempDir();
  const src = path.join(root, "src", "skill");
  fs.mkdirSync(path.join(src, "sub"), { recursive: true });
  fs.writeFileSync(path.join(src, "sub", "x.txt"), "x");
  return { root, src, dest: path.join(root, "home", "skill") };
}

describe("removePlaced (R19)", () => {
  test("absent", () => {
    assert.equal(removePlaced(path.join(tempDir(), "nothing")), "absent");
  });

  test("a copy is removed whole", () => {
    const { src, dest } = sandbox();
    placeCopy(src, dest);
    assert.equal(removePlaced(dest), "copy");
    assert.equal(fs.existsSync(dest), false);
    assert.ok(fs.existsSync(src));
  });

  test("a file is removed as a copy", () => {
    const { dest } = sandbox();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "f");
    assert.equal(removePlaced(dest), "copy");
  });

  test(
    "a link, a link to a directory and a dangling link are removed, never followed",
    { skip: process.platform === "win32" },
    () => {
      const { root, src, dest } = sandbox();
      linkOrCopy(src, dest, { env: {} });
      assert.equal(removePlaced(dest), "symlink");
      assert.equal(fs.readFileSync(path.join(src, "sub", "x.txt"), "utf8"), "x");
      assert.equal(fs.existsSync(dest), false);
      fs.symlinkSync(path.join(root, "nowhere"), dest);
      assert.equal(removePlaced(dest), "symlink");
      assert.throws(() => fs.lstatSync(dest));
    },
  );

  test("a guarded directory (the home directory) is refused", () => {
    assert.throws(() => removePlaced(os.homedir()), /refusing to remove/);
  });
});

describe("summarizeFallbacks (R18)", () => {
  const link: LinkOutcome = { method: "link", dest: "/d/a", source: "/s/a" };
  const copy: LinkOutcome = { method: "copy", dest: "/d/b", source: "/s/b" };
  const fb = (dest: string, code = "EPERM"): LinkOutcome => ({
    method: "fallback-copy",
    dest,
    source: "/s",
    code,
  });

  test("is empty without a fallback", () => {
    assert.equal(summarizeFallbacks([]), "");
    assert.equal(summarizeFallbacks([link, copy]), "");
  });

  test("names every fallback destination one per line, and only those", () => {
    const text = summarizeFallbacks([link, fb("/d/one"), copy, fb("/d/two", "ENOTSUP")]);
    const lines = text.split("\n");
    assert.ok(lines.includes("  /d/one"));
    assert.ok(lines.includes("  /d/two"));
    assert.ok(!text.includes("/d/a") && !text.includes("/d/b"));
    assert.match(text, /EPERM, ENOTSUP/);
    assert.match(text, /only after the same operation is run again/);
    assert.ok(!text.endsWith("\n"));
  });
});
