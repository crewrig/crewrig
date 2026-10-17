// index.ts — the accessors the scripts use: `.a.b`, `// ""`, `keys`, `length`, `tag`.

import { loadYq, YqMap, YqSeq, type YqNode } from "./load.ts";
import { isYqFalsy, lengthOf, render, tagOf } from "./render.ts";

export { loadYq, YqMap, YqSeq, YqParseError, PlainScalar, type YqNode } from "./load.ts";
export { isYqFalsy, lengthOf, render, tagOf } from "./render.ts";

/** `.a.b`: an absent key is null; indexing a scalar throws, as yq does. */
export function get(doc: YqNode, path: readonly string[]): YqNode {
  let cur = doc;
  for (const seg of path) {
    if (cur === null) return null;
    if (cur instanceof YqMap) {
      cur = cur.entries.find(([k]) => k === seg)?.[1] ?? null;
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

/** `keys` in DOCUMENT order. */
export function keys(node: YqNode): string[] {
  if (node instanceof YqMap) return node.entries.map(([k]) => k);
  if (node instanceof YqSeq) return node.items.map((_, i) => String(i));
  throw new Error("cannot get keys of a scalar");
}

export function parse(text: string): YqNode {
  return loadYq(text);
}
export { lengthOf as length, tagOf as tag };
