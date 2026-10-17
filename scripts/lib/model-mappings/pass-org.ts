// pass-org.ts — the org-only `remove:` and `replaces-core:` keys
// (check-model-mappings.sh:977-1029; spec 0199 R11, R13-R16): A28, A29, A30, A31.

import { isYqFalsy, lengthOf, tag } from "../yq-accessors/index.ts";
import { hasKey, scalarText, strictGet, unalias } from "./nodes.ts";
import type { PassScope } from "./types.ts";

/** The six address shapes docs/model-mapping-format.md -> "Addressing" publishes (R11). */
const VALID_ADDR =
  /^(offerings\/[^/]+|surfaces\/[^/]+\/template|surfaces\/[^/]+|guard\/terms\/[^/]+|guard\/state|guard)$/;

export function checkOrgOverrides(scope: PassScope): void {
  const { doc, file, fail } = scope;
  let substituting = false;
  if (hasKey(doc, "replaces-core")) {
    const replaces = strictGet(file, doc, ["replaces-core"]);
    if (tag(replaces) !== "!!bool") fail("A31", "replaces-core is not a boolean");
    else substituting = scalarText(replaces) === "true";
  }
  if (!hasKey(doc, "remove")) return;
  const remove = strictGet(file, doc, ["remove"]);
  if (tag(remove) !== "!!seq") {
    fail("A31", "remove is not a sequence");
    return;
  }
  const n = isYqFalsy(unalias(remove)) ? 0 : lengthOf(unalias(remove));
  if (substituting && n > 0) {
    fail(
      "A30",
      "replaces-core substitutes together with a non-empty remove list, which requirement 16 forbids",
    );
  }
  for (let i = 0; i < n; i++) {
    const entry = scalarText(strictGet(file, doc, ["remove", String(i)]));
    if (entry === "guard" || entry.startsWith("guard/terms/")) {
      fail("A29", `remove entry '${entry}' names the guard, which requirement 14 forbids removing`);
    } else if (!VALID_ADDR.test(entry)) {
      fail(
        "A28",
        `remove entry '${entry}' is not an address the addressing grammar of requirement 11 publishes`,
      );
    }
  }
}
