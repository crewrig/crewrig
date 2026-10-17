// surface-find.ts — surface and item lookups (check-model-mappings.sh:293-313, 825-833).

import { get, isYqFalsy, lengthOf, type YqNode } from "../yq-accessors/index.ts";
import { quiet, strictGet, textOrEmpty, truthyTexts, unalias } from "./nodes.ts";

const count = (n: YqNode): number => (isYqFalsy(unalias(n)) ? 0 : lengthOf(unalias(n)));

/** `find_surface_index_by_kind`: the first surface of `kind`, or -1. */
export function findSurfaceIndexByKind(file: string, doc: YqNode, kind: string): number {
  const n = count(strictGet(file, doc, ["surfaces"]));
  for (let i = 0; i < n; i++) {
    if (textOrEmpty(strictGet(file, doc, ["surfaces", String(i), "kind"])) === kind) return i;
  }
  return -1;
}

/** `find_item_index`: the first item of surface `sidx` whose `item` is `want`, or -1. */
export function findItemIndex(file: string, doc: YqNode, sidx: number, want: string): number {
  const base = ["surfaces", String(sidx)];
  const n = count(strictGet(file, doc, [...base, "items"]));
  for (let i = 0; i < n; i++) {
    if (textOrEmpty(strictGet(file, doc, [...base, "items", String(i), "item"])) === want) return i;
  }
  return -1;
}

/** `frontmatter_model_domain`: the frontmatter model item's `domain.values[]` texts, joined by LF. */
export function frontmatterModelDomain(file: string, doc: YqNode): string {
  const fidx = findSurfaceIndexByKind(file, doc, "frontmatter");
  if (fidx < 0) return "";
  const midx = findItemIndex(file, doc, fidx, "model");
  if (midx < 0) return "";
  const values = quiet(
    () => get(doc, ["surfaces", String(fidx), "items", String(midx), "domain", "values"]),
    null,
  );
  return truthyTexts(values).join("\n").replace(/\n+$/, "");
}
