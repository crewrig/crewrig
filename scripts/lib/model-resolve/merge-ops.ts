// merge-ops.ts — the node-level operations of the organisation override merge.
//
// Twins of model-resolve.sh `_list_index_by_id` (:149), `_emit_substituting_disposition`
// (:167), `_merge_offerings` (:178), `_merge_surfaces` (:201), `_merge_guard` (:240)
// and `_apply_removes` (:289). Spec 0199 R10-R12, R14, R19, R34, Decision 2; spec
// 0250 R20. R2 (spec 0250): this slice moved only because the step (b) build
// depends on it, not as precedent for the other consumers of the library.
//
// The shell ran `yq eval -i` against a composed file; here the composed document is
// a tree (merge-tree.ts) edited in place. The org file is read through the yaml-text
// readers, with the same expressions the shell used. A composition with no root
// mapping (the composed text was unparseable or a sequence) turns every edit into a
// no-op while the disposition lines are still written, as `yq` failing silently did.

import type { YamlDoc, YamlText } from "../yaml-text.ts";
import { countAt, elementAt, nodeAt } from "./yaml-nodes.ts";
import { fromDoc, newMap, nullNode } from "./merge-tree.ts";
import type { TMap, TNode, TSeq } from "./merge-tree.ts";

export interface MergeEnv {
  readonly yaml: YamlText;
  /** Write one `mapping-merge` line to standard error (no line feed). */
  readonly emit: (line: string) => void;
}

/** The document being composed; `root` is `null` when no edit can apply. */
export interface Composed {
  root: TMap | null;
}

export function entryOf(map: TMap, key: string): TNode | undefined {
  return map.entries.find(([name]) => name === key)?.[1];
}

export function setEntry(map: TMap, key: string, node: TNode): void {
  const at = map.entries.findIndex(([name]) => name === key);
  if (at < 0) map.entries.push([key, node]);
  else map.entries[at] = [key, node];
}

export function removeEntry(map: TMap, key: string): void {
  map.entries = map.entries.filter(([name]) => name !== key);
}

const isNullScalar = (node: TNode): boolean => node.kind === "scalar" && node.core === null;

/** The mapping at a key path; with `create`, an absent or null step becomes a new mapping. */
export function mapAt(root: TMap | null, keys: readonly string[], create: boolean): TMap | null {
  let node: TMap | null = root;
  for (const key of keys) {
    if (node === null) return null;
    const child = entryOf(node, key);
    if (child === undefined || isNullScalar(child)) {
      if (!create) return null;
      const made = newMap();
      setEntry(node, key, made);
      node = made;
    } else {
      node = child.kind === "map" ? child : null;
    }
  }
  return node;
}

/** The sequence at a key path (`.k += [x]` target): with `create`, an absent or null one is made. */
export function seqAt(root: TMap | null, keys: readonly string[], create: boolean): TSeq | null {
  const last = keys[keys.length - 1];
  const parent = last === undefined ? null : mapAt(root, keys.slice(0, -1), create);
  if (parent === null || last === undefined) return null;
  const child = entryOf(parent, last);
  if (child !== undefined && child.kind === "seq") return child;
  if (child !== undefined && !isNullScalar(child)) return null;
  if (!create) return null;
  const made: TSeq = { kind: "seq", items: [] };
  setEntry(parent, last, made);
  return made;
}

/** `has("<last>")` on the mapping at the path before it. */
export function hasKey(root: TMap | null, keys: readonly string[]): boolean {
  const last = keys[keys.length - 1];
  const parent = last === undefined ? null : mapAt(root, keys.slice(0, -1), false);
  return parent !== null && last !== undefined && entryOf(parent, last) !== undefined;
}

/** `.id // ""` of a tree node. */
function idOf(node: TNode | undefined): string {
  if (node === undefined || node.kind !== "scalar") return "";
  if (node.core === undefined || node.core === null || node.core === false) return "";
  return (node.text ?? "").replace(/\n+$/, "");
}

