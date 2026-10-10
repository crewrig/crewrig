// plugin-common.ts — the steps the three plugin installers share (spec 0255 R10): the binary
// requirement, the usage line, the tier lookup and the in-process build. Twins of the common
// head of scripts/install-{claude,copilot}-plugin.sh and install-antigravity-extension.sh, in
// the shell's order: the binary check comes first, then the usage line, then the lookup.
// Messages keep the shell's stream: the diagnostics go to standard output (`echo`), the usage
// line to standard error; the `jq` prerequisite is gone (spec 0255 R22(a)).

import fs from "node:fs";
import path from "node:path";

import { TIERS } from "../extension/resolve.ts";
import { pluginMain } from "../extension/plugin-main.ts";
import type { PluginTarget } from "../extension/types.ts";
import { buildInput, type PluginCtx } from "./plugin-ctx.ts";
import { onPath } from "./spawn.ts";

export interface Prepared {
  readonly name: string;
  /** `extensions/<tier>/<name>`. */
  readonly extDir: string;
}

export interface PluginScript {
  /** The shell script's name as typed, with its `.sh` suffix (usage-text decision, R22(i)). */
  readonly script: string;
  /** The CLI that installs the plugin: `claude`, `copilot` or `agy`. */
  readonly binary: string;
  /** The line printed when the binary is absent. */
  readonly missing: string;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `extensions/<tier>/<name>` searched through every tier: one match, else the shell's message.
 * Unlike `resolveExtensionDir`, a directory argument is never taken as a path.
 */
export function findInTiers(
  repoDir: string,
  name: string,
): { readonly dir: string } | { readonly message: string } {
  let found = "";
  for (const tier of TIERS) {
    const candidate = `${repoDir}/extensions/${tier}/${name}`;
    if (!isDir(candidate)) continue;
    if (found !== "")
      return {
        message: `Error: extension '${name}' exists in multiple tiers; names must be unique.`,
      };
    found = candidate;
  }
  if (found === "") return { message: `Error: Extension '${name}' not found in extensions/` };
  return { dir: found };
}

/** Binary check, usage line, tier lookup; `null` after the message has been printed (status 1). */
export function prepare(ctx: PluginCtx, spec: PluginScript): Prepared | null {
  if (!onPath(ctx, spec.binary)) {
    ctx.io.out(spec.missing);
    return null;
  }
  const name = ctx.argv[0];
  if (name === undefined || name === "") {
    ctx.io.err(`Usage: ${spec.script} <extension-name>`);
    return null;
  }
  const found = findInTiers(ctx.repoDir, name);
  if ("message" in found) {
    ctx.io.out(found.message);
    return null;
  }
  return { name, extDir: found.dir };
}

/** Build the plugin in process (`pluginMain`, spec 0254) and return its exit status. */
export function buildPlugin(
  ctx: PluginCtx,
  target: PluginTarget,
  extDir: string,
  outDir: string,
): Promise<number> {
  return pluginMain(target, buildInput(ctx, [extDir, outDir]));
}

/** `<repo>/<dist>/<name>`, the output directory of the Copilot and Antigravity installers. */
export function distDir(ctx: PluginCtx, dist: string, name: string): string {
  return path.join(ctx.repoDir, dist, name);
}
