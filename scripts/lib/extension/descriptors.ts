// descriptors.ts — typed readers of the four `extension-*.json` descriptors (spec 0254 R8).
// Reads the files the shell libraries read: scripts/lib/extension-manifest.sh:24-25 (the
// targets and legacy-shape paths), :383 (`ext_mcp_delivery`, fail-closed), :84-117
// (`ext_assert_current_shape`, which consumes the legacy-shape enumeration), and
// scripts/build-extension.sh `ext_class_scan` (the generated-output class).

import { readTextLf } from "../line-endings.ts";
import { parseJson } from "./json-ordered.ts";
import { jqText } from "./json-write.ts";
import { ExtError, TARGETS } from "./types.ts";
import type { JsonValue, Target, TargetRow, TargetTable } from "./types.ts";

export interface LegacyShape {
  readonly componentsKey: string;
  readonly componentsSubjects: readonly string[];
  readonly perCliKeys: readonly string[];
}

export type LegacyShapeResult =
  | { readonly kind: "ok"; readonly shape: LegacyShape }
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" };

export interface GeneratedClass {
  readonly manifestClass: readonly string[];
  readonly generatedGlobs: readonly string[];
}

const TARGETS_FILE = "extension-targets.json";
const PERCLI_FILE = "extension-percli-keys.json";
const CLASS_FILE = "extension-generated-class.json";
const SHAPE_FILE = "extension-legacy-shape.json";

/** `<libDir>/extension-legacy-shape.json`, the path the shape guard prints (`$shape`). */
export function legacyShapePath(libDir: string): string {
  return `${libDir}/${SHAPE_FILE}`;
}

/** Read and parse one JSON file; an unreadable file is an `ExtError`, as is a non-JSON one. */
export function readJsonFile(file: string): JsonValue {
  let text: string;
  try {
    text = readTextLf(file);
  } catch {
    throw new ExtError(`${file}: cannot read file`);
  }
  return parseJson(text, file);
}

function strings(value: JsonValue | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

/** One column as `jq -r '.[$t][$c] // empty'` renders it: "" for absent, null or false. */
function column(row: JsonValue | undefined, name: string): string {
  if (!(row instanceof Map)) return "";
  const value = row.get(name);
  if (value === undefined || value === null || value === false) return "";
  return jqText(value);
}

function toRow(row: JsonValue | undefined): TargetRow {
  const delivery = row instanceof Map ? row.get("mcpDelivery") : undefined;
  return {
    shellTool: column(row, "shellTool"),
    rootToken: column(row, "rootToken"),
    hookFile: column(row, "hookFile"),
    matchAll: column(row, "matchAll"),
    mcpDelivery: delivery === true,
    displayName: column(row, "displayName"),
    commandRef: column(row, "commandRef"),
    skillRef: column(row, "skillRef"),
    contextOutput: column(row, "contextOutput"),
  };
}

/** The four target rows; a missing or malformed row reads as empty strings and `false`. */
export function readTargetTable(libDir: string): TargetTable {
  const doc = readJsonFile(`${libDir}/${TARGETS_FILE}`);
  const get = (t: Target): TargetRow => toRow(doc instanceof Map ? doc.get(t) : undefined);
  const entries = TARGETS.map((t): [Target, TargetRow] => [t, get(t)]);
  return Object.fromEntries(entries) as Record<Target, TargetRow>;
}

/** `ext_mcp_delivery`: fail-closed, an unreadable file, row or column reads as `false`. */
export function mcpDeliveryOf(libDir: string, target: string): boolean {
  try {
    const row = readJsonFile(`${libDir}/${TARGETS_FILE}`);
    return row instanceof Map && toRow(row.get(target)).mcpDelivery;
  } catch {
    return false;
  }
}

/**
 * The admissible per-CLI keys (the `key` of each allowlist row). Fail-closed as the
 * validator is: a missing or malformed file, or a row without a string `key`, admits nothing.
 */
export function readPerCliKeys(libDir: string): string[] {
  let doc: JsonValue;
  try {
    doc = readJsonFile(`${libDir}/${PERCLI_FILE}`);
  } catch {
    return [];
  }
  if (!Array.isArray(doc)) return [];
  const keys: string[] = [];
  for (const row of doc) {
    const key = row instanceof Map ? row.get("key") : undefined;
    if (typeof key === "string") keys.push(key);
  }
  return keys;
}

/** The generated-output class; a key that is not an array of strings reads as empty. */
export function readGeneratedClass(libDir: string): GeneratedClass {
  const doc = readJsonFile(`${libDir}/${CLASS_FILE}`);
  const read = (key: string): string[] => (doc instanceof Map ? strings(doc.get(key)) : null) ?? [];
  return { manifestClass: read("manifest_class"), generatedGlobs: read("generated_globs") };
}

/** The retired-shape enumeration, or why it cannot be used (`missing`, `malformed`). */
export function readLegacyShape(libDir: string): LegacyShapeResult {
  const file = legacyShapePath(libDir);
  let text: string;
  try {
    text = readTextLf(file);
  } catch {
    return { kind: "missing" };
  }
  let doc: JsonValue;
  try {
    doc = parseJson(text, file);
  } catch {
    return { kind: "malformed" };
  }
  if (!(doc instanceof Map)) return { kind: "malformed" };
  const componentsKey = doc.get("componentsKey");
  const componentsSubjects = strings(doc.get("componentsSubjects"));
  const perCliKeys = strings(doc.get("perCliKeys"));
  if (typeof componentsKey !== "string" || componentsSubjects === null || perCliKeys === null)
    return { kind: "malformed" };
  return { kind: "ok", shape: { componentsKey, componentsSubjects, perCliKeys } };
}
