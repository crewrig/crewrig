// worktree-timing-fixtures.ts — the inputs of the `windows-worktree-git-guard`
// timing steps (spec 0248 R33, plan verification duty 6): a fixture
// repository with two ticket worktrees, one whose ticket is claimed by the
// TypeScript tool and one that is not, and the stdin payload file of each
// timing step.
//
// Run as a script it builds them under a directory and appends `KEY=path`
// lines to $GITHUB_ENV, so the later steps of the job read them as
// environment variables:
//
//   node scripts/tests/lib/worktree-timing-fixtures.ts [<dir>]
//
//   TIMING_FIXTURE_CWD       the guard's process directory: the fixture main checkout
//   TIMING_FAST_PAYLOAD      a safe command in a ticket worktree (fast path)
//   TIMING_REFUSED_PAYLOAD   `git reset --hard` in the unclaimed ticket worktree (slow path, exit 1)
//   TIMING_ALLOWED_PAYLOAD   the same command in the claimed ticket worktree (slow path, exit 0)
//
// Standard library only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { addWorktree, CLAIM_TS, cleanEnv, initRepo } from "./worktree-fixtures.ts";

export interface WorktreeTimingFixtures {
  /** The process directory of every timing run. */
  readonly cwd: string;
  readonly fastPayload: string;
  readonly refusedPayload: string;
  readonly allowedPayload: string;
}

const UNCLAIMED = "1001";
const CLAIMED = "1002";

function payload(file: string, cwd: string, command: string): string {
  fs.writeFileSync(file, JSON.stringify({ cwd, tool_input: { command } }));
  return file;
}

/** Build the fixture repository and the three payload files under `dir`. */
export function writeWorktreeTimingFixtures(dir: string): WorktreeTimingFixtures {
  fs.mkdirSync(dir, { recursive: true });
  const base = fs.realpathSync.native(dir);
  const main = path.join(base, "repo");
  initRepo(main);
  const unclaimed = addWorktree(main, UNCLAIMED);
  const claimed = addWorktree(main, CLAIMED);
  const res = spawnSync(process.execPath, [CLAIM_TS, "take", "--agent", "timing"], {
    cwd: claimed,
    encoding: "utf8",
    env: cleanEnv(),
  });
  if (res.status !== 0) {
    throw new Error(`could not take the claim of ticket ${CLAIMED}: ${res.stdout}${res.stderr}`);
  }
  return {
    cwd: main,
    fastPayload: payload(path.join(base, "fast.json"), unclaimed, "git status"),
    refusedPayload: payload(path.join(base, "refused.json"), unclaimed, "git reset --hard"),
    allowedPayload: payload(path.join(base, "allowed.json"), claimed, "git reset --hard"),
  };
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(fs.realpathSync(invoked)).href) {
  const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "worktree-guard-timing-"));
  const fixtures = writeWorktreeTimingFixtures(dir);
  const lines = [
    `TIMING_FIXTURE_CWD=${fixtures.cwd}`,
    `TIMING_FAST_PAYLOAD=${fixtures.fastPayload}`,
    `TIMING_REFUSED_PAYLOAD=${fixtures.refusedPayload}`,
    `TIMING_ALLOWED_PAYLOAD=${fixtures.allowedPayload}`,
  ];
  const env = process.env["GITHUB_ENV"];
  if (env !== undefined && env !== "") fs.appendFileSync(env, `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}
