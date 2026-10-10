// mcp-claude.ts — the Claude Code MCP registration of manage-claude-component (spec 0255
// R8, R24, plan step 9).
//
// Twins `register_mcp_server`: `claude mcp list`, then `claude mcp add --scope user <name> --
// <command> <args...>`, with the same lines on the same stream and the same statuses. The
// only program spawned is `claude`, with an argument array and no shell. It is found with
// the repository's existing lookups (`findOnPath`, and `planWindowsLaunch` on Windows, which
// also refuses a `.cmd` whose arguments cmd.exe would read as syntax). `jq` is no longer
// needed, so its diagnostic is gone (R22(a)).
//
// Listed deviations: an entry name is matched literally against the `list` output (the
// shell used it as an extended regular expression); a declaration that is not JSON throws
// an `ExtError` where `jq` printed its own error.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { jqText } from "../extension/json-write.ts";
import type { Env, Io, JsonValue } from "../extension/types.ts";
import { findOnPath } from "../mempalace-python.ts";
import {
  defaultIsFile,
  planWindowsLaunch,
  resolveOnPath,
} from "../worktree-claim/launch-windows.ts";

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
}

/** Runs a program with an argument array; standard error is discarded, standard output captured. */
export type SpawnFn = (
  file: string,
  args: readonly string[],
  options: { readonly env: Env; readonly verbatim: boolean },
) => SpawnResult;

export interface ClaudeMcpCtx {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly spawn: SpawnFn;
  /** Windows lookup only: true when the path names an existing regular file. */
  readonly isFile?: (candidate: string) => boolean;
}

/** `status` is the function's return status; `abort` is the shell's `exit 1` (stop the script). */
export interface McpOutcome {
  readonly status: number;
  readonly abort: boolean;
}

export const defaultSpawn: SpawnFn = (file, args, options) => {
  const result = spawnSync(file, [...args], {
    env: options.env as NodeJS.ProcessEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
    windowsVerbatimArguments: options.verbatim,
  });
  return { status: result.status, stdout: typeof result.stdout === "string" ? result.stdout : "" };
};

/** `command -v claude`: the file to start, or `undefined` when `claude` is not on PATH. */
function locateClaude(ctx: ClaudeMcpCtx): string | undefined {
  if (ctx.platform !== "win32") return findOnPath("claude", ctx.env, undefined);
  return resolveOnPath("claude", {
    platform: ctx.platform,
    env: ctx.env,
    isFile: ctx.isFile ?? defaultIsFile,
  });
}

function runClaude(ctx: ClaudeMcpCtx, located: string, args: readonly string[]): SpawnResult {
  if (ctx.platform !== "win32") {
    return ctx.spawn(located, args, { env: ctx.env, verbatim: false });
  }
  const isFile = ctx.isFile ?? defaultIsFile;
  // "claude" holds no separator, so the toplevel that anchors a relative path is never used.
  const plan = planWindowsLaunch(["claude", ...args], {
    platform: ctx.platform,
    env: ctx.env,
    isFile,
    toplevel: "",
  });
  if (plan.kind !== "spawn") return { status: null, stdout: "" };
  return ctx.spawn(plan.file, plan.args, { env: ctx.env, verbatim: plan.verbatim });
}

/** `jq -r` over a list of values, as the shell's `read -r` loop split its lines. */
function argLines(value: JsonValue | undefined): string[] {
  const items = value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : [];
  return items.flatMap((item) => (typeof item === "string" ? item : jqText(item)).split("\n"));
}

/** Register one `*.json` MCP declaration with Claude Code, printing the shell's lines. */
export function registerClaudeMcp(jsonFile: string, ctx: ClaudeMcpCtx, io: Io): McpOutcome {
  const located = locateClaude(ctx);
  if (located === undefined) {
    io.out("Error: 'claude' CLI required to register MCP servers.");
    return { status: 1, abort: true };
  }
  const name = path.basename(jsonFile, ".json");
  const listed = runClaude(ctx, located, ["mcp", "list"]).stdout.split("\n");
  if (
    listed.some((line) => line.startsWith(`${name}:`) && /^\s/.test(line.slice(name.length + 1)))
  ) {
    io.out(`  ${name}: already registered, skipping`);
    return { status: 0, abort: false };
  }

  const declaration = parseJson(fs.readFileSync(jsonFile, "utf8"), jsonFile);
  const field = (key: string): JsonValue | undefined =>
    declaration instanceof Map ? declaration.get(key) : undefined;
  const declared = field("command");
  const command =
    declared === undefined || declared === null || declared === false ? "" : jqText(declared);
  if (command === "") {
    io.out(`  ${name}: missing 'command' field, skipping`);
    return { status: 1, abort: false };
  }

  const args = argLines(field("args"));
  const added = runClaude(ctx, located, [
    "mcp",
    "add",
    "--scope",
    "user",
    name,
    "--",
    command,
    ...args,
  ]);
  if (added.status === 0) {
    io.out(`  ${name}: registered (scope=user)`);
    return { status: 0, abort: false };
  }
  io.out(
    `  ${name}: FAILED — re-run manually: claude mcp add --scope user ${name} -- ${command} ${args.join(" ")}`,
  );
  return { status: 1, abort: false };
}
