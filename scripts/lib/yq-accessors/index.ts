// index.ts — the accessors the scripts use: `.a.b`, `// ""`, `keys`, `length`, `tag`.

import { loadYq, YqAlias, YqMap, YqSeq, type YqNode } from "./load.ts";
import { isYqFalsy, lengthOf, render, tagOf } from "./render.ts";

export { loadYq, YqAlias, YqMap, YqSeq, YqParseError, PlainScalar, type YqNode } from "./load.ts";
export { isYqFalsy, lengthOf, render, tagOf } from "./render.ts";

/** Follow aliases to the node they stand for (a YAML `*name`); any other node is returned as is. */
export function resolve(node: YqNode): YqNode {
  let cur = node;
  while (cur instanceof YqAlias) cur = cur.target;
  return cur;
}

/** `.a.b`: an absent key is null; indexing a scalar throws, as yq does. */
export function get(doc: YqNode, path: readonly string[]): YqNode {
  let cur = doc;
  for (const seg of path) {
    while (cur instanceof YqAlias) cur = cur.target;
    if (cur === null) return null;
    if (cur instanceof YqMap) {
      cur = cur.entries.findLast(([k]) => k === seg)?.[1] ?? null;
    } else if (cur instanceof YqSeq) {
      cur = /^[0-9]+$/.test(seg) ? (cur.items[Number(seg)] ?? null) : null;
    } else {
      throw new Error(`cannot index scalar with '${seg}'`);
    }
  }
  return cur;
}

/** `.a.b // ""` rendered as `yq -r` prints it. */
export function getOrEmpty(doc: YqNode, path: readonly string[]): string {
  const n = get(doc, path);
  return isYqFalsy(n) ? "" : render(n);
}

/** yq prints a hex or octal integer key in decimal in `keys`. */
function canonicalKey(k: string): string {
  if (/^0x[0-9a-fA-F]+$/.test(k)) return String(parseInt(k.slice(2), 16));
  if (/^0o[0-7]+$/.test(k)) return String(parseInt(k.slice(2), 8));
  return k;
}

/** `keys` in DOCUMENT order. */
export function keys(node: YqNode): string[] {
  if (node instanceof YqMap) return node.entries.map(([k]) => canonicalKey(k));
  if (node instanceof YqSeq) return node.items.map((_, i) => String(i));
  throw new Error("cannot get keys of a scalar");
}

export function parse(text: string): YqNode {
  return loadYq(text);
}
export { lengthOf as length, tagOf as tag };
