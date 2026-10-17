// entry.ts — one check-ci-parity run: the sections in the shell's order, then the verdict.
// Sections not yet ported are listed in PENDING_SECTIONS (arm 1, arm 2, path filters).

import fs from "node:fs";

import { arm3, traceability } from "./traceability.ts";
import { reportValidity, verdict } from "./findings.ts";
import { checkReference, collectIds } from "./reference.ts";
import { newState } from "./state.ts";

export const PENDING_SECTIONS = ["arm1-gha", "arm2-gitlab", "path-filters"] as const;

export interface Outcome {
  stdout: string;
  stderr: string;
  code: number;
}

/** Arguments are ignored, as in the shell; `repoDir` stands for CREWRIG_REPO_DIR. */
export function run(_args: string[], repoDir: string): Outcome {
  const state = newState(repoDir);
  const done = (): Outcome => ({ stdout: state.stdout, stderr: state.stderr, code: state.code });
  if (!fs.existsSync(state.reference) || !fs.statSync(state.reference).isFile()) {
    state.stderr += `Error: CI reference not found: ${state.reference}\n`;
    state.code = 2;
    return done();
  }
  if (!checkReference(state, fs.readFileSync(state.reference, "utf8"))) return done();
  if (reportValidity(state)) return done();
  collectIds(state);
  traceability(state);
  arm3(state);
  verdict(state);
  return done();
}
