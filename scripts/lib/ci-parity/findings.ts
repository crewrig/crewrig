// findings.ts — the DRIFT accumulator and the verdict (spec 0049 R9) of check-ci-parity.

import type { ParityState } from "./state.ts";

/** The shell's `fail`: print the DRIFT line and remember it. */
export function fail(state: ParityState, message: string): void {
  state.stderr += `  DRIFT: ${message}\n`;
  state.failures.push(message);
}

/** The reference-validity abort block; returns true when the run must stop (exit 1). */
export function reportValidity(state: ParityState): boolean {
  const n = state.validityErrors.length;
  if (n === 0) return false;
  state.stderr += `FAILED: ${n} reference-validity violation(s) in ${state.reference}:\n`;
  for (const e of state.validityErrors) state.stderr += `  - ${e}\n`;
  state.stderr += "\n";
  state.stderr += "The reference is the source of truth; refusing to check the engines against\n";
  state.stderr += "a malformed reference (spec 0049 R2).\n";
  state.code = 1;
  return true;
}

/** The final verdict: the FAILED footer, or the OK line naming the arms that ran. */
export function verdict(state: ParityState): void {
  if (state.failures.length > 0) {
    state.stderr += "\n";
    state.stderr += `FAILED: ${state.failures.length} CI parity violation(s) detected (spec 0049).\n`;
    state.code = 1;
    return;
  }
  let arms = "reference";
  if (state.ghaPresent) arms += ", GitHub Actions";
  if (state.gitlabPresent) arms += ", GitLab";
  state.stdout += `OK: ${arms} agree on the portable capability set; every pipeline job is traceable.\n`;
}
