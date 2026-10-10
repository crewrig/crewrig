// org-mcp-fold.ts — the organisation MCP declaration of a setup (spec 0256 requirement 28): the
// shell's `read_org_mcp_manifest`, `org_mcp_to_native` + `apply_org_mcp_servers` and
// `org_mcp_to_claude_argv` of scripts/lib/common.sh. The translation itself is `orgMcpToNative` of
// scripts/lib/org-mcp.ts; this module reads the manifest, folds the translation over a CLI's
// `mcpServers` with the precedence framework-reserved > org > operator pre-existing, and names the
// `claude mcp add` argv of each server. Messages are the shell's, on standard output.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { writeJsonCompact } from "../extension/json-write.ts";
import { ExtError } from "../extension/types.ts";
import type { Io, JsonValue } from "../extension/types.ts";
import { MCP_RESERVED_NAMES, orgMcpToNative } from "../org-mcp.ts";
import { writeJsonConfigSecure } from "./json-secure.ts";
import type { JsonSecureCtx } from "./json-secure.ts";

export const ORG_MCP_MANIFEST = "mcp-servers.org.json";

type Servers = Map<string, JsonValue>;
type Out = { readonly io: Pick<Io, "out" | "err"> };

/** The manifest's path in the repository. */
export function orgMcpManifestPath(repoDir: string): string {
  return path.join(repoDir, ORG_MCP_MANIFEST);
}

/**
 * The manifest's `.mcpServers` object, or an empty one when the file is absent, empty, unparseable, or
 * `.mcpServers` is missing or not an object (degrade, never abort). Prints nothing; a sibling
 * `_example` or `_note` key is inert.
 */
export function readOrgMcpManifest(repoDir: string): Servers {
  let text: string;
  try {
    text = fs.readFileSync(orgMcpManifestPath(repoDir), "utf8");
    const doc = parseJson(text, ORG_MCP_MANIFEST);
    const servers = doc instanceof Map ? doc.get("mcpServers") : undefined;
    return servers instanceof Map ? servers : new Map();
  } catch {
    return new Map();
  }
}

/** The shell's `keys[]`: names in code-point order. */
function sortedKeys(map: ReadonlyMap<string, JsonValue>): string[] {
  const cmp = (a: string, b: string): number => {
    const x = Array.from(a);
    const y = Array.from(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
      if (d !== 0) return d;
    }
    return x.length - y.length;
  };
  return [...map.keys()].sort(cmp);
}

/** R10: an org declaration under a framework-reserved name is not applied (framework wins). */
export function reservedOrgWarning(name: string): string {
  return `  WARNING: '${name}' is a framework-managed MCP server — the org declaration for '${name}' was NOT applied (framework wins).`;
}

/** The native org object of `cli`; a manifest the translator refuses folds nothing, with a warning. */
function nativeOf(ctx: Out, cli: string, manifest: Servers): Servers {
  try {
    return orgMcpToNative(cli, manifest);
  } catch (error) {
    if (!(error instanceof ExtError)) throw error;
    ctx.io.err(`  WARNING: the org MCP manifest is ignored: ${error.message}`);
    return new Map();
  }
}

/**
 * `org_mcp_to_native` then `apply_org_mcp_servers` on an object: returns `current` (the config's
 * `.mcpServers` after the operator merge) with the org servers folded in. A reserved name is
 * refused with its warning; a name that collides with the operator's `preexisting` entry warns and
 * the org wins; org entries not yet present come after the existing ones, a replaced one keeps its
 * place. Returns `current` unchanged when nothing is declared. `backupRef` is named in the R11 warning.
 */
export function foldOrgMcpNative(
  ctx: Out,
  cli: string,
  manifest: Servers,
  current: ReadonlyMap<string, JsonValue>,
  preexisting: ReadonlyMap<string, JsonValue> = new Map(),
  backupRef = "",
): Servers {
  const native = nativeOf(ctx, cli, manifest);
  const result: Servers = new Map(current);
  if (native.size === 0) return result;
  for (const name of MCP_RESERVED_NAMES) if (native.has(name)) ctx.io.out(reservedOrgWarning(name));
  for (const name of sortedKeys(native)) {
    if (!preexisting.has(name) || MCP_RESERVED_NAMES.includes(name)) continue;
    ctx.io.out(
      `  WARNING: org-declared MCP server '${name}' overrides your pre-existing '${name}' entry (org declaration wins).`,
    );
    ctx.io.out(
      `           The prior entry is preserved in the timestamped backup: ${backupRef || "(none)"}`,
    );
  }
  for (const [name, entry] of native)
    if (!MCP_RESERVED_NAMES.includes(name)) result.set(name, entry);
  return result;
}

