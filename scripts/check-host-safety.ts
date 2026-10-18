// check-host-safety.ts — static host-safety check for test harnesses (spec 0267 R1-R11).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-host-safety.ts
//
// Parses (never executes, never writes) every `.ts` file under scripts/tests/, scripts/lib/ and
// the top-level scripts/*.ts with the TypeScript 7 programmatic API, and reports every `fs`
// delete, copy, rename or unlink call whose target derives from `process.env`, `process.argv`,
// `os.homedir()` or a PATH entry and is not covered by an earlier `assertInside` / `isInside`
// against an `mkdtemp` root in the same function. Rules and limits: scripts/lib/host-safety/rules.ts.
//
// Allowlist: ci/host-safety-allowlist.txt, shrink-only — an entry silences one finding, needs a
// written justification, goes stale when its call site stops being flagged, and cannot be added
// relative to the merge base (an allowlist absent on the merge base is a bootstrap).
//
// Exit: 0 clean, 1 findings, 2 wiring fault (missing scan root, allowlist or tsconfig, unresolvable
// explicit BASE_REF, a scanned file the project does not include). `CREWRIG_REPO_DIR` and
// `BASE_REF` override the repository root and the diff base, as for the sibling checks.
// Finding lines (stderr): `host-safety: <rule-id>: <path>:<line>: <message>`.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ParseFault, openProgram } from "./lib/host-safety/ast.ts";
import { ALLOWLIST, parseAllowlist, readAllowlist } from "./lib/host-safety/allowlist.ts";
import { analyzeFile } from "./lib/host-safety/rules.ts";
import type { Flagged } from "./lib/host-safety/rules.ts";
import { WiringError, repoRoot, resolveBase, showAt } from "./lib/ts-scope.ts";

const SCAN_DIRS = ["scripts/tests", "scripts/lib"];

const lines: string[] = [];

function finding(rule: string, where: string, message: string): void {
  lines.push(`host-safety: ${rule}: ${where}: ${message}`);
}

/** Every scanned `.ts` path, repository-relative with `/` separators, sorted. */
function scanFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
        out.push(child);
    }
  };
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory())
      throw new WiringError(`scan root ${dir}/ is missing`);
    walk(dir);
  }
  const scriptsAbs = path.join(root, "scripts");
  if (!existsSync(scriptsAbs)) throw new WiringError("scan root scripts/ is missing");
  for (const entry of readdirSync(scriptsAbs, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
      out.push(`scripts/${entry.name}`);
  return out.sort();
}

function main(): number {
  const root = repoRoot();
  const files = scanFiles(root);
  const { entries, hygiene } = readAllowlist();

  const flagged: Array<Flagged & { path: string }> = [];
  let sinks = 0;
  let tainted = 0;
  const program = openProgram(root);
  try {
    for (const rel of files) {
      const sf = program.sourceFile(path.join(root, rel));
      if (sf === undefined)
        throw new WiringError(`${rel} is not part of the project opened from tsconfig.json`);
      const report = analyzeFile(sf, rel);
      sinks += report.sinks;
      tainted += report.tainted;
      for (const f of report.flagged) flagged.push({ ...f, path: rel });
    }
  } finally {
    program.close();
  }

  const listed = new Map(entries.map((e) => [e.key, e]));
  const flaggedKeys = new Set(flagged.map((f) => f.key));
  let allowlisted = 0;
  for (const f of flagged) {
    if (listed.has(f.key)) allowlisted += 1;
    else finding(f.rule, `${f.path}:${f.line}`, f.message);
  }
  for (const h of hygiene) finding("allowlist-unsorted", `${ALLOWLIST}:${h.line}`, h.message);
  for (const e of entries) {
    if (e.justification === "")
      finding(
        "allowlist-unjustified",
        `${ALLOWLIST}:${e.line}`,
        `'${e.key}' has no written justification; add one after a TAB, or delete the entry`,
      );
    if (!flaggedKeys.has(e.key))
      finding(
        "allowlist-stale",
        `${ALLOWLIST}:${e.line}`,
        `'${e.key}' matches no flagged call site any more; delete this entry in the same PR`,
      );
  }

  const base = resolveBase();
  let note = "";
  if (base === null) note = "no base ref resolves; list-growth arm skipped";
  else {
    const onBase = showAt(base.mergeBase, ALLOWLIST);
    if (onBase === null)
      note = `${ALLOWLIST} absent on the merge base; bootstrap, growth arm skipped`;
    else {
      const before = new Set(parseAllowlist(onBase).entries.map((e) => e.key));
      for (const e of entries)
        if (!before.has(e.key))
          finding(
            "allowlist-entry-added",
            `${ALLOWLIST}:${e.line}`,
            `'${e.key}' was added; this list may only shrink, so guard the call with \`assertInside(root, p)\` instead (spec 0267 R10)`,
          );
    }
  }

  if (note !== "") console.log(`host-safety: note: ${note}`);
  if (lines.length > 0) {
    for (const l of lines) console.error(l);
    console.error(`host-safety: ${lines.length} finding(s); see docs/host-safety-check.md`);
    return 1;
  }
  console.log(
    `host-safety: OK (${files.length} files, ${sinks} destructive calls, ${tainted} untrusted-derived, ${allowlisted} allowlisted)`,
  );
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  const detail =
    err instanceof WiringError || err instanceof ParseFault
      ? err.message
      : err instanceof Error
        ? (err.stack ?? err.message)
        : String(err);
  console.error(`host-safety: error: ${detail}`);
  process.exitCode = 2;
}
