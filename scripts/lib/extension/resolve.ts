// resolve.ts — extension directory resolution and discovery (spec 0254 R6).
// Twins of `resolve_extension_dir`, scripts/build-extension.sh:108-132, and `ext_discover_dirs`,
// scripts/lib/extension-manifest.sh:169-185. Neither prints nor exits: the result says which
// message to show, and the caller picks the stream (stdout for the plugin builders, stderr for
// the build and migration entries).

import fs from "node:fs";
import path from "node:path";

/** The three source tiers, in lookup order. */
export const TIERS: readonly string[] = ["core", "library", "org"];

export type ResolveResult =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly message: string };

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** An existing directory argument is made absolute; else the name is looked up under each tier. */
export function resolveExtensionDir(arg: string, repoDir: string): ResolveResult {
  if (isDir(arg)) return { ok: true, dir: path.resolve(arg) };
  let found = "";
  for (const tier of TIERS) {
    const candidate = `${repoDir}/extensions/${tier}/${arg}`;
    if (!isDir(candidate)) continue;
    if (found !== "")
      return {
        ok: false,
        message: `Error: extension '${arg}' exists in multiple tiers; names must be unique.`,
      };
    found = candidate;
  }
  if (found === "")
    return { ok: false, message: `Error: extension directory or name '${arg}' not found.` };
  return { ok: true, dir: path.resolve(found) };
}

/**
 * Every `extensions/{core,library,org}/<name>/` holding `extension.json`: tiers in that order,
 * names in code-unit order, hidden names skipped as a shell `*` glob skips them.
 */
export function discoverDirs(repoDir: string): string[] {
  const found: string[] = [];
  for (const tier of TIERS) {
    const tierDir = `${repoDir}/extensions/${tier}`;
    if (!isDir(tierDir)) continue;
    const names = fs
      .readdirSync(tierDir)
      .filter((name) => !name.startsWith("."))
      .sort();
    for (const name of names) {
      const dir = `${tierDir}/${name}`;
      if (isDir(dir) && isFile(`${dir}/extension.json`)) found.push(path.resolve(dir));
    }
  }
  return found;
}
