// mapping-access.ts — the addressing-grammar accessors over a loaded mapping.
//
// Twins of model-resolve.sh `_addr_surface_id` (:516), `mapping_surface_of_kind`
// (:522), `mapping_expresses_item` (:546), `mapping_item_key` (:566),
// `mapping_item_domain_values` (:576), `mapping_item_domain_range` (:586),
// `mapping_reasoning_projection` (:600), `mapping_guidance_template` (:611),
// `mapping_guard_state` (:620), `mapping_guard_holding_terms` (:632),
// `mapping_offerings_load` (:656), `_frontmatter_item_order` (:682) and
// `mapping_item_order` (:699). R2 (spec 0250): this slice moved only because the
// step (b) build depends on it, not as precedent for the other consumers.
//
// The shell re-read the mapping file with `yq` on every call; here a mapping is
// loaded once into a `YamlDoc` and read through the node helpers of yaml-nodes.ts. A
// `null` document stands for an empty or unreadable handle: each accessor then
// degrades to its empty result (spec 0198 R17), never to an error. One deliberate
// divergence: with two surfaces sharing an id (or two items sharing a name on one
// surface), `yq` printed one line per match and the shell's comparisons then failed;
// here the first match is used. The checker rejects both.

import type { YamlText } from "../yaml-text.ts";
import { ITEM_VOCAB_ORDER } from "./ladders.ts";
import type { Offering } from "./types.ts";
import { altOr, countAt, elementAt, fieldEquals, iterate } from "./yaml-nodes.ts";
import type { MappingDoc } from "./yaml-nodes.ts";

/** The first surface carrying this id (`.surfaces[] | select(.id == "<sid>")`). */
function surfaceById(doc: MappingDoc, sid: string): MappingDoc {
  return iterate(doc, ["surfaces"]).find((surface) => fieldEquals(surface, "id", sid)) ?? null;
}

/** The first item of a surface carrying this name (`.items[] | select(.item == "<item>")`). */
function itemOf(doc: MappingDoc, addr: string, item: string): MappingDoc {
  const surface = surfaceById(doc, addrSurfaceId(addr));
  return iterate(surface, ["items"]).find((el) => fieldEquals(el, "item", item)) ?? null;
}

/** `_addr_surface_id`: `surfaces/<id>` or `surfaces/<id>/template` to `<id>`. */
export function addrSurfaceId(addr: string): string {
  const rest = addr.startsWith("surfaces/") ? addr.slice("surfaces/".length) : addr;
  const slash = rest.indexOf("/");
  return slash < 0 ? rest : rest.slice(0, slash);
}

/** `mapping_surface_of_kind`: the first `surfaces/<id>` whose `kind` is `want`, else empty (D15). */
export function surfaceOfKind(yaml: YamlText, doc: MappingDoc, want: string): string {
  const n = countAt(doc, ["surfaces"]);
  for (let i = 0; i < n; i++) {
    const surface = elementAt(doc, ["surfaces"], i);
    if (yaml.alt(surface, "kind") !== want) continue;
    const id = yaml.alt(surface, "id");
    if (id !== "") return `surfaces/${id}`;
  }
  return "";
}

/** `mapping_expresses_item`: does the named surface declare `item`? */
export function expressesItem(
  yaml: YamlText,
  doc: MappingDoc,
  selector: string,
  item: string,
): boolean {
  const addr = surfaceOfKind(yaml, doc, selector);
  if (addr === "") return false;
  const surface = surfaceById(doc, addrSurfaceId(addr));
  const n = countAt(surface, ["items"]);
  for (let i = 0; i < n; i++) {
    if (yaml.alt(elementAt(surface, ["items"], i), "item") === item) return true;
  }
  return false;
}

/** `mapping_item_key`: the frontmatter native key declared for `item`, or empty. */
export function itemKey(yaml: YamlText, doc: MappingDoc, addr: string, item: string): string {
  return yaml.alt(itemOf(doc, addr, item), "key");
}

/** `mapping_item_domain_values`: the closed values of the item's domain, space-joined. */
export function itemDomainValues(
  yaml: YamlText,
  doc: MappingDoc,
  addr: string,
  item: string,
): string {
  return yaml.seq(itemOf(doc, addr, item), ["domain", "values"]).join(" ");
}

/** `mapping_item_domain_range`: `"<type> <min> <max>"` for a ranged domain, else empty. */
export function itemDomainRange(
  yaml: YamlText,
  doc: MappingDoc,
  addr: string,
  item: string,
): string {
  const el = itemOf(doc, addr, item);
  const type = yaml.alt(el, ["domain", "type"]);
  if (type === "") return "";
  return `${type} ${yaml.alt(el, ["domain", "min"])} ${yaml.alt(el, ["domain", "max"])}`;
}

