// run.ts — the order of operations and the exit codes of the sync (spec 0253 R19-R21).
// Every module of the port is imported statically here, so loading this file loads the
// whole graph before the first write: the sync rewrites files under scripts/ (R21).

import { readFileSync } from "node:fs";
import { applyPolicies } from "./apply.ts";
import { parseArgs, readCanonicalRepo, repoDirFrom } from "./config.ts";
import { refuseIfDirty } from "./dirty.ts";
import { git, gitInherit } from "./git.ts";
import { parseManifest } from "./manifest.ts";
import { preserveHistory, refuseShallowForPreserve } from "./preserve-history.ts";
import { SyncExit } from "./types.ts";
import type { Ctx, ManifestEntry } from "./types.ts";

const writeOut = (line: string): void => void process.stdout.write(`${line}\n`);
const writeErr = (line: string): void => void process.stderr.write(`${line}\n`);

/** Run the sync; the result is the process exit code. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  entryFile: string,
): Promise<number> {
  try {
    return run(argv, env, entryFile);
  } catch (error) {
    if (error instanceof SyncExit) return error.code;
    writeErr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function run(argv: readonly string[], env: NodeJS.ProcessEnv, entryFile: string): number {
  const repoDir = repoDirFrom(env, entryFile);
  const parsed = parseArgs(argv);
  if (parsed.unknown !== undefined) {
    writeErr(`Error: unknown argument '${parsed.unknown}'`);
    return 1;
  }
  // R12: refused before any fetch, restore or commit, and before the config is read.
  if (parsed.preserveHistory) refuseShallowForPreserve(repoDir, writeErr);

  const canonical = readCanonicalRepo(`${repoDir}/crewrig.config.toml`);
  if (canonical === "") {
    writeErr("Error: canonical_repo is not set in crewrig.config.toml");
    writeErr("Set canonical_repo to the upstream repository URL before running sync.");
    return 1;
  }

  const manifestPath = `${repoDir}/.crewrig/core-paths.txt`;
  let entries: ManifestEntry[];
  try {
    entries = parseManifest(readFileSync(manifestPath, "utf8"));
  } catch {
    writeErr(`Error: cannot read ${manifestPath}`);
    return 1;
  }

  writeOut(`Fetching ${canonical} ...`);
  const fetched = gitInherit(["fetch", canonical]);
  if (fetched !== 0) return fetched;

  const shallow = git(["rev-parse", "--is-shallow-repository"]);
  const ctx: Ctx = {
    repoDir,
    markersDir: `${repoDir}/.crewrig/.synced-markers`,
    manifestPath,
    entries,
    isShallow: shallow.status === 0 && shallow.stdout.replace(/\n+$/, "") === "true",
    out: writeOut,
    err: writeErr,
  };

  refuseIfDirty(ctx);
  applyPolicies(ctx);
  if (parsed.preserveHistory && preserveHistory(ctx) === "noop") return 0;

  writeOut("Sync complete. Review the changes with 'git diff' before committing.");
  return 0;
}
