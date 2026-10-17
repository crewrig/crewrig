// pass-guard.ts — the guard block (check-model-mappings.sh:864-940): A13, A14a, A14b,
// A15, A22, A23, A32, with the org-file relaxations of spec 0199 R30 / Decision 2.

import { isYqFalsy, lengthOf } from "../yq-accessors/index.ts";
import { hasKey, isBlank, strictGet, textOrEmpty, unalias } from "./nodes.ts";
import { checkGrounds, groundsKindFor } from "./pass-grounds.ts";
import { checkClosedKeys, checkRequiredKeys } from "./pass-shape.ts";
import type { PassScope } from "./types.ts";
import { inList } from "./vocab.ts";

const TERM_KEYS = "id statement holds evidence grounds";

export function checkGuard(scope: PassScope): void {
  const { doc, file, fail, isOrg } = scope;
  const target = textOrEmpty(strictGet(file, doc, ["target"]));
  const hasGuard = hasKey(doc, "guard");
  // A13 binds the CORE mapping alone.
  if (!isOrg && target === "claude" && !hasGuard) {
    fail("A13", "target is claude but declares no guard block");
  }
  if (!hasGuard) return;
  const guard = strictGet(file, doc, ["guard"]);

  let hasId = true;
  if (isOrg) {
    hasId = hasKey(guard, "id");
    if (!hasId && !hasKey(guard, "state")) {
      fail(
        "A32",
        "guard carries neither id nor state — it occupies no address the addressing grammar publishes",
      );
    }
  }
  // A `guard/state` sub-node override (no `id:`) relaxes the node's required keys.
  if (!isOrg || hasId) checkRequiredKeys(guard, "id spec state terms", "guard", fail);
  checkClosedKeys(guard, "id spec state terms", "guard", fail);

  const state = textOrEmpty(strictGet(file, guard, ["state"]));
  if (!inList("withheld directed", state)) {
    fail("A22", `guard.state '${state}' is outside withheld|directed`);
  }
  const terms = strictGet(file, guard, ["terms"]);
  const nterms = isYqFalsy(unalias(terms)) ? 0 : lengthOf(unalias(terms));
  if ((!isOrg || hasId) && nterms !== 2) {
    fail("A22", `guard.terms has ${nterms} entries; exactly two are required`);
  }

  let anyHolds = false;
  const ids: string[] = [];
  const nodes = [];
  for (let i = 0; i < nterms; i++) {
    const term = strictGet(file, guard, ["terms", String(i)]);
    const tid = textOrEmpty(strictGet(file, term, ["id"])) || `[${i}]`;
    const label = `guard/terms/${tid}`;
    checkRequiredKeys(term, TERM_KEYS, label, fail);
    checkClosedKeys(term, TERM_KEYS, label, fail);
    checkGrounds(scope, term, label);
    if (textOrEmpty(strictGet(file, term, ["holds"])) === "true") anyHolds = true;
    ids.push(tid);
    nodes.push(term);
  }

  if (state === "withheld" && nterms > 0 && !anyHolds) {
    fail("A23", "guard.state is withheld but no term holds");
  }
  if (state === "directed" && anyHolds) {
    fail("A23", "guard.state is directed but at least one term holds");
  }
  if (state === "directed") {
    nodes.forEach((term, i) => {
      const tid = ids[i];
      if (isBlank(textOrEmpty(strictGet(file, term, ["evidence"])))) {
        fail(
          "A14a",
          `guard/terms/${tid} evidence is absent or empty while guard.state is directed`,
        );
      }
      const kind = groundsKindFor(scope, term, "holds");
      if (kind !== "citation") {
        fail(
          "A14b",
          `guard/terms/${tid} holds ground is '${kind || "absent"}', not a citation, while guard.state is directed`,
        );
      }
    });
  }
}
