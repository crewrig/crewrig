// build-main.ts — the order of operations of `build-extension` (spec 0254 R5, R19).
// Twin of the argument handling and the main block of scripts/build-extension.sh (:80-132,
// :702-747). Returns the exit status and never exits the process; an error that escapes is the
// entry's to report.

import path from "node:path";

import { parseBuildArgs } from "./args.ts";
import { checkExtension, checkSkeleton, cleanupStrayPluginDist } from "./check-arms.ts";
import { createCtx } from "./entry-ctx.ts";
import type { EntryInput } from "./entry-ctx.ts";
import { renderExtension } from "./render-extension.ts";
import { discoverDirs, resolveExtensionDir } from "./resolve.ts";
import { TARGETS } from "./types.ts";
import type { ExtCtx, Target } from "./types.ts";

async function runCheck(ctx: ExtCtx, extDirs: readonly string[]): Promise<number> {
  ctx.io.out(
    "Extension render — CHECK (no committed generated output, fresh render, exact declared set)",
  );
  let totalFailures = 0;
  try {
    for (const extDir of extDirs) {
      if ((await checkExtension(ctx, extDir)) !== 0) totalFailures += 1;
    }
    if (checkSkeleton(ctx, path.join(ctx.repoDir, "extension-skeleton")) !== 0) totalFailures += 1;
    ctx.io.out("");
    if (totalFailures > 0) {
      ctx.io.out(`FAILED: ${totalFailures} extension(s) failed one or more --check arms.`);
      return 1;
    }
    ctx.io.out(
      "OK: every extension carries no committed generated output, renders cleanly, and matches its declared set.",
    );
    return 0;
  } finally {
    cleanupStrayPluginDist(ctx.repoDir);
  }
}

async function runBuild(ctx: ExtCtx, extDirs: readonly string[], target: string): Promise<number> {
  const targets: readonly Target[] = TARGETS.filter((t) => target === "all" || t === target);
  ctx.io.out(`Extension render — BUILD (--target ${target})`);
  for (const extDir of extDirs) {
    // The shell runs under `set -e`: the first failing extension ends the run.
    if ((await renderExtension(ctx, extDir, targets)) !== 0) return 1;
  }
  ctx.io.out("");
  ctx.io.out("Done.");
  return 0;
}

/** Run `build-extension`; returns its exit status. */
export async function buildMain(input: EntryInput): Promise<number> {
  const parsed = parseBuildArgs(input.argv);
  if (!parsed.ok) {
    input.io.err(parsed.message);
    return parsed.status;
  }
  const ctx = await createCtx(input);
  if (ctx === null) return 1;

  let extDirs: string[];
  if (parsed.extArgs.length > 0) {
    extDirs = [];
    for (const arg of parsed.extArgs) {
      const resolved = resolveExtensionDir(arg, ctx.repoDir);
      if (!resolved.ok) {
        ctx.io.err(resolved.message);
        return 1;
      }
      extDirs.push(resolved.dir);
    }
  } else {
    extDirs = discoverDirs(ctx.repoDir);
  }

  return parsed.check ? await runCheck(ctx, extDirs) : await runBuild(ctx, extDirs, parsed.target);
}
