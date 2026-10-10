// component-roots.ts — TypeScript twin of the root, resolution and reporting half of
// scripts/lib/component-resolve.sh (spec 0255, row F2 of spec 0215): the overlay-tier
// constant (`COMPONENT_OVERLAY_TIERS`), `component_set_staging_roots`,
// `component_set_artifact_roots`, `component_read_lines`, `resolve_component_in_roots`,
// `enumerate_components_in_roots` and `report_unresolved`.
//
// Twin of that slice of the shell library: change both, and keep them equal. The
// conformance test `scripts/tests/component-twins-conformance.test.ts` compares the two.
//
// Differences of form, none of behaviour:
//   - no process-global array: a function returns its list instead of filling
//     `COMPONENT_ROOTS[]` or `COMPONENT_LINES[]`, and takes `repoDir` explicitly;
//   - a report goes to a `TextSink` (default: standard error), written once;
//   - paths are joined with `/` as the shell does, not normalised: a caller hands
//     the roots on to the functions below and to `reportUnresolved` unchanged;
//   - a directory listing is in code-unit order and skips names beginning with `.`,
//     as a shell glob does under the C locale.

import fs from "node:fs";

import type { TextSink } from "./component-resolve.ts";

/**
 * The overlay tiers every per-component command serves, in resolution order. `core` is
 * deliberately absent: its landing zone is the committed project tree and its delivery
 * is the build, not an install (spec 0119 R6).
 */
export const COMPONENT_OVERLAY_TIERS: readonly string[] = ["library", "community", "org"];

/** One `<basename><TAB><path>` member of an enumerated root. */
export interface ComponentEntry {
  readonly base: string;
  readonly path: string;
}

const stderrSink: TextSink = (text) => {
  process.stderr.write(text);
};

const CANDIDATE_SUFFIXES = ["", ".md", ".toml", ".json"];

function exists(target: string): boolean {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** `${REPO_DIR:?}`: an empty repository directory would root every path at `/`. */
function requireRepoDir(repoDir: string): string {
  if (repoDir === "") throw new Error("component-roots.ts requires a repository directory");
  return repoDir;
}

/**
 * `component_set_staging_roots`: the compiled staging root of every served overlay tier,
 * in tier order. `subpath` is the CLI root plus the type directory exactly as the build
 * writes it, e.g. `.claude/skills`. All three roots are always produced, present or
 * not, so that an absent tier is still reported as examined rather than dropped.
 */
export function setStagingRoots(repoDir: string, subpath: string): string[] {
  const repo = requireRepoDir(repoDir);
  return COMPONENT_OVERLAY_TIERS.map((tier) => `${repo}/dist/${tier}/${subpath}`);
}

/**
 * `component_set_artifact_roots`: the authoring-source root of every served overlay
 * tier, for the types no CLI compiles (policies, hooks, themes, mcp-servers, and
 * Gemini commands).
 */
export function setArtifactRoots(repoDir: string, type: string): string[] {
  const repo = requireRepoDir(repoDir);
  return COMPONENT_OVERLAY_TIERS.map((tier) => `${repo}/artifacts/${tier}/${type}`);
}

/** `component_read_lines`: the non-empty lines of `text`, in order. */
export function readLines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

/**
 * `resolve_component_in_roots`: every existing candidate for `name`, in root order.
 * Within one root the first existing candidate of `<name>`, `<name>.md`, `<name>.toml`,
 * `<name>.json` wins; across roots every match is collected (spec 0119 R7, R15). An
 * absent root is skipped (R8). Absence is the empty list.
 */
export function resolveComponentInRoots(name: string, roots: readonly string[]): string[] {
  const found: string[] = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = `${root}/${name}${suffix}`;
      if (exists(candidate)) {
        found.push(candidate);
        break;
      }
    }
  }
  return found;
}

/**
 * `enumerate_components_in_roots`: `{ base, path }` for every member of every present
 * root, in root order then code-unit order, skipping hidden names (so `.gitkeep`) and
 * dangling links. No deduplication: grouping repeated basenames is the install
 * driver's job. The path carries no trailing slash, so a copy of it keeps the
 * component under its own name.
 */
export function enumerateComponentsInRoots(roots: readonly string[]): ComponentEntry[] {
  const entries: ComponentEntry[] = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const base of names.sort()) {
      if (base.startsWith(".")) continue;
      const entry = `${root}/${base}`;
      if (exists(entry)) entries.push({ base, path: entry });
    }
  }
  return entries;
}

/**
 * `report_unresolved`: the R16/R17/R18 miss report, on standard error by default. The
 * build hint is printed only when no served root existed at all (R18); every root is
 * listed with whether it was there. The caller owns the exit status.
 */
export function reportUnresolved(
  name: string,
  type: string,
  roots: readonly string[],
  sink: TextSink = stderrSink,
): void {
  let present = 0;
  let text = `Error: no component named '${name}' of type '${type}' resolved in any served tier.\n`;
  text += "Locations examined, in resolution order:\n";
  for (const root of roots) {
    if (isDir(root)) {
      text += `  - ${root} (present)\n`;
      present += 1;
    } else {
      text += `  - ${root} (absent)\n`;
    }
  }
  if (present === 0) {
    text += "No served tier of this type was available at all. Populate one, or run:\n";
    text += "  bash scripts/build-components.sh\n";
  }
  sink(text);
}
