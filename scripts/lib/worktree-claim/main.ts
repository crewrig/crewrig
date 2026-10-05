// main.ts — dispatch of the claim tool (spec 0248 R14, R15).
//
// Parses the command line, resolves the repository context in the shell tool's
// order and runs the subcommand, returning the exit code. Nothing here exits the
// process: the entry sets `process.exitCode`, so every stream drains first.
// `run` lives in `run.ts`.

import { parseArgs } from "./args.ts";
import { resolveContext } from "./repo.ts";
import { runCommand } from "./run.ts";
import { cmdHistory, cmdStatus } from "./status.ts";
import { cmdRelease, cmdTake } from "./take.ts";
import { cmdTakeover } from "./takeover.ts";
import { ClaimFailure } from "./types.ts";
import type { Env, Io } from "./types.ts";
import { USAGE } from "./usage.ts";

/** Run the claim tool with `argv` (script arguments only) and return its exit code. */
export async function main(input: {
  readonly argv: readonly string[];
  readonly env: Env;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly io: Io;
}): Promise<number> {
  const { io } = input;
  try {
    const parsed = parseArgs(input.argv);
    if (parsed.kind === "usage") {
      io.raw(USAGE);
      return parsed.exitCode;
    }
    const { opts } = parsed;

    const override = input.env["CREWRIG_REPO_DIR"];
    const resolved = resolveContext({
      repoDir: override === undefined || override === "" ? input.cwd : override,
      subcommand: opts.subcommand,
      ticket: opts.ticket,
      agent: opts.agent,
      platform: input.platform,
    });
    if (!resolved.ok) throw new ClaimFailure(resolved.message);
    const { ctx } = resolved;

    switch (opts.subcommand) {
      case "status":
        return cmdStatus(ctx, io);
      case "history":
        return cmdHistory(ctx, io);
      case "take":
        return cmdTake(ctx, opts, io);
      case "release":
        return cmdRelease(ctx, io);
      case "takeover":
        return cmdTakeover(ctx, opts, io);
      case "run":
        return await runCommand(ctx, opts, io);
    }
  } catch (error) {
    if (error instanceof ClaimFailure) {
      io.err(`Error: ${error.message}`);
      return error.exitCode;
    }
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
