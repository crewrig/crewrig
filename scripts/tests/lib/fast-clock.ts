// fast-clock.ts — an `--import` preload for the launcher tests (plan of issue #2101, v2 step 4).
//
// The launcher arms its 30 s inactivity timer and its 300 s total deadline through
// `globalThis.setTimeout`, read when each timer is armed (spec 0314 R8). This preload divides every
// `setTimeout` delay of 1000 ms or more by 200, so those two limits become 150 ms and 1.5 s while the
// launcher file runs unmodified. Shorter delays (the rename backoff) and `Date.now` stay real.
//
// Usage: node --import <this file as a file: URL> <launcher> ...

const SPEEDUP = 200;
const THRESHOLD_MS = 1000;

const realSetTimeout = globalThis.setTimeout;

function scaled(delay: number | undefined): number | undefined {
  return delay !== undefined && delay >= THRESHOLD_MS ? delay / SPEEDUP : delay;
}

const fastSetTimeout = (handler: () => void, delay?: number): ReturnType<typeof realSetTimeout> =>
  realSetTimeout(handler, scaled(delay));

globalThis.setTimeout = Object.assign(
  fastSetTimeout,
  realSetTimeout,
) as typeof globalThis.setTimeout;

export {};
