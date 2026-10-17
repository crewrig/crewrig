// pass-projection.ts — the frontmatter reasoning item's projection
// (check-model-mappings.sh:835-862): A12, A9.

import { hasKey, scalarText, strictGet, truthyTexts, quiet } from "./nodes.ts";
import { get } from "../yq-accessors/index.ts";
import { findItemIndex, findSurfaceIndexByKind } from "./surface-find.ts";
import type { PassScope } from "./types.ts";
import { REASONING_RUNGS } from "./vocab.ts";

export function checkReasoningProjection(scope: PassScope): void {
  const { doc, file, fail } = scope;
  const fidx = findSurfaceIndexByKind(file, doc, "frontmatter");
  if (fidx < 0) return;
  const ridx = findItemIndex(file, doc, fidx, "reasoning");
  if (ridx < 0) return;
  const base = ["surfaces", String(fidx), "items", String(ridx)];
  const item = strictGet(file, doc, base);
  if (!hasKey(item, "projection")) {
    fail("A12", "the frontmatter reasoning item declares no projection");
    return;
  }
  const values = quiet(() => get(item, ["domain", "values"]), null);
  const domValues = truthyTexts(values).join("\n").replace(/\n+$/, "").split("\n");
  const projection = strictGet(file, item, ["projection"]);
  for (const rung of REASONING_RUNGS.split(" ")) {
    if (!hasKey(projection, rung)) {
      fail("A12", `the frontmatter reasoning item's projection is missing rung '${rung}'`);
      continue;
    }
    const img = scalarText(strictGet(file, projection, [rung]));
    if (img !== "unmapped" && !domValues.includes(img)) {
      fail(
        "A9",
        `the frontmatter reasoning item's projection for rung '${rung}' directs '${img}', outside the declared domain`,
      );
    }
  }
}
