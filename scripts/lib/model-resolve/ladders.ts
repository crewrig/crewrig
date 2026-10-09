// ladders.ts — the rung ladders, the item vocabulary and the small index helpers.
//
// Twins of model-resolve.sh `_rung_index` (:34), `_rung_name` (:48), `_int_or_zero`
// (:61), `_item_idx` (:884) and the three constants (:27, :28, :32). Spec 0198
// (spec 0195 R6, R10). R2 (spec 0250): this slice moved only because the step (b)
// build depends on it, not as precedent for the other consumers of the library.

export const INTELLIGENCE_RUNGS: readonly string[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "xxhigh",
  "max",
];

export const REASONING_RUNGS: readonly string[] = ["none", "low", "medium", "high", "xhigh", "max"];

/**
 * The seven-token item vocabulary in the library's canonical fallback order
 * (docs/model-mapping-format.md -> "Item vocabulary").
 */
export const ITEM_VOCAB_ORDER: readonly string[] = [
  "model",
  "reasoning",
  "temperature",
  "top-p",
  "top-k",
  "max-output-tokens",
  "max-turns",
];

/** `_rung_index`: the 1-based index of `rung` in `ladder`, 0 (the shell's empty) when absent. */
export function rungIndex(ladder: readonly string[], rung: string): number {
  const at = ladder.indexOf(rung);
  return at < 0 ? 0 : at + 1;
}

/** `_rung_name`: the rung at a 1-based index, empty when out of range. */
export function rungName(ladder: readonly string[], index: number): string {
  return ladder[index - 1] ?? "";
}

/** `_int_or_zero`: the digits unchanged as a number, `0` for empty or any other text. */
export function intOrZero(text: string): number {
  return /^[0-9]+$/.test(text) ? Number(text) : 0;
}

/** `_item_idx`: the position of `item` in `ITEM_VOCAB_ORDER`, `-1` when it is not a member. */
export function itemIdx(item: string): number {
  return ITEM_VOCAB_ORDER.indexOf(item);
}

const INT64_MAX = 9223372036854775807n;

/**
 * The value a bash `[ a -lt b ]` operand denotes: an optionally signed run of digits
 * that fits a 64-bit integer. `null` is the "integer expression expected" error,
 * which the shell's `[` turned into a false condition.
 */
export function bashInteger(text: string): bigint | null {
  const trimmed = text.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!/^[+-]?[0-9]+$/.test(trimmed)) return null;
  const value = BigInt(trimmed);
  return value > INT64_MAX || value < -INT64_MAX - 1n ? null : value;
}
