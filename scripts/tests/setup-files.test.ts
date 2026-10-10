// setup-files.test.ts — installFile / installDir (scripts/lib/setup/files.ts) and
// warnIfLinkedWorktree (scripts/lib/setup/worktree-warning.ts) against temporary directories only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { LinkOutcome } from "../lib/link-or-copy.ts";
import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import {
  fallbackSummary,
  flushFallbackNotice,
  installDir,
  installFile,
} from "../lib/setup/files.ts";
import type { FilesCtx } from "../lib/setup/files.ts";
import { warnIfLinkedWorktree } from "../lib/setup/worktree-warning.ts";

const posix = process.platform !== "win32";
let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-files-")));
  out = [];
  err = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function ctxOf(link: boolean, extra: Partial<FilesCtx> = {}): FilesCtx {
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), errRaw: () => {} };
  return { io, env: {}, platform: process.platform, link, ...extra };
}

const refuse = (): never => {
  throw Object.assign(new Error("not supported"), { code: "ENOTSUP" });
};

function write(rel: string, text: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

describe("installFile, copy mode", () => {
  it("copies the bytes, creates the parents and prints Copied", () => {
    const src = write("src/SOUL.md", "line one\nline two\n");
    const dest = path.join(root, "home", ".claude", "rules", "00-soul.md");
    const outcome = installFile(ctxOf(false), src, dest, "SOUL.md -> ~/.claude/rules/00-soul.md");
    assert.equal(outcome.method, "copy");
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
    assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(src));
    assert.deepEqual(out, ["  Copied: SOUL.md -> ~/.claude/rules/00-soul.md"]);
    assert.deepEqual(err, []);
  });

  it("writes LF only when the source is LF", () => {
    const src = write("src/a.md", "a\nb\nc\n");
    const dest = path.join(root, "out", "a.md");
    installFile(ctxOf(false), src, dest, "a");
    assert.equal(fs.readFileSync(dest, "utf8").includes("\r"), false);
  });

  it("replaces an existing regular file", () => {
    const src = write("src/a.md", "new\n");
    const dest = write("out/a.md", "old content that is longer\n");
    installFile(ctxOf(false), src, dest, "a");
    assert.equal(fs.readFileSync(dest, "utf8"), "new\n");
  });

  it("keeps the source's mode bits", { skip: !posix }, () => {
    const src = write("src/run.sh", "#!/bin/sh\n");
    fs.chmodSync(src, 0o755);
    const dest = path.join(root, "out", "run.sh");
    installFile(ctxOf(false), src, dest, "run");
    assert.equal(fs.statSync(dest).mode & 0o777, 0o755);
  });

  it("replaces a link to another file without writing through it", { skip: !posix }, () => {
    const src = write("src/a.md", "new\n");
    const elsewhere = write("elsewhere.md", "untouched\n");
    const dest = path.join(root, "out", "a.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(elsewhere, dest);
    installFile(ctxOf(false), src, dest, "a");
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(dest, "utf8"), "new\n");
    assert.equal(fs.readFileSync(elsewhere, "utf8"), "untouched\n");
  });

  it("replaces a dangling link", { skip: !posix }, () => {
    const src = write("src/a.md", "new\n");
    const dest = path.join(root, "out", "a.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(path.join(root, "gone.md"), dest);
    installFile(ctxOf(false), src, dest, "a");
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(dest, "utf8"), "new\n");
    assert.equal(fs.existsSync(path.join(root, "gone.md")), false);
  });
});

describe("installFile, link mode", () => {
  it("places an absolute link and prints Linked", { skip: !posix }, () => {
    const src = write("src/a.md", "x\n");
    const dest = path.join(root, "out", "a.md");
    const outcome = installFile(ctxOf(true), src, dest, "a");
    assert.equal(outcome.method, "link");
    assert.equal(fs.readlinkSync(dest), src);
    assert.deepEqual(out, ["  Linked: a"]);
  });

  it("replaces an existing regular file and a dangling link", { skip: !posix }, () => {
    const src = write("src/a.md", "x\n");
    const regular = write("out/a.md", "old\n");
    installFile(ctxOf(true), src, regular, "a");
    assert.equal(fs.readlinkSync(regular), src);
    const dangling = path.join(root, "out", "b.md");
    fs.symlinkSync(path.join(root, "gone.md"), dangling);
    installFile(ctxOf(true), src, dangling, "b");
    assert.equal(fs.readlinkSync(dangling), src);
  });

  it("places a copy when the link is refused and reports it once", () => {
    const src = write("src/a.md", "x\n");
    const ctx = {
      ...ctxOf(true, { linkOptions: { symlinkImpl: refuse } }),
      outcomes: [] as LinkOutcome[],
    };
    const a = path.join(root, "out", "a.md");
    const b = path.join(root, "out", "b.md");
    assert.equal(installFile(ctx, src, a, "a").method, "fallback-copy");
    assert.equal(installFile(ctx, src, b, "b").method, "fallback-copy");
    assert.equal(fs.lstatSync(a).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(b, "utf8"), "x\n");
    assert.deepEqual(out, ["  Copied: a", "  Copied: b"]);
    const notice = fallbackSummary(ctx);
    assert.ok(notice?.includes("(ENOTSUP)"));
    assert.ok(notice?.includes(`  ${a}`) && notice.includes(`  ${b}`));
    assert.equal(notice?.split("Symbolic links were refused").length, 2);
    flushFallbackNotice(ctx);
    assert.deepEqual(err, [notice]);
  });

  it("has no notice when nothing fell back", () => {
    const src = write("src/a.md", "x\n");
    const ctx = { ...ctxOf(false), outcomes: [] as LinkOutcome[] };
    installFile(ctx, src, path.join(root, "out", "a.md"), "a");
    assert.equal(fallbackSummary(ctx), undefined);
    flushFallbackNotice(ctx);
    assert.deepEqual(err, []);
  });
});

