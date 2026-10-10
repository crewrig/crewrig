// mcp-json-writers.ts — the MCP configuration files of the Copilot and Antigravity setups (spec
// 0256 requirement 27, delta-01): `~/.copilot/mcp-config.json` and `~/.gemini/config/mcp_config.json`.
// Both setups overwrite the file from the framework's own content, so the operator's servers are
// captured BEFORE the overwrite (`backupAndCapture`) and folded back afterwards, as
// `merge_preexisting_mcp_servers` of scripts/lib/common.sh does (spec 0089): every non-reserved
// pre-existing server wins, verbatim, over a same-named framework entry; a reserved name
// (`mempalace`, `sequentialthinking`) keeps the framework's entry, with a warning that names the
// backup. The organisation MCP fold and the MemPalace HTTP registration stay with the caller; the
// written value is returned so the caller need not read the file back.
// Objects are `Map`s (extension/json-ordered.ts) so the key order is the one `jq` writes; the file
// itself goes through the injected `WriteJson` (backup-free, atomic, 0600 off win32: json-secure.ts).

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import type { JsonValue } from "../extension/types.ts";
import { MCP_RESERVED_NAMES } from "../org-mcp.ts";
import { backupFile } from "./backup.ts";
import type { BackupOptions } from "./backup.ts";
import type { InstallCtx } from "./context.ts";

/** Writes `value` as `jq .` does, atomically, owner-only where the platform has modes. */
export type WriteJson = (file: string, value: JsonValue) => void;

/** The stdio entries the caller built (mempalace-stdio.ts); `undefined` leaves the server out. */
export interface McpEntries {
  readonly mempalace: object | undefined;
  readonly sequentialThinking: object | undefined;
}

/** What was in the target before the overwrite, and the backup that holds it byte for byte. */
export interface McpCapture {
  readonly servers: JsonValue;
  /** The backup path (`MCP_BACKUP`); "" when the file did not exist. */
  readonly backup: string;
}

export interface McpWriteResult {
  /** The file content as written, operator servers merged in. */
  readonly config: Map<string, JsonValue>;
  readonly mempalaceInstalled: boolean;
}

interface WriterArgs {
  readonly ctx: Pick<InstallCtx, "io" | "repoDir">;
  readonly entries: McpEntries;
  readonly writeJson: WriteJson;
  readonly target: string;
  readonly captured: McpCapture;
}

export const REPO_PLACEHOLDER = "__CREWRIG_REPO_DIR__";

/** A plain value (an entry builder's object) as the order-preserving model. */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const map = new Map<string, JsonValue>();
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) map.set(key, toJsonValue(item));
    }
    return map;
  }
  throw new TypeError(`cannot write ${typeof value} as JSON`);
}

function replacePlaceholder(value: JsonValue, repoDir: string): JsonValue {
  if (typeof value === "string") return value.split(REPO_PLACEHOLDER).join(repoDir);
  if (Array.isArray(value)) return value.map((item) => replacePlaceholder(item, repoDir));
  if (value instanceof Map) {
    return new Map([...value].map(([k, v]) => [k, replacePlaceholder(v, repoDir)] as const));
  }
  return value;
}

/** `jq -c '.mcpServers // {}' file 2>/dev/null || echo '{}'`: absent, unreadable or invalid gives `{}`. */
export function readMcpServers(file: string): JsonValue {
  try {
    const doc = parseJson(fs.readFileSync(file, "utf8"), file);
    if (!(doc instanceof Map)) return new Map();
    const servers = doc.get("mcpServers");
    return servers === undefined || servers === null || servers === false ? new Map() : servers;
  } catch {
    return new Map();
  }
}

/** `backup_file` then the capture, in the shell's order (the capture reads the file the backup copied). */
export function backupAndCapture(
  ctx: Pick<InstallCtx, "io">,
  target: string,
  options: BackupOptions = {},
): McpCapture {
  const backup = backupFile(ctx, target, options);
  return { servers: readMcpServers(target), backup };
}

/**
 * `merge_preexisting_mcp_servers`: warns for each reserved name that pre-existed, then returns
 * `config` with `.mcpServers = (.mcpServers // {}) + (pre-existing minus the reserved names)`.
 */
