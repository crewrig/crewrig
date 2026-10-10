// mcp-claude-flow.ts — the Claude setup's MCP section (spec 0256 requirements 27 and 28, delta-01
// deviation (m); plan v2 step B2b.2). Twins the block of scripts/setup-claude-interactive.sh that
// goes from `mcp_is_registered` to the settings question: `claude mcp list` / `add --scope user` /
// `remove` through the `Spawner` (which finds `claude` on PATH, and `claude.cmd` through
// `planWindowsLaunch` on win32), the Sequential Thinking opt-in, the legacy `~/.claude/mcp.json`
// removal and the default `settings.json`.
//
// manage/mcp-claude.ts is NOT reused: its spawn seam (`SpawnFn`, status `number | null`) is not the
// `Spawner` of the setup graph and it prints nothing for a failed `list`; the argv and the skip rule
// are the same, the code is not shared.
//
// Under the shell's `set -e` a failed `mcp_register_user` ends the run; `registerSequentialThinking`
// therefore throws `SetupExit(1)` after printing the FAILED line, where `registerUser` only returns
// the status (the MemPalace call sites test it, as the shell does).

import fs from "node:fs";
import path from "node:path";

import { readTextLf } from "../line-endings.ts";
import { writeFileAtomic } from "../tmp-file.ts";
import { backupFile } from "./backup.ts";
import type { Io, SetupCtx, Spawner } from "./context.ts";
import { SetupExit } from "./exit.ts";
import type { PromptSession } from "./prompt.ts";
import type { WrapperEnv } from "./trust-wrapper.ts";

/** What the section reads from the run context. */
export type ClaudeFlowCtx = Pick<SetupCtx, "io" | "home" | "repoDir" | "platform">;

export const SEQTHINK_HEADER = "Install Sequential Thinking MCP server?";
export const LEGACY_MCP_HEADER = "Remove legacy ~/.claude/mcp.json (backup will be kept)?";
export const SETTINGS_HEADER = "Install default settings.json?";

/** `sequentialThinkingCommand` of mempalace-stdio.ts (PR B2a), injected so this file does not import it. */
export type SequentialThinkingCommand = (env: WrapperEnv, npx: string) => readonly string[];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `claude mcp list 2>/dev/null | grep -qE "^<name>:[[:space:]]"`: the name is matched literally (the
 * shell used it as a regular expression) at the start of a line and must be followed by a colon and
 * a white-space character; `claude`'s own failure leaves an empty list, so nothing is registered.
 */
export function isRegistered(spawn: Spawner, name: string): boolean {
  const { stdout } = spawn(["claude", "mcp", "list"]);
  const rule = new RegExp(`^${escapeRegExp(name)}:[ \\t\\n\\v\\f\\r]`);
  return stdout.split("\n").some((line) => rule.test(line));
}

/** `claude mcp remove --scope user <name>`, output discarded; returns the exit status. */
export function removeUser(spawn: Spawner, name: string): number {
  return spawn(["claude", "mcp", "remove", "--scope", "user", name]).status;
}

/**
 * `mcp_register_user <name> <argv...>`: skip a registered name, else
 * `claude mcp add --scope user <name> -- <argv...>`. Prints the shell's line on stdout and returns
 * 0 (skipped or registered) or 1 (the add failed).
 */
export function registerUser(
  spawn: Spawner,
  io: Pick<Io, "out">,
  name: string,
  argv: readonly string[],
): number {
  if (isRegistered(spawn, name)) {
    io.out(`  ${name}: already registered, skipping`);
    return 0;
  }
  if (spawn(["claude", "mcp", "add", "--scope", "user", name, "--", ...argv]).status === 0) {
    io.out(`  ${name}: registered (scope=user)`);
    return 0;
  }
  io.out(
    `  ${name}: FAILED to register — re-run manually: claude mcp add --scope user ${name} -- ${argv.join(" ")}`,
  );
  return 1;
}

