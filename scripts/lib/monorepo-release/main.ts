// main.ts — the driver's top level (spec 0257 R13, R14, R19). Replaced the preflight, the dispatch and
// the summary of the former scripts/monorepo-release.ts: the forge, the mode, the branch, the identity and the
// credential are resolved up front and every refusal exits 2 before anything is written (spec 0213
// R10); then the flow of the mode runs and the summary decides the exit status. The entry file only
// forwards the process; every effect it needs arrives through `input` and `deps`.

import path from "node:path";

import { assertNotReleasePrBranch, gitBranch, releaseBranch } from "./branch.ts";
import type { ReleaseCtx } from "./context.ts";
import { resolveCredential } from "./credentials.ts";
import { ReleaseFailure } from "./failure.ts";
import { assertNoCrewrigExtension } from "./extension-dirs.ts";
import { realDeps } from "./flow-deps.ts";
import type { FlowDeps } from "./flow-deps.ts";
import { releaseGithub } from "./flow-github.ts";
import { releasePublish } from "./flow-gitlab.ts";
import { releaseRehearse } from "./flow-rehearsal.ts";
import { detectForge, requireForgeVariables } from "./forge.ts";
import { applyIdentity } from "./identity.ts";
import { releaseMode } from "./mode.ts";
import { ReleaseRefusal } from "./refusal.ts";
import { createScratch, installCleanup } from "./scratch.ts";
import type { Scratch } from "./scratch.ts";

export interface MainIo {
  /** One line on standard output. */
  out(line: string): void;
  /** One line on standard error. */
  err(line: string): void;
  /** A raw chunk on standard error (the engine's own log). */
  errRaw(text: string): void;
  /** A raw chunk on standard output (the teed engine output); a line per chunk when absent. */
  outRaw?(text: string): void;
}

export interface MainInput {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** The checkout the release runs in (the shell's `pwd`). */
  readonly cwd: string;
  /** The driver's own entry file: its directory is the `scripts/` directory of the checkout. */
  readonly entryFile: string;
  readonly io: MainIo;
}

/** The environment the children get: identity defaults and credential applied, NODE_PATH set. */
function childEnv(
  env: NodeJS.ProcessEnv,
  extra: readonly Record<string, string>[],
  rootDir: string,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...env };
  for (const entries of extra) Object.assign(merged, entries);
  merged["NODE_PATH"] = path.join(rootDir, "node_modules");
  return merged;
}

export async function main(input: MainInput, deps: FlowDeps = realDeps): Promise<number> {
  const { env, io } = input;
  let scratch: Scratch | undefined;
  let uninstall: (() => void) | undefined;
  try {
    // Preflight, in the shell's order: forge -> mode -> branch -> identity -> forge variables -> credential.
    const forge = detectForge(env);
    const mode = releaseMode(env);
    const branch = releaseBranch(forge, env, () => gitBranch(input.cwd));
    const identity = applyIdentity(forge, env);
    requireForgeVariables(forge, env);
    let credential: Record<string, string> = {};
    if (mode === "publish") {
      assertNotReleasePrBranch(forge, branch);
      credential = resolveCredential(forge, env);
    }

    assertNoCrewrigExtension(input.cwd);

    io.out(`Forge: ${forge}`);
    io.out(`Mode: ${mode}`);
    io.out(`Branch: ${branch}`);

    // One scratch root for the whole run, removed on exit and on a signal.
    let aborted = false;
    scratch = createScratch();
    uninstall = installCleanup(scratch, {
      onSignal: () => {
        aborted = true;
      },
    });
    const ctx: ReleaseCtx = {
      forge,
      mode,
      branch,
      rootDir: input.cwd,
      scriptsDir: path.dirname(input.entryFile),
      env: childEnv(env, [identity, credential], input.cwd),
      platform: input.platform,
      out: io.out,
      err: io.err,
      outRaw: io.outRaw ?? ((text) => io.out(text.replace(/\n$/, ""))),
      errRaw: io.errRaw,
      scratch,
      errors: 0,
      aborted: () => aborted,
    };

    if (mode === "rehearsal") await releaseRehearse(ctx, deps);
    else if (forge === "github") await releaseGithub(ctx, deps);
    else await releasePublish(ctx, undefined, deps);

    // A signal already recorded the conventional exit code; the summary would hide it.
    if (aborted) return typeof process.exitCode === "number" ? process.exitCode : 1;
    io.out("");
    if (ctx.errors !== 0) {
      io.out("Release analysis completed WITH ERRORS.");
      return 1;
    }
    io.out("Release analysis completed successfully.");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`Error: ${message}`);
    return error instanceof ReleaseRefusal ? 2 : error instanceof ReleaseFailure ? error.status : 1;
  } finally {
    uninstall?.();
    scratch?.dispose();
  }
}
