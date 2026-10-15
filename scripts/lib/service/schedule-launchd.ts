// schedule-launchd.ts — the macOS calendar-trigger backend (spec 0258 requirement 15).
//
// The plist carries `StartCalendarInterval` and no `RunAtLoad`, so the job does not fire
// at install; no start verb is ever issued. The legacy verb pair stays: `launchctl unload
// -w` (result ignored: nothing may be loaded yet) then `load -w`. Every spawn goes
// through exec.ts `runManager`; the plist is written through a staged temp file.

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { runManager } from "./exec.ts";
import { plistPathFor } from "./launchd.ts";
import { writeStaged } from "./program-install.ts";
import { renderCalendarPlist } from "./schedule-render.ts";
import type { ScheduleBackend, UninstallOutcome } from "./schedule-backend.ts";
import type { ScheduleNames } from "./schedule-names.ts";
import type { ScheduleSpec } from "./schedule-spec.ts";

export function createScheduleBackend(home: string = homedir()): ScheduleBackend {
  return {
    kind: "launchd",

    probe: () => ({ ok: true }),

    render(names: ScheduleNames, spec: ScheduleSpec) {
      return [{ label: plistPathFor(names, home), text: renderCalendarPlist(names, spec) }];
    },

    install(names: ScheduleNames, spec: ScheduleSpec) {
      const plist = plistPathFor(names, home);
      const text = renderCalendarPlist(names, spec);
      try {
        writeStaged(plist, text, 0o644);
      } catch (error) {
        return { ok: false, reason: `cannot write ${plist}: ${String(error)}` };
      }
      runManager("launchctl", ["unload", "-w", plist]);
      const load = runManager("launchctl", ["load", "-w", plist]);
      if (load.kind !== "ok") {
        rmSync(plist, { force: true });
        const why =
          load.kind === "nonzero" ? load.stderr.trim() || `exit ${load.status}` : load.kind;
        return { ok: false, reason: `launchctl load -w failed: ${why}; removed ${plist}` };
      }
      return { ok: true, detail: `Loaded launchd agent: ${names.label}` };
    },

    uninstall(names: ScheduleNames): UninstallOutcome {
      const plist = plistPathFor(names, home);
      if (!existsSync(plist)) return { ok: true, absent: true };
      runManager("launchctl", ["unload", "-w", plist]);
      rmSync(plist, { force: true });
      return { ok: true, removedPath: plist };
    },
  };
}
