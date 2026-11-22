// update.ts — `node crewrig update` (spec 0315 R9). It refuses unless the organization directory is a git work tree
// with an upstream and a `crewrig` launcher, fast-forwards the checkout with `git pull --ff-only` (run directly,
// never through a shell, never merging, rebasing, resetting, stashing or cleaning), then runs the launcher with
// `setup` and the options it received, so the pin that the pull brought decides the version. Its exit status is
// 0 or 1 only: a launcher code from 10 to 14 is reported as the launcher's own, and never returned as is.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Io } from "../build-components/types.ts";
import type { CliName } from "./command-args.ts";

export const LAUNCHER_FILE = "crewrig";

/** The launcher's own codes (spec 0314 R10) and their meanings. */
const LAUNCHER_CODES: Readonly<Record<number, string>> = {
  10: "the Node.js runtime is below the floor",
  11: "the pin file, the base URL or an environment variable is defective",
  12: "the download failed",
  13: "the digest did not match",
  14: "the extraction, the descriptor or the cache failed",
};

export interface UpdateRequest {
  readonly orgDir: string;
  readonly cli: CliName;
  readonly answers: readonly string[];
  readonly io: Io;
  readonly env: NodeJS.ProcessEnv;
}

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  return spawnSync("git", [...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** The first refusal of (a) in spec 0315 R9, or undefined when the directory qualifies. */
export function updatePrerequisite(orgDir: string, env: NodeJS.ProcessEnv): string | undefined {
  const inside = git(orgDir, ["rev-parse", "--is-inside-work-tree"], env);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return `crewrig update: ${orgDir} is not a git work tree; nothing was changed.`;
  }
  const upstream = git(orgDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], env);
  if (upstream.status !== 0) {
    return `crewrig update: the current branch of ${orgDir} has no upstream; nothing was changed.`;
  }
  if (!fs.existsSync(path.join(orgDir, LAUNCHER_FILE))) {
    return `crewrig update: ${path.join(orgDir, LAUNCHER_FILE)} is missing; nothing was changed.`;
  }
  return undefined;
}

export function runUpdate(request: UpdateRequest): number {
  const { io, orgDir, env } = request;
  const refusal = updatePrerequisite(orgDir, env);
  if (refusal !== undefined) {
    io.err(refusal);
    return 1;
  }

  const pull = git(orgDir, ["pull", "--ff-only"], { ...env, GIT_TERMINAL_PROMPT: "0" });
  if (pull.error !== undefined || pull.status !== 0) {
    io.err(
      `crewrig update: git pull --ff-only failed (${pull.error !== undefined ? "not started" : `status ${String(pull.status)}`}). ` +
        "The checkout was not merged, reset or stashed. node crewrig setup alone still installs the version already pinned.",
    );
    return 1;
  }

  const args = [path.join(orgDir, LAUNCHER_FILE), "setup", "--cli", request.cli];
  for (const answer of request.answers) args.push("--answer", answer);
  const run = spawnSync(process.execPath, args, { cwd: orgDir, env, stdio: "inherit" });
  if (run.error !== undefined || run.status === null) {
    io.err(
      "crewrig update: the launcher could not be run to completion; nothing else was changed by update.",
    );
    return 1;
  }
  if (run.status === 0) return 0;
  const meaning = LAUNCHER_CODES[run.status];
  if (meaning !== undefined) {
    const pin = run.status === 11 ? " Check crewrig.pin.json in the organization directory." : "";
    io.err(
      `crewrig update: the launcher ended with its own code ${run.status} (${meaning}).${pin}`,
    );
  } else {
    io.err(`crewrig update: setup ended with status ${run.status}.`);
  }
  return 1;
}
