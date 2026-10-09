// resolve-item.ts — rule (g): the per-item eligibility gate and its sub-rules.
//
// Twins of model-resolve.sh `_value_in_domain` (:897) and `_resolve_item` (:1108).
// Spec 0198 R13-R16, R20, R23, R24, R31 (D2, D3, D12, D16). R2 (spec 0250): this
// slice moved only because the step (b) build depends on it, not as precedent.
//
// An item outside the seven-token vocabulary is skipped: `_item_idx` is -1 for it,
// which the shell used as an array subscript (the last element on bash 5, an error on
// bash 3.2). The checker rejects such an item, so no valid mapping reaches it.

import type { YamlText } from "../yaml-text.ts";
import { diagDrop, diagNote } from "./diagnostics.ts";
import { itemIdx } from "./ladders.ts";
import {
  expressesItem,
  guardHoldingTerms,
  itemDomainRange,
  itemDomainValues,
  reasoningProjection,
  words,
} from "./mapping-access.ts";
import type { MappingDoc } from "./mapping-access.ts";
import { declaredValueOf, dottedPath, profileDeclaresItem } from "./profile.ts";
import type { ResolveState } from "./types.ts";

/** awk's string-to-number: the longest decimal prefix, 0 when there is none. */
function awkNumber(text: string): number {
  const match = /^[ \t\n\v\f\r]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(text);
  return match === null ? 0 : Number(match[0].trim());
}

/**
 * `_value_in_domain`: true when in-domain. A ranged domain (`<type> <min> <max>`, split
 * on blanks exactly as awk split it, so an empty `min` shifts `max` left) needs digits
 * and dots only; a values domain needs membership; no domain at all admits anything.
 */
export function valueInDomain(
  yaml: YamlText,
  doc: MappingDoc,
  addr: string,
  item: string,
  value: string,
): boolean {
  const range = itemDomainRange(yaml, doc, addr, item);
  if (range !== "") {
    const [, min = "", max = ""] = words(range);
    if (value === "" || /[^0-9.]/.test(value)) return false;
    if (min !== "" && awkNumber(value) < awkNumber(min)) return false;
    return !(max !== "" && awkNumber(value) > awkNumber(max));
  }
  const domain = itemDomainValues(yaml, doc, addr, item);
  return domain === "" || ` ${domain} `.includes(` ${value} `);
}

/** The fixed inputs of one `resolveAgent` call that every item shares. */
export interface ItemScope {
  readonly yaml: YamlText;
  readonly doc: MappingDoc;
  readonly agent: string;
  readonly target: string;
  readonly fmAddr: string;
  readonly gdAddr: string;
  readonly guardState: string;
}

/**
 * `_resolve_item`: the eligibility gate (g)(0), tested before any mapping property is
 * read, then the first applicable sub-rule of (g)(3)-(g)(8). (g)(2) is handled by
 * `narrowEncodedReasoning`, whose `disposed` mark stops this function re-entering it.
 */
export function resolveItem(scope: ItemScope, state: ResolveState, item: string): void {
  const { yaml, doc, agent, target, fmAddr, gdAddr } = scope;
  const idx = itemIdx(item);
  if (idx < 0 || !profileDeclaresItem(state.profile, item) || state.disposed[idx]) return;

  const isKnob = item !== "model" && item !== "reasoning";
  let expressedFm = fmAddr !== "" && expressesItem(yaml, doc, "frontmatter", item);
  const expressedGd = gdAddr !== "" && expressesItem(yaml, doc, "guidance", item);
  // D2: a frontmatter `model` item is expressible only while the mapping declares an offering.
  if (item === "model" && expressedFm && state.offerings.length === 0) expressedFm = false;

  // The guard withholds the `model` item's FRONTMATTER surface (R20/R31); folded into
  // expressibility so a mapping with no guidance surface drops unsupported-on-cli (C10).
  const guardSuppressed = item === "model" && scope.guardState === "withheld";
  let fmOk = expressedFm && !guardSuppressed;
  const drop = (path: string, declared: string, reason: string): void => {
    diagDrop(state, agent, target, path, declared, reason);
    state.disposed[idx] = true;
  };

  // (g)(3): expressibility; D16 narrows a tuning knob to frontmatter only.
  if (!fmOk && (isKnob || !expressedGd)) {
    return drop(dottedPath(item), declaredValueOf(state.profile, item), "unsupported-on-cli");
  }

  const reasoning = state.profile.axes.reasoning.value;
  // (g)(4): the selected offering refuses the surface, or none was selected (D12).
  if (
    item === "reasoning" &&
    expressedFm &&
    (state.offeringId === "" || state.offeringSrs !== "true")
  ) {
    return drop("metadata.model.reasoning", reasoning, "unsupported-on-model");
  }

  // (g)(5): a rung the projection declares unmapped.
  let projection = "";
  if (item === "reasoning" && expressedFm) {
    projection = reasoningProjection(yaml, doc, fmAddr, reasoning);
    if (projection === "unmapped")
      return drop("metadata.model.reasoning", reasoning, "out-of-range-for-target");
  }

  // (g)(6): a tuning knob's declared value outside the frontmatter surface's domain.
  const declared = declaredValueOf(state.profile, item);
  if (isKnob && !valueInDomain(yaml, doc, fmAddr, item, declared)) {
    return drop(dottedPath(item), declared, "out-of-range-for-target");
  }

  // (g)(7)/(g)(8): direct. A suppressed `model` reaching here has a guidance surface (g)(3).
  state.disposed[idx] = true;
  state.directed[idx] = true;
  if (guardSuppressed) {
    const terms = guardHoldingTerms(yaml, doc);
    diagNote(state, agent, target, "guard-withheld", `terms=${terms} surface=guidance`);
  }

  if (item === "model") {
    const domain = fmOk ? itemDomainValues(yaml, doc, fmAddr, "model") : "";
    if (domain !== "" && !` ${domain} `.includes(` ${state.nativeValue} `)) {
      const detail = `offering=${state.offeringId} native-value=${state.nativeValue} outside the frontmatter model key's declared domain`;
      diagNote(state, agent, target, "unreadable-cell", detail);
      fmOk = false;
    }
    state.value[idx] = state.nativeValue;
  } else {
    state.value[idx] = item === "reasoning" ? projection : declared;
  }
  state.fm[idx] = fmOk;
  state.gd[idx] = expressedGd;
}
