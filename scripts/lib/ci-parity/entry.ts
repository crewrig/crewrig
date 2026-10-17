// entry.ts — one check-ci-parity run: the sections in the shell's order, then the verdict.
// PENDING_SECTIONS lists the sections not yet ported (none).

import fs from "node:fs";

import { firstLine } from "../first-line.ts";
import { arm3, traceability } from "./traceability.ts";
import { reportValidity, verdict } from "./findings.ts";
import { checkReference, collectIds } from "./reference.ts";
import { arm1 } from "./arm1.ts";
import { arm2 } from "./gitlab-arm.ts";
import { ParityGap, ShellAbort, newState } from "./state.ts";

export const PENDING_SECTIONS: readonly string[] = [];

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
  try {
    traceability(state);
    arm1(state);
    arm2(state);
    arm3(state);
    verdict(state);
  } catch (e) {
    if (e instanceof ShellAbort) state.code = e.code;
    else if (e instanceof ParityGap) {
      // req 24 (c): where the shell aborts through yq, one `Error: <path>: <reason>` line, exit 1.
      state.stderr += `Error: ${e.file ?? state.repoDir}: ${firstLine(e.message)}\n`;
      state.code = 1;
    } else throw e;
  }
  return done();
}