export function mergePreexistingMcpServers(
  ctx: Pick<InstallCtx, "io">,
  captured: McpCapture,
  config: Map<string, JsonValue>,
): Map<string, JsonValue> {
  const current = config.get("mcpServers");
  const servers = current instanceof Map ? new Map(current) : new Map<string, JsonValue>();
  let pre: Map<string, JsonValue>;
  if (captured.servers instanceof Map) {
    pre = captured.servers;
  } else {
    ctx.io.out(
      "  WARNING: pre-existing MCP config could not be parsed — pre-existing" +
        ` declarations are NOT preserved in place; recover them from: ${captured.backup || "(none)"}`,
    );
    pre = new Map();
  }
  for (const name of MCP_RESERVED_NAMES) {
    if (!pre.has(name)) continue;
    ctx.io.out(
      servers.has(name)
        ? `  WARNING: '${name}' is a framework-managed MCP server — your prior '${name}' entry was replaced (framework wins).`
        : `  WARNING: '${name}' is a framework-managed MCP server — your prior '${name}' entry was removed (you declined it).`,
    );
    ctx.io.out(
      `           The prior entry is preserved in the timestamped backup: ${captured.backup || "(none)"}`,
    );
  }
  for (const [name, server] of pre) {
    if (!MCP_RESERVED_NAMES.includes(name)) servers.set(name, server);
  }
  const merged = new Map(config);
  merged.set("mcpServers", servers);
  return merged;
}

/** Path of the Copilot template, `config/copilot/mcp-config.json.template`. */
export function copilotTemplatePath(repoDir: string): string {
  return path.join(repoDir, "config", "copilot", "mcp-config.json.template");
}

/**
 * The Copilot setup's write (`setup-copilot-interactive.sh`): the template with the repository
 * placeholder replaced; the mempalace entry replaced by `entries.mempalace`, or removed when there
 * is none; the Sequential Thinking entry replaced by its wrapped form when the template has one;
 * then the operator's servers merged back. Prints the `Installed:` line the shell prints.
 */
export function writeCopilotMcpConfig(args: WriterArgs): McpWriteResult {
  const { ctx, entries, writeJson, target, captured } = args;
  const template = copilotTemplatePath(ctx.repoDir);
  const parsed = parseJson(fs.readFileSync(template, "utf8"), template);
  const doc = replacePlaceholder(parsed, ctx.repoDir);
  if (!(doc instanceof Map)) throw new TypeError(`${template} is not a JSON object`);
  const config = new Map(doc);
  const found = config.get("mcpServers");
  const servers = found instanceof Map ? new Map(found) : new Map<string, JsonValue>();
  config.set("mcpServers", servers);

  const mempalaceInstalled = entries.mempalace !== undefined;
  if (entries.mempalace !== undefined) {
    servers.set("mempalace", toJsonValue(entries.mempalace));
    ctx.io.out(
      "  Installed: mcp-config.json (mempalace patched with detected Python + wrapper path)",
    );
  } else {
    servers.delete("mempalace");
    ctx.io.out("  Installed: mcp-config.json (mempalace omitted from mcpServers)");
  }
  if (servers.has("sequentialthinking") && entries.sequentialThinking !== undefined) {
    servers.set("sequentialthinking", toJsonValue(entries.sequentialThinking));
  }

  const merged = mergePreexistingMcpServers(ctx, captured, config);
  writeJson(target, merged);
  return { config: merged, mempalaceInstalled };
}

/**
 * The Antigravity setup's write (`setup-antigravity-interactive.sh`): `{"mcpServers":{}}` with the
 * mempalace entry when MemPalace is installed and the Sequential Thinking entry when the operator
 * opted in, then the operator's servers merged back. Prints the two `... MCP server configured.`
 * lines the shell prints.
 */
export function writeAntigravityMcpConfig(args: WriterArgs): McpWriteResult {
  const { ctx, entries, writeJson, target, captured } = args;
  const servers = new Map<string, JsonValue>();
  if (entries.mempalace !== undefined) {
    servers.set("mempalace", toJsonValue(entries.mempalace));
    ctx.io.out("  mempalace MCP server configured.");
  }
  if (entries.sequentialThinking !== undefined) {
    servers.set("sequentialthinking", toJsonValue(entries.sequentialThinking));
    ctx.io.out("  sequentialthinking MCP server configured.");
  }
  const base = new Map<string, JsonValue>([["mcpServers", servers]]);
  const merged = mergePreexistingMcpServers(ctx, captured, base);
  writeJson(target, merged);
  return { config: merged, mempalaceInstalled: entries.mempalace !== undefined };
}
