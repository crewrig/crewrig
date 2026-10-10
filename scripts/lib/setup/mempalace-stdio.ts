// mempalace-stdio.ts — the stdio MCP entries of the MemPalace http wrapper and of Sequential
// Thinking, per CLI (spec 0256 requirements 25 and 28, delta-01 deviation (m)). Pure builders: the
// argv is `wrapStdioCommand` (trust-wrapper.ts) around the command the shell wraps, and the JSON
// objects carry the keys, in the order, that each shell registration produces:
//   - claude: `claude mcp add --scope user <name> -- <argv>` stores
//     {type, command, args, env}; the setup registers through the CLI, this is the stored shape;
//   - gemini: the template's {command, args} with `command = bash` (gemini_framework_mcp);
//   - copilot: the template's {type, command, args} patched by jq;
//   - antigravity: {command, args} built by jq on `MCP_BASE`.

import path from "node:path";

import type { Cli } from "./context.ts";
import { wrapStdioCommand } from "./trust-wrapper.ts";
import type { WrapperEnv } from "./trust-wrapper.ts";

export const SEQUENTIAL_THINKING_PACKAGE = "@modelcontextprotocol/server-sequential-thinking";

/** `npx` on POSIX, `npx.cmd` on win32 (a `.cmd` shim is what `node` can spawn there). */
export function npxName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

/** The http wrapper script, with the platform's separators (the shell writes `$REPO_DIR/scripts/lib/...`). */
export function mempalaceWrapperScript(env: WrapperEnv): string {
  return env.platform === "win32"
    ? path.win32.join(env.repoDir, "scripts", "lib", "mempalace-http-wrapper.py")
    : path.posix.join(env.repoDir, "scripts", "lib", "mempalace-http-wrapper.py");
}

/** The whole MemPalace stdio command: `<prefix> <python> <wrapper script>`. */
export function mempalaceStdioCommand(env: WrapperEnv, python: string): readonly string[] {
  return wrapStdioCommand(env, [python, mempalaceWrapperScript(env)]);
}

/** The whole Sequential Thinking stdio command: `<prefix> <npx> -y <package>`. */
export function sequentialThinkingCommand(env: WrapperEnv, npx: string): readonly string[] {
  return wrapStdioCommand(env, [npx, "-y", SEQUENTIAL_THINKING_PACKAGE]);
}

export interface StdioEntry {
  readonly type?: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, never>>;
}

/** Split an argv into the JSON object a CLI's configuration holds, keys in the CLI's order. */
function entryOf(cli: Cli, argv: readonly string[]): StdioEntry {
  const [command = "", ...args] = argv;
  switch (cli) {
    case "claude":
      return { type: "stdio", command, args, env: {} };
    case "copilot":
      return { type: "stdio", command, args };
    case "gemini":
    case "antigravity":
      return { command, args };
  }
}

export function mempalaceStdioEntry(cli: Cli, env: WrapperEnv, python: string): StdioEntry {
  return entryOf(cli, mempalaceStdioCommand(env, python));
}

export function sequentialThinkingEntry(cli: Cli, env: WrapperEnv): StdioEntry {
  return entryOf(cli, sequentialThinkingCommand(env, npxName(env.platform)));
}
