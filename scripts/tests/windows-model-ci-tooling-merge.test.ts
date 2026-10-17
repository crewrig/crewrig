// windows-model-ci-tooling-merge.test.ts — the cross-system proof of merge-spec-pr.ts (spec 0262
// R21-R23). The draft refusal runs from PowerShell on Windows on a scratch git repo; off Windows
// it runs from the default shell so the file also passes in Linux CI. The delegation case needs a
// stub `gh` shell script and is POSIX-only. Interpreters are resolved from the PARENT PATH before
// the child PATH is narrowed. The `windows-model-ci-tooling` job runs every
// `windows-model-ci-tooling-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  WIN,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repo, "scripts", "merge-spec-pr.ts");

function withBox<T>(body: (root: string, work: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-model-ci-tooling-")),
  );
  try {
    const bin = path.join(root, "bin");
    const work = path.join(root, "work");
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(work, "specs"), { recursive: true });
    return body(root, work, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

/** A scratch repo on `spec/0999-x` holding specs/0999-x.md with the given status. */
function specRepo(work: string, status: string): void {
  git(work, "init", "-q", "-b", "spec/0999-x");
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "t");
  fs.writeFileSync(
    path.join(work, "specs", "0999-x.md"),
    `---\nid: "0999"\nslug: x\nstatus: ${status}\n---\n\nbody\n`,
  );
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "spec");
}

/** Directory of `git`, resolved from the parent PATH (the child PATH is narrowed). */
function gitDir(): string[] {
  const r = spawnSync(WIN ? "where" : "which", ["git"], { encoding: "utf8" });
  const first = r.status === 0 ? r.stdout.split(/\r?\n/)[0] : undefined;
  return first ? [path.dirname(first)] : [];
}

function run(entry: string, work: string, home: string, bin: string): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-model-ci-tooling-merge: ${entry}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry,
    script,
    args: [],
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    },
    home,
    bin,
    cwd: work,
    extraPath: gitDir(),
    interpreters,
  });
}

describe("windows model-ci-tooling: merge-spec-pr", () => {
  it("refuses a draft spec with the two ERROR lines and status 1", () => {
    withBox((root, work, bin) => {
      specRepo(work, "draft");
      const r = run("merge-spec-pr draft", work, root, bin);
      expectStatus(r, 1);
      assert.equal(
        r.err.replaceAll("\r\n", "\n"),
        "ERROR: Spec file specs/0999-x.md has 'status: draft' in its frontmatter.\n" +
          "       A draft spec cannot be merged. Please approve it first.\n",
        why(r, "refusal diagnostic"),
      );
      assert.equal(r.out, "", why(r, "nothing on stdout"));
    });
  });

  it("delegates an approved spec to gh pr merge --squash", { skip: WIN }, () => {
    withBox((root, work, bin) => {
      specRepo(work, "approved");
      const log = path.join(root, "gh-argv.log");
      const gh = path.join(bin, "gh");
      fs.writeFileSync(
        gh,
        `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\nexit 7\n`,
      );
      fs.chmodSync(gh, 0o755);
      const r = run("merge-spec-pr approved", work, root, bin);
      expectStatus(r, 7);
      assert.equal(fs.readFileSync(log, "utf8"), "pr\nmerge\n--squash\n", why(r, "gh argv"));
      assert.match(r.out, /Spec file specs\/0999-x\.md is not draft\. Delegating to gh pr merge\./);
    });
  });
});
