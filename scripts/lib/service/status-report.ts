// status-report.ts — the launcher-drift, task and assistant sections of the
// MCP daemon status report (spec 0252 requirement 15; plan v3 D1 row
// status-report, D8). Messages are those of scripts/status-mcp-server.sh
// sections 4 and 5; the `task:` line is Windows only.
//
// Each section returns the exit contribution (0 or 1) and prints through
// `write`. Nothing here spawns except through exec.ts and task-snapshot.ts.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { reportArrangements } from "./assistant-arrangement.ts";
import { runManager } from "./exec.ts";
import { launcherSourceSha } from "./program-install.ts";
import { recordForm } from "./launcher-record.ts";
import { taskPathOf } from "./names.ts";
import type { ServiceNames } from "./names.ts";
import { readTaskSnapshot } from "./task-snapshot.ts";
import type { Snapshot } from "./task-snapshot.ts";

export type Write = (line: string) => void;
type Env = NodeJS.ProcessEnv;

/** `scripts/lib/mcp-daemon-launcher.sh`, the source of the shell form. */
function shellLauncherSha(repoRoot: string): string | null {
  try {
    return createHash("sha256")
      .update(readFileSync(path.join(repoRoot, "scripts", "lib", "mcp-daemon-launcher.sh")))
      .digest("hex");
  } catch {
    return null;
  }
}

function currentSha(program: string | null, repoRoot: string): string | null {
  if (program === null) return shellLauncherSha(repoRoot);
  try {
    return launcherSourceSha(path.join(repoRoot, "scripts", "lib"));
  } catch {
    return null;
  }
}

/** The interpreter the supervisor definition runs (an absolute path), or null when it cannot be told. */
export function definitionInterpreter(
  platform: NodeJS.Platform,
  names: ServiceNames,
  home: string,
): string | null {
  try {
    if (platform === "darwin") {
      const plist = readFileSync(
        path.join(home, "Library", "LaunchAgents", `${names.label}.plist`),
        "utf8",
      );
      const args = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(plist);
      return args?.[1] ?? null;
    }
    if (platform === "linux") {
      const unit = readFileSync(
        path.join(home, ".config", "systemd", "user", `${names.unit}.service`),
        "utf8",
      );
      const exec = /^ExecStart=\s*(\S+)/m.exec(unit);
      return exec?.[1] ?? null;
    }
  } catch {
    // no definition on disk: nothing to compare
  }
  return null;
}

export interface DriftOptions {
  env: Env;
  home: string;
  repoRoot: string;
  platform: NodeJS.Platform;
  names: ServiceNames;
  launcher: string;
  write: Write;
}

/** Section 4: the launcher in both forms, then the supervisor interpreter. Returns 1 on failure. */
export function launcherSection(o: DriftOptions): 0 | 1 {
  const { launcher, write } = o;
  let rc: 0 | 1 = 0;
  let isRegular = false;
  try {
    isRegular = statSync(launcher).isFile();
  } catch {
    isRegular = false;
  }
  if (!isRegular) {
    write(`  launcher: NOT INSTALLED at ${launcher}`);
    return 1;
  }
  const text = readFileSync(launcher, "utf8");
  const form = recordForm(text);
  const program = form.form === "typescript" ? form.program : null;
  const recorded = /(?:^|\n)LAUNCHER_SOURCE_SHA="([^"\n]*)"/.exec(text)?.[1] ?? "";
  if (program !== null && !existsSync(program)) {
    write(`  launcher: ${launcher} *** PROGRAM MISSING ***`);
    write(`            the record names ${program}, which does not exist.`);
    write("            Re-run setup to reinstall it.");
    rc = 1;
  } else {
    const current = currentSha(program, o.repoRoot) ?? "";
    if (recorded === "" || current === "") {
      write(`  launcher: ${launcher} (drift UNKNOWN — no recorded source hash)`);
    } else if (recorded === current) {
      write(`  launcher: ${launcher} (in sync with the repository)`);
    } else {
      write(`  launcher: ${launcher} *** DRIFTED ***`);
      write(`            built from ${recorded}, repository now ${current}`);
      write("            Re-run setup to refresh it.");
      rc = 1;
    }
  }
  const interpreter = definitionInterpreter(o.platform, o.names, o.home);
  if (interpreter !== null && path.isAbsolute(interpreter) && !existsSync(interpreter)) {
    write(`  launcher: ${launcher} *** DRIFTED ***`);
    write(`            the supervisor definition runs ${interpreter}, which no longer exists`);
    write("            (a removed or upgraded Node.js). Re-run the switch:");
    write("            bash scripts/switch-mempalace-http.sh");
    rc = 1;
  }
  return rc;
}

const TASK_STATES: Readonly<Record<number, string>> = {
  0: "unknown",
  1: "disabled",
  2: "queued",
  3: "ready",
  4: "running",
};
/** Success, running, not yet run, terminated by the user, and an ignored new instance. */
const NOT_FAILURES: ReadonlySet<number> = new Set([0, 0x41301, 0x41303, 0x41306, 0x800710e0]);

const hex = (n: number): string => `0x${n.toString(16)}`;

export interface TaskOptions {
  names: ServiceNames;
  write: Write;
  /** Seams for tests. */
  snapshot?: (taskPath: string) => Snapshot;
  registered?: (taskPath: string) => boolean;
}

/** Windows only: the `task:` line. Returns 1 when the task is registered, not running and failed. */
export function taskSection(o: TaskOptions): 0 | 1 {
  const taskPath = taskPathOf(o.names);
  const registered = (
    o.registered ?? ((p) => runManager("schtasks", ["/Query", "/TN", p]).kind === "ok")
  )(taskPath);
  const snap = (o.snapshot ?? ((p) => readTaskSnapshot(p)))(taskPath);
  const presence = registered ? "registered" : "NOT REGISTERED";
  if (!snap.ok) {
    o.write(
      `  task:     ${presence}, state UNDETERMINED, last result UNDETERMINED (${snap.reason})`,
    );
    return 0;
  }
  const t = snap.task;
  if (t === null || !t.present) {
    o.write(`  task:     ${presence}, state UNDETERMINED, last result UNDETERMINED`);
    return 0;
  }
  const state = TASK_STATES[t.state] ?? `state ${t.state}`;
  const line = `  task:     ${presence}, ${state}, last result ${hex(t.lastResult)}`;
  if (registered && t.state !== 4 && !NOT_FAILURES.has(t.lastResult)) {
    o.write(`${line} *** FAILED ***`);
    o.write("            The task is not running and its last run failed; it may have stopped");
    o.write("            for good after its restart count ran out. Re-run the switch:");
    o.write("            bash scripts/switch-mempalace-http.sh");
    return 1;
  }
  o.write(line);
  return 0;
}

/** Section 5: the per-assistant arrangement report. Returns 1 when an assistant is locked out. */
export function assistantSection(
  rc: number,
  installedEndpoint: string,
  env: Env,
  home: string,
  write: Write,
): 0 | 1 {
  write("");
  write("Assistant registrations:");
  if (rc !== 0) {
    reportArrangements("", installedEndpoint, env, home, write);
    return 0;
  }
  if (reportArrangements("serving", installedEndpoint, env, home, write)) return 0;
  write("            One or more assistants are still in stdio mode while the shared");
  write("            daemon is serving. They are locked out of writes by the daemon's");
  write("            exclusive lease. Run: bash scripts/switch-mempalace-http.sh");
  return 1;
}