/** `mapping_reasoning_projection`: the native value projected for `rung`, `unmapped`, or empty. */
export function reasoningProjection(
  yaml: YamlText,
  doc: MappingDoc,
  addr: string,
  rung: string,
): string {
  const el = itemOf(doc, addr, "reasoning");
  if (!yaml.has(el, ["projection", rung])) return "";
  return yaml.alt(el, ["projection", rung]);
}

/** `mapping_guidance_template`: the raw template text of a guidance surface, or empty. */
export function guidanceTemplate(yaml: YamlText, doc: MappingDoc, addr: string): string {
  return yaml.alt(surfaceById(doc, addrSurfaceId(addr)), "template");
}

/** `mapping_guard_state`: `withheld`, `directed`, or empty when there is no guard block. */
export function guardState(yaml: YamlText, doc: MappingDoc): string {
  return yaml.has(doc, "guard") ? yaml.alt(doc, ["guard", "state"]) : "";
}

/** `mapping_guard_holding_terms`: comma-separated ids of every term recorded `holds: true`. */
export function guardHoldingTerms(yaml: YamlText, doc: MappingDoc): string {
  if (!yaml.has(doc, "guard")) return "";
  const ids: string[] = [];
  const n = countAt(doc, ["guard", "terms"]);
  for (let i = 0; i < n; i++) {
    const term = elementAt(doc, ["guard", "terms"], i);
    if (yaml.alt(term, "holds") === "true") ids.push(yaml.alt(term, "id"));
  }
  return ids.join(",");
}

/** `mapping_offerings_load`: one entry per offering, in file order. */
export function offeringsLoad(yaml: YamlText, doc: MappingDoc): Offering[] {
  const offerings: Offering[] = [];
  const n = countAt(doc, ["offerings"]);
  for (let i = 0; i < n; i++) {
    const el = elementAt(doc, ["offerings"], i);
    offerings.push({
      id: yaml.alt(el, "id"),
      rank: yaml.alt(el, "rank"),
      native: yaml.alt(el, ["native-value"]),
      intelligence: yaml.alt(el, ["provides", "intelligence"]),
      specialization: yaml.alt(el, ["provides", "specialization"]),
      context: yaml.alt(el, ["provides", "context"]),
      speed: altOr(el, ["provides", "speed"], "standard"),
      locality: altOr(el, ["provides", "locality"], "any"),
      modalities: yaml.seq(el, ["provides", "modalities"]).join(" "),
      encodedReasoning: yaml.alt(el, ["encodes", "reasoning"]),
      supportsReasoningSurface: altOr(el, ["supports-reasoning-surface"], "false"),
    });
  }
  return offerings;
}

/** `_frontmatter_item_order`: the surface's items in declared order, each followed by a space. */
export function frontmatterItemOrder(yaml: YamlText, doc: MappingDoc, fmAddr: string): string {
  if (fmAddr === "") return "";
  const surface = surfaceById(doc, addrSurfaceId(fmAddr));
  let out = "";
  const n = countAt(surface, ["items"]);
  for (let i = 0; i < n; i++) {
    const item = yaml.alt(elementAt(surface, ["items"], i), "item");
    if (item !== "") out += `${item} `;
  }
  return out;
}

/** The shell's unquoted word splitting of a space-separated list. */
export function words(list: string): string[] {
  return list.split(/[ \t\n]+/).filter((word) => word !== "");
}

/**
 * `mapping_item_order`: the frontmatter surface's declared item order, then any
 * guidance-declared item not already listed, then the canonical vocabulary order
 * for anything neither surface names.
 */
export function itemOrder(yaml: YamlText, doc: MappingDoc): string[] {
  let order = frontmatterItemOrder(yaml, doc, surfaceOfKind(yaml, doc, "frontmatter"));
  const listed = (item: string): boolean => ` ${order} `.includes(` ${item} `);
  const gdAddr = surfaceOfKind(yaml, doc, "guidance");
  if (gdAddr !== "") {
    const surface = surfaceById(doc, addrSurfaceId(gdAddr));
    const n = countAt(surface, ["items"]);
    for (let i = 0; i < n; i++) {
      const item = yaml.alt(elementAt(surface, ["items"], i), "item");
      if (item !== "" && !listed(item)) order = `${order} ${item}`;
    }
  }
  for (const item of ITEM_VOCAB_ORDER) if (!listed(item)) order = `${order} ${item}`;
  return words(order.replace(/^ /, ""));
}

export type { MappingDoc };
