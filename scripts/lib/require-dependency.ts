// require-dependency.ts — load a third-party package with a plain-language
// diagnostic when it is missing (spec 0240 R7).
//
// A caller loads every production dependency through `loadDependency`. When
// the package is declared in the root `package.json` `dependencies` but is not
// installed (a `git pull` added it and setup has not re-run), the caller gets
// a `MissingDependencyError` naming the package and telling the user to
// re-run setup, instead of a raw module-resolution error. A script wired at a
// CLI integration point may catch that error and continue degraded.
//
// Enforcement boundary. The phantom-import guard below — only root
// `dependencies` may be loaded, so an overlap package (spec 0240 delta-01 R4)
// or a devDependency is refused — is enforced ONLY for callers of
// `loadDependency`. A static `import` of an overlap package bypasses it; a lint
// rule against that is left to a later sub-spec (H, issue #1337).
//
// Standard library only (R16).

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { repoRootFrom } from "./paths.ts";

/** Raised when a declared production dependency is not installed. */
export class MissingDependencyError extends Error {
  readonly packageName: string;

  constructor(packageName: string) {
    super(
      `crewrig: required package '${packageName}' is not installed — re-run setup (e.g. task setup-claude-interactive).`,
    );
    this.name = "MissingDependencyError";
    this.packageName = packageName;
  }
}

export interface LoadDependencyOptions {
  /** Manifest whose `dependencies` must list the package. Default: `<root>/package.json`. */
  manifestPath?: string;
  /** File the package is resolved from. Default: `<root>/package.json`. */
  resolveFrom?: string;
}

function declaredDependencies(manifestPath: string): Record<string, unknown> {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, unknown>;
  };
  return manifest.dependencies ?? {};
}

function isModuleNotFoundFor(error: unknown, name: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "MODULE_NOT_FOUND" && error.message.includes(`'${name}'`);
}

/**
 * Load the production dependency `name` and return its module namespace.
 *
 * @throws Error when `name` is not a key of the manifest's `dependencies`
 *   (a programming error, not a user-facing condition).
 * @throws MissingDependencyError when the package is declared but not installed.
 * Any other failure, including an error thrown by the package on load, is
 * rethrown unchanged.
 */
export async function loadDependency(
  name: string,
  options?: LoadDependencyOptions,
): Promise<unknown> {
  const rootManifest = path.join(repoRootFrom(import.meta.url), "package.json");
  const manifestPath = options?.manifestPath ?? rootManifest;
  const resolveFrom = options?.resolveFrom ?? rootManifest;

  if (!Object.hasOwn(declaredDependencies(manifestPath), name)) {
    throw new Error(
      `loadDependency: '${name}' is not declared in the dependencies of ${manifestPath}; only production dependencies may be loaded`,
    );
  }

  let resolved: string;
  try {
    resolved = createRequire(resolveFrom).resolve(name);
  } catch (error) {
    if (isModuleNotFoundFor(error, name)) throw new MissingDependencyError(name);
    throw error;
  }
  // Node's resolution also walks every parent directory's node_modules/ (for
  // example $HOME/node_modules). Only a copy installed in this checkout, and
  // so pinned by its lockfile, counts; anything else is "not installed".
  const ownModules = path.join(fs.realpathSync.native(path.dirname(resolveFrom)), "node_modules");
  if (!fs.realpathSync.native(resolved).startsWith(ownModules + path.sep)) {
    throw new MissingDependencyError(name);
  }
  return (await import(pathToFileURL(resolved).href)) as unknown;
}
