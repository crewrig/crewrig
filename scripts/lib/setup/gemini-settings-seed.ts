// gemini-settings-seed.ts — the template side of the Gemini settings merge (spec 0256 requirements
// 27 and 31): the seed document, the reserved MCP entries of one run (`gemini_framework_mcp` of
// scripts/lib/gemini-settings.sh) and the few object helpers `gemini-settings-merge.ts` shares.
// Pure functions: no input, no output, no environment.

import type { JsonValue } from "../extension/types.ts";
import { MCP_RESERVED_NAMES } from "../org-mcp.ts";

export type Obj = Map<string, JsonValue>;

/** Turns the words of a stdio command into the words the entry registers (the trust wrapper). */
export type WrapStdio = (words: readonly string[]) => readonly string[];

export const isObj = (value: unknown): value is Obj => value instanceof Map;

export function isStrList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** A deep copy, so a merge never edits the document it was handed. */
export function clone(value: JsonValue): JsonValue {
  if (isObj(value)) return new Map([...value].map(([key, item]) => [key, clone(item)]));
  return Array.isArray(value) ? value.map(clone) : value;
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** A plain `JSON.parse` result (or an ordered `Map` document) as an ordered `Map` document. */
export function toJson(value: unknown): JsonValue | undefined {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return value as JsonValue;
  }
  if (Array.isArray(value)) {
    const items = value.map(toJson);
    return items.includes(undefined) ? undefined : (items as JsonValue[]);
  }
  let entries: [string, unknown][];
  if (value instanceof Map) entries = [...(value as Map<string, unknown>)];
  else if (isPlain(value)) entries = Object.entries(value);
  else return undefined;
  const out: Obj = new Map();
  for (const [key, item] of entries) {
    const converted = toJson(item);
    if (converted === undefined) return undefined;
    out.set(key, converted);
  }
  return out;
}

/** The default stdio wrapper of the shell: `bash <repo>/scripts/lib/tls-exec.sh <words...>`. */
export function shellWrap(repoDir: string): WrapStdio {
  return (words) => ["bash", `${repoDir}/scripts/lib/tls-exec.sh`, ...words];
}

/** The template minus what the merge owns: `context.fileName` and the reserved MCP names. */
export function seedsOf(template: Obj): Obj | undefined {
  const seeds = clone(template) as Obj;
  const context = seeds.get("context");
  if (isObj(context)) context.delete("fileName");
  else if (context !== undefined && context !== null) return undefined;
  const servers = seeds.get("mcpServers");
  if (isObj(servers)) for (const name of MCP_RESERVED_NAMES) servers.delete(name);
  else if (servers === undefined || servers === null) seeds.set("mcpServers", null);
  else return undefined;
  return seeds;
}

/** `gs_union`: every entry of `a` in order, then each entry of `b` not seen yet. */
export function union(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of [...a, ...b]) if (!out.includes(item)) out.push(item);
  return out;
}

/**
 * `gemini_framework_mcp`: the template's `.mcpServers` with the reserved entries of this run.
 * With a MemPalace interpreter `mempalace` runs the wrapped `<python> <args...>` (the repository
 * placeholder replaced); without one it is absent. `sequentialthinking` is wrapped. `undefined`
 * when the template cannot yield them (the shell's jq program fails).
 */
export function frameworkMcp(
  template: Obj,
  repoDir: string,
  python: string,
  wrap: WrapStdio,
): Obj | undefined {
  const declared = template.get("mcpServers") ?? new Map();
  if (!isObj(declared)) return undefined;
  const servers = clone(declared) as Obj;
  if (python === "") servers.delete("mempalace");
  else {
    const entry = servers.get("mempalace");
    const args = isObj(entry) ? entry.get("args") : undefined;
    if (!isObj(entry) || !isStrList(args)) return undefined;
    const words = wrap([python, ...args.map((a) => a.split("__CREWRIG_REPO_DIR__").join(repoDir))]);
    entry.set("command", words[0] ?? "");
    entry.set("args", words.slice(1));
  }
  const thinking = servers.get("sequentialthinking");
  if (thinking !== undefined && thinking !== null && thinking !== false) {
    const args = isObj(thinking) ? (thinking.get("args") ?? []) : undefined;
    const command = isObj(thinking) ? thinking.get("command") : undefined;
    if (!isObj(thinking) || !isStrList(args) || typeof command !== "string") return undefined;
    const words = wrap([command, ...args]);
    thinking.set("args", words.slice(1));
    thinking.set("command", words[0] ?? "");
  }
  return servers;
}
