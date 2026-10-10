// extension.ts — install or link extensions into the Gemini home (spec 0255 R9, R13, R18). Twin
// of scripts/install-extension.sh and scripts/link-extensions.sh. One extension: resolve its
// source through the three tiers, render the Gemini tree IN PROCESS (the shell ran
// build-extension.sh with its standard output sent to standard error), then replace
// `<home>/.gemini/extensions/<name>` with a link to, or a copy of, the build directory. With no
// name the loop is one process, so it prints at most one aggregated fallback notice at its end.

import fs from "node:fs";
import path from "node:path";

import { buildMain } from "../extension/build-main.ts";
import { extBuildDir } from "../extension/manifest.ts";
import { TIERS } from "../extension/resolve.ts";
import { linkOrCopy, placeCopy, summarizeFallbacks } from "../link-or-copy.ts";
import type { LinkOutcome } from "../link-or-copy.ts";
import { geminiHome, tierNames, walkedTiers, wantsOrg } from "./ctx.ts";
import type { InstallCtx } from "./ctx.ts";

export type InstallMode = "install" | "link";

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The shell's `resolve_ext_dir`: the tier directories holding `name`, never a directory argument. */
function resolveSource(ctx: InstallCtx, name: string): boolean {
  const found = TIERS.filter((tier) => isDir(path.join(ctx.repoDir, "extensions", tier, name)));
  if (found.length > 1) {
    ctx.io.err(`Error: extension '${name}' exists in multiple tiers; names must be unique.`);
    return false;
  }
  return found.length === 1;
}

/** Run `build-extension --target gemini <name>` in process, its standard output on standard error. */
async function render(ctx: InstallCtx, name: string): Promise<number> {
  try {
    return await buildMain({
      argv: ["--target", "gemini", name],
      env: ctx.env,
      platform: ctx.platform,
      // Only its parent is used: the sandbox root is derived from it, as the entry does.
      entryFile: path.join(ctx.repoDir, "scripts", "build-extension.ts"),
      io: { out: ctx.io.err, err: ctx.io.err, errRaw: ctx.io.errRaw },
    });
  } catch (error) {
    ctx.io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** The shell's `do_install`: returns 0 or 1, pushes what it placed on `outcomes`. */
export async function installOne(
  ctx: InstallCtx,
  name: string,
  mode: InstallMode,
  outcomes: LinkOutcome[],
): Promise<number> {
  const extensions = path.join(geminiHome(ctx), "extensions");
  fs.mkdirSync(extensions, { recursive: true });
  if (!resolveSource(ctx, name)) {
    ctx.io.err(`Error: extension '${name}' not found.`);
    return 1;
  }
  if ((await render(ctx, name)) !== 0) {
    ctx.io.err(`Error: rendering extension '${name}' failed.`);
    return 1;
  }
  const source = extBuildDir(ctx.repoDir, name);
  const options = { env: ctx.env, platform: ctx.platform };
  const target = path.join(extensions, name);
  const outcome =
    mode === "link" ? linkOrCopy(source, target, options) : placeCopy(source, target, options);
  outcomes.push(outcome);
  ctx.io.out(`  ${outcome.method === "link" ? "Linked" : "Copied"}: ${name} (build directory)`);
  return 0;
}

/** Every extension of the walked tiers in code-unit order; the first failure ends the loop. */
export async function installAll(
  ctx: InstallCtx,
  mode: InstallMode,
  includeOrg: boolean,
  outcomes: LinkOutcome[],
): Promise<number> {
  for (const tier of walkedTiers(includeOrg)) {
    for (const name of tierNames(ctx.repoDir, tier)) {
      if ((await installOne(ctx, name, mode, outcomes)) !== 0) return 1;
    }
  }
  return 0;
}

async function withNotice(
  ctx: InstallCtx,
  run: (outcomes: LinkOutcome[]) => Promise<number>,
): Promise<number> {
  const outcomes: LinkOutcome[] = [];
  try {
    return await run(outcomes);
  } finally {
    const notice = summarizeFallbacks(outcomes);
    if (notice !== "") ctx.io.err(notice);
  }
}

/** `install-extension.ts [install|link] [name|--include-org]`: returns the exit status. */
export async function installMain(ctx: InstallCtx, argv: readonly string[]): Promise<number> {
  const mode: InstallMode = argv[0] === "link" ? "link" : "install";
  const arg = argv[1] ?? "";
  const flag = arg === "--include-org";
  return await withNotice(ctx, (outcomes) =>
    arg !== "" && !flag
      ? installOne(ctx, arg, mode, outcomes)
      : installAll(ctx, mode, wantsOrg(ctx, flag), outcomes),
  );
}

/** `link-extensions.ts [--include-org]`: links every upstream extension in process. */
export async function linkExtensionsMain(
  ctx: InstallCtx,
  argv: readonly string[],
): Promise<number> {
  return await withNotice(ctx, (outcomes) =>
    installAll(ctx, "link", wantsOrg(ctx, argv[0] === "--include-org"), outcomes),
  );
}
