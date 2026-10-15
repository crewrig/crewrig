// schedule-names.ts — the names of the scheduled harness-curator job (spec 0258
// requirement 15; PLAN v2 step 16).
//
// The job is a calendar-triggered job, not a supervised daemon, so it does NOT
// extend names.ts `DaemonKind`: its record carries the discriminator "curator",
// which keeps every existing `ServiceNames` consumer untouched. The record is
// still compatible with the helpers that read only `label` or `unit`
// (`Pick<ServiceNames, "label" | "unit">`).
//
// The label equals the one the shell wrote (`io.crewrig.harness-curator`), so a
// plist written by `schedule-curator.sh` is replaced in place.

import type { ServiceNames } from "./names.ts";
import { windowsTaskPath } from "./names.ts";

export const CURATOR_LABEL = "io.crewrig.harness-curator";
export const CURATOR_UNIT = CURATOR_LABEL;

export interface ScheduleNames extends Pick<ServiceNames, "label" | "unit"> {
  readonly kind: "curator";
  /** `\CrewRig\<unit>`. */
  readonly taskPath: string;
}

/**
 * The names of the curator job. `leaf` is a library-only seam for throwaway
 * names in tests (it replaces the label, the unit and the Windows task leaf);
 * the entry never passes it. A leaf outside `[A-Za-z0-9._-]` is refused.
 */
export function curatorNames(leaf?: string): ScheduleNames {
  const name = leaf ?? CURATOR_UNIT;
  return {
    kind: "curator",
    label: leaf ?? CURATOR_LABEL,
    unit: name,
    taskPath: windowsTaskPath(name),
  };
}
