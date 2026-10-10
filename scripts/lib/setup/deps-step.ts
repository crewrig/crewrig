// deps-step.ts — the production-dependency step of every setup (spec 0256 requirement 20, plan v2
// step B1.9): the TypeScript twin of `install_production_dependencies` in scripts/lib/common.sh.
// `npm ci --omit=dev --workspaces=false` runs at the repository root, gated on the SHA-256 of
// `package-lock.json` recorded in `.crewrig-state/production-deps.sha256` after the last successful
// run. Layer 1: it runs before any dependency is installed, so it imports the standard library
// only. The caller has already placed the CA variables in `ctx.env`; the child inherits them.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { SetupCtx, Spawner } from "./context.ts";
import { findOnPath } from "../mempalace-python.ts";
import { writeFileAtomic } from "../tmp-file.ts";

export const NPM_CI_ARGV: readonly string[] = ["npm", "ci", "--omit=dev", "--workspaces=false"];

type DepsCtx = Pick<SetupCtx, "io" | "env" | "platform" | "repoDir">;

export interface DepsStepInput {
  readonly ctx: DepsCtx;
  readonly spawn: Spawner;
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** The recorded hash, as `$(cat stamp)` reads it: trailing line feeds dropped; `""` when absent. */
function readStamp(stamp: string): string {
  try {
    return fs.readFileSync(stamp, "utf8").replace(/\n+$/, "");
  } catch {
    return "";
  }
}

/** `rm -f stamp`: a record that cannot be removed is not an error. */
function dropStamp(stamp: string): void {
  try {
    fs.rmSync(stamp, { force: true });
  } catch {
    // The next write or read reports whatever is really wrong.
  }
}

/** Returns 0 on success or skip, 1 when npm is missing or fails (the caller exits on 1). */
export function installProductionDependencies(input: DepsStepInput): number {
  const { ctx, spawn } = input;
  const repoDir = ctx.repoDir;
  const lockfile = path.join(repoDir, "package-lock.json");
  const stateDir = path.join(repoDir, ".crewrig-state");
  const stamp = path.join(stateDir, "production-deps.sha256");

  if (repoDir === "" || !isFile(path.join(repoDir, "package.json"))) {
    ctx.io.err(
      `ERROR: install_production_dependencies: '${repoDir}' is not a repository checkout.`,
    );
    return 1;
  }
  if (findOnPath("npm", { ...ctx.env }, { platform: ctx.platform }) === undefined) {
    ctx.io.err("Error: npm is required but not installed (it ships with Node.js).");
    ctx.io.err("Install Node.js 24 or later from https://nodejs.org/en/download");
    return 1;
  }

  let lockHash = "";
  if (isFile(lockfile)) {
    lockHash = createHash("sha256").update(fs.readFileSync(lockfile)).digest("hex");
  }

  // A removed tree means there is no record of a successful run to trust.
  if (!fs.existsSync(path.join(repoDir, "node_modules"))) dropStamp(stamp);

  if (lockHash !== "" && readStamp(stamp) === lockHash) {
    ctx.io.out(
      `Production dependencies: skipped — package-lock.json unchanged since the last successful install (sha256 ${lockHash.slice(0, 12)}). Delete .crewrig-state/production-deps.sha256 to force a re-install.`,
    );
    return 0;
  }

  // Drop the record BEFORE installing so an interrupted install never leaves a stale one behind.
  dropStamp(stamp);
  ctx.io.out("Production dependencies: running 'npm ci --omit=dev --workspaces=false'...");
  const res = spawn(NPM_CI_ARGV, { cwd: repoDir, inherit: true });
  if (res.status !== 0) {
    // npm's own diagnostic went to the terminal (inherit); a launch failure carries its message here.
    if (res.stderr !== "") ctx.io.errRaw(res.stderr);
    ctx.io.err(
      "ERROR: production dependency install failed — setup aborted; re-run setup once the cause above is fixed.",
    );
    fs.rmSync(path.join(repoDir, "node_modules"), { recursive: true, force: true });
    return 1;
  }

  // A failed write only means the next setup re-runs the step, so it warns rather than aborts.
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    writeFileAtomic(stamp, `${lockHash}\n`);
  } catch {
    ctx.io.err(
      `WARNING: could not record ${stamp} — the next setup run will re-install production dependencies.`,
    );
  }
  return 0;
}
