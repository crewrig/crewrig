// staging.ts — the `--check` staging root and the cleanup of temporary roots (spec 0250
// R8, R16).
//
// Twins scripts/build-components.sh `CHECK_STAGING_ROOT` (:503), its creation (:1095-1097,
// `mktemp -d -t crewrig-check-staging.XXXXXX`) and `cleanup_check_staging` with its EXIT
// trap (:504-517), which also removed the merged-mapping root the model library derived
// (`mapping_merge_cleanup`, spec 0199 R27). The shell's trap ran on every exit and on a
// fatal signal; the same holds here through three paths, all idempotent:
//   - `dispose()`, which `main.ts` calls from a `finally` (normal return and exceptions);
//   - a `process.once("exit")` hook (a stray throw that skips the `finally`);
//   - `SIGINT` and `SIGTERM` handlers, which clean up, remove themselves and raise the
//     signal again so the process still dies by it (status 130 / 143, as under bash).
// A handler can only run when the event loop turns: `main.ts` yields between tiers, so a
// signal is honoured at the next tier boundary rather than in the middle of a tier.
//
// The staging root is local to this module (no shared directory helper, R16): a directory
// under `TMPDIR` or the platform temporary directory, mode 0700, with a random suffix. The
// merge root is the model library's to name; `mappingMergeCleanup` removes it only when the
// library derived it (spec 0199 D11), never a `MAPPING_MERGE_DIR` the caller owns.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mappingMergeCleanup } from "../model-resolve.ts";
import type { ResolveContext } from "../model-resolve.ts";
import type { BuildState, Env } from "./types.ts";

const PREFIX = "crewrig-check-staging-";

/** Create the `--check` staging root: `0700`, collision-free, under `TMPDIR` or `os.tmpdir()`. */
export function createStagingRoot(env: Env): string {
  const tmp = env["TMPDIR"];
  const base = tmp !== undefined && tmp !== "" ? tmp : os.tmpdir();
  return fs.mkdtempSync(path.join(base, PREFIX));
}

/** What `main.ts` holds on to: running the cleanup now, and withdrawing the hooks. */
export interface Cleanup {
  dispose(): void;
}

/**
 * Install the cleanup of the staging root (`state.stagingRoot`, read when it runs) and of
 * the derived merge root. Call `dispose()` when the run ends; it is safe to call twice.
 */
export function installCleanup(state: BuildState, model: ResolveContext): Cleanup {
  const run = (): void => {
    if (state.stagingRoot !== "") {
      try {
        fs.rmSync(state.stagingRoot, { recursive: true, force: true });
      } catch {
        // the shell's `rm -rf` ignored failures and the trap returned 0
      }
      state.stagingRoot = "";
    }
    mappingMergeCleanup(model);
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    withdraw();
    run();
    process.kill(process.pid, signal);
  };
  const withdraw = (): void => {
    process.off("exit", run);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  process.once("exit", run);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return {
    dispose() {
      withdraw();
      run();
    },
  };
}
