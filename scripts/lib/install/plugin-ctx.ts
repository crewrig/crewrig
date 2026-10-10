// plugin-ctx.ts — the small context of the three plugin installers (spec 0255 R10, R24).
// Built from the entry's input the way scripts/lib/extension/entry-ctx.ts builds the builders'
// context, minus the descriptors and the YAML reader: the in-process build constructs its own.

import os from "node:os";

import { repoDirOf } from "../extension/entry-ctx.ts";
import type { EntryInput } from "../extension/entry-ctx.ts";
import type { Env, Io } from "../extension/types.ts";

export interface PluginCtx {
  /** Script arguments only (`process.argv.slice(2)`). */
  readonly argv: readonly string[];
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly io: Io;
  /** The entry's own file, handed on to the in-process build. */
  readonly entryFile: string;
  /** Physical parent of the directory that holds the entry file. */
  readonly repoDir: string;
  /** `$HOME`, else `%USERPROFILE%`, else the operating system's answer. */
  readonly home: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

export function createPluginCtx(input: EntryInput): PluginCtx {
  return {
    argv: input.argv,
    env: input.env,
    platform: input.platform,
    io: input.io,
    entryFile: input.entryFile,
    repoDir: repoDirOf(input.entryFile),
    home: nonEmpty(input.env["HOME"]) ?? nonEmpty(input.env["USERPROFILE"]) ?? os.homedir(),
  };
}

/** The input `pluginMain` takes, rebuilt from the context with the build's own arguments. */
export function buildInput(ctx: PluginCtx, argv: readonly string[]): EntryInput {
  return {
    argv,
    env: ctx.env,
    platform: ctx.platform,
    entryFile: ctx.entryFile,
    io: ctx.io,
  };
}
