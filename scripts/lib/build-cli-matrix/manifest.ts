// manifest.ts — manifest and source-tree validation for the CLI-matrix generator (spec 0272 R4).
//
// Usage: readManifest(sourceDir), partOf(basename)
// Exit codes: not applicable (library); failures throw Error.
// Finding-line format: not applicable.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const LEADING = ["intro.md", "supported-clis.md", "feature-matrix.md"];
export const TRAILING = ["notes.md", "parity-gaps.md", "adding-a-cli.md"];
const FIXED = new Set([...LEADING, ...TRAILING]);

export type Part = { name: string; path: string; offset: number; prefix: string; isRow: boolean };

/** Describe a manifest entry: where it lives, its heading offset and its link prefix. */
export function partOf(sourceDir: string, name: string): Part {
  if (name === "intro.md")
    return { name, path: join(sourceDir, name), offset: 0, prefix: "../", isRow: false };
  if (FIXED.has(name))
    return { name, path: join(sourceDir, name), offset: 1, prefix: "../", isRow: false };
  return { name, path: join(sourceDir, "rows", name), offset: 2, prefix: "../../", isRow: true };
}

function mdFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/** Read `order.txt` and check it against the files on disk; returns the ordered parts. */
export function readManifest(sourceDir: string): Part[] {
  const raw = readFileSync(join(sourceDir, "order.txt"), "utf8").replace(/\r/g, "");
  const names = raw.split("\n").filter((l) => l.trim() !== "");
  const seen = new Set<string>();
  for (const n of names) {
    if (n !== n.trim() || n.includes("/")) throw new Error(`order.txt: invalid entry "${n}"`);
    if (seen.has(n)) throw new Error(`order.txt: duplicate entry "${n}"`);
    seen.add(n);
  }
  const lead = names.slice(0, LEADING.length);
  const trail = names.slice(names.length - TRAILING.length);
  if (lead.join() !== LEADING.join() || trail.join() !== TRAILING.join()) {
    throw new Error(
      `order.txt: must start with ${LEADING.join(", ")} and end with ${TRAILING.join(", ")}`,
    );
  }
  const parts = names.map((n) => partOf(sourceDir, n));
  for (const p of parts) {
    if (!existsSync(p.path)) throw new Error(`order.txt: "${p.name}" has no file at ${p.path}`);
  }
  const onDisk = [...mdFiles(sourceDir), ...mdFiles(join(sourceDir, "rows"))];
  for (const f of onDisk) {
    if (!seen.has(f)) throw new Error(`source file "${f}" is absent from order.txt`);
  }
  return parts;
}

/** The row id of a row file: the first token of its level-1 heading. */
export function rowHeadingId(text: string, where: string): string {
  const m = /^# (\S+) — /.exec(text);
  if (!m) throw new Error(`${where}: row heading must read "# <id> — <feature>"`);
  return m[1]!;
}
