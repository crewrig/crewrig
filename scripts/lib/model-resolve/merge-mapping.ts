// merge-mapping.ts — `mappingInForce` and the organisation override merge.
//
// Twins of model-resolve.sh `mapping_in_force` (:77), `_org_channel_declares_nothing`
// (:96), `_reorder_merged` (:354), `_emit_duplicate_rank_notes` (:376) and
// `_merge_mapping` (:397). Spec 0199 R8-R9, R15-R17, R20-R28; spec 0250 R20, R33(h).
// R2 (spec 0250): this slice moved only because the step (b) build depends on it,
// not as precedent for the other consumers of the library.
//
// Carrying nulls and quoting (plan finding v1-F2). The merged document is a COPY of
// the core and org nodes, not a typed round trip, so it is built from a text tree
// (merge-tree.ts): structure and the written text of every scalar from the FAILSAFE
// schema, the scalar's type from the CORE schema. Dumping the FAILSAFE tree with
// `dump` was rejected for two reasons measured against js-yaml 4.3.0: an empty value
// loads as `null` and a FAILSAFE `dump` throws on it, which would break "never
// throws"; and every string is written plain, so `"true"`, `"null"`, `"007"` and
// `"1e3"` would reload as a boolean, a null and numbers. A typed CORE round trip was
// rejected too: it writes `min: 0.0` and `max: 2.0` of model-mappings/gemini.yml as
// `0` and `2`. The emitter therefore decides each scalar from its CORE type:
//   - a string (quoted or plain in the source) is written double-quoted, whatever
//     it spells, so it reloads as the same string under CORE and under `yq`;
//   - a number, a boolean or a null (`0.0`, `True`, `~`, `null`) is written with the
//     characters it was written with, so it reloads with the same type and the same
//     text; those spellings are plain scalars with no whitespace, so no quoting
//     question arises;
//   - an empty value (FAILSAFE null) is written empty (`key:` or `-`), so it reads
//     as the empty text and as a null under both readers; an absent node taken from
//     the org file is the spelling `null`, as `yq -o=json` printed it.
// The property: after the file is written and loaded again, by yaml-text's readers
// or by `yq`, every plain, alt, seq, has and entries result over the merged document
// equals the same result over the source documents it was merged from (R33(h): equal
// after loading, not byte-identical). `dump` of the library is deliberately unused.
//
// Two consequences, both inside R33(h): the shell's `yq -o=json` splice normalised a
// non-decimal number (`0x10` became `16`), which this merge keeps as written; and
// yq's multi-type `sort_by` is not a total order (it panics on `0x10`), where the
// reorder here puts numbers before strings and compares strings by code point, the
// order of yq's UTF-8 byte comparison (verified against yq v4.54.1).

import fs from "node:fs";

import { writeFileAtomic } from "../tmp-file.ts";
import type { YamlDoc } from "../yaml-text.ts";
import { countAt, elementAt, loadMapping } from "./yaml-nodes.ts";
import {
  applyRemoves,
  emitSubstitutingDisposition,
  entryOf,
  hasKey,
  mergeGuard,
  mergeOfferings,
  mergeSurfaces,
  removeEntry,
  seqAt,
} from "./merge-ops.ts";
import type { Composed, MergeEnv } from "./merge-ops.ts";
import {
  ensureRoot,
  isFile,
  mappingMergeRoot,
  mappingSha256,
  pathJoin,
  rootState,
} from "./merge-root.ts";
import { emitDocument, fromDoc, newMap } from "./merge-tree.ts";
import type { TNode } from "./merge-tree.ts";
import type { ResolveContext } from "./types.ts";

/** The top-level keys in the order docs/model-mapping-format.md -> "Top level" publishes. */
const TOP_LEVEL = [
  "target",
  "surfaces",
  "offerings",
  "guard",
  "zero-offerings",
  "observed-not-declared",
];

/** `_org_channel_declares_nothing`: no offering, surface, guard, remove entry or substituting replaces-core (R8). */
function orgDeclaresNothing(ctx: ResolveContext, org: string): boolean {
  const doc = loadMapping(ctx.yaml, org);
  return (
    countAt(doc, ["surfaces"]) === 0 &&
    countAt(doc, ["offerings"]) === 0 &&
    !ctx.yaml.has(doc, "guard") &&
    countAt(doc, ["remove"]) === 0 &&
    ctx.yaml.alt(doc, "replaces-core") !== "true"
  );
}

/**
 * `mapping_in_force`: the core mapping alone when the org channel file is absent or
 * declares nothing (R8, R9), otherwise the path of a materialised merge. Empty when
 * neither exists. The only function that derives either mapping path (R2).
 */
