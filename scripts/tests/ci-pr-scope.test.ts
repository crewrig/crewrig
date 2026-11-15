// Spec 0287 delta-02 R22: the pr-scope classifier. Offline: `classify` is pure, the CLI runs in a
// temporary git repository holding a merge commit (HEAD^1 is the base, HEAD the merge).

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { classify } from "../ci-pr-scope.ts";

const SCRIPT = path.resolve(import.meta.dirname, "..", "ci-pr-scope.ts");
const many = (n: number, prefix = "specs/"): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}f${i}.md`);

describe("classify", () => {
  it("is true only when every path is under specs/", () => {
    assert.equal(classify("pull_request", ["specs/a.md"]), "true");
    assert.equal(classify("pull_request", ["specs/a/b/c.md", "specs/d.md"]), "true");
  });
  it("is false for one path outside specs/", () => {
    assert.equal(classify("pull_request", ["specs/a.md", "docs/b.md"]), "false");
  });
  it("is false for the specs-old/ prefix trap and a bare specs file", () => {
    assert.equal(classify("pull_request", ["specs-old/x.md"]), "false");
    assert.equal(classify("pull_request", ["specs"]), "false");
  });
  it("is false for an empty list", () => {
    assert.equal(classify("pull_request", []), "false");
  });
  it("is true at 2,999 paths and throws at 3,000", () => {
    assert.equal(classify("pull_request", many(2999)), "true");
    assert.throws(() => classify("pull_request", many(3000)), /3,?000|cap|limit/i);
  });
  it("is false for any other event, before the cap is applied", () => {
    assert.equal(classify("push", ["specs/a.md"]), "false");
    assert.equal(classify("workflow_dispatch", ["specs/a.md"]), "false");
    assert.equal(classify("push", many(3000)), "false");
  });
});

function sh(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** A repo with a base commit holding `base`, then a merge commit applying `change(dir)` on a side branch. */
function mergeRepo(base: Record<string, string>, change: (dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-scope-"));
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@example.com");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "commit.gpgsign", "false");
  for (const [f, c] of Object.entries(base)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "base");
  sh(dir, "checkout", "-q", "-b", "side");
  change(dir);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "change");
  sh(dir, "checkout", "-q", "main");
  sh(dir, "commit", "-q", "--allow-empty", "-m", "main moves");
  sh(dir, "merge", "-q", "--no-ff", "-m", "merge", "side");
  return dir;
}

function runCli(cwd: string, event: string): { status: number | null; out: string; stderr: string } {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pr-scope-out-")), "output");
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: outFile },
    },
  );
  const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  return { status: r.status, out, stderr: r.stderr };
}

describe("the CLI", () => {
  it("writes spec-only=true for a spec-only merge commit", () => {
    const dir = mergeRepo({ "README.md": "x" }, (d) => {
      fs.mkdirSync(path.join(d, "specs"));
      fs.writeFileSync(path.join(d, "specs", "a.md"), "a");
    });
    const r = runCli(dir, "pull_request");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out, "spec-only=true\n");
  });
  it("writes false when one path is outside specs/", () => {
    const dir = mergeRepo({ "README.md": "x" }, (d) => {
      fs.mkdirSync(path.join(d, "specs"));
      fs.writeFileSync(path.join(d, "specs", "a.md"), "a");
      fs.writeFileSync(path.join(d, "README.md"), "y");
    });
    assert.equal(runCli(dir, "pull_request").out, "spec-only=false\n");
  });
  it("counts the old path of a rename out of specs/ (a delete plus an add)", () => {
    const dir = mergeRepo({ "docs/a.md": "same content\nmore\n" }, (d) => {
      fs.mkdirSync(path.join(d, "specs"));
      sh(d, "mv", "docs/a.md", "specs/a.md");
    });
    assert.equal(runCli(dir, "pull_request").out, "spec-only=false\n");
  });
  it("counts the new path of a rename into docs/ (a delete plus an add)", () => {
    const dir = mergeRepo({ "specs/a.md": "same content\nmore\n" }, (d) => {
      fs.mkdirSync(path.join(d, "docs"));
      sh(d, "mv", "specs/a.md", "docs/a.md");
    });
    assert.equal(runCli(dir, "pull_request").out, "spec-only=false\n");
  });
  it("a rename inside specs/ stays spec-only", () => {
    const dir = mergeRepo({ "specs/a.md": "same content\nmore\n" }, (d) => {
      sh(d, "mv", "specs/a.md", "specs/b.md");
    });
    assert.equal(runCli(dir, "pull_request").out, "spec-only=true\n");
  });
  it("fails with no output line when HEAD^1 is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-scope-"));
    sh(dir, "init", "-q", "-b", "main");
    sh(dir, "config", "user.email", "t@example.com");
    sh(dir, "config", "user.name", "t");
    sh(dir, "config", "commit.gpgsign", "false");
    sh(dir, "commit", "-q", "--allow-empty", "-m", "only");
    const r = runCli(dir, "pull_request");
    assert.notEqual(r.status, 0);
    assert.equal(r.out, "");
    assert.match(r.stderr, /git/i);
  });
  it("on push writes false and exits 0 with no git call, even with no HEAD^1", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-scope-"));
    sh(dir, "init", "-q", "-b", "main");
    const r = runCli(dir, "push");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out, "spec-only=false\n");
  });
});
