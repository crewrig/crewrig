// schtasks.ts — the Windows Task Scheduler implementation of ServiceBackend
// (spec 0252 requirements 5, 8 and 33; PLAN v3 D1 and D5).
//
// Presence and every mutation are decided by `schtasks` EXIT STATUSES only: no
// localized text is parsed anywhere (the verbatim text is quoted in
// diagnostics and never inspected). State, last result and EnginePID come from
// task-snapshot.ts and are used for status reads and for the `stop` sweep only;
// install verification, rollback, ownership and uninstall never depend on
// PowerShell. The task leaf is `names.unit`, so a test passes a throwaway leaf
// through the names it hands to `install`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  InstallSpec,
  ServiceBackend,
  ServiceOutcome,
  ServiceStatus,
  SupervisorPid,
} from "./backend.ts";
import { runManager, type ExecResult } from "./exec.ts";
import { taskPathOf, type ServiceNames } from "./names.ts";
import { descendants } from "./process-tree.ts";
import {
  classifyTask,
  expectationFromDefinition,
  inspectTask,
  normalizeForCompare,
  readTaskXml,
  type OwnershipExpectation,
} from "./task-ownership.ts";
import { readTaskSnapshot, type TaskInfo } from "./task-snapshot.ts";
import { decodeTaskFile } from "./windows-task-xml.ts";

export const GROUP_POLICY_SENTENCE =
  "Group Policy or the machine's administrator may prohibit per-user scheduled tasks.";
export const STDIO_ADVICE =
  "No assistant has been switched; MemPalace keeps working in stdio mode, one session at a time.";
export const DOCTOR_POINTER = "Run doctor-mempalace for the state of the mechanism.";
export const SWEEP_UNDETERMINED =
  "process sweep UNDETERMINED: the process table could not be read, so this does not claim that no daemon process remains";
export const DISABLE_FAILED =
  "could not disable the task before ending it: a trigger may have started a new instance after the sweep, so a daemon process of the removed task may still run; run `status`, then `doctor-mempalace`, to find it";

export interface SchtasksOptions {
  /** Files an install put under ~/.crewrig/ that no other service uses; removed on a failed install. */
  readonly cleanupFiles?: () => readonly string[];
  /** The program path of a service's own chain, for the ownership test of `uninstall`. */
  readonly programPathOf?: (names: ServiceNames) => string | undefined;
  /** Where a degradation is reported; defaults to standard error. */
  readonly report?: (line: string) => void;
}

const ok = (detail?: string): ServiceOutcome =>
  detail === undefined ? { ok: true } : { ok: true, detail };
const fail = (reason: string): ServiceOutcome => ({ ok: false, reason });
const verbatim = (r: ExecResult): string => `${r.stderr}${r.stdout}`.trim() || `(${r.kind})`;
const command = (args: readonly string[]): string => `schtasks ${args.join(" ")}`;

/** The requirement-8 diagnostic: capability, failed command, verbatim text, policy, stdio, doctor. */
export function refusalMessage(args: readonly string[], r: ExecResult): string {
  const capability =
    r.kind === "nonzero"
      ? "Windows Task Scheduler refused the request"
      : "Windows Task Scheduler (schtasks.exe) is absent or refused by policy";
  return [
    `${capability}: ${command(args)} failed: ${verbatim(r)}`,
    GROUP_POLICY_SENTENCE,
    STDIO_ADVICE,
    DOCTOR_POINTER,
  ].join(" ");
}

function stateWords(t: TaskInfo): string {
  return `State ${t.state}, last result 0x${t.lastResult.toString(16)}`;
}

