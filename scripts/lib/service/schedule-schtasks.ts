// schedule-schtasks.ts — the Windows calendar-trigger backend (spec 0258 requirement 15).
//
// An own flow, not the daemon backend's: there is NO `/Run` (the job fires on its calendar
// only). An existing task is read through task-ownership.ts; a task that is not CrewRig's is
// refused untouched; an own one is disabled, ended and deleted before the new definition is
// created from a UTF-16LE XML in a 0600 temp file. A created task that `/Query` does not
// return is deleted again. Presence and every mutation are decided by exit statuses only,
// no localized text is parsed (the verbatim text is quoted in diagnostics).
//
// Ownership is the marker and the task URI; the first argument of the existing task is not
// compared, because the entry lives in a checkout and a reinstall from another checkout must
// still replace its own task (the daemon tasks compare it: their program path is fixed).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runManager } from "./exec.ts";
import type { ExecResult } from "./exec.ts";
import { renderCalendarTaskXml } from "./schedule-render.ts";
import type { Outcome, ScheduleBackend, UninstallOutcome } from "./schedule-backend.ts";
import type { ScheduleNames } from "./schedule-names.ts";
import type { ScheduleSpec } from "./schedule-spec.ts";
import { GROUP_POLICY_SENTENCE } from "./schtasks.ts";
import { classifyTask, expectationFromDefinition, readTaskXml } from "./task-ownership.ts";
import { currentUserId, encodeUtf16le } from "./windows-task-xml.ts";

const mgr = (...args: string[]): ExecResult => runManager("schtasks", args);
const verbatim = (r: ExecResult): string => `${r.stderr}${r.stdout}`.trim() || `(${r.kind})`;
const fail = (reason: string): Outcome => ({ ok: false, reason });
const unavailable = (detail: string): string =>
  `Windows Task Scheduler (schtasks.exe) is unavailable: ${detail}. ${GROUP_POLICY_SENTENCE}`;
const refused = (args: readonly string[], r: ExecResult): string =>
  `Windows Task Scheduler refused the request: schtasks ${args.join(" ")} failed: ${verbatim(r)}. ${GROUP_POLICY_SENTENCE}`;

export function createScheduleBackend(): ScheduleBackend {
  /** Remove an own task: disable it, end it, delete it. A failed delete is the only failure. */
  function removeOwn(task: string): Outcome {
    mgr("/Change", "/TN", task, "/DISABLE");
    mgr("/End", "/TN", task);
    const del = mgr("/Delete", "/TN", task, "/F");
    return del.kind === "ok" ? { ok: true } : fail(refused(["/Delete", "/TN", task, "/F"], del));
  }

  /** `null` when absent, else why the task cannot be touched, or `"own"`. */
  function inspect(task: string): { readonly refusal: string } | "absent" | "own" {
    const read = readTaskXml(task);
    if (read.kind === "absent") return "absent";
    if (read.kind === "unavailable") return { refusal: unavailable(read.detail) };
    const programPath = expectationFromDefinition(read.xml)?.programPath ?? "";
    const own = classifyTask(read.xml, { taskUri: task, programPath });
    return own.kind === "own"
      ? "own"
      : {
          refusal: `the task ${task} exists and is not CrewRig's (${own.reason}); nothing was deleted or written`,
        };
  }

  return {
    kind: "schtasks",

    probe() {
      const r = mgr("/?");
      return r.kind === "ok" || r.kind === "nonzero"
        ? { ok: true }
        : { ok: false, capability: "schtasks.exe", detail: verbatim(r) };
    },

    render(names: ScheduleNames, spec: ScheduleSpec) {
      return [{ label: names.taskPath, text: renderCalendarTaskXml(names, spec, currentUserId()) }];
    },

    install(names: ScheduleNames, spec: ScheduleSpec) {
      const task = names.taskPath;
      const bytes = encodeUtf16le(renderCalendarTaskXml(names, spec, currentUserId()));
      const existing = inspect(task);
      if (typeof existing === "object") return fail(existing.refusal);
      if (existing === "own") {
        const removed = removeOwn(task);
        if (!removed.ok) return fail(`cannot replace the existing task: ${removed.reason}`);
      }
      const dir = mkdtempSync(join(tmpdir(), "crewrig-task-"));
      try {
        const file = join(dir, "task.xml");
        writeFileSync(file, bytes, { mode: 0o600 });
        const args = ["/Create", "/TN", task, "/XML", file];
        const create = mgr(...args);
        if (create.kind !== "ok") {
          mgr("/Delete", "/TN", task, "/F");
          return fail(refused(args, create));
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const query = mgr("/Query", "/TN", task);
      if (query.kind !== "ok") {
        mgr("/Delete", "/TN", task, "/F");
        return fail(
          `the created task is not returned by schtasks /Query /TN ${task}: ${verbatim(query)}; deleted it`,
        );
      }
      return { ok: true, detail: `Registered ${task}` };
    },

    uninstall(names: ScheduleNames): UninstallOutcome {
      const task = names.taskPath;
      const existing = inspect(task);
      if (existing === "absent") return { ok: true, absent: true };
      if (typeof existing === "object") return fail(existing.refusal);
      const removed = removeOwn(task);
      return removed.ok ? { ok: true, removedPath: task } : removed;
    },
  };
}
