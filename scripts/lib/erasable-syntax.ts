// erasable-syntax.ts — spec 0238 R5: reject TypeScript that Node's built-in
// type stripping cannot erase without generating code, naming file, line and
// construct.
//
// No single oracle is enough (plan #1321, finding F-b), so three are stacked:
//   (1) `tsc` erasableSyntaxOnly diagnostics (TS1294) give file, line and
//       column but not the construct: the construct is classified from the
//       token at that position and its enclosing context;
//   (2) `stripTypeScriptTypes` names the construct but not the line: it is a
//       cross-check, so Node's own verdict always wins where `tsc` disagrees;
//   (3) V8 parsing the stripped output catches a decorator, which both (1)
//       and (2) accept.
// Layers 2 and 3 run in one child process (./erasable-probe.ts).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProbeResult } from "./erasable-probe.ts";

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
}

export interface ErasableFinding {
  file: string;
  line: number | "?";
  construct: string;
}

const MODIFIERS = new Set(["private", "public", "protected", "readonly", "override"]);

const REMEDY: Record<string, string> = {
  enum: "an enum generates code; use a union of literals or an `as const` object",
  namespace: "a namespace with runtime content generates code; use a module",
  "parameter-property":
    "a parameter property generates code; declare the field and assign it in the constructor",
  decorator: "a decorator is not erasable; remove it",
  "import-equals": "`import x = ...` generates code; use an ES `import`",
  "non-erasable": "this syntax is not erasable by Node type stripping",
};

/** Offset of a 1-based (line, col) position in `src`. */
function offsetOf(src: string, line: number, col: number): number {
  let offset = 0;
  for (let l = 1; l < line; l += 1) {
    const next = src.indexOf("\n", offset);
    if (next === -1) return src.length;
    offset = next + 1;
  }
  return offset + col - 1;
}

/**
 * Whether the nearest unclosed `(` before `offset` opens a constructor's
 * parameter list. Scans backwards across lines, so a parameter that Oxfmt put
 * on its own line (review finding v1-F1) is still recognised.
 */
function insideConstructorParams(src: string, offset: number): boolean {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === ")" || ch === "]" || ch === "}") depth += 1;
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) return ch === "(" && /\bconstructor\s*$/.test(src.slice(0, i));
      depth -= 1;
    }
  }
  return false;
}

/** Classify the construct a TS1294 diagnostic points at. */
export function classify(src: string, line: number, col: number): string {
  const offset = offsetOf(src, line, col);
  const before = src.slice(0, offset).trimEnd();
  const token = /^[A-Za-z_$][\w$]*/.exec(src.slice(offset))?.[0] ?? "";
  if (/\benum$/.test(before)) return "enum";
  if (/\b(namespace|module)$/.test(before)) return "namespace";
  if (token === "import" || token === "export") return "import-equals";
  if (MODIFIERS.has(token) && insideConstructorParams(src, offset)) return "parameter-property";
  return "non-erasable";
}

/** Parse `tsc --pretty false` output into its TS1294 diagnostics. */
export function parseTs1294(tscOutput: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const m of tscOutput.matchAll(/^(.+?)\((\d+),(\d+)\): error TS1294:/gm)) {
    const [, file = "", line = "0", col = "0"] = m;
    out.push({ file: file.split(path.sep).join("/"), line: Number(line), col: Number(col) });
  }
  return out;
}

function isProbeResults(value: unknown): value is ProbeResult[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v: unknown) =>
        typeof v === "object" && v !== null && "file" in v && typeof v.file === "string",
    )
  );
}

function runProbe(root: string, files: readonly string[]): ProbeResult[] {
  if (files.length === 0) return [];
  const probe = fileURLToPath(new URL("./erasable-probe.ts", import.meta.url));
  const res = spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      probe,
      root,
      ...files,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`erasable probe failed: ${res.stderr}`);
  const parsed: unknown = JSON.parse(res.stdout);
  if (!isProbeResults(parsed)) throw new Error("erasable probe returned malformed output");
  return parsed;
}

/** Run the three layers over `files` (repository-relative), given `tsc`'s TS1294 diagnostics. */
export function checkErasable(
  root: string,
  files: readonly string[],
  diags: Diagnostic[],
): ErasableFinding[] {
  const findings: ErasableFinding[] = [];
  const scoped = new Set(files);
  const flagged = new Set<string>();
  for (const d of diags) {
    if (!scoped.has(d.file)) continue;
    const src = readFileSync(path.join(root, d.file), "utf8");
    findings.push({ file: d.file, line: d.line, construct: classify(src, d.line, d.col) });
    flagged.add(d.file);
  }
  for (const r of runProbe(root, files)) {
    if (r.stripConstruct !== undefined && !flagged.has(r.file)) {
      findings.push({ file: r.file, line: "?", construct: r.stripConstruct });
    } else if (r.parseError !== undefined) {
      const decorator = /^\s*@/.test(r.parseError.text);
      findings.push({
        file: r.file,
        line: r.parseError.line ?? "?",
        construct: decorator ? "decorator" : "non-erasable",
      });
    }
  }
  return findings.sort((a, b) =>
    a.file === b.file
      ? String(a.line).localeCompare(String(b.line), "en", { numeric: true })
      : a.file < b.file
        ? -1
        : 1,
  );
}

/** One finding line in the shared contract format. */
export function formatFinding(f: ErasableFinding): string {
  return `erasable: ${f.construct}: ${f.file}:${f.line}: ${REMEDY[f.construct] ?? REMEDY["non-erasable"]}`;
}