/** `backup_file "$HOME/.claude.json"`, once before the first MCP mutation; returns the backup path or "". */
export function backupClaudeJson(ctx: Pick<ClaudeFlowCtx, "io" | "home">): string {
  return backupFile(ctx, path.join(ctx.home, ".claude.json"));
}

export interface SeqThinkOptions {
  readonly ctx: ClaudeFlowCtx;
  readonly session: PromptSession;
  readonly spawn: Spawner;
  readonly command: SequentialThinkingCommand;
  /** The `npx` to wrap; defaults to `npx.cmd` on win32 and `npx` elsewhere (delta-01 deviation (m)). */
  readonly npx?: string;
}

/** The opt-in block, from its leading blank line to its closing one. Throws `SetupExit(1)` on a failed add. */
export async function registerSequentialThinking(options: SeqThinkOptions): Promise<boolean> {
  const { ctx, session, spawn } = options;
  ctx.io.out("");
  ctx.io.out("Sequential Thinking MCP server (working memory):");
  ctx.io.out("  Command: npx -y @modelcontextprotocol/server-sequential-thinking");
  const answer = await session.choose({
    id: "install-seqthink",
    header: SEQTHINK_HEADER,
    options: ["yes", "no"],
    cancel: "abort",
  });
  let registered = false;
  if (answer === "yes") {
    const npx = options.npx ?? (ctx.platform === "win32" ? "npx.cmd" : "npx");
    const env: WrapperEnv = { platform: ctx.platform, home: ctx.home, repoDir: ctx.repoDir };
    const rc = registerUser(spawn, ctx.io, "sequentialthinking", options.command(env, npx));
    if (rc !== 0) throw new SetupExit(rc);
    registered = true;
  } else {
    ctx.io.out("  Sequential Thinking install skipped.");
  }
  ctx.io.out("");
  return registered;
}

/** `~/.claude/mcp.json`, the legacy file Claude Code does not read. */
export const legacyMcpPath = (home: string): string => path.join(home, ".claude", "mcp.json");

const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** The legacy-file block (the question only when the file exists), then the blank line that follows it. */
export async function removeLegacyMcpJson(
  ctx: Pick<ClaudeFlowCtx, "io" | "home">,
  session: PromptSession,
): Promise<boolean> {
  const legacy = legacyMcpPath(ctx.home);
  let removed = false;
  if (isFile(legacy)) {
    ctx.io.out("");
    ctx.io.out(`Note: ${legacy} is a legacy file and is NOT read by Claude Code.`);
    ctx.io.out("      Active MCP config lives in ~/.claude.json.");
    const answer = await session.choose({
      id: "legacy-mcp-removal",
      header: LEGACY_MCP_HEADER,
      options: ["no", "yes"],
      cancel: "abort",
    });
    if (answer === "yes") {
      backupFile(ctx, legacy);
      fs.rmSync(legacy);
      ctx.io.out("  Legacy mcp.json removed.");
      removed = true;
    }
  }
  ctx.io.out("");
  return removed;
}

/** The settings block: ask when `~/.claude/settings.json` is absent, else say it exists; then a blank line. */
export async function installSettingsTemplate(
  ctx: Pick<ClaudeFlowCtx, "io" | "home" | "repoDir">,
  session: PromptSession,
): Promise<boolean> {
  const target = path.join(ctx.home, ".claude", "settings.json");
  let installed = false;
  if (!isFile(target)) {
    const answer = await session.choose({
      id: "install-settings",
      header: SETTINGS_HEADER,
      options: ["yes", "no"],
      cancel: "abort",
    });
    if (answer === "yes") {
      const template = path.join(ctx.repoDir, "config", "claude", "settings.json.template");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeFileAtomic(target, readTextLf(template));
      ctx.io.out("  Installed: settings.json");
      installed = true;
    }
  } else {
    ctx.io.out("  settings.json already exists, skipping.");
  }
  ctx.io.out("");
  return installed;
}
