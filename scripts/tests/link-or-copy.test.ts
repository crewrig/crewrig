// link-or-copy.test.ts — linkOrCopy, placeCopy, removePlaced, summarizeFallbacks (spec 0255 R14-R21).

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

/** A source directory `src/skill` holding a file and a subdirectory, in a fresh sandbox. */
function sandbox(): { root: string; src: string; dest: string } {
  const root = tempDir();
  const src = path.join(root, "src", "skill");
  fs.mkdirSync(path.join(src, "sub"), { recursive: true });
  fs.writeFileSync(path.join(src, "SKILL.md"), "new\r\ncontent\n");
  fs.writeFileSync(path.join(src, "sub", "x.txt"), "x");
  return { root, src, dest: path.join(root, "home", "skill") };
}

function leftovers(dir: string): string[] {
  return fs.readdirSync(dir).filter((n) => n.includes(".crewrig-tmp-") || n.includes(".old-"));
}

function refuse(code: string): (t: string, p: string, type: "dir" | "file") => void {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

const WIN = { platform: "win32", env: {} } as const;
const isLink = (p: string): boolean => fs.lstatSync(p).isSymbolicLink();

describe("linkOrCopy — a real link", () => {
  test(
    "creates an absolute link to a directory and to a file",
    { skip: process.platform === "win32" },
    () => {
      const { src, dest } = sandbox();
      const out = linkOrCopy(src, dest, { env: {} });
      assert.deepEqual(out, { method: "link", dest, source: src });
      assert.ok(isLink(dest));
      assert.equal(fs.readlinkSync(dest), src);
      const file = path.join(src, "SKILL.md");
      const fileDest = path.join(path.dirname(dest), "SKILL.md");
      assert.equal(linkOrCopy(file, fileDest, { env: {} }).method, "link");
      assert.equal(fs.readlinkSync(fileDest), file);
      assert.deepEqual(leftovers(path.dirname(dest)), []);
    },
  );

  test("passes the type taken from the source to the symlink call", () => {
    const { src, dest } = sandbox();
    const seen: string[] = [];
    const impl = (t: string, p: string, type: "dir" | "file"): void => {
      seen.push(type);
      fs.symlinkSync(t, p, type);
    };
    linkOrCopy(src, dest, { env: {}, symlinkImpl: impl });
    linkOrCopy(path.join(src, "SKILL.md"), path.join(path.dirname(dest), "f"), {
      env: {},
      symlinkImpl: impl,
    });
    assert.deepEqual(seen, ["dir", "file"]);
  });

  for (const state of ["absent", "file", "directory", "symlink", "dangling"] as const) {
    test(
      `destination ${state} ends as a link to the source`,
      { skip: process.platform === "win32" },
      () => {
        const { root, src, dest } = sandbox();
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (state === "file") fs.writeFileSync(dest, "old");
        if (state === "directory") {
          fs.mkdirSync(path.join(dest, "deep"), { recursive: true });
          fs.writeFileSync(path.join(dest, "deep", "old.txt"), "old");
        }
        if (state === "symlink") fs.symlinkSync(root, dest);
        if (state === "dangling") fs.symlinkSync(path.join(root, "nowhere"), dest);
        assert.equal(linkOrCopy(src, dest, { env: {} }).method, "link");
        assert.equal(fs.readlinkSync(dest), src);
        assert.ok(fs.existsSync(path.join(root, "src")), "the old link target is untouched");
        assert.deepEqual(leftovers(path.dirname(dest)), []);
      },
    );
  }
});

describe("linkOrCopy — refusals (R15)", () => {
  for (const code of ["ENOTSUP", "EOPNOTSUPP", "ENOSYS"]) {
    for (const platform of ["win32", "linux", "darwin"]) {
      test(`${code} on ${platform} falls back to a copy`, () => {
        const { src, dest } = sandbox();
        const out = linkOrCopy(src, dest, { platform, env: {}, symlinkImpl: refuse(code) });
        assert.deepEqual(out, { method: "fallback-copy", dest, source: src, code });
        assert.ok(!isLink(dest));
        assert.equal(fs.readFileSync(path.join(dest, "sub", "x.txt"), "utf8"), "x");
      });
    }
  }

  test("EPERM on win32 falls back to a copy, byte for byte, with no leftover", () => {
    const { src, dest } = sandbox();
    const out = linkOrCopy(src, dest, { ...WIN, symlinkImpl: refuse("EPERM") });
    assert.equal(out.method, "fallback-copy");
    assert.equal(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), "new\r\ncontent\n");
    assert.deepEqual(leftovers(path.dirname(dest)), []);
  });

  for (const code of ["EPERM", "EACCES"]) {
    test(`${code} on POSIX is rethrown and nothing is created`, () => {
      const { src, dest } = sandbox();
      assert.throws(
        () => linkOrCopy(src, dest, { platform: "linux", env: {}, symlinkImpl: refuse(code) }),
        (e: unknown) => e instanceof Error && "code" in e && e.code === code,
      );
      assert.equal(fs.existsSync(dest), false);
      assert.deepEqual(leftovers(path.dirname(dest)), []);
    });
  }

  for (const code of ["EEXIST", "ENOENT", "ELOOP", "EINVAL"]) {
    test(`${code} is rethrown even on win32`, () => {
      const { src, dest } = sandbox();
      assert.throws(() => linkOrCopy(src, dest, { ...WIN, symlinkImpl: refuse(code) }));
      assert.equal(fs.existsSync(dest), false);
    });
  }

  test('onRefusal "throw" rethrows a refusal that would otherwise copy', () => {
    const { src, dest } = sandbox();
    assert.throws(
      () => linkOrCopy(src, dest, { ...WIN, onRefusal: "throw", symlinkImpl: refuse("EPERM") }),
      (e: unknown) => e instanceof Error && "code" in e && e.code === "EPERM",
    );
    assert.equal(fs.existsSync(dest), false);
  });

  test("the seam env forces the refusal and the win32 classification", () => {
    const { src, dest } = sandbox();
    const out = linkOrCopy(src, dest, {
      platform: "linux",
      env: { CREWRIG_TEST_LINK_REFUSAL: "EPERM" },
    });
    assert.deepEqual(out, { method: "fallback-copy", dest, source: src, code: "EPERM" });
    assert.ok(!isLink(dest));
  });

  test("the seam env with a code outside the fallback set is rethrown", () => {
    const { src, dest } = sandbox();
    assert.throws(
      () => linkOrCopy(src, dest, { env: { CREWRIG_TEST_LINK_REFUSAL: "EACCES" } }),
      (e: unknown) => e instanceof Error && "code" in e && e.code === "EACCES",
    );
  });

  test("an unset or empty seam env is ignored", { skip: process.platform === "win32" }, () => {
    for (const env of [{}, { CREWRIG_TEST_LINK_REFUSAL: "" }]) {
      const { src, dest } = sandbox();
      assert.equal(linkOrCopy(src, dest, { env }).method, "link");
    }
  });
});

