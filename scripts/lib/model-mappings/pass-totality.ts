// pass-totality.ts — selection totality and the zero-offerings / observed-not-declared
// blocks (check-model-mappings.sh:942-975): A11, A3, A15.

import { isYqFalsy, lengthOf } from "../yq-accessors/index.ts";
import { hasKey, strictGet, unalias } from "./nodes.ts";
import { checkClosedKeys, checkRequiredKeys } from "./pass-shape.ts";
import { intelNameAt, loadOfferings, selectForRung } from "./select.ts";
import type { PassScope } from "./types.ts";

/** A11: every one of the seven rungs selects an offering (R17, R23). */
export function checkSelectionTotality(scope: PassScope): void {
  const offerings = loadOfferings(scope.file, scope.doc);
  if (offerings.length === 0) return;
  for (let rung = 1; rung <= 7; rung++) {
    if (selectForRung(offerings, rung) === "") {
      scope.fail("A11", `no offering is selected at intelligence rung '${intelNameAt(rung)}'`);
    }
  }
}

export function checkZeroOfferingsAndObserved(scope: PassScope): void {
  const { doc, file, fail } = scope;
  if (hasKey(doc, "zero-offerings")) {
    const zero = strictGet(file, doc, ["zero-offerings"]);
    checkRequiredKeys(zero, "ground condition grounds", "zero-offerings", fail);
    checkClosedKeys(zero, "ground condition grounds", "zero-offerings", fail);
  }
  if (hasKey(doc, "observed-not-declared")) {
    const list = strictGet(file, doc, ["observed-not-declared"]);
    const n = isYqFalsy(unalias(list)) ? 0 : lengthOf(unalias(list));
    for (let i = 0; i < n; i++) {
      const node = strictGet(file, doc, ["observed-not-declared", String(i)]);
      const label = `observed-not-declared[${i}]`;
      checkRequiredKeys(node, "native-value ground grounds", label, fail);
      checkClosedKeys(node, "native-value ground grounds", label, fail);
    }
  }
}
