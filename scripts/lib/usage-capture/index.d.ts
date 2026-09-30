// index.d.ts — hand-written declaration file for the untouched CommonJS
// baseline scripts/lib/usage-capture/index.js (spec 0243 R1, R3, R11); see
// cursor.d.ts for the sibling-declaration precedent.
//
// Declares only the two exports index.js makes. `capture` never throws: its
// whole body runs inside one try/catch that turns a failure into an
// `uncaptured` record (spec 0206 R16).

/** The argument of `capture`. `payload` is whatever the CLI sent, parsed. */
export interface CaptureInput {
  readonly cli: string | null | undefined;
  readonly event: string | null | undefined;
  readonly payload: unknown;
}

/** Derive the records for one firing and hand each to the storage boundary. */
export function capture(input: CaptureInput): void;

/** Resolve a record's attribution and submit it; never throws. */
export function submit(rec: unknown, ctx: unknown): unknown;
