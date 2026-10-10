// main.ts — the shared body of the four manage-*-component.sh scripts (spec 0255 R6, R7, R12, R22(i)).
//
// Twins what the scripts do around their `case "$TYPE" in` dispatch: the `<mode> <type> [name]`
// grammar, the usage lines, the link-mode warning and its one-key prompt, the singular-to-plural
// normalisation, and the loop of `overlay-loop.ts`. One aggregated fallback notice (R7, R18) goes
// to standard error at the end, whatever the loop's outcome. Nothing here calls `process.exit`,
// reads `process` or keeps module state: the thin entry builds a `ManageCtx` and sets the code.
//
// Listed deviation (R22(i)): the shell printed `Usage: $0 ...` with the path it was started by;
// the usage line here starts with the bare script name of the descriptor, `manage-<cli>-component.sh`.

import type { Env, Io } from "../extension/types.ts";
import type { LinkOrCopyOptions } from "../link-or-copy.ts";
import type { SpawnFn as RebuildFn } from "../component-overlay.ts";
import { confirmContinue, linkWarningLines } from "./confirm.ts";
import type { LinkWarningCli, PromptStdin } from "./confirm.ts";
import { normaliseType } from "./normalise.ts";
import { runOverlayLoop } from "./overlay-loop.ts";
import type { LoopDeps } from "./overlay-loop.ts";
import type { ClaudeMcpCtx } from "./mcp-claude.ts";
import { flushFallbackNotice, newPlaceCtx } from "./place.ts";
import type { CliDescriptor } from "./types.ts";

/** Everything `manageMain` reads from the outside; the entry fills it from `process`. */
export interface ManageCtx {
  readonly io: Io;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** The stream the `Continue? [y/N]` prompt reads (the process's standard input). */
  readonly stdin: PromptStdin;
  /** The repository root (`REPO_DIR`). */
  readonly repoDir: string;
  /** The user's HOME (`HOME`, or `USERPROFILE` on Windows). */
  readonly home: string;
  /** Claude only: the `claude mcp` lookup and spawn context. */
  readonly claude?: ClaudeMcpCtx;
  /** Test seam: the staging rebuild child (default: a real `node` child). */
  readonly rebuild?: RebuildFn;
  /** Test seam and policy switches of the link placement (win over `env` and `platform`). */
  readonly linkOptions?: LinkOrCopyOptions;
}

/** `Usage: manage-claude-component.sh <install|link> <type> [name]`, then the `Types:` line. */
export function usageLines(descriptor: CliDescriptor): readonly string[] {
  return [
    `Usage: ${descriptor.script} <install|link> <type> [name]`,
    `Types: ${descriptor.typesLine}`,
  ];
}

/** The workspace script serves the Gemini CLI; the warning table is keyed by script family. */
function warningCli(descriptor: CliDescriptor): LinkWarningCli {
  return descriptor.cli === "gemini" ? "workspace" : (descriptor.cli as LinkWarningCli);
}

/** The loop's dependencies; only claude's MCP handler reads `claude` (it throws when it is absent). */
function loopDeps(ctx: ManageCtx, place: LoopDeps["place"]): LoopDeps {
  return {
    io: ctx.io,
    place,
    ...(ctx.claude === undefined ? {} : { claude: ctx.claude }),
    ...(ctx.rebuild === undefined ? {} : { rebuild: ctx.rebuild }),
  };
}

/**
 * Run one manage command. `argv` is the script's own arguments (`<mode> <type> [name]`, no
 * program or script path). Returns the exit status: 0, or the first non-zero status, which
 * stops the run (`|| exit $?`).
 */
export async function manageMain(
  descriptor: CliDescriptor,
  argv: readonly string[],
  ctx: ManageCtx,
): Promise<number> {
  const { io } = ctx;
  // `${1:-install}`: an empty first argument is the default mode too.
  const modeWord = argv[0] === undefined || argv[0] === "" ? descriptor.defaultMode : argv[0];
  const rawType = argv[1] ?? "";
  const name = argv[2] ?? "";

  if (rawType === "") {
    for (const line of usageLines(descriptor)) io.out(line);
    return 1;
  }

  // Any word but `link` installs (the shell tested `[ "$MODE" = "link" ]` only).
  const mode = modeWord === "link" ? "link" : "install";
  if (mode === "link") {
    for (const line of linkWarningLines(warningCli(descriptor))) io.out(line);
    if (descriptor.linkPrompt && !(await confirmContinue(ctx.stdin, io))) return 1;
  }

  const place = newPlaceCtx(
    io,
    ctx.env as Record<string, string | undefined>,
    ctx.platform,
    ctx.linkOptions,
  );
  const request = {
    cli: descriptor,
    type: normaliseType(descriptor, rawType),
    name,
    mode,
    repoDir: ctx.repoDir,
    home: ctx.home,
  } as const;
  try {
    return runOverlayLoop(request, loopDeps(ctx, place)).status;
  } finally {
    flushFallbackNotice(place);
  }
}