export function mappingInForce(ctx: ResolveContext, target: string): string {
  const dir = pathJoin(ctx.platform, ctx.repoDir, "model-mappings");
  const core = pathJoin(ctx.platform, dir, `${target}.yml`);
  const org = pathJoin(ctx.platform, dir, `${target}.org.yml`);
  if (!isFile(org) || orgDeclaresNothing(ctx, org)) return isFile(core) ? core : "";
  return mergeMapping(ctx, core, org, target);
}

/**
 * A composition from a parsed document. An empty or comment-only document composes as an
 * empty mapping (`yq` creates the keys). An unparseable one, a scalar and a sequence have
 * no root: every edit is a no-op and the final document is empty, as `yq` failing was.
 */
function composeFrom(doc: YamlDoc | null): Composed {
  if (doc === null || Array.isArray(doc.core)) return { root: null };
  if (doc.core === undefined || doc.core === null) return { root: newMap() };
  const node = fromDoc(doc);
  return { root: node.kind === "map" ? node : null };
}

const isNullNode = (node: TNode | undefined): boolean =>
  node === undefined || (node.kind === "scalar" && node.core === null);

function field(item: TNode, name: string): TNode | undefined {
  return item.kind === "map" ? entryOf(item, name) : undefined;
}

/** The sort key of a node: its number when CORE typed it so, and its written text. */
function keyOf(node: TNode): { readonly num: number | null; readonly text: string } {
  if (node.kind !== "scalar") return { num: null, text: "" };
  return { num: typeof node.core === "number" ? node.core : null, text: node.text ?? "" };
}

/** Null and absent first, then numbers, then text by code point (the order of yq's UTF-8 compare). */
function compareValues(a: TNode | undefined, b: TNode | undefined): number {
  if (a === undefined || b === undefined || isNullNode(a) || isNullNode(b)) {
    return Number(!isNullNode(a)) - Number(!isNullNode(b));
  }
  const [x, y] = [keyOf(a), keyOf(b)];
  if (x.num !== null && y.num !== null) return x.num === y.num ? 0 : x.num < y.num ? -1 : 1;
  if (x.num !== null || y.num !== null) return x.num !== null ? -1 : 1;
  return Buffer.compare(Buffer.from(x.text), Buffer.from(y.text));
}

/** What `yq -r` prints for a scalar field: absent is `null`, otherwise the written text. */
function printed(node: TNode | undefined): string {
  if (node === undefined) return "null";
  return node.kind === "scalar" ? (node.text ?? "").replace(/\n+$/, "") : "";
}

/**
 * `_emit_duplicate_rank_notes` (R20, R21): one note per colliding rank, in the order
 * the ranks first appear, naming every colliding id in ascending order. yq's
 * `group_by` keys groups by the written text of the rank, in first-appearance order.
 */
function emitDuplicateRankNotes(env: MergeEnv, composed: Composed, target: string): void {
  const groups = new Map<string, TNode[]>();
  for (const item of seqAt(composed.root, ["offerings"], false)?.items ?? []) {
    const key = printed(field(item, "rank"));
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [rank, group] of groups) {
    if (group.length < 2) continue;
    // Sort the items, not their ids: `Array.sort` puts `undefined` last without calling the
    // comparator, and an offering with no id sorts first (as an empty id does in yq).
    const ids = [...group]
      .sort((a, b) => compareValues(field(a, "id"), field(b, "id")))
      .map((item) => {
        const id = field(item, "id");
        return isNullNode(id) ? "" : printed(id);
      });
    env.emit(
      `mapping-merge-note\t${target}\tduplicate-rank\trank=${rank} offerings=${ids.join(",")}`,
    );
  }
}

/**
 * `_reorder_merged` (R26): offerings ascending by (rank, id), the top-level keys in
 * the published order, any key that resolves null dropped, any other key dropped.
 */
function reorderMerged(composed: Composed): string {
  const root = composed.root;
  if (root === null) return "";
  const ordered = newMap();
  for (const key of TOP_LEVEL) {
    const node = entryOf(root, key);
    if (key !== "offerings") {
      if (!isNullNode(node) && node !== undefined) ordered.entries.push([key, node]);
      continue;
    }
    const falsy = isNullNode(node) || (node?.kind === "scalar" && node.core === false);
    // `.offerings // [] | sort_by(...)` is a yq error on anything but a sequence: an empty document.
    if (node?.kind !== "seq" && !falsy) return "";
    const items = node?.kind === "seq" ? node.items : [];
    const sorted = items
      .map((item, i) => ({ item, i }))
      .sort(
        (p, q) =>
          compareValues(field(p.item, "rank"), field(q.item, "rank")) ||
          compareValues(field(p.item, "id"), field(q.item, "id")) ||
          p.i - q.i,
      )
      .map((entry) => entry.item);
    ordered.entries.push([key, { kind: "seq", items: sorted }]);
  }
  return emitDocument(ordered);
}

