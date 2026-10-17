// modes.ts — the modes of scripts/sweep-en-us.ts (twin of scripts/sweep-en-us.sh,
// spec 0023): --apply, --check, --scope-test, --list, --aspell. Output goes
// through `out`/`err` so a caller can buffer it; the return value is the exit status.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  EngineExit,
  applyMap,
  buildDetector,
  buildSubstitutions,
  detect,
  loadMap,
  loadWords,
  sweepableRanges,
} from "./rules.ts";
import { pyStrip, readText } from "./pystr.ts";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const MD_SPECS = [
  "artifacts/**/*.md",
  "docs/**/*.md",
  "specs/**/*.md",
  "tests/**/*.md",
  "config/*.md",
  "*.md",
  "*.md.template",
  "config/*.md.template",
  "config/*.template",
  "*.template",
];
const SRC_SPECS = [
  "scripts/*.sh",
  "scripts/tests/*.sh",
  "scripts/e2e/*.sh",
  "tests/e2e/**/*.sh",
  "artifacts/**/scripts/*.sh",
  "artifacts/**/scripts/*.py",
  "docs/research/**/*.sh",
  ".github/workflows/copilot.yml",
];
const EXCLUDED = [
  /^LICENSE$/,
  /^\.claude\//,
  /^\.gemini\//,
  /^\.github\/(skills|agents|copilot)\//,
  /\/fixtures\//,
  /^tests\/fixtures\//,
  /^communication\//,
  /\/node_modules\//,
  /\/extension-skeleton\//,
];

function git(args: string[], stderr: "inherit" | "ignore"): { stdout: string; status: number } {
  const r = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", stderr] });
  return { stdout: r.stdout ?? "", status: r.status ?? 1 };
}

/** The in-scope file set S (sorted bytewise like `sort -u` under LC_ALL=C, then filtered). */
export function collectFiles(): { files: string[]; status: number } {
  const first = git(["ls-files", "--", ...MD_SPECS], "inherit");
  const second = git(["ls-files", "--", ...SRC_SPECS], "inherit");
  const lines = (first.stdout + second.stdout).split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const sorted = [...new Set(lines)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return { files: sorted.filter((l) => !EXCLUDED.some((rx) => rx.test(l))), status: second.status };
}

/** `files` as the Python heredocs read them: stripped, blank lines dropped. */
function fileList(): string[] {
  return collectFiles()
    .files.map(pyStrip)
    .filter((l) => l !== "");
}

export interface Paths {
  map: string;
  detect: string;
}

export function doApply(io: Io, p: Paths): number {
  const files = fileList();
  const subs = buildSubstitutions(loadMap(p.map));
  const total = new Map<string, number>();
  let changed = 0;
  for (const file of files) {
    const text = readText(file);
    const res = applyMap(file, text, subs);
    if (res.text !== text) {
      fs.writeFileSync(file, res.text, "utf8");
      changed += 1;
      for (const [k, v] of res.counts) total.set(k, (total.get(k) ?? 0) + v);
    }
  }
  io.out(`[sweep] files changed: ${changed}\n`);
  const fam = new Map<string, number>();
  let grand = 0;
  for (const [k, v] of total) {
    fam.set(k.toLowerCase(), (fam.get(k.toLowerCase()) ?? 0) + v);
    grand += v;
  }
  const keys = [...fam.keys()].sort(
    (a, b) => (fam.get(b) as number) - (fam.get(a) as number) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const k of keys) io.out(`  ${String(fam.get(k)).padStart(5)}  ${k}\n`);
  io.out(`[sweep] total replacements: ${grand}\n`);
  return 0;
}

function assertSuperset(io: Io, p: Paths): number {
  let pairs: Array<[string, string]>;
  try {
    pairs = loadMap(p.map);
  } catch (e) {
    if (!(e instanceof EngineExit)) throw e;
    io.err(`${e.message}\n`);
    return 1;
  }
  const words = loadWords(p.detect);
  const det = new Set(words.map((w) => w.toLowerCase()));
  const keys = new Set(pairs.map(([b]) => b.toLowerCase()));
  const missing = [...keys].filter((k) => !det.has(k)).sort();
  if (missing.length > 0) {
    io.out("[superset] FAIL: map keys absent from detect list:\n");
    for (const m of missing) io.out(`   - ${m}\n`);
    return 1;
  }
  io.out(`[superset] PASS: all ${keys.size} map keys present in detect list (${det.size} words)\n`);
  return 0;
}

function runDetector(io: Io, p: Paths): number {
  const files = fileList();
  const rx = buildDetector(loadWords(p.detect));
  let violations = 0;
  for (const file of files) {
    for (const [lineno, word] of detect(file, readText(file), rx)) {
      io.out(`R6 VIOLATION: ${file}:${lineno}: ${word}\n`);
      violations += 1;
    }
  }
  if (violations > 0) {
    io.out(`[R6] FAIL: ${violations} residual British spelling(s) in scope\n`);
    return 1;
  }
  io.out("[R6] PASS: zero British spellings remain in the in-scope set\n");
  return 0;
}

function exclusionGuard(io: Io): number {
  const r = git(
    ["diff", "--name-only", "--", "LICENSE", "tests/fixtures", "communication"],
    "ignore",
  );
  const touched = r.status === 0 ? r.stdout.replace(/\n+$/, "") : "";
  if (touched !== "") {
    io.err("[exclusion-guard] FAIL: excluded path(s) modified:\n");
    for (const w of touched.split(/[ \t\n]+/).filter((x) => x !== "")) io.err(`   - ${w}\n`);
    return 1;
  }
  io.out("[exclusion-guard] PASS: no excluded tree touched\n");
  return 0;
}

export function doCheck(io: Io, p: Paths): number {
  let rc = 0;
  if (assertSuperset(io, p) !== 0) rc = 1;
  if (runDetector(io, p) !== 0) rc = 1;
  if (exclusionGuard(io) !== 0) rc = 1;
  return rc;
}

export function doScopeTest(io: Io, p: Paths): number {
  if (assertSuperset(io, p) !== 0) return 1;
  const files = fileList();
  let mismatches = 0;
  for (const file of files) {
    const text = readText(file);
    const a = JSON.stringify(sweepableRanges(file, text));
    const b = JSON.stringify(sweepableRanges(file, text));
    if (a !== b) {
      io.out(`SCOPE MISMATCH: ${file}\n`);
      mismatches += 1;
    }
  }
  if (mismatches > 0) {
    io.out(`[scope-test] FAIL: ${mismatches} mismatch(es)\n`);
    return 1;
  }
  io.out(`[scope-test] PASS: sweep_scope == detect_scope for all ${files.length} in-scope files\n`);
  return 0;
}

export function doList(io: Io): number {
  const { files, status } = collectFiles();
  for (const f of files) io.out(`${f}\n`);
  return status;
}

/** `command -v aspell`: an executable `aspell` on PATH. */
function hasAspell(): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      try {
        const f = path.join(dir === "" ? "." : dir, `aspell${ext}`);
        if (fs.statSync(f).isFile()) {
          fs.accessSync(f, fs.constants.X_OK);
          return true;
        }
      } catch {
        // not here
      }
    }
  }
  return false;
}

export function doAspell(io: Io): number {
  io.out(
    hasAspell()
      ? "[aspell] advisory en_GB cross-check available but non-gating (informational only)\n"
      : "[aspell] not installed; skipping advisory cross-check (non-gating)\n",
  );
  return 0;
}

export { EngineExit };
