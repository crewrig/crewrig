// select.ts — R17 floor-plus-ceiling candidate formation and R23 lowest-rank pick
// (check-model-mappings.sh:437-521): the checker's own simulation, over its own
// OFF_* arrays (the shell's are distinct from the library's, so this stays local).

import { bashInteger } from "../model-resolve/ladders.ts";
import { lengthOf, isYqFalsy, type YqNode } from "../yq-accessors/index.ts";
import { strictGet, textOrEmpty, unalias } from "./nodes.ts";
import { INTELLIGENCE_RUNGS } from "./vocab.ts";

export interface Offering {
  id: string;
  rank: string;
  intel: string;
}

const RUNGS = INTELLIGENCE_RUNGS.split(" ");

/** 1-based rung index, or 0 when `name` is no rung (the shell's empty index). */
export const intelIndex = (name: string): number => RUNGS.indexOf(name) + 1;
export const intelNameAt = (idx: number): string => RUNGS[idx - 1] ?? "";

/** `load_offerings`: `.offerings // [] | length`, then three reads per index. */
export function loadOfferings(file: string, doc: YqNode): Offering[] {
  const node = strictGet(file, doc, ["offerings"]);
  const n = isYqFalsy(unalias(node)) ? 0 : lengthOf(unalias(node));
  const out: Offering[] = [];
  for (let i = 0; i < n; i++) {
    const at = (rest: string[]): string =>
      textOrEmpty(strictGet(file, doc, ["offerings", String(i), ...rest]));
    out.push({ id: at(["id"]), rank: at(["rank"]), intel: at(["provides", "intelligence"]) });
  }
  return out;
}

/**
 * The shell's `[ a -lt b ]`. A non-integer operand made `[` print a diagnostic with the
 * script path and line number and read false, then carry on. That diagnostic is not a
 * contract: the twin stops with one `Error: <path>: <reason>` line and exit 1 (spec 0262
 * req 24 (c)); the caller adds the path.
 */
export class RankError extends Error {}
function lessThan(a: string, b: string): boolean {
  const [x, y] = [bashInteger(a), bashInteger(b)];
  if (x === null || y === null) {
    throw new RankError(`offering rank '${x === null ? a : b}' is not an integer`);
  }
  return x < y;
}

function lowestRank(offerings: Offering[], eligible: (idx: number) => boolean): string | null {
  let bestRank = "";
  let bestId: string | null = null;
  for (const o of offerings) {
    const idx = intelIndex(o.intel);
    if (idx === 0 || !eligible(idx)) continue;
    if (bestRank === "" || lessThan(o.rank, bestRank)) {
      bestRank = o.rank;
      bestId = o.id;
    }
  }
  return bestId;
}

/** `select_for_rung`: the selected offering id, or "" when no candidate exists. */
export function selectForRung(offerings: Offering[], declared: number): string {
  const floor = lowestRank(offerings, (idx) => idx >= declared);
  if (floor !== null) return floor;
  const max = Math.max(0, ...offerings.map((o) => intelIndex(o.intel)));
  if (max === 0) return "";
  return lowestRank(offerings, (idx) => idx === max) ?? "";
}
