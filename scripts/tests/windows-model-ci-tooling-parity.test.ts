// windows-model-ci-tooling-parity.test.ts — the cross-system proof of check-ci-parity.ts (spec 0262
// R23, delta-02 (h), delta-05 (j)). From PowerShell on Windows, the twin runs against the real
// repository (OK verdict) and against a scratch copy whose reference drifted (DRIFT findings,
// status 1); off Windows it runs from the default shell so the file also passes in Linux CI.
// Interpreters are resolved from the PARENT PATH before the child PATH is narrowed. Every fixture
// is built at runtime inside the test's own mkdtemp directory; nothing outside it is touched. The
// `windows-model-ci-tooling` job runs every `windows-model-ci-tooling-*.test.ts` file.

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
const script = path.join(repo, "scripts", "check-ci-parity.ts");

function withBox<T>(body: (root: string, work: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-model-ci-tooling-")),
  );
  try {
    const bin = path.join(root, "bin");
    const work = path.join(root, "work");
    fs.mkdirSync(bin);
    fs.mkdirSync(work);
    return body(root, work, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Directory of `git`, resolved from the parent PATH (the child PATH is narrowed). */
function gitDir(): string[] {
  const r = spawnSync(WIN ? "where" : "which", ["git"], { encoding: "utf8" });
  const first = r.status === 0 ? r.stdout.split(/\r?\n/)[0] : undefined;
  return first ? [path.dirname(first)] : [];
}

function run(entry: string, root: string, bin: string, repoDir?: string): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-model-ci-tooling-parity: ${entry}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry,
    script,
    args: [],
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      ...(repoDir === undefined ? {} : { CREWRIG_REPO_DIR: repoDir }),
    },
    home: root,
    bin,
    extraPath: gitDir(),
    interpreters,
  });
}

/** A scratch repository tree with the reference's `build` command changed. */
function driftedTree(work: string): void {
  fs.cpSync(path.join(repo, "ci"), path.join(work, "ci"), { recursive: true });
  fs.cpSync(path.join(repo, ".github", "workflows"), path.join(work, ".github", "workflows"), {
    recursive: true,
  });
  fs.copyFileSync(path.join(repo, ".gitlab-ci.yml"), path.join(work, ".gitlab-ci.yml"));
  const ref = path.join(work, "ci", "ci-capabilities.yml");
  fs.writeFileSync(
    ref,
    fs.readFileSync(ref, "utf8").replace("command:", "command:\n      - echo extra"),
  );
}

describe("windows model-ci-tooling: check-ci-parity", () => {
  it("agrees on the real repository: OK verdict, status 0, empty stderr, LF only", () => {
    withBox((root, _work, bin) => {
      const r = run("check-ci-parity real", root, bin);
      expectStatus(r, 0);
      assert.match(
        r.out,
        /^OK: reference, GitHub Actions, GitLab agree on the portable capability set;/,
        why(r, "verdict line"),
      );
      assert.equal(r.err, "", why(r, "empty stderr"));
      assert.ok(!r.out.includes("\r"), why(r, "LF only on stdout"));
    });
  });

  it("reports DRIFT findings and exits 1 on a drifted scratch reference", () => {
    withBox((root, work, bin) => {
      driftedTree(work);
      const r = run("check-ci-parity drift", root, bin, work);
      expectStatus(r, 1);
      assert.match(
        r.err,
        /^ {2}DRIFT: capability 'build' \(github-actions\): business step diverges from the declared command/m,
        why(r, "arm 1 finding"),
      );
      assert.match(r.err, /^ {2}DRIFT: reference.GitLab divergence \(gitlab\)/mu, why(r, "arm 2"));
      assert.match(r.err, /FAILED: \d+ CI parity violation\(s\) detected/, why(r, "verdict"));
      assert.ok(!r.out.includes("\r") && !r.err.includes("\r"), why(r, "LF only"));
    });
  });
});
