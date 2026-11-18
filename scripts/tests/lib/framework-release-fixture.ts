// framework-release-fixture.ts — a local temporary git repository with a bare `origin`, for the
// framework release guard and build suites (spec 0310 R12). No network is involved.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scrubGitEnv } from "../../lib/git-env.ts";

export class Fixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-fwrel-"));
  readonly origin = path.join(this.root, "origin.git");
  readonly work = path.join(this.root, "work");

  constructor() {
    fs.mkdirSync(this.work);
    this.run(this.root, "init", "-q", "--bare", "-b", "main", this.origin);
    this.run(this.work, "init", "-q", "-b", "main");
    this.run(this.work, "remote", "add", "origin", this.origin);
  }

  run(cwd: string, ...args: string[]): string {
    const res = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd,
      encoding: "utf8",
      env: scrubGitEnv(process.env),
    });
    assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
    return res.stdout.trim();
  }

  git(...args: string[]): string {
    return this.run(this.work, ...args);
  }

  /** Write files (path to content), commit them on the current branch, return the sha. */
  commit(files: Record<string, string>, message = "c"): string {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(this.work, rel)), { recursive: true });
      fs.writeFileSync(path.join(this.work, rel), content);
    }
    this.git("add", "-A");
    this.git("commit", "-q", "--allow-empty", "-m", message);
    return this.git("rev-parse", "HEAD");
  }

  pkg(version: string): Record<string, string> {
    return { "package.json": `${JSON.stringify({ name: "crewrig", version, private: true })}\n` };
  }

  push(...refs: string[]): void {
    this.git("push", "-q", "origin", ...refs);
  }

  dispose(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

/**
 * main (version 1.0.0) -> release/1822-distribution (one more commit, same version). Both are
 * pushed; the work tree ends on the release branch. Returns the shas.
 */
export function standardRepo(fx: Fixture): { mainSha: string; releaseSha: string } {
  const mainSha = fx.commit(fx.pkg("1.0.0"), "main");
  fx.push("main");
  fx.git("checkout", "-q", "-b", "release/1822-distribution");
  const releaseSha = fx.commit({ "notes.txt": "release work\n" }, "release");
  fx.push("release/1822-distribution");
  return { mainSha, releaseSha };
}