/** `_list_index_by_id`: the index of the first element whose `.id // ""` equals `want`, else -1. */
export function indexById(root: TMap | null, keys: readonly string[], want: string): number {
  const list = seqAt(root, keys, false);
  if (list === null) return -1;
  return list.items.findIndex((item) => item.kind === "map" && idOf(entryOf(item, "id")) === want);
}

/** Replace the element at an index, or append (`yq`'s `.list[i] = x` and `.list += [x]`). */
function replaceOrAppend(
  composed: Composed,
  keys: readonly string[],
  index: number,
  node: TNode | null,
): void {
  const list = node === null ? null : seqAt(composed.root, keys, index < 0);
  if (node === null || list === null) return;
  if (index >= 0) list.items[index] = node;
  else list.items.push(node);
}

/**
 * The node `yq -o=json ".<list>[i]"` printed for an org element. Read through a scalar
 * `yq` printed nothing, so the splice `+= []` was a no-op: `null` here. A mapping read by
 * index gives a `null` node (or its key `i`).
 */
function spliced(org: YamlDoc | null, keys: readonly string[], el: YamlDoc | null): TNode | null {
  const list = nodeAt(org, keys);
  const indexable = list !== null && typeof list.core === "object" && list.core !== null;
  return indexable ? fromDoc(el) : null;
}

function line(env: MergeEnv, target: string, address: string, disposition: string): void {
  env.emit(`mapping-merge\t${target}\t${address}\t${disposition}`);
}

/**
 * `_emit_substituting_disposition`: under `replaces-core: substituting`, an org node is
 * `replaced` when the core mapping (read for classification only) declares the same
 * address, `no-effect` otherwise; never `added` (spec 0199 R19, second clause).
 */
export function emitSubstitutingDisposition(
  env: MergeEnv,
  target: string,
  address: string,
  keys: readonly string[],
  id: string,
  coreRoot: TMap | null,
): void {
  const found = coreRoot !== null && indexById(coreRoot, keys, id) >= 0;
  line(env, target, address, found ? "replaced" : "no-effect");
}

/** `_merge_offerings`: whole-node replace-or-add at `offerings/<id>` (R10, R12). */
export function mergeOfferings(
  env: MergeEnv,
  composed: Composed,
  org: YamlDoc | null,
  target: string,
): void {
  const n = countAt(org, ["offerings"]);
  for (let i = 0; i < n; i++) {
    const el = elementAt(org, ["offerings"], i);
    const id = env.yaml.plain(el, "id");
    const index = indexById(composed.root, ["offerings"], id);
    replaceOrAppend(composed, ["offerings"], index, spliced(org, ["offerings"], el));
    line(env, target, `offerings/${id}`, index >= 0 ? "replaced" : "added");
  }
}

/**
 * `_merge_surfaces`: a node carrying `kind:` is a whole-node replace-or-add at
 * `surfaces/<id>`; one carrying `template:` and no `kind:` is a scalar replace at
 * `surfaces/<id>/template` (R10-R12, Decision 2).
 */
export function mergeSurfaces(
  env: MergeEnv,
  composed: Composed,
  org: YamlDoc | null,
  target: string,
): void {
  const n = countAt(org, ["surfaces"]);
  for (let i = 0; i < n; i++) {
    const el = elementAt(org, ["surfaces"], i);
    const id = env.yaml.alt(el, "id");
    const index = indexById(composed.root, ["surfaces"], id);
    if (env.yaml.has(el, "kind")) {
      replaceOrAppend(composed, ["surfaces"], index, spliced(org, ["surfaces"], el));
      line(env, target, `surfaces/${id}`, index >= 0 ? "replaced" : "added");
      continue;
    }
    if (index >= 0) {
      const surface = seqAt(composed.root, ["surfaces"], false)?.items[index];
      if (
        surface !== undefined &&
        surface.kind === "map" &&
        spliced(org, ["surfaces"], el) !== null
      ) {
        const template = nodeAt(el, ["template"]);
        setEntry(surface, "template", template === null ? nullNode() : fromDoc(template));
      }
    } else {
      replaceOrAppend(composed, ["surfaces"], -1, spliced(org, ["surfaces"], el));
    }
    line(env, target, `surfaces/${id}/template`, index >= 0 ? "replaced" : "added");
  }
}

