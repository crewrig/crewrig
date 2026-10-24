// load.ts — YAML loader of the shared yq-accessor reader (spec 0262 req 5, 24 d).
//
// Scalar style: `FAILSAFE_SCHEMA.extend({implicit: [plainScalar]})`. js-yaml applies
// implicit types to PLAIN scalars only, so a plain scalar loads as a `PlainScalar`
// (a `String` subclass carrying its exact source text) while quoted and block
// scalars load as ordinary strings and an empty value as `null`. `PlainScalar`
// extends `String` because js-yaml collapses plain-object keys to `[object Object]`.
//
// Key order: a js-yaml object lists integer-like keys first (`z,10,2,a` -> `2,10,z,a`),
// so no object is ever iterated. The `listener` option yields one 'open' and one
// 'close' call per composed node, in document order, with `state.result` holding the
// constructed value at 'close'. A stack over open/close rebuilds the tree: each
// 'close' pops its frame and appends the node to the parent frame, so a mapping
// frame holds its children as key, value, key, value. Key scalars are told apart
// from value scalars by parity, and the two parses stay aligned by a check at each
// mapping close: the child count must be 2n, n being the key count of the loaded
// object, and the key texts must equal the loaded object's key set. Any mismatch (for
// instance a flow `{a}` or `? a` entry with no value event) throws `YqAlignmentError`
// rather than guessing an order. The loaded value of each key comes from the node
// built by events; an alias closes with the SAME object identity as its anchor, so a
// `WeakMap` from loaded object to node resolves it.
//
// Duplicate keys: yq keeps both entries (`keys` returns `a,a`, `.a` the last one), so
// js-yaml runs with `json: true` (a duplicate overrides instead of throwing) and the
// document comes from the listener tree only; alignment then compares key SETS.
// A flow entry with no value event (`{x, y: 1}`) falls back to the loaded object for
// that mapping (key order of that mapping then follows js-yaml). An empty value is a
// `PlainScalar("")`, distinct from an absent key (null). An alias closes with kind
// null and a non-null result; its name is read from the source before `position`.
//
// Multi-document input is rejected deliberately (req 24 d); duplicate keys and tags
// js-yaml does not know surface as typed errors.

import jsYaml from "js-yaml";

// js-yaml ships no types here; this is the structural slice the reader uses.
interface JsYaml {
  Type: new (tag: string, opts: object) => object;
  FAILSAFE_SCHEMA: { extend(x: { implicit: object[]; explicit?: object[] }): object };
  load(
    text: string,
    opts: {
      schema: object;
      json: boolean;
      listener: (phase: string, state: ListenerState) => void;
    },
  ): unknown;
}
const yaml = jsYaml as unknown as JsYaml;

export class PlainScalar extends String {}

export class YqMap {
  readonly entries: [string, YqNode][];
  constructor(entries: [string, YqNode][]) {
    this.entries = entries;
  }
}

export class YqSeq {
  readonly items: YqNode[];
  constructor(items: YqNode[]) {
    this.items = items;
  }
}

/** An alias (`*name`): yq does not resolve it for `-r`, `tag` or `length`; `get` follows it. */
export class YqAlias {
  readonly name: string;
  readonly target: YqNode;
  constructor(name: string, target: YqNode) {
    this.name = name;
    this.target = target;
  }
}

export type YqNode = null | string | PlainScalar | YqMap | YqSeq | YqAlias;

export class YqParseError extends Error {
  readonly kind: "duplicate-key" | "unknown-tag" | "multi-document" | "syntax" | "alignment";
  constructor(kind: YqParseError["kind"], message: string) {
    super(message);
    this.name = "YqParseError";
    this.kind = kind;
  }
}

const plainScalar = new yaml.Type("tag:yaml.org,2002:str", {
  kind: "scalar",
  resolve: () => true,
  construct: (data: string) => new PlainScalar(data),
});

// GitLab's `!reference [job, key]` is a tagged sequence: read it as the plain sequence
// (the tag itself is not kept; consumers resolve a two-scalar sequence inside `before_script`).
const reference = new yaml.Type("!reference", {
  kind: "sequence",
  construct: (data: unknown[]) => data,
});

const SCHEMA = yaml.FAILSAFE_SCHEMA.extend({ implicit: [plainScalar], explicit: [reference] });

interface Frame {
  children: YqNode[];
}

interface ListenerState {
  position: number;
  kind: string | null;
  result: unknown;
}

function classify(e: unknown): YqParseError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/duplicated mapping key/.test(msg)) return new YqParseError("duplicate-key", msg);
  if (/unknown tag/.test(msg)) return new YqParseError("unknown-tag", msg);
  if (/expected a single document/.test(msg)) return new YqParseError("multi-document", msg);
  return new YqParseError("syntax", msg);
}

export function loadYq(text: string): YqNode {
  const stack: Frame[] = [];
  const byObject = new WeakMap<object, YqNode>();
  let last: YqNode = null;
  const fromLoaded = (v: unknown): YqNode => {
    if (v === null || v === undefined) return new PlainScalar("");
    return (typeof v === "object" ? byObject.get(v) : undefined) ?? (v as YqNode);
  };
  const listener = (phase: string, state: ListenerState): void => {
    if (phase === "open") {
      stack.push({ children: [] });
      return;
    }
    const frame = stack.pop() ?? { children: [] };
    const result = state.result;
    // A flow collection nested in a block sequence fires its open/close pair twice, the
    // outer pair wrapping the inner one with the SAME loaded object: pass the inner node on.
    const only = frame.children[0];
    if (
      (state.kind === "sequence" || state.kind === "mapping") &&
      frame.children.length === 1 &&
      only !== undefined &&
      typeof result === "object" &&
      result !== null &&
      byObject.get(result) === only
    ) {
      stack[stack.length - 1]?.children.push(only);
      last = only;
      return;
    }
    let node: YqNode;
    if (state.kind === "mapping") {
      const obj = result as Record<string, unknown>;
      const keys = Object.keys(obj);
      const kids = frame.children;
      const entries: [string, YqNode][] = [];
      if (kids.length % 2 === 0) {
        for (let i = 0; i < kids.length; i += 2)
          entries.push([String(kids[i]), kids[i + 1] ?? null]);
      }
      const seen = [...new Set(entries.map(([k]) => k))].sort();
      if (entries.length === 0 || JSON.stringify(seen) !== JSON.stringify([...keys].sort())) {
        if (keys.length === 0) {
          node = new YqMap([]);
          stack[stack.length - 1]?.children.push(node);
          byObject.set(obj, node);
          last = node;
          return;
        }
        entries.length = 0;
        for (const k of keys) entries.push([k, fromLoaded(obj[k])]);
      }
      node = new YqMap(entries);
    } else if (state.kind === "sequence") {
      if (frame.children.length !== (result as unknown[]).length) {
        throw new YqParseError("alignment", "sequence items");
      }
      node = new YqSeq(frame.children);
    } else if (state.kind === null && result !== null && result !== undefined) {
      const m = /\*([^\s,\]}]+)\s*$/.exec(text.slice(0, state.position));
      node = new YqAlias(m?.[1] ?? "", fromLoaded(result));
    } else if (result === null || result === undefined) {
      node = new PlainScalar("");
    } else {
      node = result as YqNode;
    }
    if (state.kind !== null && result !== null && typeof result === "object")
      byObject.set(result, node);
    stack[stack.length - 1]?.children.push(node);
    last = node;
  };
  try {
    yaml.load(text, { schema: SCHEMA, listener, json: true });
  } catch (e) {
    throw e instanceof YqParseError ? e : classify(e);
  }
  return last;
}
