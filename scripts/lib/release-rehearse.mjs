// release-rehearse.mjs — Run the release engine's dry run for ONE extension and
// report its computed release as one JSON object (spec 0213 R12, PLAN v2 step 5).
//
// Usage (cwd = the extension directory of the rehearsal clone, which holds the
// generated .releaserc.json):
//   node scripts/lib/release-rehearse.mjs <branch>
//
// Output contract:
//   - stdout carries exactly one line, written after the engine returned:
//       {"released":bool,"version":str|null,"gitTag":str|null,
//        "lastTag":str|null,"notes":str|null}
//     `notes` is the engine's raw markdown (nextRelease.notes), not the
//     terminal-rendered copy the engine logs (plan review v2-F6a).
//   - the engine's own log and its dry-run note are sent to stderr (v1-F7).
//   - exit 0 on a completed rehearsal (released or not), 1 on an engine
//     error, 2 on a refusal.
//
// One process per extension: semantic-release-gitmoji caches its ReleaseNotes
// instance per process (ReleaseNotes.get), so a second extension in the same
// process would render the first one's notes.
//
// Defence in depth (plan review v2-F2): the caller strips every credential
// variable from this process's environment; this script refuses to call the
// engine when one is still present, by the same name rule as
// scripts/lib/monorepo-release-lib.sh release_is_credential_name — the
// release core's own masking pattern, plus CI_REPOSITORY_URL. Only names are
// ever printed. The no-publication guarantee itself rests on the rehearsal
// config having no publish plugin and on every git remote operation being
// redirected to a throwaway local mirror; dry-run also skips every plugin
// step with side effects (prepare, publish, success, fail, addChannel).

import semanticRelease from "semantic-release";

const CREDENTIAL_NAME = /token|password|credential|secret|private/i;

const present = Object.keys(process.env)
  .filter((name) => CREDENTIAL_NAME.test(name) || name === "CI_REPOSITORY_URL")
  .sort();
if (present.length > 0) {
  process.stderr.write(
    `release-rehearse: refusing to run with credential variables present: ${present.join(", ")}\n`,
  );
  process.exit(2);
}

const branch = process.argv[2];
if (!branch) {
  process.stderr.write("Usage: node scripts/lib/release-rehearse.mjs <branch>\n");
  process.exit(2);
}

let result;
try {
  result = await semanticRelease(
    { dryRun: true, branches: [branch] },
    { cwd: process.cwd(), env: process.env, stdout: process.stderr, stderr: process.stderr },
  );
} catch (error) {
  process.stderr.write(`release-rehearse: the release engine failed: ${error && error.message ? error.message : error}\n`);
  process.exit(1);
}

const next = result && result.nextRelease ? result.nextRelease : null;
const last = result && result.lastRelease ? result.lastRelease : null;
process.stdout.write(
  `${JSON.stringify({
    released: Boolean(next),
    version: next ? next.version : null,
    gitTag: next ? next.gitTag : null,
    lastTag: last && last.gitTag ? last.gitTag : null,
    notes: next ? next.notes : null,
  })}\n`,
);
