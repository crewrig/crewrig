// yaml-text.ts — read YAML as the text `yq -r` printed (spec 0250 R11).
//
// The build's shell read every frontmatter field with `yq -r`, which prints a
// scalar as it was written (`1.0`, `True`, `~`, `007`), never as a parsed value.
// A single `js-yaml` load cannot give both the structure and the written text,
// so `parse` loads the same text twice with two explicitly pinned schemas:
//   - CORE_SCHEMA for structure: null in any spelling, `false`, absent, kind.
//     Timestamps and merge keys (the library default) are NOT resolved;
//   - FAILSAFE_SCHEMA for text: every scalar is the string as written, an empty
//     value is `null`, so `1.0` stays `1.0` and `True` stays `True`.
//
// `js-yaml` is never imported here (spec 0250 R24): the caller loads it through
// `loadDependency` and hands the namespace to `toYamlLib`. Standard library only.
//
// Reader semantics, each mirroring one `yq -r` expression of the shell:
//   plain   `.a.b`                      absent renders `null`, an empty value ``.
//   alt     `.a.b // ""`                absent, null (any spelling), false, `` give ``.
//   seq     `.a // [] | .[]`            element texts in order.
//   has     `.a // {} | has("b")`       key presence, whatever the value.
//   entries `.a | to_entries | .[]`     key, kind and text of every entry.
// A document whose expanded size passes EXPANDED_NODE_LIMIT is refused as unparseable
// (`parse` returns null): js-yaml shares an alias target, so a few hundred bytes of nested
// aliases parse cheaply and then blow up when any consumer copies the tree (spec 0250
// R33, the alias-expansion hardening). A cyclic alias is refused the same way.
// A path that cannot be walked (through a scalar or a sequence), and an
// unparseable source (`parse` returned null), are a `yq` error: the shell
// discarded stderr, so the text is empty (`plain`, `alt`), `[]`, or `false`.
// A mapping or a sequence read as a scalar renders empty; a caller that must
// refuse one (R12) asks `entries` for its `kind`.

/** The part of the `js-yaml` namespace this module uses. */
export interface YamlLib {
  load(input: string, options?: { readonly schema?: unknown }): unknown;
  dump(value: unknown, options?: Readonly<Record<string, unknown>>): string;
  readonly CORE_SCHEMA: unknown;
  readonly FAILSAFE_SCHEMA: unknown;
}

/** One source loaded under both schemas. */
export interface YamlDoc {
  /** Structure: null, false, absent, kind (CORE_SCHEMA). */
  readonly core: unknown;
  /** Written text of every scalar (FAILSAFE_SCHEMA). */
  readonly text: unknown;
}

/** A key path: `["metadata", "provenance"]`, or `"metadata.provenance"` split on `.`. */
export type YamlPath = string | readonly string[];

export type YamlKind = "scalar" | "mapping" | "sequence";

export interface YamlEntry {
  readonly key: string;
  readonly kind: YamlKind;
  /** The scalar as `yq` concatenates it (null in any spelling is ``); `` for a collection. */
  readonly text: string;
}

