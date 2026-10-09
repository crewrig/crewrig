// os-inspect.ts — the ONE module that spawns `netstat`, `ps` or `powershell` for
// process and socket inspection (spec 0215 delta-05 requirement 23; spec 0252
// requirement 16 as modified by delta-01; PLAN v3 D1, D5 *State source*, D8).
//
// Rules this module keeps for every caller:
//   - each tool is resolved at the operating system's own absolute path, never
//     through the search path (macOS /usr/sbin/netstat and /bin/ps; Windows
//     %SystemRoot%\System32\netstat.exe and the v1.0 powershell.exe);
//   - argument arrays, no shell, a bounded run, and a minimal environment that
//     carries no credential (an allow-list, never `process.env` wholesale);
//   - `powershell` runs only with -NoProfile -NonInteractive and ONE constant
//     script text; the task path and the PID list travel in the environment
//     variables CREWRIG_TASK_PATH and CREWRIG_PID_LIST, never in the text;
//   - the output is returned for the caller to parse in process.
// Linux spawns nothing: the /proc file system answers (callers read it).

import { spawnSync } from "node:child_process";
import { win32 } from "node:path";

export type InspectReason = "absent" | "refused" | "timeout";
export type InspectResult = { ok: true; stdout: string } | { ok: false; reason: InspectReason };

/** What the runner is asked to execute: an absolute file, an argument array, an environment. */
export interface InspectSpec {
  file: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
}
export type InspectRunner = (spec: InspectSpec) => InspectResult;

/**
 * The constant PowerShell text. It reads its inputs from the environment and
 * prints one JSON object of numbers and booleans only (no localized text):
 * `{task: null | {present, hresult, state, lastResult, enginePid}, processes: [{pid, ppid, start?}]}`.
 * `start` (UTC epoch milliseconds) is emitted only for the PIDs of CREWRIG_PID_LIST.
 */
export const POWERSHELL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$task = $null",
  "if ($env:CREWRIG_TASK_PATH) {",
  "  $svc = New-Object -ComObject 'Schedule.Service'",
  "  $svc.Connect()",
  "  $task = [ordered]@{ present = $false; hresult = 0; state = 0; lastResult = 0; enginePid = $null }",
  "  try {",
  "    $t = $svc.GetFolder('\\').GetTask($env:CREWRIG_TASK_PATH)",
  "    $task.present = $true; $task.state = [int]$t.State; $task.lastResult = [int]$t.LastTaskResult",
  "  } catch { $task.hresult = [int]$_.Exception.HResult }",
  "  foreach ($r in $svc.GetRunningTasks(1)) {",
  "    if ($r.Path -eq $env:CREWRIG_TASK_PATH) { $task.enginePid = [int]$r.EnginePID }",
  "  }",
  "}",
  "$want = @(); if ($env:CREWRIG_PID_LIST) { $want = @($env:CREWRIG_PID_LIST -split ',' | ForEach-Object { [int]$_ }) }",
  "$rows = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process' | ForEach-Object {",
  "  $row = [ordered]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId }",
  "  if ($want -contains [int]$_.ProcessId -and $_.CreationDate) {",
  "    $row.start = [int64][DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()",
  "  }",
  "  $row",
  "})",
  "[ordered]@{ task = $task; processes = $rows } | ConvertTo-Json -Compress -Depth 4",
].join("\n");

const NETSTAT_DARWIN = "/usr/sbin/netstat";
const PS_DARWIN = "/bin/ps";
const NETSTAT_TIMEOUT_MS = 10_000;
const POWERSHELL_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Variables a spawned tool may inherit: locale and profile plumbing, no credential. */
const INHERITED_ENV = [
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "LANG",
  "LC_ALL",
] as const;

function systemRoot(): string {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  return root !== undefined && root !== "" ? root : "C:\\Windows";
}

