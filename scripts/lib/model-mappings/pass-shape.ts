// pass-shape.ts — the target, top-level shape and duplicate-id assertions
// (check-model-mappings.sh:354-378, 525-589): A1, A2, A3, A6, A7, A15.

import { fieldValues, hasKey, keyList, strictGet, textOrEmpty } from "./nodes.ts";
import { type YqNode } from "../yq-accessors/index.ts";
import type { Fail, PassScope } from "./types.ts";
import { inList, TARGET_VOCAB } from "./vocab.ts";

/** A3: every key of `node` is in the closed set `allowed`. */
export function checkClosedKeys(node: YqNode, allowed: string, label: string, fail: Fail): void {
  for (const k of keyList(node)) {
    if (k === "") continue;
    if (!inList(allowed, k)) fail("A3", `${label} carries key '${k}', outside its closed key set`);
  }
}

/** A15: every key of `required` is present on `node`. */
export function checkRequiredKeys(node: YqNode, required: string, label: string, fail: Fail): void {
  for (const r of required.split(" ")) {
    if (!hasKey(node, r)) fail("A15", `${label} is missing required key '${r}'`);
  }
}

/** A1, A2: the declared target is in the vocabulary and agrees with the filename stem. */
export function checkTarget(scope: PassScope, wantTarget: string, file: string): void {
  const target = textOrEmpty(strictGet(file, scope.doc, ["target"]));
  if (!inList(TARGET_VOCAB, target)) {
    scope.fail("A1", `target '${target}' is not one of {${TARGET_VOCAB}}`);
  }
  if (target !== wantTarget) {
    scope.fail("A2", `target '${target}' disagrees with filename stem '${wantTarget}'`);
  }
}

/** A15, A3 on the document root; an org file's required set reduces to `target`. */
export function checkToplevelShape(scope: PassScope): void {
  const base = "target surfaces offerings guard zero-offerings observed-not-declared";
  const label = "the top-level document";
  if (scope.isOrg) {
    checkRequiredKeys(scope.doc, "target", label, scope.fail);
    checkClosedKeys(scope.doc, `${base} remove replaces-core`, label, scope.fail);
  } else {
    checkRequiredKeys(scope.doc, "target surfaces offerings", label, scope.fail);
    checkClosedKeys(scope.doc, base, label, scope.fail);
  }
}

function dupes(values: string[], what: string, id: string, fail: Fail): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) fail(id, `duplicate ${what} '${v}'`);
    seen.add(v);
  }
}

/** A6 for offerings, surfaces and guard terms, then A7 for offering ranks. */
export function checkDuplicateIdsAndRanks(scope: PassScope): void {
  const { doc, fail } = scope;
  dupes(fieldValues(doc, ["offerings"], "id"), "offering id", "A6", fail);
  dupes(fieldValues(doc, ["surfaces"], "id"), "surface id", "A6", fail);
  dupes(fieldValues(doc, ["guard", "terms"], "id"), "guard term id", "A6", fail);
  dupes(fieldValues(doc, ["offerings"], "rank"), "offering rank", "A7", fail);
}