export function createBackend(options: SchtasksOptions = {}): ServiceBackend {
  const report = options.report ?? ((line: string) => void process.stderr.write(`${line}\n`));

  const mgr = (...args: string[]): ExecResult => runManager("schtasks", args);

  function removeInstalledFiles(): string {
    const files = options.cleanupFiles?.() ?? [];
    for (const f of files) rmSync(f, { force: true });
    return files.length === 0 ? "" : ` and removed ${files.length} installed file(s)`;
  }

  function rollback(task: string, why: string): ServiceOutcome {
    mgr("/Delete", "/TN", task, "/F");
    const files = removeInstalledFiles();
    return fail(`${why}; deleted the task it created${files}`);
  }

  /** Snapshot the daemon tree of a running task: pids with the start times that identify them. */
  function snapshotTree(
    task: string,
  ): { pids: number[]; starts: Map<number, number> } | "undetermined" | null {
    const first = readTaskSnapshot(task);
    if (!first.ok || first.task === null) return "undetermined";
    const root = first.task.enginePid;
    if (root === null) return null;
    const table = new Map(first.processes.map((p) => [p.pid, p.ppid] as const));
    const pids = [root, ...descendants(table, root)];
    const second = readTaskSnapshot(task, pids);
    if (!second.ok) return "undetermined";
    const starts = new Map<number, number>();
    for (const p of second.processes) if (p.start !== undefined) starts.set(p.pid, p.start);
    return { pids, starts };
  }

  /** End the task (requirement 33): snapshot, `/End`, then end leftovers by pid and start time. */
  function endTask(task: string): ServiceOutcome {
    const tree = snapshotTree(task);
    if (tree === null) return ok("was not running");
    const end = mgr("/End", "/TN", task);
    if (end.kind !== "ok") return fail(refusalMessage(["/End", "/TN", task], end));
    if (tree === "undetermined") {
      report(SWEEP_UNDETERMINED);
      return ok(SWEEP_UNDETERMINED);
    }
    const after = readTaskSnapshot(task, tree.pids);
    if (!after.ok) {
      report(SWEEP_UNDETERMINED);
      return ok(SWEEP_UNDETERMINED);
    }
    let killed = 0;
    for (const p of after.processes) {
      const was = tree.starts.get(p.pid);
      if (!tree.pids.includes(p.pid) || was === undefined || p.start !== was) continue;
      try {
        process.kill(p.pid, "SIGKILL");
        killed += 1;
      } catch {
        /* already gone */
      }
    }
    return ok(
      killed === 0 ? "ended" : `ended; ${killed} leftover process(es) of the daemon tree ended`,
    );
  }

  function expectationFor(names: ServiceNames): OwnershipExpectation | null {
    const programPath = options.programPathOf?.(names);
    return programPath === undefined ? null : { taskUri: taskPathOf(names), programPath };
  }

  return {
    kind: "schtasks",

    install(names: ServiceNames, spec: InstallSpec): ServiceOutcome {
      const task = taskPathOf(names);
      let bytes: Buffer;
      try {
        bytes = readFileSync(spec.definitionPath);
      } catch (e) {
        return fail(`cannot read the task definition ${spec.definitionPath}: ${String(e)}`);
      }
      const expect = expectationFromDefinition(decodeTaskFile(bytes));
      if (expect === null || normalizeForCompare(expect.taskUri) !== normalizeForCompare(task)) {
        return fail(
          `the task definition does not carry the crewrig:service-task marker of ${task}`,
        );
      }
      const existing = inspectTask(task, expect);
      if (existing.kind === "unavailable") {
        return fail(
          `Windows Task Scheduler (schtasks.exe) is unavailable: ${existing.detail}. ${GROUP_POLICY_SENTENCE} ${STDIO_ADVICE} ${DOCTOR_POINTER}`,
        );
      }
      if (existing.kind === "classified") {
        if (existing.ownership.kind === "foreign") {
          return fail(
            `the task ${task} exists and is not CrewRig's (${existing.ownership.reason}); nothing was deleted or written`,
          );
        }
        const del = mgr("/Delete", "/TN", task, "/F");
        if (del.kind !== "ok")
          return fail(
            `cannot replace the existing task: ${refusalMessage(["/Delete", "/TN", task, "/F"], del)}`,
          );
      }
      const dir = mkdtempSync(join(tmpdir(), "crewrig-task-"));
      try {
        const file = join(dir, "task.xml");
        writeFileSync(file, bytes, { mode: 0o600 });
        const createArgs = ["/Create", "/TN", task, "/XML", file];
        const create = mgr(...createArgs);
        if (create.kind !== "ok") {
          mgr("/Delete", "/TN", task, "/F");
          const files = removeInstalledFiles();
          return fail(
            `${refusalMessage(createArgs, create)}${files === "" ? "" : ` (${files.trim()})`}`,
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const query = mgr("/Query", "/TN", task);
      if (query.kind !== "ok")
        return rollback(
          task,
          `the created task is not returned by ${command(["/Query", "/TN", task])}: ${verbatim(query)}`,
        );
      const run = mgr("/Run", "/TN", task);
      if (run.kind !== "ok")
        return rollback(task, `${command(["/Run", "/TN", task])} was refused: ${verbatim(run)}`);
      return ok(`registered ${task} and started it`);
    },

    start(names: ServiceNames): ServiceOutcome {
      const args = ["/Run", "/TN", taskPathOf(names)];
      const r = mgr(...args);
      return r.kind === "ok" ? ok("started") : fail(`${command(args)} failed: ${verbatim(r)}`);
    },

    stop(names: ServiceNames): ServiceOutcome {
      return endTask(taskPathOf(names));
    },

    status(names: ServiceNames): ServiceStatus {
      const task = taskPathOf(names);
      const q = mgr("/Query", "/TN", task);
      if (q.kind !== "ok") return { registered: false, running: false, detail: "not registered" };
      const snap = readTaskSnapshot(task);
      if (!snap.ok || snap.task === null) {
        return {
          registered: true,
          running: false,
          detail: "state UNDETERMINED, last result UNDETERMINED",
        };
      }
      return { registered: true, running: snap.task.state === 4, detail: stateWords(snap.task) };
    },

    uninstall(names: ServiceNames): ServiceOutcome {
      const task = taskPathOf(names);
      const read = readTaskXml(task);
      if (read.kind === "absent") return ok("was not loaded");
      if (read.kind === "unavailable") {
        return fail(`Windows Task Scheduler (schtasks.exe) is unavailable: ${read.detail}`);
      }
      // Without the chain's program path (no `programPathOf`) only the marker
      // and the URI are tested: the first argument is compared with itself.
      const expect = expectationFor(names) ?? {
        taskUri: task,
        programPath: expectationFromDefinition(read.xml)?.programPath ?? "",
      };
      const own = classifyTask(read.xml, expect);
      if (own.kind === "foreign")
        return fail(`the task ${task} is not CrewRig's (${own.reason}); left in place`);
      // Disable first so that no trigger of the task can start a new instance while it is
      // ended and swept (spec 0252 delta-02): the repeating keep-alive trigger would.
      const disable = mgr("/Change", "/TN", task, "/DISABLE");
      const disableFailed = disable.kind !== "ok";
      if (disableFailed) report(DISABLE_FAILED);
      const ended = endTask(task);
      const del = mgr("/Delete", "/TN", task, "/F");
      if (del.kind !== "ok")
        return fail(`${command(["/Delete", "/TN", task, "/F"])} failed: ${verbatim(del)}`);
      const detail =
        ended.ok && ended.detail !== undefined && ended.detail !== "was not running"
          ? `removed; ${ended.detail}`
          : "removed";
      return ok(disableFailed ? `${detail}; ${DISABLE_FAILED}` : detail);
    },

    supervisorPid(names: ServiceNames): SupervisorPid {
      const snap = readTaskSnapshot(taskPathOf(names));
      if (!snap.ok || snap.task === null)
        return {
          state: "unverifiable",
          reason: `task snapshot failed (${snap.ok ? "garbage" : snap.reason})`,
        };
      return snap.task.enginePid === null
        ? { state: "none" }
        : { state: "pid", pid: snap.task.enginePid };
    },
  };
}
