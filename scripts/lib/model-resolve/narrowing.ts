// narrowing.ts — selection-axis narrowing (rule (d)) and encoded-reasoning
// narrowing (rule (e)).
//
// Twins of model-resolve.sh `_pred_context` (:926), `_pred_locality` (:934),
// `_pred_specialization` (:940), `_pred_speed` (:946), `_pred_modalities` (:952),
// `_narrow_axis` (:1008) and `_narrow_encoded_reasoning` (:1029). Spec 0198 R9-R11,
// R22. The shell mutated the dynamically scoped `CANDIDATES` of `resolve_agent`;
// here `state.candidates` is that array. R2 (spec 0250): this slice moved only
// because the step (b) build depends on it, not as precedent for other consumers.

import { bashInteger, itemIdx, REASONING_RUNGS, rungIndex, rungName } from "./ladders.ts";
import { words } from "./mapping-access.ts";
import { diagDrop, diagNote } from "./diagnostics.ts";
import type { Offering, ResolveState } from "./types.ts";

/** Does an offering satisfy one declared constraint? */
export type Predicate = (offering: Offering, declared: string) => boolean;

const DIGITS = /^[0-9]+$/;

/** `_pred_context`: both sides digits only, `have >= want`; a value past 64 bits is a shell error (false). */
export const predContext: Predicate = (offering, want) => {
  if (!DIGITS.test(offering.context) || !DIGITS.test(want)) return false;
  const have = bashInteger(offering.context);
  const need = bashInteger(want);
  return have !== null && need !== null && have >= need;
};

/** `_pred_locality`: an offering that names none provides `any`. */
export const predLocality: Predicate = (offering, want) => (offering.locality || "any") === want;

/** `_pred_specialization`: an offering that names none provides `general`. */
export const predSpecialization: Predicate = (offering, want) =>
  (offering.specialization || "general") === want;

/** `_pred_speed`: an offering that names none provides `standard`. */
export const predSpeed: Predicate = (offering, want) => (offering.speed || "standard") === want;

/** `_pred_modalities`: every wanted modality is provided; an offering that lists none provides `text`. */
export const predModalities: Predicate = (offering, want) => {
  const have = words(offering.modalities === "" ? "text" : offering.modalities);
  return words(want).every((modality) => have.includes(modality));
};

/**
 * `_narrow_axis`: rule (d)'s one narrowing step (R9, R10). A narrowing that would
 * empty the set is abandoned and recorded as one `unserved-value` drop.
 */
export function narrowAxis(
  state: ResolveState,
  agent: string,
  target: string,
  axis: string,
  declared: string,
  predicate: Predicate,
  has: boolean,
  display: string = declared,
): void {
  if (!has) return;
  const kept = state.candidates.filter((i) => predicate(state.offerings[i], declared));
  if (kept.length === 0) {
    diagDrop(state, agent, target, `metadata.model.${axis}`, display, "unserved-value");
  } else {
    state.candidates = kept;
  }
}

/** The offerings of `candidates` whose encoded reasoning rung has this ladder index. */
function atRung(state: ResolveState, pool: readonly number[], index: number): number[] {
  return pool.filter(
    (i) => rungIndex(REASONING_RUNGS, state.offerings[i].encodedReasoning) === index,
  );
}

/**
 * `_narrow_encoded_reasoning`: rule (e) (R11, R22, D11). Exact rung first, else the
 * nearest rung below, else the nearest above. Directs, never drops; marks the
 * reasoning item directed-by-selection.
 */
export function narrowEncodedReasoning(state: ResolveState, agent: string, target: string): void {
  const encoded = state.candidates.filter((i) => state.offerings[i].encodedReasoning !== "");
  if (encoded.length === 0) return;

  const declared = state.profile.axes.reasoning.value;
  const declIdx = rungIndex(REASONING_RUNGS, declared);
  if (declIdx === 0) return;

  const rungOf = (i: number): number =>
    rungIndex(REASONING_RUNGS, state.offerings[i].encodedReasoning);
  let best = atRung(state, encoded, declIdx);
  if (best.length === 0) {
    const below = Math.max(0, ...encoded.map(rungOf).filter((r) => r > 0 && r < declIdx));
    if (below > 0) best = atRung(state, encoded, below);
  }
  if (best.length === 0) {
    const above = Math.min(...encoded.map(rungOf).filter((r) => r > declIdx), Infinity);
    if (above !== Infinity) best = atRung(state, encoded, above);
  }
  if (best.length === 0) return;

  state.candidates = best;
  const reasoning = itemIdx("reasoning");
  state.disposed[reasoning] = true;
  state.directed[reasoning] = true;
  const matched = rungOf(best[0]);
  if (matched !== declIdx) {
    const name = rungName(REASONING_RUNGS, matched);
    diagNote(
      state,
      agent,
      target,
      "reasoning-rung-substituted",
      `declared=${declared} encoded=${name}`,
    );
  }
}
