// gitmoji-esm-shim.mjs — ESM-visible facade over semantic-release-gitmoji
// (issue #1225).
//
// semantic-release-monorepo wraps its analyzeCommits, generateNotes, success
// and fail steps through semantic-release-plugin-decorators' wrapStep, which
// resolves each plugin with `await import(pluginName)` and reads
// `plugin[stepName]` off the ESM namespace. semantic-release-gitmoji is
// CommonJS (`module.exports = { analyzeCommits: require(...), generateNotes:
// require(...) }`); Node's CJS named-export detection only surfaces
// `analyzeCommits` from that literal, so `generateNotes` was never found and
// every extension release shipped an empty note.
//
// This module loads the CJS package unchanged and re-exports every step it
// provides as a named ESM export. scripts/monorepo-release.sh references it by
// absolute path in place of the bare package name; the plugin options
// (releaseRules) are passed through untouched, so version computation is the
// package's own.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const gitmoji = require('semantic-release-gitmoji');

export const { analyzeCommits, generateNotes } = gitmoji;

// Fail loudly if an upgrade of the package adds, renames or drops a step, so
// this facade can never again hide a step from the engine silently.
const exported = ['analyzeCommits', 'generateNotes'];
const provided = Object.keys(gitmoji).filter((k) => typeof gitmoji[k] === 'function');
const drift = provided.filter((k) => !exported.includes(k))
  .concat(exported.filter((k) => !provided.includes(k)));
if (drift.length) {
  throw new Error(
    `gitmoji-esm-shim: semantic-release-gitmoji step set changed (${drift.join(', ')}); update scripts/lib/release-notes/gitmoji-esm-shim.mjs`
  );
}
