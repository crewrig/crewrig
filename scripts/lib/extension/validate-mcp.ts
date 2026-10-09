// validate-mcp.ts — the shape, reserved-name and path-token validators of the generic
// `mcpServers` section (spec 0254 R9). Twins of `ext_validate_mcp_shape`,
// `ext_validate_mcp_names` and `ext_validate_mcp_tokens` (scripts/lib/extension-manifest.sh,
// the three functions after "Extension-scoped MCP server declaration").
// Pure: each returns the VALIDATION-ERROR lines the shell prints to stderr.

import { jqText } from "./json-write.ts";
import { stripTrailingLf } from "./hooks-vocab.ts";
import { jqKeys } from "./validate-percli.ts";
import type { JsonValue } from "./types.ts";

/** The five known path tokens, refused inside env/headers values. */
export const EXT_MCP_KNOWN_PATH_TOKENS: readonly string[] = [
  "${extensionRoot}",
  "${extensionPath}",
  "${CLAUDE_PLUGIN_ROOT}",
  "${COPILOT_PLUGIN_ROOT}",
  "${/}",
];

const STDIO_KEYS = ["transport", "command", "args", "env", "cwd", "timeout"];
const REMOTE_KEYS = ["transport", "url", "headers", "timeout"];

/** `jq -e '(.f // "") | length > 0'`: a jq error (true, an object-less type) counts as false. */
function lengthPositive(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return Math.abs(value) > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value instanceof Map ? value.size > 0 : false;
}

/** `.mcpServers` present and not null (the shell's `has(...) and != null`). */
function declared(manifest: Map<string, JsonValue>): JsonValue | undefined {
  const servers = manifest.get("mcpServers");
  return servers === undefined || servers === null ? undefined : servers;
}

export function validateMcpShape(manifestPath: string, manifest: Map<string, JsonValue>): string[] {
  const servers = declared(manifest);
  if (servers === undefined) return [];
  const head = `VALIDATION-ERROR: ${manifestPath} —`;
  if (!(servers instanceof Map)) {
    return [`${head} the generic 'mcpServers' section must be an object keyed by server name`];
  }

  const lines: string[] = [];
  for (const name of jqKeys(servers)) {
    if (name === "") continue;
    const entry = servers.get(name) as JsonValue;
    // `.transport // "stdio"`: null stays stdio; a non-object entry makes jq fail, read as "".
    let transport = "";
    if (entry === null) transport = "stdio";
    else if (entry instanceof Map) {
      const t = entry.get("transport");
      transport =
        t === undefined || t === null || t === false ? "stdio" : stripTrailingLf(jqText(t));
    }
    if (!["stdio", "http", "sse"].includes(transport)) {
      lines.push(
        `${head} mcpServers.${name} declares transport '${transport}', outside the admissible set {stdio, http, sse}`,
      );
      continue;
    }

    const stdio = transport === "stdio";
    const required = stdio ? "command" : "url";
    const get = (key: string): JsonValue | undefined =>
      entry instanceof Map ? entry.get(key) : undefined;
    if (!lengthPositive(get(required))) {
      lines.push(
        `${head} mcpServers.${name} (transport ${transport}) is missing a non-empty '${required}'`,
      );
    }
    const admissible = stdio ? STDIO_KEYS : REMOTE_KEYS;
    for (const key of jqKeys(entry instanceof Map ? entry : null)) {
      if (key === "" || admissible.includes(key)) continue;
      lines.push(
        `${head} mcpServers.${name} (transport ${transport}) declares inadmissible key '${key}' (admissible: ${admissible.join(", ")})`,
      );
    }
  }
  return lines;
}

export function validateMcpNames(
  manifestPath: string,
  manifest: Map<string, JsonValue>,
  reserved: unknown,
): string[] {
  const head = `VALIDATION-ERROR: ${manifestPath} —`;
  if (!Array.isArray(reserved) || reserved.length === 0) {
    return [
      `${head} the framework-reserved MCP name set is empty or malformed; refusing to validate mcpServers.* against it (fail-closed)`,
    ];
  }
  const servers = declared(manifest);
  if (servers === undefined) return [];
  const nameValue = manifest.get("name");
  const extName =
    nameValue === undefined || nameValue === null || nameValue === false
      ? "?"
      : stripTrailingLf(jqText(nameValue));

  const lines: string[] = [];
  for (const name of jqKeys(servers)) {
    if (name === "") continue;
    if (reserved.includes(name)) {
      lines.push(
        `${head} extension '${extName}' declares MCP server '${name}', a framework-reserved name; choose a name outside the reserved set`,
      );
    }
  }
  return lines;
}

/** Every `${...}` token of a leaf as `printf | grep -oE '\$\{[^}]*\}'` finds them, line by line. */
function tokensOf(value: JsonValue): string[] {
  const found: string[] = [];
  for (const line of jqText(value).split("\n")) {
    if (line === "") continue;
    found.push(...(line.match(/\$\{[^}]*\}/g) ?? []));
  }
  return found;
}

/** The leaves of `[(.command // empty)] + (.args // []) + [(.cwd // empty)]`; none when jq fails. */
function commandLeaves(entry: Map<string, JsonValue>): JsonValue[] {
  const present = (key: string): JsonValue[] => {
    const v = entry.get(key);
    return v === undefined || v === null || v === false ? [] : [v];
  };
  const args = entry.get("args");
  if (args !== undefined && args !== null && args !== false && !Array.isArray(args)) return [];
  return [...present("command"), ...(Array.isArray(args) ? args : []), ...present("cwd")];
}

/** The leaves of `[(.env // {}), (.headers // {})] | .[] | .[]?`. */
function envHeaderLeaves(entry: Map<string, JsonValue>): JsonValue[] {
  const leaves: JsonValue[] = [];
  for (const key of ["env", "headers"]) {
    const v = entry.get(key);
    if (v instanceof Map) leaves.push(...v.values());
    else if (Array.isArray(v)) leaves.push(...v);
  }
  return leaves;
}

export function validateMcpTokens(
  manifestPath: string,
  manifest: Map<string, JsonValue>,
): string[] {
  const servers = declared(manifest);
  if (!(servers instanceof Map)) return [];
  const head = `VALIDATION-ERROR: ${manifestPath} —`;
  const lines: string[] = [];
  for (const name of jqKeys(servers)) {
    const entry = servers.get(name);
    if (name === "" || !(entry instanceof Map)) continue;
    for (const leaf of commandLeaves(entry)) {
      for (const token of tokensOf(leaf)) {
        if (token === "${extensionRoot}") continue;
        lines.push(
          `${head} mcpServers.${name} declares '${token}' inside command/args/cwd; the only admissible path token there is \${extensionRoot}`,
        );
      }
    }
    for (const leaf of envHeaderLeaves(entry)) {
      for (const token of tokensOf(leaf)) {
        if (!EXT_MCP_KNOWN_PATH_TOKENS.includes(token)) continue;
        lines.push(
          `${head} mcpServers.${name} declares path token '${token}' inside an env/headers value; a path token has no path to resolve against there`,
        );
      }
    }
  }
  return lines;
}
