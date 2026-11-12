// layout.ts — the output layout of a run (spec 0290 R10 as modified by delta-04).
//
//   <out>/<skill>/eval-<id>/{transcript.md, grading.json, metrics.json, outputs/}
//   <out>/<skill>/probe-<n>/{transcript.md, metrics.json, probe.json}
//
// Usage: evalDir(out, skill, evalId). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

export const skillOutDir = (out: string, skill: string): string => path.join(out, skill);

export const evalDir = (out: string, skill: string, evalId: number): string =>
  path.join(skillOutDir(out, skill), `eval-${evalId}`);

export const probeDir = (out: string, skill: string, n: number): string =>
  path.join(skillOutDir(out, skill), `probe-${n}`);

export const outputsDirOf = (run: string): string => path.join(run, "outputs");

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
