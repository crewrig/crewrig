// layout.ts — the output layout of a run (spec 0290 R10 as modified by delta-01).
//
//   <out>/<skill>/eval-<id>/<with_skill|without_skill>/{transcript.md, grading.json, metrics.json, outputs/}
//   <out>/<skill>/base/eval-<id>/with_skill/...      (the replay on the merge-base skill, R19)
//   <out>/<skill>/benchmark.json                     (head runs only)
//
// Usage: runDir(out, skill, evalId, "with_skill", false). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import type { Configuration } from "./benchmark.ts";

export const skillOutDir = (out: string, skill: string): string => path.join(out, skill);

export function runDir(
  out: string,
  skill: string,
  evalId: number,
  configuration: Configuration,
  base: boolean,
): string {
  return path.join(
    skillOutDir(out, skill),
    ...(base ? ["base"] : []),
    `eval-${evalId}`,
    configuration,
  );
}

export const outputsDirOf = (run: string): string => path.join(run, "outputs");

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
