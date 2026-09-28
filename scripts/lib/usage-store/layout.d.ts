// layout.d.ts — hand-written declaration file for the untouched CommonJS
// baseline scripts/lib/usage-store/layout.js (spec 0238 TypeScript rewrite of
// issue #1206; see scripts/lib/usage-store/inventory.ts's own header for why
// a sibling .d.ts, rather than a tsconfig change or a conversion of the
// module it describes, is the chosen JS-interop shape).
//
// layout.js is NOT converted to TypeScript by this ticket — out of scope,
// and it stays exactly as-is (see inventory.ts's header). This file declares
// ONLY the one export inventory.ts actually calls, `period()`; every other
// export layout.js makes (resolveRoot, journalRoot, mirrorDir, ...) is
// unused by this ticket's TypeScript surface and is deliberately left
// undeclared here — a partial declaration file is valid TypeScript and adds
// no obligation to describe exports nothing imports.
//
// `scripts/check-ratchet.ts`'s own ts-scope.ts classifies a file by its
// `.ts` extension for the shell/JS ratchet's ledger; `isJsFile()`
// (scripts/lib/ts-scope.ts) matches only `\.(js|mjs|cjs)$`, so a `.d.ts`
// path — ending in `.ts`, not `.js`/`.mjs`/`.cjs` — is never classified as a
// JavaScript file and never needs a `ci/js-baseline.txt` entry. Verified by
// inspection of that regex, not assumed.

/**
 * The UTC `YYYY-MM` period a usage record's own `timing.requestInstant`
 * falls in — the exact function scripts/lib/usage-store/prune.js's own
 * derived-store walk already reuses. Throws a `TypeError` when
 * `record.timing` itself is missing (property access on `undefined`); a
 * present-but-unparseable `requestInstant` yields an `Invalid Date` and a
 * non-matching `"NaN-NaN"` string instead of a throw — inventory.ts's own
 * confirmDrawer() covers both cases by validating the RETURNED string
 * against its PERIOD_RE, exactly as inventory.js did.
 */
export function period(record: { timing: { requestInstant: string } }): string;
