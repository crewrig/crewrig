// output-dirs.ts — `--list-output-dirs` (spec 0125; spec 0250 R5).
//
// Twins `list_output_dirs` (scripts/build-components.sh :67-112) and its fast exit
// (:114-117). It answers before anything else is read: it touches no file, no
// configuration and no YAML library, so it works on a machine that has none.
//
// The shell expanded `$TARGET` and `$TIER_FILTER` unquoted, so both are split on
// blanks here as well (`--target "gemini claude"` lists both CLIs while a build
// compares the whole text and selects none). Pathname expansion of those words
// is not reproduced. The final `sort -u` is code-unit order (a listed deviation
// under a non-C locale: `.agents` and `.claude` sort the same either way).

import { words } from "./args.ts";
import type { BuildOptions } from "./types.ts";

/** The directories one CLI writes into, relative to an output root. */
const DIRS_BY_TARGET: ReadonlyMap<string, readonly string[]> = new Map([
  ["gemini", [".gemini/skills", ".gemini/commands", ".gemini/agents"]],
  ["claude", [".claude/skills", ".claude/agents"]],
  ["copilot", [".github/skills", ".github/agents"]],
  ["github", [".github/skills", ".github/agents"]],
  ["antigravity", [".agents/skills", ".agents/agents"]],
]);

const ALL_TARGETS = ["gemini", "claude", "copilot", "antigravity"];

/**
 * The lines `--list-output-dirs` prints, in order: unique, code-unit sorted, `dist/<tier>/`
 * prefixed for every tier but `core`. A selection that lists nothing is one empty line
 * (`printf '%s\n'` with no argument prints a line feed), kept.
 */
export function outputDirLines(opts: Pick<BuildOptions, "target" | "tierFilter">): string[] {
  const targets = opts.target === "all" ? ALL_TARGETS : words(opts.target);
  const tiers = opts.tierFilter === null ? ["core"] : opts.tierFilter;
  const dirs = new Set<string>();
  for (const tier of tiers) {
    const prefix = tier === "core" ? "" : `dist/${tier}/`;
    for (const target of targets) {
      for (const dir of DIRS_BY_TARGET.get(target) ?? []) dirs.add(`${prefix}${dir}`);
    }
  }
  return dirs.size === 0 ? [""] : [...dirs].sort();
}
