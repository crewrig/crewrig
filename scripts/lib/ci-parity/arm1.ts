// arm1.ts — resolves each portable capability to its first attributed GitHub job and runs
// Arm 1, the cache-key check and the path filters for it, in the shell's order.

import { checkGhaCache, checkGhaJob } from "./gha-arm.ts";
import { jobNode, loadJobs, readJob } from "./job-records.ts";
import { checkGhaPaths } from "./path-filters.ts";
import type { ParityState } from "./state.ts";

export function arm1(state: ParityState): void {
  if (!state.ghaPresent) return;
  for (const pid of state.portableIds) {
    if (pid === "") continue;
    const hit = state.ghaJobs.find((j) => j.id === pid);
    if (hit === undefined) continue; // an Arm-3 omission
    const cap = state.caps.find((c) => c.id === pid);
    if (cap === undefined) continue;
    const job = readJob(jobNode(loadJobs(hit.workflow), hit.jobKey));
    checkGhaJob(state, cap, job, hit.jobKey);
    if (cap.cacheLen !== 0) checkGhaCache(state, cap, job);
    checkGhaPaths(state, cap, hit.workflow, hit.jobKey);
  }
}