describe("installDir", () => {
  function store(): string {
    write("store/one.md", "1\n");
    write("store/sub/.hidden", "h\n");
    return path.join(root, "store");
  }

  it("copies a tree to a real directory and prints Copied dir", () => {
    const dest = path.join(root, "home", ".crewrig", "system-context");
    const outcome = installDir(ctxOf(false), store(), dest, "system-context");
    assert.equal(outcome.method, "copy");
    assert.equal(fs.lstatSync(dest).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(dest, "sub", ".hidden"), "utf8"), "h\n");
    assert.deepEqual(out, ["  Copied dir: system-context"]);
  });

  it("clears a prior copy first, so a removed source file does not linger", () => {
    const dest = write("out/ctx/stale.md", "stale\n");
    installDir(ctxOf(false), store(), path.dirname(dest), "ctx");
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(path.join(root, "out", "ctx", "one.md")), true);
  });

  it("links the directory and switches a prior copy to a link", { skip: !posix }, () => {
    const dest = write("out/ctx/old.md", "old\n");
    installDir(ctxOf(true), store(), path.dirname(dest), "ctx");
    assert.equal(fs.readlinkSync(path.join(root, "out", "ctx")), store());
    assert.deepEqual(out, ["  Linked dir: ctx"]);
  });

  it(
    "switches a prior link back to a real directory without touching the source",
    { skip: !posix },
    () => {
      const src = store();
      const dest = path.join(root, "out", "ctx");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.symlinkSync(src, dest);
      installDir(ctxOf(false), src, dest, "ctx");
      assert.equal(fs.lstatSync(dest).isDirectory(), true);
      assert.equal(fs.readFileSync(path.join(src, "one.md"), "utf8"), "1\n");
    },
  );

  it("places a copy of the directory when the link is refused", () => {
    const ctx = {
      ...ctxOf(true, { linkOptions: { symlinkImpl: refuse } }),
      outcomes: [] as LinkOutcome[],
    };
    const dest = path.join(root, "out", "ctx");
    assert.equal(installDir(ctx, store(), dest, "ctx").method, "fallback-copy");
    assert.equal(fs.lstatSync(dest).isDirectory(), true);
    assert.deepEqual(out, ["  Copied dir: ctx"]);
    assert.ok(fallbackSummary(ctx)?.includes(dest));
  });
});

describe("warnIfLinkedWorktree", () => {
  const spawnerOf =
    (stdout: string, status = 0): Spawner =>
    (): SpawnResult => ({
      status,
      stdout,
      stderr: "",
    });
  const ctx = () => ({
    io: { out: (l: string) => out.push(l) },
    repoDir: "/work/repo",
  });

  it("prints the four lines for a linked worktree", () => {
    const calls: (readonly string[])[] = [];
    const spawner: Spawner = (argv) => {
      calls.push(argv);
      return { status: 0, stdout: "/work/main/.git\n", stderr: "" };
    };
    assert.equal(warnIfLinkedWorktree(ctx(), spawner, "usage-capture shim"), true);
    assert.deepEqual(calls, [["git", "-C", "/work/repo", "rev-parse", "--git-common-dir"]]);
    assert.deepEqual(out, [
      "  WARNING: this checkout is a linked git worktree (/work/repo).",
      "           The usage-capture shim wiring above points INTO this checkout — running",
      "           'git worktree remove' on it breaks the wired hook silently",
      "           until this installer is re-run against a durable checkout.",
    ]);
  });

  it("is silent in the main checkout", () => {
    assert.equal(warnIfLinkedWorktree(ctx(), spawnerOf(".git\n"), "x"), false);
    assert.deepEqual(out, []);
  });

  it("is silent when git prints nothing or fails", () => {
    assert.equal(warnIfLinkedWorktree(ctx(), spawnerOf("", 128), "x"), false);
    assert.equal(warnIfLinkedWorktree(ctx(), spawnerOf("", 127), "x"), false);
    assert.deepEqual(out, []);
  });
});
