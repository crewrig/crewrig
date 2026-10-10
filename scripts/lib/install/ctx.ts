// ctx.ts — the context the install and unlink entries share (spec 0255 R3, R9, R13): the output
// channels, the environment, the platform, the home directory and the repository, built from
// `process` by the entry and never read again from it. The repository comes from the entry's own
// location (never from a search for `.git`), so a sandbox copy of scripts/ works too.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { repoDirOf } from "../extension/entry-ctx.ts";
import { TIERS } from "../extension/resolve.ts";
import type { Env, Io } from "../extension/types.ts";

export interface InstallCtx {
  readonly io: Io;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** `HOME` (`USERPROFILE` on Windows): the parent of `.gemini`. */
  readonly home: string;
  /** Physical parent of the directory that holds the entry file. */
  readonly repoDir: string;
}

/** The home directory as the scripts see it: `$HOME`, or `%USERPROFILE%` on Windows. */
export function homeOf(env: Env, platform: NodeJS.Platform): string {
  const preferred = platform === "win32" ? env["USERPROFILE"] : env["HOME"];
  const fallback = platform === "win32" ? env["HOME"] : env["USERPROFILE"];
  for (const value of [preferred, fallback]) {
    if (typeof value === "string" && value !== "") return value;
  }
  return os.homedir();
}

/** The process's streams; `out` and `err` append the line feed. */
export function processIo(): Io {
  return {
    out: (line: string) => void process.stdout.write(`${line}\n`),
    err: (line: string) => void process.stderr.write(`${line}\n`),
    errRaw: (text: string) => void process.stderr.write(text),
  };
}

/** The script arguments and the context of one entry; `entryFile` is the entry's `__filename`. */
export function processCtx(entryFile: string): { argv: string[]; ctx: InstallCtx } {
  const env: Env = process.env;
  const platform = process.platform;
  const ctx = {
    io: processIo(),
    env,
    platform,
    home: homeOf(env, platform),
    repoDir: repoDirOf(entryFile),
  };
  return { argv: process.argv.slice(2), ctx };
}

/** `<home>/.gemini`, the Gemini home every install and unlink script works under. */
export function geminiHome(ctx: InstallCtx): string {
  return path.join(ctx.home, ".gemini");
}

/**
 * The shell's `[ "$1" = "--include-org" ] || [ -n "${INCLUDE_ORG:-}" ]`: the flag as the first
 * argument, or any non-empty `INCLUDE_ORG` (`0` included).
 */
export function wantsOrg(ctx: InstallCtx, flag: boolean): boolean {
  const value = ctx.env["INCLUDE_ORG"];
  return flag || (typeof value === "string" && value !== "");
}

/**
 * The names under `extensions/<tier>/` the shell's directory glob of a tier matches: directories (a link to one
 * included), hidden names skipped, in code-unit order. A missing tier is empty.
 */
export function tierNames(repoDir: string, tier: string): string[] {
  const tierDir = path.join(repoDir, "extensions", tier);
  let names: string[];
  try {
    names = fs.readdirSync(tierDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.startsWith("."))
    .sort()
    .filter((name) => {
      try {
        return fs.statSync(path.join(tierDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
}

/** The tiers a no-name run walks: core and library, then org when opted in. */
export function walkedTiers(includeOrg: boolean): string[] {
  return TIERS.filter((tier) => tier !== "org" || includeOrg);
}
