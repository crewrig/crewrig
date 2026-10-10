// gemini-settings-merge.ts — the in-place merge of ~/.gemini/settings.json (spec 0256 requirements
// 27 and 31; twins scripts/lib/gemini-settings.sh, spec 0214, and the spec 0089 / 0091 folds of
// scripts/lib/common.sh that `gemini_settings_write` runs after it).
//
// `mergeGeminiSettings` is pure: the text of the existing file (or `undefined` when absent), the
// template, and what the run knows go in; the merged text and the warning lines the shell prints
// on stdout come out. The file is read the way Gemini CLI reads it (comments removed), which is
// the decision pinned for the commented-settings question: the merge TOLERATES comments, warns
// that the rewritten file drops them (the backup keeps them), and ALWAYS writes plain JSON, so
// the strict reader of the later HTTP registration (scripts/lib/service/assistant-config.ts)
// never meets a comment. The write itself (backup, atomic rename, 0600) is `gemini-settings.ts`.
//
// Known limit: numbers are written as JavaScript writes the value (listed deviation 28(d)), where
// jq 1.8 keeps a literal's spelling (`30.0`, `1E+3`); a number beyond a double fails the read.

import fs from "node:fs";

import { ExtError } from "../extension/types.ts";
import type { JsonValue } from "../extension/types.ts";
import { parseJson } from "../extension/json-ordered.ts";
import { writeJsonText } from "../extension/json-write.ts";
import { stripJsonComments } from "../jsonc.ts";
import { MCP_RESERVED_NAMES } from "../org-mcp.ts";
import {
  clone,
  frameworkMcp,
  isObj,
  isStrList,
  seedsOf,
  shellWrap,
  toJson,
  union,
} from "./gemini-settings-seed.ts";
import type { Obj, WrapStdio } from "./gemini-settings-seed.ts";

export interface MergeInput {
  /** The existing file's text, `undefined` when it is absent. */
  readonly current: string | undefined;
  /** The parsed `config/gemini/settings.json` (a `Map` document or a plain object). */
  readonly seed: unknown;
  readonly repoDir: string;
  /** The MemPalace interpreter; `""` or `undefined` when MemPalace is absent. */
  readonly python?: string | undefined;
  /** The org servers in Gemini's native shape (`orgMcpToNative`), or their JSON text. */
  readonly orgNative?: ReadonlyMap<string, JsonValue> | string | undefined;
  /** The settings file's path, named in the messages. */
  readonly target: string;
  /** The path of the template, named in a failure message. */
  readonly seedPath?: string | undefined;
  /** The timestamped backup the warnings name; `undefined` prints `(none)`. */
  readonly backupRef?: string | undefined;
  /** The stdio wrapper of the reserved entries; defaults to the shell's `bash tls-exec.sh`. */
  readonly wrap?: WrapStdio | undefined;
}

/** How the existing file read, before the merge (`gs_classify`, plus `absent`). */
export type FileState = "absent" | "object" | "empty" | "invalid";

export type MergeResult =
  | {
      readonly ok: true;
      /** The merged document, byte-identical to the shell's jq output. */
      readonly text: string;
      /** The stdout lines the shell prints, in order, without line feeds. */
      readonly warnings: readonly string[];
      readonly state: FileState;
      /** Whether comments were removed from the existing file. */
      readonly comments: boolean;
    }
  | {
      readonly ok: false;
      /** The `gemini_settings_write` return code: this pure part only ever fails with 1. */
      readonly code: 2 | 1;
      /** The stderr text of the shell, one or two lines, without a trailing line feed. */
      readonly message: string;
    };

const BOM = "﻿";

function tryParse(text: string): JsonValue | undefined {
  try {
    return parseJson(text, "settings.json");
  } catch (error) {
    if (error instanceof ExtError) return undefined;
    throw error;
  }
}

/** `gs_classify`: the document to merge into and how the file read. */
function classify(raw: string): { state: FileState; comments: boolean; doc: Obj } {
  if (raw.startsWith(BOM)) return { state: "invalid", comments: false, doc: new Map() };
  const fast = tryParse(raw);
  if (isObj(fast)) return { state: "object", comments: false, doc: fast };
  const stripped = stripJsonComments(raw);
  const comments = stripped !== raw;
  if (/^[ \t\n\r]*$/.test(stripped)) return { state: "empty", comments, doc: new Map() };
  const parsed = tryParse(stripped);
  if (isObj(parsed)) return { state: "object", comments, doc: parsed };
  return { state: "invalid", comments, doc: new Map() };
}

/** `jq`'s `*`: objects merge recursively, anything else takes the right side. */
function deepMerge(left: Obj, right: Obj): Obj {
  const out = new Map(left);
  for (const [key, value] of right) {
    const mine = out.get(key);
    out.set(key, isObj(mine) && isObj(value) ? deepMerge(mine, value) : value);
  }
  return out;
}

/** `gs_replaced_keys`: the framework-owned values the merge replaces. */
function replacedKeys(doc: Obj): string[] {
  const keys: string[] = [];
  const context = doc.get("context");
  if (doc.has("context") && !isObj(context)) keys.push("context");
  if (isObj(context) && context.has("fileName")) {
    const names = context.get("fileName");
    if (typeof names !== "string" && !isStrList(names)) keys.push("context.fileName");
  }
  if (doc.has("mcpServers") && !isObj(doc.get("mcpServers"))) keys.push("mcpServers");
  return keys;
}

const asObj = (value: JsonValue | undefined): Obj => (isObj(value) ? value : new Map());
const reserved = (name: string): boolean => MCP_RESERVED_NAMES.includes(name);

