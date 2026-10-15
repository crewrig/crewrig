// schedule-systemd.ts — the Linux calendar-trigger backend (spec 0258 requirement 15).
//
// A `Type=oneshot` `<unit>.service` and the `<unit>.timer` that fires it, both under
// `~/.config/systemd/user`, written through staged temp files. The timer is the unit that
// is enabled (`enable --now <unit>.timer`); the service is never started by the install.
// A reinstall over an existing timer file first runs `disable --now` so the new calendar is
// re-armed. A failure at any point rolls back completely: `disable --now`, both files removed,
// `daemon-reload`. `uninstall` tests the timer file BEFORE spawning any `systemctl`, so a
// box with no user session (a CI runner) is not asked anything when there is nothing to remove.

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runManager } from "./exec.ts";
import type { ExecResult } from "./exec.ts";
import { writeStaged } from "./program-install.ts";
import { renderTimerPair } from "./schedule-render.ts";
import type { ScheduleBackend, UninstallOutcome } from "./schedule-backend.ts";
import type { ScheduleNames } from "./schedule-names.ts";
import type { ScheduleSpec } from "./schedule-spec.ts";
import { unitPathFor } from "./systemd.ts";

function systemctl(...args: string[]): ExecResult {
  return runManager("systemctl", ["--user", ...args]);
}

const verbatim = (r: ExecResult): string =>
  `${r.stderr}${r.stdout}`.trim() || (r.kind === "nonzero" ? `exit ${r.status}` : r.kind);

export function createScheduleBackend(home: string = homedir()): ScheduleBackend {
  const servicePath = (names: ScheduleNames): string => unitPathFor(names, home);
  const timerPath = (names: ScheduleNames): string =>
    path.join(path.dirname(servicePath(names)), `${names.unit}.timer`);

  function removeAll(names: ScheduleNames): void {
    systemctl("disable", "--now", `${names.unit}.timer`);
    rmSync(timerPath(names), { force: true });
    rmSync(servicePath(names), { force: true });
    systemctl("daemon-reload");
  }

  return {
    kind: "systemd",

    probe() {
      const r = systemctl("show-environment");
      return r.kind === "ok"
        ? { ok: true }
        : { ok: false, capability: "user systemd session", detail: verbatim(r) };
    },

    render(names: ScheduleNames, spec: ScheduleSpec) {
      const pair = renderTimerPair(names, spec);
      return [
        { label: servicePath(names), text: pair.service },
        { label: timerPath(names), text: pair.timer },
      ];
    },

    install(names: ScheduleNames, spec: ScheduleSpec) {
      const pair = renderTimerPair(names, spec);
      const timer = `${names.unit}.timer`;
      let failure: string | null = null;
      // A reinstall replaces: `enable --now` on an already-active timer does not re-arm a
      // rewritten `OnCalendar`, so an earlier registration is disabled and stopped first (the
      // result is ignored). The first install, with no timer file, issues no such verb.
      if (existsSync(timerPath(names))) systemctl("disable", "--now", timer);
      try {
        writeStaged(servicePath(names), pair.service, 0o644);
        writeStaged(timerPath(names), pair.timer, 0o644);
      } catch (error) {
        failure = `cannot write the unit files: ${String(error)}`;
      }
      if (failure === null) {
        const reload = systemctl("daemon-reload");
        if (reload.kind !== "ok")
          failure = `systemctl --user daemon-reload failed: ${verbatim(reload)}`;
      }
      if (failure === null) {
        const enable = systemctl("enable", "--now", timer);
        if (enable.kind !== "ok") {
          failure = `systemctl --user enable --now ${timer} failed: ${verbatim(enable)}`;
        }
      }
      if (failure !== null) {
        removeAll(names);
        return { ok: false, reason: `${failure}; rolled back` };
      }
      return { ok: true, detail: `Enabled and scheduled: ${timer}` };
    },

    uninstall(names: ScheduleNames): UninstallOutcome {
      const timerFile = timerPath(names);
      if (!existsSync(timerFile)) return { ok: true, absent: true };
      removeAll(names);
      return { ok: true, removedPath: timerFile };
    },
  };
}
