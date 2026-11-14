// layout.ts — the output layout of a run (spec 0290 R10 as modified by delta-04; 0304 R27).
//
//   <out>/<skill>/eval-<id>/run-<r>/{transcript.md, grading.json, metrics.json, outputs/}
//   <out>/<skill>/probe-<n>/run-<r>/{transcript.md, metrics.json, probe.json}
//
// `r` is the 1-based run number of the slot; a resumed measurement never overwrites the directory
// of a recorded run.
//
// Usage: evalDir(out, skill, evalId, run). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

export const skillOutDir = (out: string, skill: string): string => path.join(out, skill);

export const evalDir = (out: string, skill: string, evalId: number, run: number): string =>
  path.join(skillOutDir(out, skill), `eval-${evalId}`, `run-${run}`);

export const probeDir = (out: string, skill: string, n: number, run: number): string =>
  path.join(skillOutDir(out, skill), `probe-${n}`, `run-${run}`);

export const outputsDirOf = (run: string): string => path.join(run, "outputs");

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