/** The Windows system tool paths; `%SystemRoot%\System32\...` and nothing found through PATH. */
export function windowsToolPaths(): { netstat: string; powershell: string } {
  const sys32 = win32.join(systemRoot(), "System32");
  return {
    netstat: win32.join(sys32, "netstat.exe"),
    powershell: win32.join(sys32, "WindowsPowerShell", "v1.0", "powershell.exe"),
  };
}

function baseEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

/** The real runner: `spawnSync` with no shell, a timeout, and the failure mapping. */
export const spawnRunner: InspectRunner = (spec) => {
  const r = spawnSync(spec.file, [...spec.args], {
    env: { ...spec.env },
    shell: false,
    timeout: spec.timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.error !== undefined) {
    const code: unknown = (r.error as { code?: unknown }).code;
    if (code === "ENOENT") return { ok: false, reason: "absent" };
    if (code === "ETIMEDOUT") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "refused" };
  }
  if (r.status !== 0) return { ok: false, reason: r.signal === "SIGTERM" ? "timeout" : "refused" };
  const out: unknown = r.stdout;
  return typeof out === "string" ? { ok: true, stdout: out } : { ok: false, reason: "refused" };
};

let runner: InspectRunner = spawnRunner;

/** Test-only seam: route every call through `fake`; `undefined` restores the real runner. */
export function setInspectRunnerForTests(fake: InspectRunner | undefined): void {
  runner = fake ?? spawnRunner;
}

function run(spec: InspectSpec): InspectResult {
  return runner(spec);
}

function powershell(taskPath: string, pids: readonly number[]): InspectResult {
  if (taskPath.includes("\0") || taskPath.length > 1024) return { ok: false, reason: "refused" };
  if (!pids.every((p) => Number.isSafeInteger(p) && p > 0)) return { ok: false, reason: "refused" };
  return run({
    file: windowsToolPaths().powershell,
    args: ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCRIPT],
    env: baseEnv({ CREWRIG_TASK_PATH: taskPath, CREWRIG_PID_LIST: pids.join(",") }),
    timeoutMs: POWERSHELL_TIMEOUT_MS,
  });
}

/**
 * Text of the listening-socket table: macOS `netstat -anv -p tcp`; Windows
 * `netstat -ano -p TCP` followed by `-p TCPv6`. Linux and any other platform:
 * `absent` (nothing is spawned; the caller reads /proc).
 */
export function listenerTable(platform: NodeJS.Platform): InspectResult {
  if (platform === "darwin") {
    return run({
      file: NETSTAT_DARWIN,
      args: ["-anv", "-p", "tcp"],
      env: baseEnv({}),
      timeoutMs: NETSTAT_TIMEOUT_MS,
    });
  }
  if (platform !== "win32") return { ok: false, reason: "absent" };
  const { netstat } = windowsToolPaths();
  let text = "";
  for (const proto of ["TCP", "TCPv6"]) {
    const r = run({
      file: netstat,
      args: ["-ano", "-p", proto],
      env: baseEnv({}),
      timeoutMs: NETSTAT_TIMEOUT_MS,
    });
    if (!r.ok) return r;
    text += `${r.stdout}\n`;
  }
  return { ok: true, stdout: text };
}

/**
 * The process table: macOS `ps -axo pid=,ppid=` (text); Windows the PowerShell
 * call (JSON, see POWERSHELL_SCRIPT; `pids` asks for their start times).
 * Linux and any other platform: `absent`.
 */
export function processTable(
  platform: NodeJS.Platform,
  pids: readonly number[] = [],
): InspectResult {
  if (platform === "darwin") {
    return run({
      file: PS_DARWIN,
      args: ["-axo", "pid=,ppid="],
      env: baseEnv({}),
      timeoutMs: NETSTAT_TIMEOUT_MS,
    });
  }
  return platform === "win32" ? powershell("", pids) : { ok: false, reason: "absent" };
}

/** Windows only: the Task Scheduler's view of one task plus the process table, as JSON text. */
export function taskSnapshot(taskPath: string, pids: readonly number[] = []): InspectResult {
  return powershell(taskPath, pids);
}
