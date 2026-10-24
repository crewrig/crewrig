// release-main-fixture.ts — a throw-away checkout and a `main` run over fake flow dependencies,
// shared by the suites of the driver's top level (spec 0257 R13, R14, R19).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { realDeps } from "../../lib/monorepo-release/flow-deps.ts";
import type { FlowDeps } from "../../lib/monorepo-release/flow-deps.ts";
import { main } from "../../lib/monorepo-release/main.ts";
import { scrubGitEnv } from "../../lib/git-env.ts";

export type Env = Record<string, string | undefined>;

export const GITHUB: Env = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.example",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_TOKEN: "tok",
};
export const GITLAB: Env = {
  GITLAB_CI: "true",
  CI_PROJECT_URL: "https://gitlab.example/g/p",
  CI_SERVER_URL: "https://gitlab.example",
  CI_COMMIT_BRANCH: "main",
  GITLAB_TOKEN: "tok",
};

let tmp = "";
export let checkout = "";
/** Registers the hooks that give each test a fresh, empty checkout directory. */
export function useCheckout(): void {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-main-test-"));
    checkout = path.join(tmp, "checkout");
    fs.mkdirSync(checkout);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
}

/** A checkout on `branch` with one commit, so `git rev-parse --abbrev-ref HEAD` answers. */
export function initRepo(branch: string): void {
  const git = (...args: string[]): void => {
    const result = spawnSync("git", args, {
      cwd: checkout,
      encoding: "utf8",
      env: scrubGitEnv(process.env),
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q", "-b", branch);
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
}

export interface Seen {
  mirrorEnvs: Array<Readonly<Record<string, string | undefined>>>;
  mirrorDirs: string[];
  syncs: Array<{ scriptsDir: string }>;
}

interface Result {
  code: number;
  out: string[];
  err: string[];
  seen: Seen;
}

function fakeDeps(seen: Seen, over: Partial<FlowDeps> = {}): FlowDeps {
  return {
    ...realDeps,
    makeMirror: (opts) => {
      seen.mirrorEnvs.push(opts.env);
      seen.mirrorDirs.push(opts.dir);
    },
    stageCloneModules: () => [],
    runGit: () => ({ status: 0, stdout: "", stderr: "" }),
    runReleasePr: (_argv, opts) => {
      seen.syncs.push({ scriptsDir: opts.scriptsDir });
      return Promise.resolve(0);
    },
    ...over,
  };
}

export async function run(env: Env, over: Partial<FlowDeps> = {}): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const seen: Seen = { mirrorEnvs: [], mirrorDirs: [], syncs: [] };
  const code = await main(
    {
      env: { PATH: process.env["PATH"], ...env },
      platform: process.platform,
      cwd: checkout,
      entryFile: path.join(checkout, "scripts", "monorepo-release.ts"),
      io: { out: (l) => out.push(l), err: (l) => err.push(l), errRaw: (t) => err.push(t) },
    },
    fakeDeps(seen, over),
  );
  return { code, out, err, seen };
}
