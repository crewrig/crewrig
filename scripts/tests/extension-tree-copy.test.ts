// extension-tree-copy.test.ts — copyTree, emptyDir, removeGenerated and the removal guard (spec 0254 R6, R14).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { readGeneratedClass } from "../lib/extension/descriptors.ts";
import {
  assertSafeToRemove,
  caseGlobRegExp,
  copyTree,
  emptyDir,
  removeGenerated,
  scanGenerated,
} from "../lib/extension/tree-copy.ts";
import { ExtError } from "../lib/extension/types.ts";

const LIB = path.resolve(import.meta.dirname, "../lib");
const scratch: string[] = [];

function tmp(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ext-tree-")));
  scratch.push(dir);
  return dir;
}

function put(root: string, rel: string, text = "x"): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function canLink(): boolean {
  const dir = tmp();
  try {
    fs.symlinkSync("target", path.join(dir, "l"));
    return true;
  } catch {
    return false;
  }
}

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("copyTree", () => {
  it("copies nested files and dotfiles into a fresh and an existing destination", () => {
    const src = tmp();
    put(src, "a.txt", "A");
    put(src, ".hidden", "H");
    put(src, "sub/.dot/b.txt", "B");
    const dst = path.join(tmp(), "out");
    assert.deepEqual(copyTree(src, dst), []);
    assert.equal(fs.readFileSync(path.join(dst, "a.txt"), "utf8"), "A");
    assert.equal(fs.readFileSync(path.join(dst, ".hidden"), "utf8"), "H");
    assert.equal(fs.readFileSync(path.join(dst, "sub/.dot/b.txt"), "utf8"), "B");
    put(dst, "keep.txt", "K");
    put(src, "a.txt", "A2");
    copyTree(src, dst);
    assert.equal(fs.readFileSync(path.join(dst, "a.txt"), "utf8"), "A2");
    assert.equal(fs.readFileSync(path.join(dst, "keep.txt"), "utf8"), "K");
  });

  it("keeps the file mode", { skip: process.platform === "win32" }, () => {
    const src = tmp();
    put(src, "run.sh", "#!/bin/sh\n");
    fs.chmodSync(path.join(src, "run.sh"), 0o755);
    const dst = tmp();
    copyTree(src, dst);
    assert.equal(fs.statSync(path.join(dst, "run.sh")).mode & 0o777, 0o755);
  });

  it("reproduces a link as a link, not its target", { skip: !canLink() }, () => {
    const src = tmp();
    put(src, "real.txt", "R");
    fs.symlinkSync("real.txt", path.join(src, "link.txt"));
    fs.symlinkSync("/nonexistent/elsewhere", path.join(src, "dangling"));
    const dst = tmp();
    assert.deepEqual(copyTree(src, dst), []);
    assert.equal(fs.lstatSync(path.join(dst, "link.txt")).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(dst, "link.txt")), "real.txt");
    assert.equal(fs.readlinkSync(path.join(dst, "dangling")), "/nonexistent/elsewhere");
  });

  it("refuses to copy a tree into itself", () => {
    const src = tmp();
    assert.throws(() => copyTree(src, path.join(src, "inner")), ExtError);
  });
});

describe("emptyDir", () => {
  it("removes every entry, dotfiles included, and keeps the directory", () => {
    const dir = tmp();
    put(dir, "a/b/c.txt");
    put(dir, ".hidden");
    emptyDir(dir, tmp());
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it("creates the directory when absent", () => {
    const dir = path.join(tmp(), "new", "deep");
    emptyDir(dir, tmp());
    assert.equal(fs.statSync(dir).isDirectory(), true);
  });

  it("refuses the filesystem root, the home directory, the repository and its ancestors", () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, "sub"));
    assert.throws(() => emptyDir(path.parse(repo).root, repo), /filesystem root/);
    assert.throws(
      () => assertSafeToRemove(os.homedir(), path.join(os.tmpdir(), "x")),
      /home directory/,
    );
    assert.throws(() => emptyDir(repo, repo), /repository/);
    assert.throws(() => emptyDir(path.dirname(repo), repo), /repository/);
    put(repo, "survivor.txt");
    assert.equal(fs.existsSync(path.join(repo, "survivor.txt")), true);
    assert.doesNotThrow(() => emptyDir(path.join(repo, "sub"), repo));
  });
});

describe("removeGenerated", () => {
  const generated = [
    "gemini-extension.json",
    "GEMINI.md",
    ".mcp.json",
    ".github/copilot/extension.json",
    "rules/AGENTS.md",
    "commands/build.toml",
    "skills/ctx-context/SKILL.md",
    "hooks/hooks.json",
    "hooks.json",
    "observed-gaps.json",
  ];
  const kept = [
    "extension.json",
    "README.md",
    "commands/build.md",
    "skills/real/SKILL.md",
    "other/hooks.json",
    "agents/a.md",
  ];

  it("removes exactly the files of the class, using the real descriptor", () => {
    const dir = tmp();
    for (const rel of [...generated, ...kept]) put(dir, rel);
    const cls = readGeneratedClass(LIB);
    assert.deepEqual(scanGenerated(dir, cls), [...generated].sort());
    assert.deepEqual(removeGenerated(dir, cls), [...generated].sort());
    for (const rel of generated) assert.equal(fs.existsSync(path.join(dir, rel)), false, rel);
    for (const rel of kept) assert.equal(fs.existsSync(path.join(dir, rel)), true, rel);
  });

  it("is a no-op on a missing directory", () => {
    assert.deepEqual(removeGenerated(path.join(tmp(), "none"), readGeneratedClass(LIB)), []);
  });
});

describe("caseGlobRegExp is a shell case pattern, not a pathname expansion", () => {
  it("* crosses a slash, ? is one character, regex characters are literal", () => {
    assert.ok(caseGlobRegExp("commands/*.toml").test("commands/a/b.toml"));
    assert.ok(caseGlobRegExp("skills/*-context/SKILL.md").test("skills/x/y-context/SKILL.md"));
    assert.ok(caseGlobRegExp("a?c").test("abc"));
    assert.ok(!caseGlobRegExp("a?c").test("ac"));
    assert.ok(!caseGlobRegExp("a.b").test("axb"));
    assert.ok(!caseGlobRegExp("commands/*.toml").test("xcommands/a.toml"));
  });
});
