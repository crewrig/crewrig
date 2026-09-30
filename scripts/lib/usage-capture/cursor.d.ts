// cursor.d.ts — hand-written declaration file for the untouched CommonJS
// baseline scripts/lib/usage-capture/cursor.js (spec 0243 R1, R8, R11), the
// same sibling-declaration shape scripts/lib/usage-store/layout.d.ts
// establishes. `isJsFile()` in scripts/lib/ts-scope.ts matches only
// `.js/.mjs/.cjs`, so this file needs no ci/js-baseline.txt entry.
//
// Declares only what hooks/usage-capture.ts and
// hooks/antigravity-statusline-shim.ts call: the three definitions the entry
// guard shares with the capture step (usage root, source key, stamp path), so
// no entry carries a copy of them.

/** `CREWRIG_USAGE_ROOT` when set and non-empty, else `<home>/.crewrig/usage`. */
export function usageRoot(): string;

/** Lowercase SHA-256 hex digest of the source's own path, no salt. */
export function sourceKey(sourcePath: string): string;

/** `<usage root>/state/<cli>/<sourceKey>.stamp`. */
export function stampPath(cli: string, sourcePath: string): string;
