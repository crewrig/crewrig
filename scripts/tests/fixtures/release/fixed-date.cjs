// fixed-date.cjs — freezes no-argument `new Date()` / `Date.now()` to a single
// instant, so two release-note renders of the SAME commit history taken at
// different wall-clock moments are byte-identical (spec 0213 R21, PLAN v2
// step 11g). Loaded as a preload, never imported by product code:
//
//   NODE_OPTIONS='--require <this file>' node scripts/lib/release-rehearse.mjs <branch>
//
// A `--require` preload runs before ESM evaluation of the entry module, so
// gitmoji's `{{datetime "UTC:yyyy-mm-dd"}}` helper (which reads `new Date()`
// with no argument) sees the frozen instant no matter which of the two
// configs 11g compares is in play — the seam is entirely in the test harness,
// never in scripts/lib/monorepo-release-lib.sh or release-rehearse.mjs.
//
// `new Date(<explicit arg>)` is left untouched (delegated to the real
// constructor), because semantic-release and its plugins also construct
// dates from commit timestamps and must keep reading the real values.
'use strict';

const FIXED_ISO = process.env.RELEASE_TEST_FIXED_DATE || '2026-01-01T00:00:00.000Z';
const RealDate = Date;

class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(FIXED_ISO);
    } else {
      super(...args);
    }
  }

  static now() {
    return new RealDate(FIXED_ISO).getTime();
  }
}

// eslint-disable-next-line no-global-assign
Date = FixedDate;
