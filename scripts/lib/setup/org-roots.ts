// org-roots.ts — where a two-root setup reads each file (spec 0315 R6, R12). A setup run started from an
// organization directory reads the framework (rules, catalogs of the CLI, templates, hook scripts) from the
// pinned version root, `ctx.repoDir`, and the organization's own files from `ctx.org.dir`. The organization
// components are the overlay tier `org`, compiled into `ctx.org.staging` before the run. Without `org` every
// path resolves under `ctx.repoDir`, as in a checkout.

import fs from "node:fs";
import path from "node:path";

import type { SetupCtx } from "./context.ts";

/** The `config/` entries that belong to the organization: its identity, its tools and its choice catalogs. */
const ORGANIZATION_OWNED = [
  "config/ORGANIZATION.md",
  "config/TOOLS.md",
  "config/SOUL.md",
  "config/PROFILE.md",
  "config/teams",
  "config/expertise",
  "config/level",
] as const;

/** Whether a source path, relative to a root, names an organization-owned entry. */
export function isOrganizationOwned(rel: string): boolean {
  const posix = rel.replaceAll("\\", "/");
  return ORGANIZATION_OWNED.some((owned) => posix === owned || posix.startsWith(`${owned}/`));
}

/** The personal identity and profile files, which a two-root run may find absent (spec 0315 R6). */
export function isPersonalFile(rel: string): boolean {
  const posix = rel.replaceAll("\\", "/");
  return posix === "config/SOUL.md" || posix === "config/PROFILE.md";
}

/** The physical spelling of an existing path: a Windows 8.3 short name and a letter case resolve to one form. */
export function physicalPath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/** The path functions the classification needs; the platform's `path` by default. */
export type PathLib = Pick<
  typeof path,
  "isAbsolute" | "join" | "dirname" | "basename" | "relative" | "sep"
>;

/**
 * Whether `p` is a file of another version of the framework in the cache (spec 0315 R6): under
 * `<home>/.crewrig/versions/` but outside `repoDir`, the running version root. Such a file may still exist after
 * an update moved the pin, so a hook registered at it is not this run's hook. Both sides are compared in their
 * physical form (a Windows short name and a long name of one directory are the same version) and, on win32, case
 * does not count; `lib` and `physical` are injectable so the win32 forms are testable on any platform.
 */
export function isOtherCachedVersionPath(
  p: string,
  home: string,
  repoDir: string,
  lib: PathLib = path,
  physical: (dir: string) => string = physicalPath,
): boolean {
  const file = lib.join(physical(lib.dirname(p)), lib.basename(p));
  const inside = (dir: string): boolean => {
    const rel = lib.relative(physical(dir), file);
    return rel !== "" && rel.split(lib.sep)[0] !== ".." && !lib.isAbsolute(rel);
  };
  return inside(lib.join(home, ".crewrig", "versions")) && !inside(repoDir);
}

/** The root that a source path of a setup step is read from. */
export function sourceRoot(ctx: Pick<SetupCtx, "repoDir" | "org">, rel: string): string {
  if (ctx.org !== undefined && isOrganizationOwned(rel)) return ctx.org.dir;
  return ctx.repoDir;
}

/**
 * The root whose `dist/<tier>/<cli>` holds a built tier: the organization's compile for `org` in a
 * two-root run, the pinned version for every framework tier.
 */
export function tierRoot(ctx: Pick<SetupCtx, "repoDir" | "org">, tier: string): string {
  if (ctx.org !== undefined && tier === "org") return ctx.org.staging;
  return ctx.repoDir;
}

/** The overlay tiers a run offers: `community` and `org` in a checkout; `org` alone in a two-root run. */
export function overlayTiersOf(
  ctx: Pick<SetupCtx, "org">,
  all: readonly string[],
): readonly string[] {
  return ctx.org === undefined ? all : all.filter((tier) => tier === "org");
}
