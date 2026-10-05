// clock.ts — wall-clock timestamps for claims and ledger lines (spec 0248 R18).
//
// UTC, second precision, the two spellings the shell tool wrote with
// `date -u +%s` and `date -u +%Y-%m-%dT%H:%M:%SZ`. The source is injectable so
// in-process tests can age a claim without sleeping.

let source: () => number = () => Date.now();

/** Replace the millisecond clock (tests only). */
export function setClock(now: () => number): void {
  source = now;
}

/** Restore the system clock. */
export function resetClock(): void {
  source = () => Date.now();
}

/** Whole seconds since the Unix epoch. */
export function nowEpoch(): number {
  return Math.floor(source() / 1000);
}

/** ISO 8601 UTC, second precision, trailing `Z`: `2026-10-05T17:57:29Z`. */
export function nowIso(): string {
  return new Date(nowEpoch() * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