describe("copy placement", () => {
  for (const state of ["absent", "file", "directory", "symlink", "dangling"] as const) {
    test(`placeCopy over a destination ${state}`, () => {
      const { root, src, dest } = sandbox();
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (state === "file") fs.writeFileSync(dest, "old");
      if (state === "directory") {
        fs.mkdirSync(path.join(dest, "deep"), { recursive: true });
        fs.writeFileSync(path.join(dest, "deep", "old.txt"), "old");
      }
      if (state === "symlink" && process.platform !== "win32") fs.symlinkSync(root, dest);
      if (state === "dangling" && process.platform !== "win32")
        fs.symlinkSync(path.join(root, "nowhere"), dest);
      assert.deepEqual(placeCopy(src, dest), { method: "copy", dest, source: src });
      assert.ok(!isLink(dest));
      assert.deepEqual(fs.readdirSync(dest).sort(), ["SKILL.md", "sub"]);
      assert.ok(fs.existsSync(path.join(root, "src")), "a replaced link's target is untouched");
      assert.deepEqual(leftovers(path.dirname(dest)), []);
    });
  }

  test("a single file is copied with its mode", { skip: process.platform === "win32" }, () => {
    const { src, dest } = sandbox();
    const file = path.join(src, "run.sh.golden");
    fs.writeFileSync(file, "#!x\n");
    fs.chmodSync(file, 0o750);
    placeCopy(file, dest);
    assert.equal(fs.statSync(dest).mode & 0o777, 0o750);
  });

  test(
    "a copy is replaced by a link once a link succeeds",
    { skip: process.platform === "win32" },
    () => {
      const { src, dest } = sandbox();
      linkOrCopy(src, dest, { ...WIN, symlinkImpl: refuse("EPERM") });
      assert.ok(!isLink(dest));
      assert.equal(linkOrCopy(src, dest, { env: {} }).method, "link");
      assert.equal(fs.readlinkSync(dest), src);
      assert.deepEqual(leftovers(path.dirname(dest)), []);
    },
  );

  test("a refresh rewrites a stale copy and drops files removed from the source", () => {
    const { src, dest } = sandbox();
    placeCopy(src, dest);
    fs.writeFileSync(path.join(src, "SKILL.md"), "v2");
    fs.rmSync(path.join(src, "sub"), { recursive: true });
    placeCopy(src, dest);
    assert.equal(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), "v2");
    assert.deepEqual(fs.readdirSync(dest), ["SKILL.md"]);
  });

  test("a destination inside its source is refused, for a link and for a copy", () => {
    const { src } = sandbox();
    const inside = path.join(src, "sub", "deeper", "copy");
    assert.throws(() => linkOrCopy(src, inside, { env: {} }), /inside its source/);
    assert.throws(() => placeCopy(src, inside), /inside its source/);
    assert.throws(() => placeCopy(src, src), /inside its source/);
    assert.equal(fs.existsSync(path.join(src, "sub", "deeper")), false);
  });

  test(
    "a failed copy leaves the old destination intact",
    { skip: process.platform === "win32" || process.getuid?.() === 0 },
    () => {
      const { src, dest } = sandbox();
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "keep.txt"), "old");
      const locked = path.join(src, "locked.txt");
      fs.writeFileSync(locked, "secret");
      fs.chmodSync(locked, 0o000);
      try {
        assert.throws(() => placeCopy(src, dest));
        assert.throws(() => linkOrCopy(src, dest, { ...WIN, symlinkImpl: refuse("EPERM") }));
      } finally {
        fs.chmodSync(locked, 0o600);
      }
      assert.equal(fs.readFileSync(path.join(dest, "keep.txt"), "utf8"), "old");
      assert.deepEqual(leftovers(path.dirname(dest)), []);
    },
  );

  test(
    "a link inside the source is dereferenced in the copy",
    { skip: process.platform === "win32" },
    () => {
      const { root, src, dest } = sandbox();
      fs.writeFileSync(path.join(root, "outside.txt"), "outside");
      fs.symlinkSync(path.join(root, "outside.txt"), path.join(src, "ln-file"));
      fs.symlinkSync(path.join(src, "sub"), path.join(src, "ln-dir"));
      placeCopy(src, dest);
      assert.ok(!isLink(path.join(dest, "ln-file")));
      assert.equal(fs.readFileSync(path.join(dest, "ln-file"), "utf8"), "outside");
      assert.ok(!isLink(path.join(dest, "ln-dir")));
      assert.equal(fs.readFileSync(path.join(dest, "ln-dir", "x.txt"), "utf8"), "x");
    },
  );

  test(
    "a source reached through a link is resolved: the outcome names the real source",
    { skip: process.platform === "win32" },
    () => {
      const { root, src, dest } = sandbox();
      const alias = path.join(root, "alias");
      fs.symlinkSync(src, alias);
      const out = linkOrCopy(`${alias}/`, dest, { env: {} });
      assert.equal(out.source, src);
      assert.equal(fs.readlinkSync(dest), src);
    },
  );
});
