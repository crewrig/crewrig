// skill-versions.ts — logic of check-skill-versions (spec 0259): every modified
// component source must add a `version: "..."` line in its diff.
//
// Reuses base-ref.ts and bump-scan.ts (shared with row I2).
// Usage: runSkillVersions(argv, env) -> exit status.
// Exit codes: 0 all bumped or none modified, 1 a source lacks a bump, 2 unresolvable base.
// Finding-line format: `  FAIL <file> — metadata.provenance.version not bumped`.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  defaultBaseRef,
  ensureBaseResolvable,
  normalizeBaseRef,
  preferredRemote,
  unresolvableBaseLines,
} from "./base-ref.ts";
import { modifiedFiles } from "./bump-scan.ts";
import { runGit } from "./git-run.ts";
import { fail, fatal, ok } from "./report.ts";

export const PATHSPECS = [
  "artifacts/core/skills/*/SKILL.md",
  "artifacts/library/skills/*/SKILL.md",
  "artifacts/community/skills/*/SKILL.md",
  "artifacts/core/commands/*.md",
  "artifacts/library/commands/*.md",
  "artifacts/community/commands/*.md",
  "artifacts/core/agents/*/AGENT.md",
  "artifacts/library/agents/*/AGENT.md",
  "artifacts/community/agents/*/AGENT.md",
  "artifacts/core/rules/*.md",
  "artifacts/core/system-context/*.md",
  "hooks/*.ts",
] as const;

// The shell's `^\+[[:space:]]+version:[[:space:]]*"` under LC_ALL=C.
const BUMP = /^\+[ \t\n\v\f\r]+version:[ \t\n\v\f\r]*"/;

function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}

/** Run the check; returns the process exit status. */
export function runSkillVersions(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const cwd = process.cwd();
  const arg = argv[0] ?? "";
  let base = normalizeBaseRef(arg !== "" ? arg : (env.BASE_REF ?? ""));
  if (base === "") base = defaultBaseRef(preferredRemote(cwd), cwd);

  if (!ensureBaseResolvable(base, cwd)) {
    const [l1, l2] = unresolvableBaseLines(base);
    fatal(l1);
    fatal(l2);
    return 2;
  }

  const modified = modifiedFiles(base, PATHSPECS, cwd);
  if (modified.length === 0) {
    ok(`OK: no existing component sources modified vs ${base}.`);
    return 0;
  }
  ok(`Checking version bumps on ${modified.length} modified component source(s)...`);

  const failures: string[] = [];
  for (const f of modified) {
    if (!isFile(path.resolve(cwd, f))) continue; // deleted file: no bump needed
    const diff = runGit(["diff", base, "--", f], { cwd }).stdout.toString("utf8");
    if (diff.split("\n").some((l) => BUMP.test(l))) {
      ok(`  OK   ${f}`);
    } else {
      fail(`  FAIL ${f} — metadata.provenance.version not bumped`);
      failures.push(f);
    }
  }

  if (failures.length > 0) {
    ok("");
    ok(`FAILED: ${failures.length} source(s) changed without a version bump:`);
    for (const f of failures) ok(`  - ${f}`);
    ok("");
    ok("Per artifacts/FORMAT.md → Version semantics, bump");
    ok("metadata.provenance.version in the same diff. SemVer:");
    ok("  PATCH (1.0.0 → 1.0.1) — friction fix / wording change");
    ok("  MINOR (1.0.0 → 1.1.0) — additive (new section, new field)");
    ok("  MAJOR (1.0.0 → 2.0.0) — breaking contract change");
    return 1;
  }
  ok("");
  ok("OK: all changed component sources include a version bump.");
  return 0;
}