export interface YamlText {
  /** `null` when either load throws (unparseable, duplicate key, non-core tag) or the document is too large once expanded. */
  parse(text: string): YamlDoc | null;
  plain(doc: YamlDoc | null, path: YamlPath): string;
  alt(doc: YamlDoc | null, path: YamlPath): string;
  seq(doc: YamlDoc | null, path: YamlPath): string[];
  has(doc: YamlDoc | null, path: YamlPath): boolean;
  entries(doc: YamlDoc | null, path: YamlPath): YamlEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isSequence(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUsableLib(candidate: unknown): candidate is YamlLib {
  return (
    isRecord(candidate) &&
    typeof candidate["load"] === "function" &&
    typeof candidate["dump"] === "function" &&
    isRecord(candidate["CORE_SCHEMA"]) &&
    isRecord(candidate["FAILSAFE_SCHEMA"])
  );
}

/**
 * Narrow the namespace `loadDependency("js-yaml")` returns. `js-yaml` 4.x
 * exposes every function both as a named export and under `default`; the
 * `default` object is tried first, then the namespace itself.
 *
 * @throws TypeError when neither carries `load`, `dump`, `CORE_SCHEMA` and
 *   `FAILSAFE_SCHEMA` (a programming error, not a user-facing condition).
 */
export function toYamlLib(ns: unknown): YamlLib {
  const candidates: unknown[] = [isRecord(ns) ? ns["default"] : undefined, ns];
  const found = candidates.find(isUsableLib);
  if (found === undefined) {
    throw new TypeError(
      "toYamlLib: the namespace has no load, dump, CORE_SCHEMA and FAILSAFE_SCHEMA",
    );
  }
  const lib = found;
  return {
    load: (input, options) => lib.load(input, options),
    dump: (value, options) => lib.dump(value, options),
    CORE_SCHEMA: lib.CORE_SCHEMA,
    FAILSAFE_SCHEMA: lib.FAILSAFE_SCHEMA,
  };
}

/** Most nodes a document may have once every alias is followed (about 1000 times a real one). */
export const EXPANDED_NODE_LIMIT = 100_000;

interface SizeFrame {
  readonly node: object;
  readonly children: unknown[];
  next: number;
  sum: number;
}

function frameOf(node: object): SizeFrame {
  const children: unknown[] = Array.isArray(node) ? node : Object.values(node);
  return { node, children, next: 0, sum: 1 };
}

/**
 * Whether following every alias of `root` reaches more than {@link EXPANDED_NODE_LIMIT}
 * nodes, or loops back on itself. Linear in the number of distinct nodes: the size of a
 * shared node is computed once (memoised) and the running sum is capped, so the
 * expansion is counted, never performed. Iterative, so nesting depth cannot overflow
 * the call stack.
 */
export function exceedsExpandedLimit(root: unknown): boolean {
  if (!isRecord(root)) return false;
  const sizes = new Map<object, number>();
  const active = new Set<object>([root]);
  const stack: SizeFrame[] = [frameOf(root)];
  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    if (frame.next < frame.children.length) {
      const child = frame.children[frame.next];
      frame.next += 1;
      if (!isRecord(child)) {
        frame.sum += 1;
      } else if (active.has(child)) {
        return true;
      } else if (sizes.has(child)) {
        frame.sum += sizes.get(child) ?? 0;
      } else {
        active.add(child);
        stack.push(frameOf(child));
      }
      if (frame.sum > EXPANDED_NODE_LIMIT) return true;
      continue;
    }
    stack.pop();
    active.delete(frame.node);
    sizes.set(frame.node, frame.sum);
    const parent = stack.at(-1);
    if (parent !== undefined) {
      parent.sum += frame.sum;
      if (parent.sum > EXPANDED_NODE_LIMIT) return true;
    }
  }
  return false;
}

/** A node seen through both trees; `core === undefined` is an absent key. */
interface Pair {
  readonly core: unknown;
  readonly text: unknown;
}

const ABSENT: Pair = { core: undefined, text: undefined };

/** `null` is a `yq` error (the key is read through a scalar or a sequence). */
function child(parent: Pair, key: string): Pair | null {
  const { core, text } = parent;
  if (core === null || core === undefined) return ABSENT;
  if (!isMapping(core)) return null;
  const written = isMapping(text) && Object.hasOwn(text, key) ? text[key] : undefined;
  if (Object.hasOwn(core, key)) return { core: core[key], text: written };
  // A key the two schemas spell differently (`1.0:`, `~:`): the text tree owns it.
  return written === undefined ? ABSENT : { core: written, text: written };
}

function keysOf(path: YamlPath): string[] {
  if (typeof path !== "string") return [...path];
  const trimmed = path.startsWith(".") ? path.slice(1) : path;
  return trimmed === "" ? [] : trimmed.split(".");
}

function walk(doc: YamlDoc | null, keys: readonly string[]): Pair | null {
  if (doc === null) return null;
  let node: Pair | null = { core: doc.core, text: doc.text };
  for (const key of keys) {
    node = child(node, key);
    if (node === null) return null;
  }
  return node;
}

/** The written text of a scalar of the FAILSAFE tree; `` for null and collections. */
function writtenText(text: unknown): string {
  return typeof text === "string" ? text : "";
}

/** The shell's command substitution removed every trailing line feed. */
function withoutTrailingLf(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
  return text.slice(0, end);
}

function render(text: unknown): string {
  return withoutTrailingLf(writtenText(text));
}

function kindOf(value: unknown): YamlKind {
  if (isSequence(value)) return "sequence";
  return isMapping(value) ? "mapping" : "scalar";
}

/** Build the readers over a narrowed `js-yaml` namespace (see {@link toYamlLib}). */
export function createYamlText(lib: YamlLib): YamlText {
  return {
    parse(text) {
      try {
        const core = lib.load(text, { schema: lib.CORE_SCHEMA });
        const written = lib.load(text, { schema: lib.FAILSAFE_SCHEMA });
        if (exceedsExpandedLimit(core) || exceedsExpandedLimit(written)) return null;
        return { core, text: written };
      } catch {
        return null;
      }
    },

    plain(doc, path) {
      const node = walk(doc, keysOf(path));
      if (node === null) return "";
      return node.core === undefined ? "null" : render(node.text);
    },

    alt(doc, path) {
      const node = walk(doc, keysOf(path));
      if (node === null) return "";
      const { core } = node;
      if (core === undefined || core === null || core === false) return "";
      return render(node.text);
    },

    seq(doc, path) {
      const node = walk(doc, keysOf(path));
      if (node === null) return [];
      const { core, text } = node;
      if (core === undefined || core === null || core === false) return [];
      // `.[]` yields the elements of a sequence and the values of a mapping.
      if (isSequence(text)) return text.map((item) => render(item));
      if (isMapping(text)) return Object.values(text).map((item) => render(item));
      return [];
    },

    has(doc, path) {
      const keys = keysOf(path);
      const last = keys.pop();
      if (last === undefined) return false;
      const parent = walk(doc, keys);
      if (parent === null) return false;
      if (isMapping(parent.core) && Object.hasOwn(parent.core, last)) return true;
      return isMapping(parent.core) && isMapping(parent.text) && Object.hasOwn(parent.text, last);
    },

    entries(doc, path) {
      const node = walk(doc, keysOf(path));
      if (node === null || !isMapping(node.text)) return [];
      const text = node.text;
      const core = isMapping(node.core) ? node.core : {};
      return Object.keys(text).map((key): YamlEntry => {
        const value = text[key];
        const kind = kindOf(value);
        const isNull = Object.hasOwn(core, key) ? core[key] === null : value === null;
        // `yq` keeps the block scalar's own trailing line feed inside the value.
        return { key, kind, text: kind === "scalar" && !isNull ? writtenText(value) : "" };
      });
    },
  };
}
