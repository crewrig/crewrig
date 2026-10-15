// main.ts — the order of operations of `create-extension` (spec 0258 R23-R25).
// Twin of the main flow of scripts/create-extension.sh. Returns the exit status and never exits
// the process; an error that escapes is the entry's to report.

import fs from "node:fs";
import path from "node:path";

import { repoDirOf } from "../extension/entry-ctx.ts";
import type { Env, Io } from "../extension/types.ts";
import { parseCreateArgs } from "./args.ts";
import { mergeFragments } from "./merge.ts";
import { assertNoSurvivors, placeholderTokens } from "./placeholders.ts";
import { deriveGaps } from "./render.ts";
import { reportDone, reportNoComponents, reportStart, reportSurvivorsClear } from "./report.ts";
import { scaffold } from "./scaffold.ts";
import { selectComponents } from "./selection.ts";
import { substituteName } from "./substitute.ts";

export interface MainInput {
  /** Script arguments only (`process.argv.slice(2)`). */
  readonly argv: readonly string[];
  readonly env: Env;
  /** The entry's own file: `<repoDir>/scripts/create-extension.ts`. */
  readonly entryFile: string;
  readonly io: Io;
  readonly stdinIsTty: boolean;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
}

export async function main(input: MainInput): Promise<number> {
  const { io } = input;
  const args = parseCreateArgs(input.argv, input.env);
  if (!args.ok) {
    io.out(args.message);
    return args.status;
  }
  const { name, tier } = args;
  const repoDir = repoDirOf(input.entryFile);
  const skeletonDir = path.join(repoDir, "extension-skeleton");

  const target = path.join(repoDir, "extensions", tier, name);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    io.out(`Error: extensions/${tier}/${name} already exists.`);
    return 1;
  }

  reportStart(io, name);
  const selection = await selectComponents({
    name,
    fromOption: args.components,
    env: input.env,
    stdinIsTty: input.stdinIsTty,
    stdin: input.stdin,
    stdout: input.stdout,
  });
  if (!selection.ok) {
    io.err(selection.message);
    return 1;
  }
  const components = selection.components;
  if (components.length === 0) reportNoComponents(io);

  scaffold(skeletonDir, target, components, io);
  substituteName(target, name);
  const tokens = placeholderTokens(skeletonDir);
  mergeFragments(target, components, io);
  if (!assertNoSurvivors(target, tokens, io)) return 1;
  reportSurvivorsClear(io, target);

  const status = deriveGaps(repoDir, tier, name, target, io);
  if (status !== 0) return status;
  reportDone(io, tier, name);
  return 0;
}
