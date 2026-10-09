// supervisor-pid.ts — the PID the service manager itself reports for the MCP
// daemon (spec 0252 requirement 5; plan v2 D1). Never read from a file a
// same-uid process could write (spec 0158 R2): `launchctl print` and
// `systemctl --user show` outputs are parsed in process, as the shell's
// `mcp_supervisor_pid` (scripts/lib/common.sh) does.
//
// The seam MEMPALACE_MCP_EXPECTED_PID fixes the answer for a hermetic suite;
// set but empty it forces "undeterminable". On Windows the answer is the
// `EnginePID` of the task snapshot.

import type { BackendKind, SupervisorPid } from "./backend.ts";
import { runManager } from "./exec.ts";
import type { ExecResult } from "./exec.ts";
import { taskPathOf } from "./names.ts";
import type { EnvLike, ServiceNames } from "./names.ts";
import { readTaskSnapshot } from "./task-snapshot.ts";

const PID_LINE_RE = /^[ \t]*pid = ([0-9]+)[ \t]*$/m;

/** The `pid = N` of `launchctl print` output, or `null`. */
export function parseLaunchctlPid(stdout: string): number | null {
  const match = PID_LINE_RE.exec(stdout);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** `systemctl show -p MainPID --value`: `0` (loaded, not running) is no PID. */
export function parseMainPid(stdout: string): number | null {
  const text = stdout.trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const pid = Number(text);
  return pid === 0 ? null : pid;
}

function fromSeam(value: string): SupervisorPid {
  if (value === "") return { state: "unverifiable", reason: "MEMPALACE_MCP_EXPECTED_PID is empty" };
  if (!/^[0-9]+$/.test(value) || Number(value) === 0) {
    return { state: "unverifiable", reason: "MEMPALACE_MCP_EXPECTED_PID is not a PID" };
  }
  return { state: "pid", pid: Number(value) };
}

function fromManager(
  tool: string,
  r: ExecResult,
  parse: (stdout: string) => number | null,
): SupervisorPid {
  if (r.kind === "absent" || r.kind === "timeout" || r.kind === "error") {
    return { state: "unverifiable", reason: `${tool} ${r.kind}` };
  }
  const pid = r.kind === "ok" ? parse(r.stdout) : null;
  return pid === null ? { state: "none" } : { state: "pid", pid };
}

/** The supervised process of `names` under the backend `kind`. */
export function lookupSupervisorPid(
  kind: BackendKind,
  names: ServiceNames,
  env: EnvLike = process.env,
  uid: number = process.getuid?.() ?? 0,
): SupervisorPid {
  const seam = env["MEMPALACE_MCP_EXPECTED_PID"];
  if (seam !== undefined) return fromSeam(seam);
  switch (kind) {
    case "launchd":
      return fromManager(
        "launchctl",
        runManager("launchctl", ["print", `gui/${uid}/${names.label}`]),
        parseLaunchctlPid,
      );
    case "systemd":
      return fromManager(
        "systemctl",
        runManager("systemctl", ["--user", "show", "-p", "MainPID", "--value", names.unit]),
        parseMainPid,
      );
    case "schtasks": {
      const snap = readTaskSnapshot(taskPathOf(names));
      if (!snap.ok) return { state: "unverifiable", reason: `task snapshot ${snap.reason}` };
      const pid = snap.task?.enginePid ?? null;
      return pid === null ? { state: "none" } : { state: "pid", pid };
    }
  }
}
