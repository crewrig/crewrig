// node-floor-guard.js — Node.js floor guard (spec 0240 R1-R3, R16).
//
// Plain ES5 CommonJS on purpose: it must parse and run on Node.js releases
// that cannot strip TypeScript types, so it uses no `const`/`let`, no arrow
// function, no template literal and no `import`. It imports nothing — not even
// a built-in module — and touches no file, so a rejected release leaves the
// disk exactly as it found it.
//
// Two ways to use it:
//   node scripts/lib/node-floor-guard.js   exits 1 with one diagnostic line on
//                                           stderr below the floor; exits 0
//                                           silently otherwise.
//   require('./node-floor-guard.js')       same check on load; the exported
//                                           `evaluate` is a pure function.
//
// Stable token: the diagnostic always contains `requires Node.js >= 24`. Two
// assertions depend on it — the `node-floor-guard` CI capability
// (ci/ci-capabilities.yml) and scripts/tests/node-floor-guard.test.ts. Change
// the wording only together with both.
//
// Admitted to the JavaScript ratchet through ci/js-exceptions.txt, category
// `node-floor-guard` (spec 0238 R3).

'use strict';

var FLOOR = 24;
var DOWNLOAD_URL = 'https://nodejs.org/en/download';

/**
 * Decide whether a `process.version`-style string meets the floor.
 * @param {string} versionString e.g. "v24.0.0"
 * @returns {{ ok: boolean, message: string }} `message` is empty when ok.
 */
function evaluate(versionString) {
  var match = /^v?(\d+)\./.exec(String(versionString));
  var major = match ? parseInt(match[1], 10) : NaN;
  if (major >= FLOOR) {
    return { ok: true, message: '' };
  }
  return {
    ok: false,
    message:
      'crewrig: Node.js ' +
      versionString +
      ' detected; crewrig requires Node.js >= ' +
      FLOOR +
      '. Install a supported release from ' +
      DOWNLOAD_URL
  };
}

var verdict = evaluate(process.version);
if (!verdict.ok) {
  process.stderr.write(verdict.message + '\n');
  process.exit(1);
}

module.exports = { FLOOR: FLOOR, evaluate: evaluate };
