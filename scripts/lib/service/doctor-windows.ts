// doctor-windows.ts — the fourth section of `doctor-mempalace`, Windows only
// (spec 0252 requirement 20; plan v3 D5 *State source*, step 33): *4. Background
// service mechanism*. It is informational: it returns nothing the exit status
// reads. It reports whether `schtasks.exe` is present, whether the operating
// system exposes a policy that prohibits the creation of tasks (read, never
// probed by creating a task; *UNDETERMINED* when it cannot be read), and, for each
// of the two CrewRig tasks, whether it is registered, running and with which last
// result. Presence comes from the `/Query` exit status; state and last result from
// the one snapshot call of task-snapshot.ts, never from localized text.

import { existsSync } from "node:fs";
import { executableFor, runManager } from "./exec.ts";
import { taskCreationPolicy } from "./os-inspect.ts";
import { serviceNames, taskPathOf } from "./names.ts";
import { hex, NOT_FAILURES, TASK_STATES } from "./status-report.ts";
import { readTaskSnapshot } from "./task-snapshot.ts";
import type { Snapshot } from "./task-snapshot.ts";
import { field } from "./doctor-report.ts";
import type { Write } from "./doctor-report.ts";

export type Policy = "prohibited" | "allowed" | "undetermined";

export interface WindowsSectionOptions {
  env: NodeJS.ProcessEnv;
  write: Write;
  /** Seams for tests; the real calls by default. */
  schtasksPath?: string;
  snapshot?: (taskPath: string) => Snapshot;
  registered?: (taskPath: string) => "yes" | "no" | "undetermined";
  policy?: () => Policy;
}

/** The policy read: `undetermined` whenever the call fails or its JSON is not `{prohibited: boolean}`. */
export function readPolicy(): Policy {
  const r = taskCreationPolicy();
  if (!r.ok) return "undetermined";
  try {
    const data: unknown = JSON.parse(r.stdout);
    const prohibited = (data as { prohibited?: unknown } | null)?.prohibited;
    if (prohibited === true) return "prohibited";
    return prohibited === false ? "allowed" : "undetermined";
  } catch {
    return "undetermined";
  }
}

function queryRegistered(taskPath: string): "yes" | "no" | "undetermined" {
  const q = runManager("schtasks", ["/Query", "/TN", taskPath]);
  if (q.kind === "ok") return "yes";
  return q.kind === "nonzero" ? "no" : "undetermined";
}

function describeTask(
  o: WindowsSectionOptions,
  title: string,
  taskPath: string,
  haveTool: boolean,
): void {
  const { write } = o;
  const registered = haveTool ? (o.registered ?? queryRegistered)(taskPath) : "undetermined";
  const snap = (o.snapshot ?? ((p) => readTaskSnapshot(p)))(taskPath);
  write(`  ${title} (${taskPath})`);
  field(
    write,
    "registered:",
    registered === "yes" ? "yes" : registered === "no" ? "NO" : "UNDETERMINED",
  );
  if (!snap.ok) {
    field(write, "running:", `UNDETERMINED (${snap.reason})`);
    field(write, "last result:", `UNDETERMINED (${snap.reason})`);
    return;
  }
  const t = snap.task;
  if (t === null || !t.present) {
    field(write, "running:", registered === "yes" ? "UNDETERMINED" : "no");
    field(write, "last result:", registered === "yes" ? "UNDETERMINED" : "none (no such task)");
    return;
  }
  field(
    write,
    "running:",
    t.state === 4 ? "yes" : `no (${TASK_STATES[t.state] ?? `state ${t.state}`})`,
  );
  const failed = t.state !== 4 && !NOT_FAILURES.has(t.lastResult);
  field(write, "last result:", `${hex(t.lastResult)}${failed ? " *** FAILED ***" : ""}`);
}

/** Print section 4. Never changes the exit status, creates no task, mutates nothing. */
export function sectionBackground(o: WindowsSectionOptions): void {
  const { write } = o;
  write("4. Background service mechanism");
  write("   (can this machine run the shared daemon as a scheduled task? informational:");
  write("   this section never changes the exit status)");
  write("");

  const tool = o.schtasksPath ?? executableFor("schtasks", "win32", o.env);
  const haveTool = existsSync(tool);
  field(write, "schtasks.exe:", haveTool ? `PRESENT (${tool})` : `ABSENT — ${tool} does not exist`);

  const policy = (o.policy ?? readPolicy)();
  if (policy === "prohibited") {
    field(write, "task creation policy:", "PROHIBITED — a policy forbids creating scheduled tasks");
  } else if (policy === "allowed") {
    field(write, "task creation policy:", "not prohibited by any policy this report can read");
  } else {
    field(write, "task creation policy:", "UNDETERMINED — the policy could not be read;");
    write("                            an install will answer");
  }
  write("");

  describeTask(o, "MCP daemon task", taskPathOf(serviceNames("mcp", o.env)), haveTool);
  write("");
  describeTask(o, "ChromaDB daemon task", taskPathOf(serviceNames("chroma", o.env)), haveTool);
  write("");

  if (policy === "prohibited") {
    write("  The shared daemon cannot be installed on this machine: the creation of");
    write("  scheduled tasks is prohibited. Each assistant therefore stays in stdio mode,");
    write("  one session at a time.");
    write("");
  }
}
