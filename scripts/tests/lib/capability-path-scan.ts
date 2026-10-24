// capability-path-scan.ts — the effective `paths:` of each trigger of one capability, from a plain
// text scan of ci/ci-capabilities.yml (no yaml dependency, so Layer 1 tests keep running on every OS).
// Spec 0283 R3: a trigger's own `paths:` (8 spaces) wins, else the capability-level `paths:` (4 spaces).

import fs from "node:fs";
import path from "node:path";

export function capabilityTriggerPaths(referenceText: string, id: string): string[][] {
  const lines = referenceText.split("\n");
  const start = lines.findIndex((l) => l === `  - id: ${id}`);
  if (start < 0) return [];
  const own: string[][] = [];
  const shared: string[] = [];
  let triggers = 0;
  let current: string[] | undefined;
  for (const l of lines.slice(start + 1)) {
    if (/^ {2}- id:/.test(l)) break;
    if (/^ {6}- on:/.test(l)) {
      triggers += 1;
      own.push([]);
      current = undefined;
    } else if (/^ {8}paths:\s*$/.test(l)) {
      current = own[own.length - 1];
      if (current) current.push("\u0000own");
    } else if (/^ {4}paths:\s*$/.test(l)) {
      current = shared;
    } else if (/^ {2,4}\S/.test(l) && !/^ {6,}/.test(l)) {
      current = undefined;
    }
    const m = /^ {6,10}- "([^"]+)"\s*$/.exec(l);
    if (m !== null && current !== undefined) current.push(m[1] ?? "");
  }
  return own
    .slice(0, triggers)
    .map((b) => (b.includes("\u0000own") ? b.filter((p) => p !== "\u0000own") : [...shared]));
}

/** The effective `pull-request` paths of capability `id`: what the runtime path gate matches (spec 0283 R6). */
export function gatePaths(id: string): string[] {
  const ref = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../ci/ci-capabilities.yml"),
    "utf8",
  );
  return capabilityTriggerPaths(ref, id)[0] ?? [];
}
