// ext-provenance.ts — logic of check-extension-provenance (spec 0259, twin of
// scripts/check-extension-provenance.sh). Paths are cwd-relative, as in the shell.
//
// Usage: const { lines, code } = checkProvenance();
// Reuses walk.ts `findFiles` (regular SKILL.md / AGENT.md files only) and
// carrier.ts `firstBodyLine` / `carrierField`.
// Exit codes: 0 when every carrier is complete and self-routing, 1 otherwise.
// Finding-line format: `  FAIL <path> — <reason> (R1|R5|R7)` on stdout.

import { lstatSync, readFileSync, statSync } from "node:fs";
import { carrierField, firstBodyLine } from "./carrier.ts";
import { findFiles } from "./walk.ts";

const TIER_ROOTS = ["extensions/core", "extensions/library"];
const PREFIX = "<!-- crewrig-provenance:";
const SUFFIX = "-->";

export interface ProvenanceResult {
  lines: string[];
  code: number;
}

const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function sources(): string[] {
  const all: string[] = [];
  for (const root of TIER_ROOTS) {
    if (!isDir(root)) continue;
    // `find` does not descend into a root that is itself a symlink.
    if (lstatSync(root).isSymbolicLink()) continue;
    const names = findFiles(root, (rel) => /(^|\/)(SKILL|AGENT)\.md$/.test(rel));
    for (const rel of names) all.push(`${root}/${rel}`);
  }
  return all.sort(byteOrder);
}

export function checkProvenance(): ProvenanceResult {
  const lines: string[] = [];
  const failures: string[] = [];
  const files = sources();

  for (const f of files) {
    const carrier = firstBodyLine(readFileSync(f, "utf8"));
    if (
      !(
        carrier.startsWith(PREFIX) &&
        carrier.endsWith(SUFFIX) &&
        carrier.length >= PREFIX.length + SUFFIX.length
      )
    ) {
      lines.push(`  FAIL ${f} — missing crewrig-provenance carrier on first body line (R7)`);
      failures.push(f);
      continue;
    }

    const version = carrierField(carrier, "version");
    const extension = carrierField(carrier, "extension");
    const canonical = carrierField(carrier, "canonical");
    const feedback = carrierField(carrier, "feedback");

    const missing: string[] = [];
    if (version === "") missing.push("version");
    if (canonical === "") missing.push("canonical");
    if (feedback === "") missing.push("feedback");
    if (extension === "") missing.push("extension");
    if (missing.length > 0) {
      lines.push(`  FAIL ${f} — provenance carrier missing field(s): ${missing.join(" ")} (R1)`);
      failures.push(f);
      continue;
    }

    if (feedback !== canonical) {
      lines.push(`  FAIL ${f} — feedback '${feedback}' != canonical '${canonical}' (R5)`);
      failures.push(f);
      continue;
    }

    lines.push(`  OK   ${f}`);
  }

  if (failures.length > 0) {
    lines.push(
      "",
      `FAILED: ${failures.length} upstream-owned extension component(s) violate the provenance contract:`,
      ...failures.map((f) => `  - ${f}`),
      "",
      "Per spec 0043, every skill/agent under an upstream-owned extension tier",
      "(extensions/core, extensions/library) MUST carry a crewrig-provenance",
      "carrier as its FIRST BODY LINE (an HTML comment, NOT frontmatter — Gemini",
      "0.42.0+ rejects non-name/description frontmatter keys on in-place sources):",
      "",
      '  <!-- crewrig-provenance: extension="…" version="…" canonical="…" feedback="…" -->',
      "",
      "with all four fields present (extension = the extension directory name), canonical a LITERAL origin repo URL (not",
      "${CANONICAL_REPO} — a consumer cannot resolve a third-party origin), and",
      "feedback == canonical (upstream-owned tier routes feedback to canonical).",
    );
    return { lines, code: 1 };
  }
  lines.push(
    "",
    `OK: ${files.length} upstream-owned extension skill/agent(s) carry a complete, self-routing provenance carrier.`,
  );
  return { lines, code: 0 };
}
