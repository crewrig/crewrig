// types.ts — the shared shapes of the TypeScript port of scripts/sync-from-upstream.sh
// (spec 0253 R19-R21). Every module of this directory takes a `Ctx` and reports through
// its two line writers, so a message keeps the stream the shell script wrote it to.
//
// MODULE CONTRACT (the port is split one concern per file, each at most 300 lines):
//   config.ts            parseArgs, readCanonicalRepo, repoDirFrom
//   manifest.ts          parseManifest, excludedChildrenOf, pathspecFor, isUnderExcluded, pathIsGoverned
//   blobs.ts             blobSha, upstreamHasBlob, resolvesAtFetchHead, objectTypeAtFetchHead,
//                        strictBlobIsDirty, pathInOrgHistory, readMarker, writeMarker, blobEntryDecision
//   org-components.ts    isOrgComponentOutput
//   reconcile.ts         reconcileMember, reconcileDir
//   dirty.ts             collectDirty, refuseIfDirty
//   apply.ts             applyPolicies
//   preserve-history.ts  refuseShallowForPreserve, preserveHistory
//   run.ts               main (the order of operations and the exit codes)
//
// EXIT CODES: a module that stops the sync prints its message(s) through `ctx.err` and
// throws `SyncExit(code)`; `run.ts` turns it into the process exit code. A git command
// the shell ran unguarded under `set -e` and that fails ends the run with git's own status
// (`SyncExit(status)`), exactly as `set -e` did.
//
// CWD RULE: the shell script ran some git commands in the process working directory
// (no `-C`) and others against REPO_DIR (`git -C "$REPO_DIR"` or `cd "$REPO_DIR" &&`).
// The port keeps each one where it was: `git()` below runs in the process cwd unless a
// `cwd` is given. Do not "normalise" it.

export interface ManifestEntry {
  readonly path: string;
  /** The policy column as written; an unknown value is rejected by apply.ts, as the shell did. */
  readonly policy: string;
}

export interface Ctx {
  readonly repoDir: string;
  /** `<repoDir>/.crewrig/.synced-markers` */
  readonly markersDir: string;
  readonly manifestPath: string;
  readonly entries: readonly ManifestEntry[];
  /** `git rev-parse --is-shallow-repository` (process cwd) read after the fetch; false on failure. */
  readonly isShallow: boolean;
  /** One line to standard output (newline added). */
  readonly out: (line: string) => void;
  /** One line to standard error (newline added). */
  readonly err: (line: string) => void;
}

/** Thrown to end the sync with `code`, after the message was already printed. */
export class SyncExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`sync-from-upstream exit ${code}`);
    this.code = code;
  }
}
