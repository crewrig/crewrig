// yaml-nodes.ts — `yq` navigation semantics over a loaded YAML document.
//
// No shell twin: the shell asked `yq` a question per accessor call (model-resolve.sh,
// every `yq` invocation of :98-105 and :149-1000). This module answers the same
// questions from a `YamlDoc` (scripts/lib/yaml-text.ts), reproducing the behaviour of
// yq v4.54.1 that the accessors and the merge depend on, each measured:
//   - a key read through a scalar yields nothing, so `// "dflt"` gives the default;
//     a key read through a sequence is an error, so the read is empty (no default);
//   - `.a[]` iterates a sequence's elements or a mapping's values; `.a[i]` on a
//     mapping reads the key `i`, on a scalar yields nothing;
//   - `| length` counts a sequence's elements, a mapping's keys, a scalar's UTF-8
//     bytes, and is 0 for null and for an absent key;
//   - `select(.id == "x")` compares the written text of a non-null scalar.
// A `null` result of a walk is a `yq` error; `{core: undefined}` is an absent node.
// R2 (spec 0250): this slice moved only because the step (b) build depends on it,
// not as precedent for the other consumers of the library.

import fs from "node:fs";

import type { YamlDoc, YamlText } from "../yaml-text.ts";

/** A parsed mapping, or `null` for an empty handle or an unreadable file. */
export type MappingDoc = YamlDoc | null;

const ABSENT: YamlDoc = { core: undefined, text: undefined };

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutTrailingLf(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
  return text.slice(0, end);
}

function written(text: unknown): string {
  return typeof text === "string" ? withoutTrailingLf(text) : "";
}

/** `.key` on a node. `null` is a `yq` error: the key was read through a sequence. */
function stepKey(node: YamlDoc, key: string): YamlDoc | null {
  const { core, text } = node;
  if (core === null || core === undefined) return ABSENT;
  if (Array.isArray(core)) return null;
  if (!isMapping(core)) return ABSENT;
  const spelled = isMapping(text) && Object.hasOwn(text, key) ? text[key] : undefined;
  if (Object.hasOwn(core, key)) return { core: core[key], text: spelled };
  return spelled === undefined ? ABSENT : { core: spelled, text: spelled };
}

/** Walk a key path; `null` is a `yq` error. */
export function nodeAt(doc: MappingDoc, keys: readonly string[]): YamlDoc | null {
  if (doc === null) return null;
  let node: YamlDoc | null = doc;
  for (const key of keys) {
    node = stepKey(node, key);
    if (node === null) return null;
  }
  return node;
}

const isFalsy = (core: unknown): boolean => core === undefined || core === null || core === false;

/** `-r '.path // "<fallback>"'`: the written text, the fallback for absent, null and `false`. */
export function altOr(doc: MappingDoc, keys: readonly string[], fallback: string): string {
  const node = nodeAt(doc, keys);
  if (node === null) return "";
  return isFalsy(node.core) ? fallback : written(node.text);
}

/** `(.path // []) | length`. */
export function countAt(doc: MappingDoc, keys: readonly string[]): number {
  const node = nodeAt(doc, keys);
  if (node === null || isFalsy(node.core)) return 0;
  const { core, text } = node;
  if (Array.isArray(core)) return core.length;
  if (isMapping(core)) return Object.keys(isMapping(text) ? text : core).length;
  return Buffer.byteLength(typeof text === "string" ? text : "", "utf8");
}

/** `.path[i]`: the i-th element; `null` is a `yq` error. */
export function elementAt(doc: MappingDoc, keys: readonly string[], index: number): MappingDoc {
  const node = nodeAt(doc, keys);
  if (node === null) return null;
  const { core, text } = node;
  if (Array.isArray(core))
    return { core: core[index], text: Array.isArray(text) ? text[index] : undefined };
  return isMapping(core) ? stepKey(node, String(index)) : ABSENT;
}

/** `.path[]`: the elements of a sequence or the values of a mapping. */
export function iterate(doc: MappingDoc, keys: readonly string[]): YamlDoc[] {
  const node = nodeAt(doc, keys);
  if (node === null) return [];
  const { core } = node;
  if (Array.isArray(core)) return core.map((_, i) => elementAt(doc, keys, i) ?? ABSENT);
  if (!isMapping(core)) return [];
  return Object.keys(core).map((key) => stepKey(node, key) ?? ABSENT);
}

/** `select(.<field> == "<want>")`. */
export function fieldEquals(el: MappingDoc, field: string, want: string): boolean {
  const node = nodeAt(el, [field]);
  return (
    node !== null && node.core !== undefined && node.core !== null && written(node.text) === want
  );
}

/** Load a mapping file once; an unreadable or unparseable file is `null` (spec 0198 R17). */
export function loadMapping(yaml: YamlText, handle: string): MappingDoc {
  if (handle === "") return null;
  try {
    return yaml.parse(fs.readFileSync(handle, "utf8"));
  } catch {
    return null;
  }
}
