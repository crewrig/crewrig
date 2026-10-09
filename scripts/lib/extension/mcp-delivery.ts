// mcp-delivery.ts — the MCP delivery gate and the root-token rewrite (spec 0254 R11).
// Twins of `ext_mcp_delivery` and `ext_mcp_native` (scripts/lib/extension-manifest.sh:383-428).
// A null Antigravity root token means "leave `${extensionRoot}` unresolved" for MCP, the opposite
// of the hook translator, so this module deliberately does not use `resolveCommand`.

import { orgMcpToNative } from "../org-mcp.ts";
import type { JsonValue, Target, TargetTable } from "./types.ts";

const NEUTRAL_ROOT_TOKEN = "${extensionRoot}";

/** Does the target receive an MCP declaration at all? */
export function mcpDelivery(target: Target, table: TargetTable): boolean {
  return table[target].mcpDelivery;
}

/** `walk(if type == "string" then gsub(token; $root) else . end)`: values only, keys untouched. */
function rewriteRoot(value: JsonValue, root: string): JsonValue {
  if (typeof value === "string") return value.split(NEUTRAL_ROOT_TOKEN).join(root);
  if (Array.isArray(value)) return value.map((v) => rewriteRoot(v, root));
  if (value instanceof Map) {
    const out = new Map<string, JsonValue>();
    for (const [k, v] of value) out.set(k, rewriteRoot(v, root));
    return out;
  }
  return value;
}

export function mcpNative(
  target: Target,
  manifest: Map<string, JsonValue>,
  table: TargetTable,
): Map<string, JsonValue> {
  const declared = manifest.get("mcpServers");
  const neutral =
    declared === undefined || declared === null || declared === false ? new Map() : declared;
  const native = orgMcpToNative(target, neutral);
  const root = table[target].rootToken;
  if (root === "") return native;
  return rewriteRoot(native, root) as Map<string, JsonValue>;
}