/** The org servers: a non-object (or unparseable text) reads as none, as `apply_org_mcp_servers`. */
function orgServers(org: MergeInput["orgNative"]): Obj {
  const value =
    typeof org === "string" ? tryParse(org) : org === undefined ? undefined : toJson(org);
  return isObj(value) ? value : new Map();
}

function failure(what: string, input: MergeInput): MergeResult {
  const lines = [`  ERROR: ${what}; ${input.target} was left unchanged.`];
  if (input.backupRef !== undefined) {
    lines.push(
      `         The prior file is preserved in the timestamped backup: ${input.backupRef}`,
    );
  }
  return { ok: false, code: 1, message: lines.join("\n") };
}

/** The merge of `gemini_settings_write`, folds included, without any file access. */
export function mergeGeminiSettings(input: MergeInput): MergeResult {
  const bak = input.backupRef ?? "(none)";
  const warnings: string[] = [];
  const template = toJson(input.seed);
  if (!isObj(template))
    return failure(
      `the framework MCP entries could not be built from ${input.seedPath ?? "the template"}`,
      input,
    );
  const wrap = input.wrap ?? shellWrap(input.repoDir);
  const framework = frameworkMcp(template, input.repoDir, input.python ?? "", wrap);
  if (framework === undefined)
    return failure(
      `the framework MCP entries could not be built from ${input.seedPath ?? "the template"}`,
      input,
    );

  const read =
    input.current === undefined
      ? { state: "absent" as const, comments: false, doc: new Map() as Obj }
      : classify(input.current);
  const doc = read.doc;
  if (read.state === "object" || read.state === "empty") {
    if (read.comments) {
      warnings.push(
        `  WARNING: ${input.target} holds comments; they are not kept in the rewritten file.`,
      );
      warnings.push(`           They are preserved in the timestamped backup: ${bak}`);
    }
  } else if (read.state === "invalid") {
    warnings.push(
      `  WARNING: ${input.target} is not a JSON object, even with its comments removed; it was replaced by a fresh configuration.`,
    );
    warnings.push(`           The prior content is preserved in the timestamped backup: ${bak}`);
  }
  for (const key of replacedKeys(doc)) {
    const what = key === "context.fileName" ? "a string or a list of strings" : "an object";
    warnings.push(
      `  WARNING: '${key}' in ${input.target} is not ${what}; it was replaced by the framework's value.`,
    );
    warnings.push(`           The prior value is preserved in the timestamped backup: ${bak}`);
  }

  // gs_merge
  const seeds = seedsOf(template);
  const templateNames = asObj(template.get("context")).get("fileName") ?? [];
  if (seeds === undefined || !isStrList(templateNames))
    return failure("the settings merge failed", input);
  const operatorContext = doc.get("context");
  const current = isObj(operatorContext) ? (operatorContext.get("fileName") ?? null) : null;
  const operatorNames = typeof current === "string" ? [current] : isStrList(current) ? current : [];
  const merged = deepMerge(seeds, clone(doc) as Obj);
  const context = asObj(merged.get("context"));
  merged.set("context", context);
  context.set("fileName", union(templateNames, operatorNames));
  const servers = new Map(asObj(merged.get("mcpServers")));
  for (const name of MCP_RESERVED_NAMES) servers.delete(name);
  for (const [name, entry] of framework) servers.set(name, entry);
  merged.set("mcpServers", servers);

  // Spec 0089 fold: a content no-op, its warnings stay.
  const operatorServers = asObj(doc.get("mcpServers"));
  for (const name of MCP_RESERVED_NAMES) {
    if (!operatorServers.has(name)) continue;
    const verdict = servers.has(name)
      ? `your prior '${name}' entry was replaced (framework wins).`
      : `your prior '${name}' entry was removed (you declined it).`;
    warnings.push(`  WARNING: '${name}' is a framework-managed MCP server — ${verdict}`);
    warnings.push(`           The prior entry is preserved in the timestamped backup: ${bak}`);
  }

  // Spec 0091 fold: framework-reserved > org > operator.
  const org = orgServers(input.orgNative);
  if (org.size > 0) {
    for (const name of MCP_RESERVED_NAMES) {
      if (org.has(name))
        warnings.push(
          `  WARNING: '${name}' is a framework-managed MCP server — the org declaration for '${name}' was NOT applied (framework wins).`,
        );
    }
    const byCodePoint = (a: string, b: string): number =>
      Buffer.compare(Buffer.from(a), Buffer.from(b));
    for (const name of [...org.keys()].sort(byCodePoint)) {
      if (!operatorServers.has(name) || reserved(name)) continue;
      warnings.push(
        `  WARNING: org-declared MCP server '${name}' overrides your pre-existing '${name}' entry (org declaration wins).`,
      );
      warnings.push(`           The prior entry is preserved in the timestamped backup: ${bak}`);
    }
    for (const [name, entry] of org) if (!reserved(name)) servers.set(name, clone(entry));
  }
  return {
    ok: true,
    text: writeJsonText(merged),
    warnings,
    state: read.state,
    comments: read.comments,
  };
}

/** The merge over a file: absent when it does not exist (`[ ! -e ]`), code 1 when unreadable. */
export function readAndMerge(
  file: string,
  input: Omit<MergeInput, "current" | "target">,
): MergeResult {
  let current: string | undefined;
  try {
    current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  } catch {
    return failure("the existing file could not be read", {
      ...input,
      current: undefined,
      target: file,
    });
  }
  return mergeGeminiSettings({ ...input, current, target: file });
}
