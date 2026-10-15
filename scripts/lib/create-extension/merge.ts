// merge.ts — merge each selected component's fragment into `extension.json` (spec 0258 R23).
// Twin of `jq -s '.[0] * .[1]'` (create-extension.sh :99-186): objects merge recursively, any
// other value (arrays included) is replaced by the fragment's, the base's key order is kept and
// new keys are appended in the fragment's order; the result is written with two-space
// indentation and one final line feed. The reader and writer are those of the extension builders
// (scripts/lib/extension/json-ordered.ts and json-write.ts), which keep key order.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { writeJsonText } from "../extension/json-write.ts";
import type { Io, JsonValue } from "../extension/types.ts";

/** The fixed merge order, with the label each `Merged:` line prints. */
export const MERGE_ORDER: ReadonlyArray<
  readonly [component: string, fragment: string, label: string]
> = [
  ["command", "command.json.fragment", "command"],
  ["skill", "skill.json.fragment", "skill"],
  ["agent", "agent.json.fragment", "agent"],
  ["mcp-server", "mcp-server.json.fragment", "MCP server"],
  ["theme", "theme.json.fragment", "theme"],
  ["hook", "hooks.json.fragment", "hook"],
];

/** `a * b` of `jq`: recursive on two objects, otherwise `b`. */
export function jqMultiply(a: JsonValue, b: JsonValue): JsonValue {
  if (!(a instanceof Map) || !(b instanceof Map)) return b;
  const out = new Map<string, JsonValue>(a);
  for (const [key, value] of b) {
    const current = out.get(key);
    out.set(key, current === undefined ? value : jqMultiply(current, value));
  }
  return out;
}

/**
 * `selection` is the text the shell grepped (`echo "$COMPONENTS" | grep -q <component>`): a
 * component is merged when its name occurs in it AND its fragment file exists.
 */
export function mergeFragments(target: string, selection: readonly string[], io: Io): void {
  const selectionText = selection.join("\n");
  const manifest = path.join(target, "extension.json");
  for (const [component, fragmentName, label] of MERGE_ORDER) {
    if (!selectionText.includes(component)) continue;
    const fragment = path.join(target, fragmentName);
    if (!fs.existsSync(fragment) || !fs.statSync(fragment).isFile()) continue;
    const base = parseJson(fs.readFileSync(manifest, "utf8"), manifest);
    const extra = parseJson(fs.readFileSync(fragment, "utf8"), fragment);
    fs.writeFileSync(manifest, writeJsonText(jqMultiply(base, extra)));
    fs.rmSync(fragment, { force: true });
    io.out(`  Merged: ${label} config into extension.json`);
  }
}
