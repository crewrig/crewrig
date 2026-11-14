// case-hash.ts — the case hash of an eval (spec 0304 R14).
//
// SHA-256, written `sha256:<64 hex>`, over the canonical JSON of the eval entry (keys sorted at
// every level, no insignificant whitespace, UTF-8), a NUL byte, then for each entry of its `files`
// sorted by path: the path in UTF-8, NUL, the file size in decimal ASCII, NUL, the file's bytes
// unmodified and NUL. Two evals are the same case when their hashes are equal; the attestation
// recomputes the hash of every recorded eval from the working tree.
//
// Usage: caseHashesOf(evalsText, skillDirAbs); evalListProblem(recordedIds, treeIds).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** JSON with the keys of every object sorted and no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export interface FixtureFile {
  readonly path: string;
  readonly bytes: Buffer;
}

export function caseHash(entry: unknown, files: readonly FixtureFile[]): string {
  const h = createHash("sha256");
  const nul = Buffer.from([0]);
  h.update(Buffer.from(canonicalJson(entry), "utf8"));
  h.update(nul);
  const sorted = [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  for (const f of sorted) {
    h.update(Buffer.from(f.path, "utf8"));
    h.update(nul);
    h.update(Buffer.from(String(f.bytes.length), "ascii"));
    h.update(nul);
    h.update(f.bytes);
    h.update(nul);
  }
  return `sha256:${h.digest("hex")}`;
}

/** The case hash of every eval of an evals.json text, by id, with fixtures read from `skillDirAbs`. */
export function caseHashesOf(evalsText: string, skillDirAbs: string): Map<number, string> {
  const out = new Map<number, string>();
  let doc: unknown;
  try {
    doc = JSON.parse(evalsText);
  } catch {
    return out;
  }
  const evals = (doc as { evals?: unknown } | null)?.evals;
  if (!Array.isArray(evals)) return out;
  for (const entry of evals as Record<string, unknown>[]) {
    const id = entry["id"];
    if (typeof id !== "number") continue;
    const names = Array.isArray(entry["files"]) ? (entry["files"] as string[]) : [];
    const files: FixtureFile[] = [];
    for (const f of names) {
      try {
        files.push({ path: f, bytes: fs.readFileSync(path.join(skillDirAbs, f)) });
      } catch {
        files.push({ path: f, bytes: Buffer.alloc(0) });
      }
    }
    out.set(id, caseHash(entry, files));
  }
  return out;
}

/** R14: why the recorded evals differ from the tree's (naming the eval), or undefined. */
export function caseProblem(
  recorded: ReadonlyMap<number, string>,
  tree: ReadonlyMap<number, string>,
): string | undefined {
  for (const id of tree.keys())
    if (!recorded.has(id))
      return `eval ${id} is in the tree but was not recorded by the measurement`;
  for (const id of recorded.keys())
    if (!tree.has(id)) return `eval ${id} was recorded but is absent from the tree`;
  for (const [id, h] of recorded)
    if (tree.get(id) !== h)
      return `eval ${id} changed after the measurement (its case_hash differs from the tree's)`;
  return undefined;
}
