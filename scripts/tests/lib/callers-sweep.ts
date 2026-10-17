// callers-sweep.ts — the repository-wide scan behind the callers guards (spec 0258 R39). The fixed
// lists of `skill-scripts-callers.ts` and `harness-curator-callers.ts` check named files; this scan
// reads every tracked text file, so a new caller anywhere that spells a retired `.sh` (or the bare
// pre-switch name) is reported by path. Pure functions, so the test can prove the scan not vacuous.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { retiredSpellings as curator } from "./harness-curator-callers.ts";
import { retiredSpellings as skills } from "./skill-scripts-callers.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** A path prefix (or exact path) the scan skips, with the reason it may name a retired spelling. */
export interface Allowed {
  readonly prefix: string;
  readonly reason: string;
}

export const ALLOWED: readonly Allowed[] = [
  { prefix: "specs/", reason: "specs describe the retired spellings they replace" },
  { prefix: "docs/adr/", reason: "ADRs are history" },
  { prefix: "docs/research/", reason: "research notes are history" },
  { prefix: "scripts/tests/", reason: "tests and goldens name the spellings they guard" },
  { prefix: "artifacts/core/skills/", reason: "the skill scripts, their shims and oracles" },
  { prefix: "artifacts/library/skills/harness-curator/scripts/", reason: "shims, entries, oracle" },
  { prefix: ".claude/", reason: "built mirror of artifacts/, regenerated" },
  { prefix: ".gemini/", reason: "built mirror of artifacts/, regenerated" },
  { prefix: ".agents/", reason: "built mirror of artifacts/, regenerated" },
  { prefix: ".github/skills/", reason: "built mirror of artifacts/, regenerated" },
  { prefix: ".github/agents/", reason: "built mirror of artifacts/, regenerated" },
  {
    prefix: "scripts/lib/service/schedule-names.ts",
    reason: "a comment on the plist the old schedule-curator.sh wrote (history)",
  },
  { prefix: "ci/shell-allowlist.txt", reason: "lists the shims and oracles that stay shell" },
];

const TEXT = /\.(md|ts|js|mjs|cjs|json|ya?ml|toml|sh|txt|py|cmd|ps1)$|Taskfile\.yml$/;

/** Every tracked text file outside the allow-list, as repo-relative paths. */
export function scannedFiles(allowed: readonly Allowed[] = ALLOWED): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
  return out
    .split("\0")
    .filter((f) => f !== "" && TEXT.test(f) && !allowed.some((a) => f.startsWith(a.prefix)))
    .filter((f) => fs.existsSync(path.join(REPO, f)));
}

/** The retired spellings of one text, from both script sets. */
export const retired = (text: string): string[] => [
  ...new Set([...skills(text), ...curator(text)]),
];

/** `<file>: <spelling>` for every retired spelling found in `files` (read from the repository). */
export function sweep(
  files: readonly string[],
  read: (file: string) => string = (file) => fs.readFileSync(path.join(REPO, file), "utf8"),
): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = read(file);
    for (const spelling of new Set(retired(text))) found.push(`${file}: ${spelling}`);
  }
  return found;
}
