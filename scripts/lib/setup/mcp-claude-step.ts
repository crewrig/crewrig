// mcp-claude-step.ts — the `mcp` step of the Claude setup (spec 0256 requirements 26-28; shell lines
// 164-307 of scripts/setup-claude-interactive.sh). MCP servers are registered through the
// `claude mcp` CLI (the `Spawner`), never by editing `~/.claude.json`, except for the guarded
// restore of an operator entry an org declaration replaced.
//
// Order: header, backup of `~/.claude.json`, Sequential Thinking opt-in, MemPalace (detect, Chroma,
// ensure FIRST, stdio only on rc 1), org-declared servers, legacy `mcp.json`, settings template.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import type { JsonValue } from "../extension/types.ts";
import { ExtError } from "../extension/types.ts";
import type { StepEnv } from "./descriptor.ts";
import { writeJsonConfigSecure } from "./json-secure.ts";
import {
  backupClaudeJson,
  installSettingsTemplate,
  isRegistered,
  registerSequentialThinking,
  registerUser,
  removeLegacyMcpJson,
  removeUser,
} from "./mcp-claude-flow.ts";
import { runMempalaceStep } from "./mempalace-callsite.ts";
import { mempalaceStdioCommand, sequentialThinkingCommand } from "./mempalace-stdio.ts";
import { orgMcpClaudeArgvs, readOrgMcpManifest, reservedOrgWarning } from "./org-mcp-fold.ts";
import {
  chromaStep,
  detectMempalace,
  hasOrgManifest,
  makeEnsure,
  prepareTrustWrapper,
} from "./steps-mcp-common.ts";

/** The operator's entry for `name` in `~/.claude.json`, or `undefined` (the shell's `// empty`). */
function savedEntry(file: string, name: string): JsonValue | undefined {
  try {
    const doc = parseJson(fs.readFileSync(file, "utf8"), file);
    const servers = doc instanceof Map ? doc.get("mcpServers") : undefined;
    return servers instanceof Map ? servers.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/** `.mcpServers[name] = saved` written back; false on any failure (the shell's `could not auto-restore`). */
function restoreEntry(env: StepEnv, file: string, name: string, saved: JsonValue): boolean {
  const quiet = { io: { out: () => undefined, err: () => undefined }, platform: env.ctx.platform };
  try {
    writeJsonConfigSecure({
      ctx: quiet,
      file,
      backup: false,
      patch: (doc) => {
        if (!(doc instanceof Map)) throw new ExtError(`${file} is not a JSON object`);
        const held = doc.get("mcpServers");
        const servers = new Map(held instanceof Map ? held : []);
        servers.set(name, saved);
        return new Map(doc).set("mcpServers", servers);
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** `register_org_mcp_claude`: one `claude mcp add` per org server, the framework-reserved names refused. */
export function registerOrgMcpClaude(env: StepEnv): void {
  const { ctx, spawn } = env;
  const { io } = ctx;
  const config = path.join(ctx.home, ".claude.json");
  let servers: ReturnType<typeof orgMcpClaudeArgvs>;
  try {
    servers = orgMcpClaudeArgvs(readOrgMcpManifest(ctx.repoDir));
  } catch (error) {
    if (!(error instanceof ExtError)) throw error;
    io.err(`  WARNING: the org MCP manifest is ignored: ${error.message}`);
    return;
  }
  for (const { name, reserved, argv } of servers) {
    if (reserved) {
      io.out(reservedOrgWarning(name));
      continue;
    }
    const add = (): boolean => spawn(["claude", "mcp", "add", ...argv]).status === 0;
    if (!isRegistered(spawn, name)) {
      io.out(
        add()
          ? `  ${name}: org declaration registered`
          : `  ${name}: FAILED to register org declaration — re-run manually: claude mcp add ${argv.join(" ")}`,
      );
      continue;
    }
    io.out(
      `  WARNING: org-declared MCP server '${name}' overrides your pre-existing '${name}' entry (org declaration wins).`,
    );
    const saved = savedEntry(config, name);
    removeUser(spawn, name);
    if (add()) {
      io.out(`  ${name}: org declaration registered (replaced prior entry)`);
      continue;
    }
    io.out(`  ${name}: FAILED to register org declaration — restoring your prior entry.`);
    if (saved === undefined) continue;
    io.out(
      restoreEntry(env, config, name, saved)
        ? `  ${name}: prior entry restored from ~/.claude.json.`
        : `  ${name}: could not auto-restore — recover from the ~/.claude.json backup.`,
    );
  }
}

export async function run(env: StepEnv): Promise<void> {
  const { ctx, state, session, spawn } = env;
  const { io } = ctx;
  state.mempalaceInstalled = false;
  state.settingsTarget = path.join(ctx.home, ".claude", "settings.json");
  io.out("Configuring MCP servers via 'claude mcp add --scope user'...");
  prepareTrustWrapper(env);
  backupClaudeJson(ctx);
  await registerSequentialThinking({ ctx, session, spawn, command: sequentialThinkingCommand });

  io.out("MemPalace MCP server (persistent agent memory):");
  const python = await detectMempalace(env, { detected: "Detected interpreter" });
  if (python !== undefined) {
    await chromaStep(env);
    const wrapperEnv = { platform: ctx.platform, home: ctx.home, repoDir: ctx.repoDir };
    const result = await runMempalaceStep({
      ctx,
      cli: "claude",
      ensure: makeEnsure(env),
      registerStdio: () =>
        registerUser(spawn, io, "mempalace", mempalaceStdioCommand(wrapperEnv, python)) === 0,
      removeUserScope: () => void removeUser(spawn, "mempalace"),
      isRegistered: () => isRegistered(spawn, "mempalace"),
    });
    state.mempalaceInstalled = result.installed;
  }

  if (hasOrgManifest(env)) {
    io.out("Registering org-declared MCP servers from mcp-servers.org.json (spec 0091)...");
    registerOrgMcpClaude(env);
    io.out("");
  }
  await removeLegacyMcpJson(ctx, session);
  await installSettingsTemplate(ctx, session);
}