/**
 * `_merge_guard`: `.guard` carrying `id:` is a whole-node replace at `guard`; carrying
 * `state:` and no `id:` is a scalar replace at `guard/state`; each `.guard.terms[]` entry
 * is its own whole-term replace-or-add at `guard/terms/<id>` (R10-R12, Decision 2).
 */
export function mergeGuard(
  env: MergeEnv,
  composed: Composed,
  org: YamlDoc | null,
  target: string,
): void {
  const { yaml } = env;
  if (!yaml.has(org, "guard")) return;

  if (yaml.has(org, ["guard", "id"])) {
    const had = hasKey(composed.root, ["guard"]);
    if (composed.root !== null) setEntry(composed.root, "guard", fromDoc(nodeAt(org, ["guard"])));
    line(env, target, "guard", had ? "replaced" : "added");
    return;
  }

  if (yaml.has(org, ["guard", "state"])) {
    const had = hasKey(composed.root, ["guard", "state"]);
    const guard = mapAt(composed.root, ["guard"], true);
    if (guard !== null) setEntry(guard, "state", fromDoc(nodeAt(org, ["guard", "state"])));
    line(env, target, "guard/state", had ? "replaced" : "added");
  }

  const n = countAt(org, ["guard", "terms"]);
  for (let i = 0; i < n; i++) {
    const term = elementAt(org, ["guard", "terms"], i);
    const id = yaml.plain(term, "id");
    const index = indexById(composed.root, ["guard", "terms"], id);
    replaceOrAppend(composed, ["guard", "terms"], index, spliced(org, ["guard", "terms"], term));
    line(env, target, `guard/terms/${id}`, index >= 0 ? "replaced" : "added");
  }
}

function removeIndex(composed: Composed, keys: readonly string[], index: number): void {
  seqAt(composed.root, keys, false)?.items.splice(index, 1);
}

/**
 * `_apply_removes`: a `remove:` entry naming `guard` or `guard/terms/<id>` is rejected by
 * the checker (R14) but ignored here (R34, O12). Every other valid address is removed when
 * present, or recorded `no-effect` (R19) when the composed document does not declare it.
 */
export function applyRemoves(
  env: MergeEnv,
  composed: Composed,
  org: YamlDoc | null,
  target: string,
): void {
  const n = countAt(org, ["remove"]);
  for (let i = 0; i < n; i++) {
    const entry = env.yaml.plain(elementAt(org, ["remove"], i), []);
    const done = (removed: boolean): void =>
      line(env, target, entry, removed ? "removed" : "no-effect");
    if (entry === "guard" || entry.startsWith("guard/terms/")) continue;
    if (entry.startsWith("offerings/")) {
      const index = indexById(composed.root, ["offerings"], entry.slice("offerings/".length));
      if (index >= 0) removeIndex(composed, ["offerings"], index);
      done(index >= 0);
    } else if (
      entry.length >= "surfaces//template".length &&
      entry.startsWith("surfaces/") &&
      entry.endsWith("/template")
    ) {
      const sid = entry.slice("surfaces/".length, entry.length - "/template".length);
      const index = indexById(composed.root, ["surfaces"], sid);
      const found =
        index >= 0 ? seqAt(composed.root, ["surfaces"], false)?.items[index] : undefined;
      const surface = found !== undefined && found.kind === "map" ? found : null;
      const has = surface !== null && entryOf(surface, "template") !== undefined;
      if (surface !== null && has) removeEntry(surface, "template");
      done(has);
    } else if (entry.startsWith("surfaces/")) {
      const index = indexById(composed.root, ["surfaces"], entry.slice("surfaces/".length));
      if (index >= 0) removeIndex(composed, ["surfaces"], index);
      done(index >= 0);
    } else if (entry === "guard/state") {
      const guard = mapAt(composed.root, ["guard"], false);
      const has = guard !== null && entryOf(guard, "state") !== undefined;
      if (guard !== null && has) removeEntry(guard, "state");
      done(has);
    }
  }
}
