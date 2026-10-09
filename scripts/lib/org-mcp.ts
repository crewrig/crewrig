// org-mcp.ts — the neutral MCP server translator (spec 0254 R3).
//
// Twins `org_mcp_to_native` (scripts/lib/common.sh:263) and `MCP_RESERVED_NAMES`
// (scripts/lib/common.sh:85), the two pieces of common.sh that the extension builders
// need and that the setup scripts (rows F1 and F2) and scripts/lib/gemini-settings.sh
// import later. Pure functions: no input, no output, no environment.
//
// Maps the neutral `mcpServers` object (a transport of `stdio`, `http` or `sse`, absent
// meaning `stdio`; `{command, args?, env?, cwd?, timeout?}` or `{url, headers?, timeout?}`)
// to the native object of one CLI. A member is added only when its neutral value is
// truthy in `jq`'s sense (present and neither null nor false; an empty array or string
// counts). The members come out in the order of the shell's `jq` program, which is part
// of the byte contract of the files built from it.

import { ExtError } from "./extension/types.ts";
import type { JsonValue } from "./extension/types.ts";

/** Server names the framework owns; an extension may not deliver a server under one. */
export const MCP_RESERVED_NAMES: readonly string[] = ["mempalace", "sequentialthinking"];

function truthy(value: JsonValue | undefined): value is JsonValue {
  return value !== undefined && value !== null && value !== false;
}

/** Append `key` to `target` when the entry holds a truthy value for it. */
function addIfTruthy(
  target: Map<string, JsonValue>,
  entry: Map<string, JsonValue>,
  key: string,
): void {
  const value = entry.get(key);
  if (truthy(value)) target.set(key, value);
}

function stdioServer(cli: string, entry: Map<string, JsonValue>): Map<string, JsonValue> {
  const native = new Map<string, JsonValue>([["command", entry.get("command") ?? null]]);
  for (const key of ["args", "env", "cwd", "timeout"]) addIfTruthy(native, entry, key);
  if (cli === "copilot") native.set("type", "stdio");
  return native;
}

function remoteServer(
  cli: string,
  transport: JsonValue,
  entry: Map<string, JsonValue>,
): Map<string, JsonValue> {
  const url = entry.get("url") ?? null;
  const native = new Map<string, JsonValue>();
  if (cli === "antigravity") native.set("serverUrl", url);
  else if (cli === "gemini") native.set(transport === "http" ? "httpUrl" : "url", url);
  else {
    native.set("type", transport);
    native.set("url", url);
  }
  addIfTruthy(native, entry, "headers");
  addIfTruthy(native, entry, "timeout");
  return native;
}

/**
 * Translate the neutral `servers` object into the native object of `cli` (`gemini`,
 * `copilot`, `antigravity`, `claude`; any other name takes the `claude` shapes, as the
 * shell's default arm does). A value that is not an object reads as the empty object.
 */
export function orgMcpToNative(cli: string, servers: JsonValue): Map<string, JsonValue> {
  const native = new Map<string, JsonValue>();
  if (!(servers instanceof Map)) return native;
  for (const [name, entry] of servers) {
    // A null entry reads as an empty stdio server, as in the shell. Any other value that is not
    // an object makes the shell's whole translation fail silently (an empty output, status 0);
    // validation rejects such a manifest first, so the twin refuses it loudly (listed deviation).
    if (entry === null) {
      native.set(name, stdioServer(cli, new Map()));
      continue;
    }
    if (!(entry instanceof Map)) throw new ExtError(`mcpServers.${name} is not an object`);
    const declared = entry.get("transport");
    const transport = truthy(declared) ? declared : "stdio";
    native.set(
      name,
      transport === "stdio" ? stdioServer(cli, entry) : remoteServer(cli, transport, entry),
    );
  }
  return native;
}