/** The merge-unavailable degrade of R22: the core mapping alone, nothing when it does not exist. */
function unavailable(ctx: ResolveContext, core: string, target: string, root: string): string {
  ctx.stderr(`mapping-merge-note\t${target}\tmerge-unavailable\troot=${root}`);
  return isFile(core) ? core : "";
}

/** Compose the merged document text (R10-R25, R31). */
function compose(env: MergeEnv, core: string, org: string, target: string): string {
  const orgDoc = loadMapping(env.yaml, org);
  const coreDoc = isFile(core) ? loadMapping(env.yaml, core) : null;
  let composed: Composed;

  if (!isFile(core) || env.yaml.alt(orgDoc, "replaces-core") === "true") {
    // R15, R17: the composition is the org document alone; the core is consulted only,
    // when it exists, to classify the dispositions (D6, C2).
    composed = composeFrom(orgDoc);
    const coreRoot = isFile(core) ? composeFrom(coreDoc).root : null;
    for (const key of ["offerings", "surfaces"] as const) {
      const n = countAt(orgDoc, [key]);
      for (let i = 0; i < n; i++) {
        const el = elementAt(orgDoc, [key], i);
        const id = key === "offerings" ? env.yaml.plain(el, "id") : env.yaml.alt(el, "id");
        emitSubstitutingDisposition(env, target, `${key}/${id}`, [key], id, coreRoot);
      }
    }
    if (env.yaml.has(orgDoc, "guard")) {
      const coreHas = coreRoot !== null && hasKey(coreRoot, ["guard"]);
      env.emit(`mapping-merge\t${target}\tguard\t${coreHas ? "replaced" : "no-effect"}`);
    }
    // R16/A30 forbid `remove:` beside a substituting replaces-core, so an entry reaches
    // here only through the absent-core branch, where every entry is no-effect (R19).
    const n = countAt(orgDoc, ["remove"]);
    for (let i = 0; i < n; i++) {
      env.emit(
        `mapping-merge\t${target}\t${env.yaml.plain(elementAt(orgDoc, ["remove"], i), [])}\tno-effect`,
      );
    }
  } else {
    // R10, R12: start from the core; each org node replaces its addressed core node in
    // place, or is appended when the address is new.
    composed = composeFrom(coreDoc);
    mergeOfferings(env, composed, orgDoc, target);
    mergeSurfaces(env, composed, orgDoc, target);
    mergeGuard(env, composed, orgDoc, target);
    applyRemoves(env, composed, orgDoc, target);
  }

  // The two org-only top-level keys (R31, R25): the merged document is shape-identical
  // to a core mapping, so every accessor reads it unchanged.
  if (composed.root !== null) {
    removeEntry(composed.root, "remove");
    removeEntry(composed.root, "replaces-core");
  }
  emitDuplicateRankNotes(env, composed, target);
  return reorderMerged(composed);
}

/**
 * `_merge_mapping` (R20, R26-R28): the path of the merged document at
 * `<root>/<digest>/<target>.yml`. The cache is the existence of that file: the merge
 * for one target happens at most once per root, and every later resolution reads it.
 * A root the current user does not own is not used (the predictable-name risk); an I/O
 * failure past that guard degrades the same way, so this never throws.
 */
function mergeMapping(ctx: ResolveContext, core: string, org: string, target: string): string {
  const root = mappingMergeRoot(ctx);
  if (rootState(ctx, root) === "foreign") return unavailable(ctx, core, target, root);
  ensureRoot(root);
  if (rootState(ctx, root) !== "owned") return unavailable(ctx, core, target, root);

  const docDir = pathJoin(ctx.platform, root, mappingSha256(target, core, org));
  const out = pathJoin(ctx.platform, docDir, `${target}.yml`);
  if (isFile(out)) return out;
  try {
    fs.mkdirSync(docDir, { recursive: true });
    const env: MergeEnv = { yaml: ctx.yaml, emit: ctx.stderr };
    writeFileAtomic(out, compose(env, core, org, target));
    // The merge counter (R28's proving case): a file, so it survives any process boundary.
    fs.appendFileSync(pathJoin(ctx.platform, root, ".merges"), `${target}\n`);
  } catch {
    return unavailable(ctx, core, target, root);
  }
  return out;
}
