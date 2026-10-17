// pass-grounds.ts — the R5 grounds-list check (check-model-mappings.sh:235-264, 380-435):
// A4, A5, A16, A24, A25, with the A25 resolution rule and its closed aspect vocabulary.

import { get, isYqFalsy, lengthOf, tag, type YqNode } from "../yq-accessors/index.ts";
import { hasKey, isBlank, scalarText, strictGet, textOrEmpty, unalias } from "./nodes.ts";
import type { PassScope } from "./types.ts";
import { CLOSED_ASPECTS, inList } from "./vocab.ts";

/** `resolves_path`: the dotted path resolves to a real value (any tag but empty or `!!null`). */
function resolvesPath(node: YqNode, dotted: string): boolean {
  if (dotted === "") return false;
  const segs = dotted.split(".");
  if (segs.some((s) => s === "")) return false;
  try {
    const t = tag(get(node, segs));
    return t !== "" && t !== "!!null";
  } catch {
    return false;
  }
}

/** `resolves_declares`: the full path resolves, or its last segment is a closed aspect of a resolving prefix. */
export function resolvesDeclares(node: YqNode, declares: string): boolean {
  if (resolvesPath(node, declares)) return true;
  if (!declares.includes(".")) return false;
  const cut = declares.lastIndexOf(".");
  if (!inList(CLOSED_ASPECTS, declares.slice(cut + 1))) return false;
  return resolvesPath(node, declares.slice(0, cut));
}

/** `grounds_kind_for`: the mark kind of the first grounds entry declaring `target`, or "". */
export function groundsKindFor(scope: PassScope, node: YqNode, target: string): string {
  const grounds = strictGet(scope.file, node, ["grounds"]);
  const n = isYqFalsy(unalias(grounds)) ? 0 : lengthOf(unalias(grounds));
  for (let i = 0; i < n; i++) {
    const entry = strictGet(scope.file, node, ["grounds", String(i)]);
    if (textOrEmpty(strictGet(scope.file, entry, ["declares"])) !== target) continue;
    if (hasKey(entry, "citation")) return "citation";
    if (hasKey(entry, "assumption")) return "assumption";
    return "";
  }
  return "";
}

/** A4, A5, A16, A24, A25 over the R5 node `node`. */
export function checkGrounds(scope: PassScope, node: YqNode, label: string): void {
  const { fail, file } = scope;
  const grounds = strictGet(file, node, ["grounds"]);
  const n = isYqFalsy(unalias(grounds)) ? 0 : lengthOf(unalias(grounds));
  if (!hasKey(node, "grounds") || n === 0) {
    fail("A4", `${label} carries no grounds (or an empty grounds list)`);
    return;
  }
  const seen: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    const entry = strictGet(file, node, ["grounds", String(i)]);
    const d = textOrEmpty(strictGet(file, entry, ["declares"]));
    const hc = hasKey(entry, "citation");
    const ha = hasKey(entry, "assumption");
    let kind = "";
    if (hc && ha) {
      fail("A5", `${label} grounds[${i}] (declares '${d}') carries both citation and assumption`);
    } else if (!hc && !ha) {
      fail(
        "A5",
        `${label} grounds[${i}] (declares '${d}') carries neither citation nor assumption`,
      );
    } else {
      kind = hc ? "citation" : "assumption";
      const txt = scalarText(strictGet(file, entry, [kind]));
      if (isBlank(txt)) {
        fail(
          "A16",
          `${label} grounds[${i}] (declares '${d}') ${kind} text is empty or whitespace-only`,
        );
      }
    }
    if (d === "") {
      fail("A25", `${label} grounds[${i}] declares an empty target`);
    } else if (!resolvesDeclares(node, d)) {
      fail(
        "A25",
        `${label} grounds[${i}] declares '${d}', which does not resolve to a declared field (or a closed-vocabulary aspect of one)`,
      );
    }
    if (kind !== "" && d !== "") {
      const prior = seen.find(([t]) => t === d)?.[1] ?? "";
      if (prior !== "" && prior !== kind) {
        fail(
          "A24",
          `${label} carries two grounds entries for '${d}' with different mark kinds (${prior} vs ${kind})`,
        );
      }
      seen.push([d, kind]);
    }
  }
}
