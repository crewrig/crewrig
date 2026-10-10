// entry.ts — what the four manage-*-component.ts entries build from `process` (spec 0255 R3, R6).
//
// Twins scripts/lib/extension/entry-ctx.ts for the manage family: the entry file is the only
// anchor of the repository (never a search for `.git`), `HOME` (`USERPROFILE` on Windows) is
// the home, and the streams are the process's own. `buildProcessCtxParts` holds the part every
// install, manage and link entry shares; `runManageEntry` adds the `ManageCtx` fields only the
// manage entries read (standard input for the link prompt, the `claude mcp` spawn context).

import os from "node:os";

import type { Env, Io } from "../extension/types.ts";
import { repoDirOf } from "../extension/entry-ctx.ts";
import { defaultIsFile } from "../worktree-claim/launch-windows.ts";
import { manageMain } from "./main.ts";
import type { ManageCtx } from "./main.ts";
import { defaultSpawn } from "./mcp-claude.ts";
import type { CliDescriptor } from "./types.ts";

/** The fields of a context that every entry reads from `process` and the entry's own location. */
export interface ProcessCtxParts {
  /** Script arguments only (`process.argv.slice(2)`). */
  readonly argv: readonly string[];
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly io: Io;
  /** The repository root, from the entry file: `<repoDir>/scripts/<name>.ts`. */
  readonly repoDir: string;
  /** `HOME`, or `USERPROFILE` on Windows; the operating system's answer when neither is set. */
  readonly home: string;
}

/** An `Io` writing to the process's standard streams, one `\n` per line. */
export function processIo(): Io {
  return {
    out: (line: string) => void process.stdout.write(`${line}\n`),
    err: (line: string) => void process.stderr.write(`${line}\n`),
    errRaw: (text: string) => void process.stderr.write(text),
  };
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

/** Everything an entry derives from `process` without reading a file; `entryFile` is `__filename`. */
export function buildProcessCtxParts(entryFile: string): ProcessCtxParts {
  const env: Env = process.env;
  const platform = process.platform;
  return {
    argv: process.argv.slice(2),
    env,
    platform,
    io: processIo(),
    repoDir: repoDirOf(entryFile),
    home: homeOf(env, platform),
  };
}

/** Run one manage entry: build the context from `process`, run `manageMain`, return the status. */
export function runManageEntry(descriptor: CliDescriptor, entryFile: string): Promise<number> {
  const parts = buildProcessCtxParts(entryFile);
  const ctx: ManageCtx = {
    io: parts.io,
    env: parts.env,
    platform: parts.platform,
    stdin: process.stdin,
    repoDir: parts.repoDir,
    home: parts.home,
    claude: {
      env: parts.env,
      platform: parts.platform,
      spawn: defaultSpawn,
      isFile: defaultIsFile,
    },
  };
  return manageMain(descriptor, parts.argv, ctx);
}
