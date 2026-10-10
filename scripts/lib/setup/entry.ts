// entry.ts — what the four setup-<cli>-interactive.ts entries build from `process` (spec 0256
// requirement 6). Twins scripts/lib/manage/entry.ts: the entry file is the only anchor of the
// repository, `HOME` (`USERPROFILE` on Windows) is the home, and the streams are the process's own.
// The flow never calls `process.exit`: the entry sets `process.exitCode` from the returned status.

import { buildProcessCtxParts } from "../manage/entry.ts";
import type { SetupDescriptor, StdinLike } from "./descriptor.ts";
import { runSetup } from "./flow.ts";

/** Run one setup for `descriptor`: build the dependencies from `process`, run the flow, return the status. */
export function runSetupEntry(descriptor: SetupDescriptor, entryFile: string): Promise<number> {
  const parts = buildProcessCtxParts(entryFile);
  return runSetup(descriptor, {
    argv: parts.argv,
    stdin: process.stdin as StdinLike,
    stdout: process.stdout,
    stderr: process.stderr,
    env: parts.env,
    platform: parts.platform,
    home: parts.home,
    repoDir: parts.repoDir,
  });
}
