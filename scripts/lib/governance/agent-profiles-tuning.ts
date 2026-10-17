// agent-profiles-tuning.ts — assertion P8: the five tuning knobs and their ranges
// (twin of `check_tuning_value` in scripts/check-agent-profiles.sh).

import { get, type YqMap } from "../yq-accessors/index.ts";
import { AgentProfilesError, type Fail, valueOf } from "./agent-profiles-yq.ts";

const INT64_MAX = 9223372036854775807n;

/** awk's `x+0`: the numeric prefix of a digits-and-dots string. */
function awkNumber(v: string): number {
  const prefix = /^[0-9]*\.?[0-9]*/.exec(v)?.[0] ?? "";
  return prefix === "" || prefix === "." ? 0 : Number(prefix);
}

function checkInteger(knob: string, v: string, min: number, fail: Fail): void {
  if (v === "" || /[^0-9]/.test(v)) {
    fail("P8", `tuning.${knob} '${v}' is not an integer`);
    return;
  }
  const n = BigInt(v);
  // Bash's `[ -lt ]` refuses an operand past 64 bits with a diagnostic of its own.
  if (n > INT64_MAX) throw new AgentProfilesError(`tuning.${knob}: integer expression expected`);
  if (n < BigInt(min)) fail("P8", `tuning.${knob} '${v}' is below the minimum ${min}`);
}

function checkNumber(
  knob: string,
  v: string,
  lo: string,
  hi: string,
  openFloor: boolean,
  fail: Fail,
): void {
  if (v === "" || /[^0-9.]/.test(v)) {
    fail("P8", `tuning.${knob} '${v}' is not a number`);
    return;
  }
  const x = awkNumber(v);
  const aboveFloor = openFloor ? x > Number(lo) : x >= Number(lo);
  if (aboveFloor && x <= Number(hi)) return;
  fail(
    "P8",
    openFloor
      ? `tuning.${knob} '${v}' is outside (${lo}, ${hi}] — open at the floor`
      : `tuning.${knob} '${v}' is outside ${lo}..${hi} inclusive`,
  );
}

/** Run the five knob checks, in the shell's order, over a mapping-valued `tuning`. */
export function checkTuningKnobs(tuning: YqMap, fail: Fail): void {
  const read = (knob: string): string | undefined =>
    tuning.entries.some(([k]) => k === knob) ? valueOf(get(tuning, [knob])) : undefined;
  let v = read("temperature");
  if (v !== undefined) checkNumber("temperature", v, "0.0", "2.0", false, fail);
  v = read("top-p");
  if (v !== undefined) checkNumber("top-p", v, "0.0", "1.0", true, fail);
  for (const knob of ["top-k", "max-output-tokens", "max-turns"]) {
    v = read(knob);
    if (v !== undefined) checkInteger(knob, v, 1, fail);
  }
}
