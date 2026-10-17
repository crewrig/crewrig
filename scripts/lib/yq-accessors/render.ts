// render.ts — `yq -r` rendering, `tag`, falsiness, `length` of a loaded node.
// The plain-scalar rules start from YAML 1.2 core resolution and are corrected by the
// fuzz corpus run against real yq v4.44.3 (scripts/tests/model-ci-tooling-yq-accessors.test.ts).

import { PlainScalar, YqAlias, YqMap, YqSeq, type YqNode } from "./load.ts";

const NULL = /^(~|null|Null|NULL)?$/;
const BOOL = /^(true|True|TRUE|false|False|FALSE)$/;
const INT = /^([-+]?[0-9][0-9_]*|0o[0-7]+|0b[01]+|0x[0-9a-fA-F]+)$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ][0-9:.]+(Z|[-+][0-9:]+)?)?$/;
const FLOAT =
  /^([-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$/;

export function tagOf(node: YqNode): string {
  if (node === null) return "!!null";
  if (node instanceof YqMap) return "!!map";
  if (node instanceof YqSeq) return "!!seq";
  if (node instanceof YqAlias) return "";
  if (!(node instanceof PlainScalar)) return "!!str";
  const t = node.toString();
  if (NULL.test(t)) return "!!null";
  if (BOOL.test(t)) return "!!bool";
  if (INT.test(t)) return "!!int";
  if (FLOAT.test(t)) return "!!float";
  if (TIMESTAMP.test(t)) return "!!timestamp";
  return "!!str";
}

/** `// ""` treats null and false as falsy; a quoted "false" or "~" is a string. */
export function isYqFalsy(node: YqNode): boolean {
  if (node === null) return true;
  if (node instanceof PlainScalar) {
    const t = tagOf(node);
    return t === "!!null" || (t === "!!bool" && /^(false|False|FALSE)$/.test(node.toString()));
  }
  return false;
}

/** The `yq -r` rendering of a scalar node: source text, `null` for a null node. */
export function render(node: YqNode): string {
  if (node === null) return "null";
  if (node instanceof YqAlias) return `*${node.name}`;
  if (node instanceof YqMap || node instanceof YqSeq) {
    throw new Error("render: collection nodes are not rendered by this reader");
  }
  return node.toString();
}

export function lengthOf(node: YqNode): number {
  if (node === null) return 0;
  if (node instanceof YqMap) return node.entries.length;
  if (node instanceof YqSeq) return node.items.length;
  if (node instanceof YqAlias) return 0;
  if (tagOf(node) === "!!null") return 0;
  return Buffer.byteLength(node.toString());
}
