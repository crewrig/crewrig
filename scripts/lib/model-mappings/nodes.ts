// nodes.ts — the `yq` reads of the shell over a loaded document (spec 0262 req 5, 24 (c)).
//
// A read the shell ran without `2>/dev/null` aborts under `set -e` when yq fails; that
// is an `Error:` line here (`strictGet`). A read it silenced (`quiet`) yields "absent".

import {
  get,
  isYqFalsy,
  keys,
  render,
  tag,
  YqAlias,
  YqMap,
  YqSeq,
  type YqNode,
} from "../yq-accessors/index.ts";
import { ModelMappingsError } from "./types.ts";

export function unalias(node: YqNode): YqNode {
  let cur = node;
  while (cur instanceof YqAlias) cur = cur.target;
  return cur;
}

/** Run a read whose yq stderr the shell discarded; a failure reads as `fallback`. */
export function quiet<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * A read the shell did not silence: a yq failure is a (c) runtime failure. yq also fails
 * when a key is read through a sequence, which the shared reader answers with null.
 */
export function strictGet(file: string, doc: YqNode, path: readonly string[]): YqNode {
  try {
    let cur = doc;
    for (const seg of path) {
      const at = unalias(cur);
      if (at instanceof YqSeq && !/^[0-9]+$/.test(seg)) {
        throw new Error(`cannot index array with '${seg}'`);
      }
      cur = get(cur, [seg]);
    }
    return cur;
  } catch (e) {
    throw new ModelMappingsError(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** `yq -r` of a scalar node as `$(...)` captured it; a collection is a (c) gap. */
export function scalarText(node: YqNode): string {
  const n = unalias(node);
  if (n instanceof YqMap || n instanceof YqSeq) {
    if (n instanceof YqMap ? n.entries.length === 0 : n.items.length === 0) {
      return n instanceof YqMap ? "{}" : "[]";
    }
    throw new ModelMappingsError(
      "a non-empty collection where a scalar is expected is not rendered",
    );
  }
  return render(node).replace(/\n+$/, "");
}

/** `-r '<path> // ""'` */
export function textOrEmpty(node: YqNode): string {
  return isYqFalsy(unalias(node)) ? "" : scalarText(node);
}

/** `<path> | has("k")` (stderr discarded): true iff the node is a mapping carrying `k`. */
export function hasKey(node: YqNode, key: string): boolean {
  const n = unalias(node);
  return n instanceof YqMap && n.entries.some(([k]) => k === key);
}

/**
 * `<path> | keys | .[]` as `check_closed_keys` runs it: yq fails on a null or scalar
 * node and the shell's `keys=$(...)` aborts under `set -e` with no message. The twin
 * raises a plain Error; `checkFile` adds the path (spec 0262 req 24 (c)).
 */
export function keyList(node: YqNode): string[] {
  const n = unalias(node);
  try {
    return keys(n);
  } catch {
    throw new Error(`cannot get keys of ${tag(n) || "an alias"}`);
  }
}

/** `<path> // {} | keys | .[]`: a falsy node reads as an empty mapping. */
export function keyListOrEmpty(node: YqNode): string[] {
  return isYqFalsy(unalias(node)) ? [] : keyList(node);
}

/** The elements of `.[]`: sequence items or mapping values; throws like yq on a scalar. */
export function elements(node: YqNode): YqNode[] {
  const n = unalias(node);
  if (n instanceof YqSeq) return n.items;
  if (n instanceof YqMap) return n.entries.map(([, v]) => v);
  if (n === null) return [];
  throw new Error("cannot iterate over a scalar");
}

/**
 * `<path>[].<field> // ""` with stderr discarded: streamed per element, so an element
 * yq cannot index stops the output after the earlier ones. Empty values are skipped,
 * as every consumer's `[ -z ]` does.
 */
export function fieldValues(root: YqNode, path: readonly string[], field: string): string[] {
  const out: string[] = [];
  try {
    for (const el of elements(get(root, path))) {
      const v = get(el, [field]);
      const t = textOrEmpty(v);
      if (t !== "") out.push(t);
    }
  } catch (e) {
    if (e instanceof ModelMappingsError) throw e;
  }
  return out;
}

/**
 * `<path>[] // ""` (stderr discarded): the truthy elements' texts, or one empty text
 * when none is truthy; a read yq cannot make yields nothing.
 */
export function truthyTexts(node: YqNode): string[] {
  let els: YqNode[];
  try {
    els = elements(node);
  } catch {
    return [];
  }
  const live = els.filter((e) => !isYqFalsy(unalias(e)));
  return live.length === 0 ? [""] : live.map((e) => scalarText(e));
}

/** `tr -d '[:space:]'` leaves nothing. */
export const isBlank = (text: string): boolean => text.replace(/[ \t\n\v\f\r]/g, "") === "";
