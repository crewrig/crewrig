// merge-tree.ts — the text tree the override merge works on, and its emitter.
//
// No shell twin: the shell edited the composed document in place with `yq eval -i`
// and let `yq` write it back. This module is the part of that job the merge needs
// done outside `yq` (spec 0250 R20; the design is documented in merge-mapping.ts,
// "Carrying nulls and quoting", which answers plan finding v1-F2). R2 (spec 0250):
// this slice moved only because the step (b) build depends on it, not as precedent.
//
// A `TNode` is one YAML node seen through both pinned schemas of yaml-text.ts: the
// STRUCTURE and the written TEXT of every scalar come from the FAILSAFE tree, the
// scalar's TYPE comes from the CORE tree (`core` is the CORE value, so `typeof core
// === "string"` is the whole question "was this a string, or a number, a boolean, a
// null?"). Mapping keys are the keys as written.

import type { YamlDoc } from "../yaml-text.ts";

export type TScalar = { readonly kind: "scalar"; text: string | null; core: unknown };
export type TMap = { readonly kind: "map"; entries: Array<[string, TNode]> };
export type TSeq = { readonly kind: "seq"; items: TNode[] };
export type TNode = TScalar | TMap | TSeq;

/** A `null` the way `yq -o=json` prints one: the spelling `null`, the CORE value null. */
export function nullNode(): TScalar {
  return { kind: "scalar", text: "null", core: null };
}

export function newMap(): TMap {
  return { kind: "map", entries: [] };
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function zip(core: unknown, text: unknown): TNode {
  if (Array.isArray(text)) {
    const items: unknown[] = text;
    return {
      kind: "seq",
      items: items.map((item, i) => zip(Array.isArray(core) ? core[i] : undefined, item)),
    };
  }
  if (isMapping(text)) {
    const entries = Object.keys(text).map((key): [string, TNode] => {
      const typed = isMapping(core) && Object.hasOwn(core, key) ? core[key] : undefined;
      return [key, zip(typed, text[key])];
    });
    return { kind: "map", entries };
  }
  if (typeof text === "string")
    return { kind: "scalar", text, core: core === undefined ? text : core };
  return { kind: "scalar", text: null, core: null };
}

/** The node of a document or a sub-document; an absent node is a `yq` `null`. */
export function fromDoc(doc: YamlDoc | null): TNode {
  if (doc === null || (doc.core === undefined && doc.text === undefined)) return nullNode();
  return zip(doc.core, doc.text);
}

function unzipCore(node: TNode): unknown {
  if (node.kind === "scalar") return node.core;
  if (node.kind === "seq") return node.items.map(unzipCore);
  return Object.fromEntries(node.entries.map(([key, child]) => [key, unzipCore(child)]));
}

function unzipText(node: TNode): unknown {
  if (node.kind === "scalar") return node.text;
  if (node.kind === "seq") return node.items.map(unzipText);
  return Object.fromEntries(node.entries.map(([key, child]) => [key, unzipText(child)]));
}

/** The node as a document the yaml-text readers accept. */
export function toDoc(node: TNode): YamlDoc {
  return { core: unzipCore(node), text: unzipText(node) };
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const KEY_WORDS = new Set(["y", "n", "yes", "no", "on", "off", "true", "false", "null"]);

/**
 * The characters JSON leaves raw that YAML 1.1 readers (and `yq`) fold or refuse: the
 * C1 controls with DEL (0x7f-0x9f), the line and paragraph separators (0x2028, 0x2029)
 * and the byte-order mark (0xfeff). Built from code points so the source stays ASCII.
 */
const UNSAFE = new RegExp(
  `[${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f, 0x2028, 0x2029, 0xfeff)}]`,
  "g",
);

/** JSON string syntax is YAML double-quoted syntax; the characters of `UNSAFE` become four-digit backslash-u escapes. */
function quote(text: string): string {
  return JSON.stringify(text).replace(
    UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function keyText(key: string): string {
  return PLAIN_KEY.test(key) && !KEY_WORDS.has(key.toLowerCase()) ? key : quote(key);
}

/** A string is always quoted; any other scalar keeps the characters it was written with. */
function scalarText(node: TScalar): string {
  if (typeof node.core === "string") return quote(node.text ?? "");
  return node.text ?? "";
}

function isBlock(node: TNode): node is TMap | TSeq {
  if (node.kind === "map") return node.entries.length > 0;
  return node.kind === "seq" && node.items.length > 0;
}

/** The one-line form of a scalar or an empty collection. */
function flat(node: TNode): string {
  if (node.kind === "scalar") return scalarText(node);
  return node.kind === "map" ? "{}" : "[]";
}

/** The block lines of a non-empty collection at an indentation. */
function block(node: TMap | TSeq, pad: string): string[] {
  const lines: string[] = [];
  if (node.kind === "map") {
    for (const [key, child] of node.entries) {
      const head = `${pad}${keyText(key)}:`;
      if (isBlock(child)) lines.push(head, ...block(child, `${pad}  `));
      else lines.push(flat(child) === "" ? head : `${head} ${flat(child)}`);
    }
    return lines;
  }
  for (const child of node.items) {
    if (!isBlock(child)) {
      lines.push(flat(child) === "" ? `${pad}-` : `${pad}- ${flat(child)}`);
      continue;
    }
    const nested = block(child, `${pad}  `);
    lines.push(`${pad}- ${(nested[0] ?? "").slice(pad.length + 2)}`, ...nested.slice(1));
  }
  return lines;
}

/** The document text of a root node: block style, strings double-quoted, one line feed at the end. */
export function emitDocument(root: TNode): string {
  if (!isBlock(root)) return `${flat(root)}\n`;
  return `${block(root, "").join("\n")}\n`;
}