/**
 * `apply_org_mcp_servers` on a file: folds the org servers over `file`'s `.mcpServers` (created when
 * absent) through `writeJsonConfigSecure`, without a backup of its own (the caller made it: pass its
 * path as `backupRef`). Nothing declared means no write at all. Returns whether the file was rewritten.
 */
export function applyOrgMcpServers(
  ctx: JsonSecureCtx,
  cli: string,
  manifest: Servers,
  file: string,
  preexisting: ReadonlyMap<string, JsonValue>,
  backupRef: string,
): boolean {
  const native = nativeOf(ctx, cli, manifest);
  if (native.size === 0) return false;
  writeJsonConfigSecure({
    ctx,
    file,
    backup: false,
    patch: (doc) => {
      if (!(doc instanceof Map)) throw new ExtError(`${file} is not a JSON object`);
      const held = doc.get("mcpServers");
      if (held !== undefined && held !== null && held !== false && !(held instanceof Map)) {
        throw new ExtError(`${file}: mcpServers is not an object`);
      }
      const current = held instanceof Map ? held : new Map<string, JsonValue>();
      const next: Servers = new Map(doc);
      next.set("mcpServers", foldOrgMcpNative(ctx, cli, manifest, current, preexisting, backupRef));
      return next;
    },
  });
  return true;
}

/** `jq -r` of one array element: a string verbatim, null as `null`, anything else as its JSON text. */
function token(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  return value === undefined ? "null" : writeJsonCompact(value);
}

/** The text of `.key + "=" + .value`: null adds nothing, another non-string is a `jq` error. */
function joined(name: string, key: string, value: JsonValue, what: string): string {
  if (value === null) return key;
  if (typeof value !== "string")
    throw new ExtError(`mcpServers.${name}.${what}.${key} is not a string`);
  return `${key}${what === "env" ? "=" : ": "}${value}`;
}

function objectMember(name: string, entry: Servers, key: string): Servers {
  const value = entry.get(key);
  if (value === undefined || value === null || value === false) return new Map();
  if (!(value instanceof Map)) throw new ExtError(`mcpServers.${name}.${key} is not an object`);
  return value;
}

/**
 * `org_mcp_to_claude_argv`: the tokens that follow `claude mcp add` for the neutral `entry` of
 * server `name` (a null entry reads as an empty stdio server).
 *   stdio    --scope user [-e K=V]... <name> -- <command> <args...>
 *   http/sse --scope user --transport <t> <name> <url> [--header "K: V"]...
 */
export function orgMcpClaudeArgv(name: string, entry: JsonValue): string[] {
  const server: Servers = entry === null ? new Map() : entry instanceof Map ? entry : new Map();
  if (entry !== null && !(entry instanceof Map))
    throw new ExtError(`mcpServers.${name} is not an object`);
  const declared = server.get("transport");
  const transport =
    declared === undefined || declared === null || declared === false ? "stdio" : declared;
  if (transport === "stdio") {
    const argv = ["--scope", "user"];
    for (const [key, value] of objectMember(name, server, "env"))
      argv.push("-e", joined(name, key, value, "env"));
    argv.push(name, "--", token(server.get("command")));
    const args = server.get("args");
    if (args !== undefined && args !== null && args !== false) {
      if (!Array.isArray(args)) throw new ExtError(`mcpServers.${name}.args is not an array`);
      for (const arg of args) argv.push(token(arg));
    }
    return argv;
  }
  const argv = ["--scope", "user", "--transport", token(transport), name, token(server.get("url"))];
  for (const [key, value] of objectMember(name, server, "headers")) {
    argv.push("--header", joined(name, key, value, "headers"));
  }
  return argv;
}

export interface OrgMcpClaudeServer {
  readonly name: string;
  /** A framework-reserved name: not registered (`reservedOrgWarning`); `argv` is empty. */
  readonly reserved: boolean;
  /** The tokens after `claude mcp add`. */
  readonly argv: readonly string[];
}

/** One `claude mcp add` argv per manifest server, in the shell's `keys[]` order. */
export function orgMcpClaudeArgvs(manifest: Servers): OrgMcpClaudeServer[] {
  return sortedKeys(manifest).map((name) => {
    if (MCP_RESERVED_NAMES.includes(name)) return { name, reserved: true, argv: [] };
    return { name, reserved: false, argv: orgMcpClaudeArgv(name, manifest.get(name) ?? null) };
  });
}
