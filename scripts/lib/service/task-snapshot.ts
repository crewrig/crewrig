// task-snapshot.ts — Windows only: the Task Scheduler's view of one task and
// the process table, parsed in process from the JSON that os-inspect.ts's one
// constant PowerShell text prints (PLAN v3 D5 *State source* (2) and (3)).
//
// The JSON carries numbers and booleans only, so no localized text is parsed.
// This file spawns nothing: it calls `taskSnapshot` of os-inspect.ts. Every
// failure (tool absent, refused, timed out, unparseable output) is a failed
// snapshot, and the callers render it UNDETERMINED / UNVERIFIABLE.

import { taskSnapshot } from "./os-inspect.ts";
import type { InspectReason } from "./os-inspect.ts";

/** `TASK_STATE`: 0 unknown, 1 disabled, 2 queued, 3 ready, 4 running. */
export interface TaskInfo {
  present: boolean;
  /** Unsigned HRESULT of `GetTask` for an absent task (expected 0x80070002), else 0. */
  hresult: number;
  state: number;
  /** Unsigned `LastTaskResult` (0, 0x41301, 0x41303, 0x41306, any other a failure). */
  lastResult: number;
  /** The process the task engine started, or null when the task is not running. */
  enginePid: number | null;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  /** UTC epoch milliseconds; only present for the PIDs the caller asked about. */
  start?: number;
}

export type SnapshotFailure = InspectReason | "garbage";
export type Snapshot =
  | { ok: true; task: TaskInfo | null; processes: ProcessRow[] }
  | { ok: false; reason: SnapshotFailure };

const GARBAGE: Snapshot = { ok: false, reason: "garbage" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function unsigned(v: unknown): number | null {
  const n = int(v);
  return n === null || n < -(2 ** 31) || n >= 2 ** 32 ? null : n >>> 0;
}

function parseTask(raw: unknown): TaskInfo | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw) || typeof raw.present !== "boolean") return undefined;
  const hresult = unsigned(raw.hresult);
  const state = int(raw.state);
  const lastResult = unsigned(raw.lastResult);
  const engine = raw.enginePid === null ? null : int(raw.enginePid);
  if (hresult === null || state === null || lastResult === null) return undefined;
  if (raw.enginePid !== null && engine === null) return undefined;
  return { present: raw.present, hresult, state, lastResult, enginePid: engine };
}

/** The `processes` array of the PowerShell JSON; `null` when any row is malformed. */
export function parseProcessRows(raw: unknown): ProcessRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: ProcessRow[] = [];
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) return null;
    const pid = int(item.pid);
    const ppid = int(item.ppid);
    if (pid === null || ppid === null) return null;
    const start = item.start === undefined ? undefined : int(item.start);
    if (start === null) return null;
    rows.push(start === undefined ? { pid, ppid } : { pid, ppid, start });
  }
  return rows;
}

/** Parse the stdout of the PowerShell call; any deviation from the shape is `garbage`. */
export function parseSnapshot(stdout: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return GARBAGE;
  }
  if (!isRecord(data)) return GARBAGE;
  const task = parseTask(data.task === undefined ? null : data.task);
  const processes = parseProcessRows(data.processes);
  if (task === undefined || processes === null) return GARBAGE;
  return { ok: true, task, processes };
}

/** Ask the Task Scheduler about `taskPath` (for example `\CrewRig\mempalace-mcp-server`). */
export function readTaskSnapshot(taskPath: string, pids: readonly number[] = []): Snapshot {
  const r = taskSnapshot(taskPath, pids);
  if (!r.ok) return { ok: false, reason: r.reason };
  const snap = parseSnapshot(r.stdout);
  return snap.ok && snap.task === null ? GARBAGE : snap;
}
