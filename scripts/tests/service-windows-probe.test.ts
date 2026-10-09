// service-windows-probe.test.ts — what reading a task's state and the process table costs on
// Windows, per candidate mechanism (spec 0252 delta-02, owner request of 2026-10-09: the
// state read must take 5 s or less, or the delta cites the measurements and the reason).
// Skipped off win32. Every timing is printed as one `MEASURE:` line; nothing is asserted
// except that a candidate ran, so the job reports the numbers whatever they are.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { POWERSHELL_SCRIPT } from "../lib/service/os-inspect.ts";

const skip = process.platform !== "win32";
const POWERSHELL = `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const SCHTASKS = `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\schtasks.exe`;
const NETSTAT = `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\NETSTAT.EXE`;
const TASK = `\\CrewRig\\probe-${randomBytes(4).toString("hex")}`;
const RUNS = 3;

function timed(label: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  let out = "";
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const r = spawnSync(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      env: { ...process.env, ...env },
    });
    const ms = Math.round(performance.now() - t0);
    out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    console.log(
      `MEASURE: probe ${label} run=${i + 1} ms=${ms} status=${r.status} out=${JSON.stringify(out.trim().slice(0, 160))}`,
    );
  }
  return out;
}
const ps = (label: string, script: string, env: NodeJS.ProcessEnv = {}): string =>
  timed(label, POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], env);

const TOOLHELP = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Th {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct PE { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szExeFile; }
  [DllImport("kernel32.dll")] public static extern IntPtr CreateToolhelp32Snapshot(uint f, uint p);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool Process32First(IntPtr h, ref PE e);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool Process32Next(IntPtr h, ref PE e);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static int Count() { var e = new PE(); e.dwSize = (uint)Marshal.SizeOf(typeof(PE)); var h = CreateToolhelp32Snapshot(2, 0); int n = 0; if (Process32First(h, ref e)) { do { n++; } while (Process32Next(h, ref e)); } CloseHandle(h); return n; }
}
"@
[Th]::Count()`;

test(
  "what each way of reading a task and the process table costs",
  { skip, timeout: 600_000 },
  () => {
    const created = spawnSync(
      SCHTASKS,
      ["/Create", "/TN", TASK, "/SC", "ONCE", "/ST", "23:59", "/TR", "cmd /c exit 0", "/F"],
      { encoding: "utf8", windowsHide: true },
    );
    console.log(
      `MEASURE: probe create status=${created.status} out=${JSON.stringify(`${created.stdout}${created.stderr}`.trim().slice(0, 160))}`,
    );
    after(() => spawnSync(SCHTASKS, ["/Delete", "/TN", TASK, "/F"], { windowsHide: true }));
    // A task that really runs, as the daemon tasks do while the state is read.
    const longRun = TASK + "-run";
    const mk = spawnSync(
      SCHTASKS,
      [
        "/Create",
        "/TN",
        longRun,
        "/SC",
        "ONCE",
        "/ST",
        "23:58",
        "/TR",
        "ping -n 300 127.0.0.1",
        "/F",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const go = spawnSync(SCHTASKS, ["/Run", "/TN", longRun], {
      encoding: "utf8",
      windowsHide: true,
    });
    console.log(`MEASURE: probe create-running create=${mk.status} run=${go.status}`);
    after(() => {
      spawnSync(SCHTASKS, ["/End", "/TN", longRun], { windowsHide: true });
      spawnSync(SCHTASKS, ["/Delete", "/TN", longRun, "/F"], { windowsHide: true });
    });
    spawnSync("ping", ["-n", "3", "127.0.0.1"], { windowsHide: true });
    ps("os-inspect-script-running-task", POWERSHELL_SCRIPT, {
      CREWRIG_TASK_PATH: longRun,
      CREWRIG_PID_LIST: "4",
    });
    ps("os-inspect-script-no-task", POWERSHELL_SCRIPT, {
      CREWRIG_TASK_PATH: "",
      CREWRIG_PID_LIST: "",
    });
    ps(
      "com-get-running-tasks-enumerate",
      "$s = New-Object -ComObject 'Schedule.Service'; $s.Connect(); foreach ($r in $s.GetRunningTasks(1)) { if ($r.Path -eq $env:T) { [int]$r.EnginePID } }",
      { T: longRun },
    );
    ps(
      "com-running-count-only",
      "$s = New-Object -ComObject 'Schedule.Service'; $s.Connect(); $s.GetRunningTasks(1).Count",
    );
    ps(
      "com-get-task-instances",
      "$s = New-Object -ComObject 'Schedule.Service'; $s.Connect(); $t = $s.GetFolder('\\').GetTask($env:T); \"$([int]$t.State) $([int]$t.LastTaskResult)\"",
      { T: longRun },
    );
    ps(
      "cim-with-want-loop",
      "$want = @(4); $rows = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process' | ForEach-Object { $row = [ordered]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId }; if ($want -contains [int]$_.ProcessId -and $_.CreationDate) { $row.start = 1 }; $row }); $rows.Count",
    );
    timed("schtasks-query-v-csv-running", SCHTASKS, [
      "/Query",
      "/TN",
      longRun,
      "/V",
      "/FO",
      "CSV",
      "/NH",
    ]);
    ps("powershell-empty", "exit 0");
    ps(
      "com-task-state",
      "$s = New-Object -ComObject 'Schedule.Service'; $s.Connect(); $t = $s.GetFolder('\\').GetTask($env:T); \"$([int]$t.State) $([int]$t.LastTaskResult) $($s.GetRunningTasks(1).Count)\"",
      { T: TASK },
    );
    ps(
      "cim-process-table",
      "(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process' | Measure-Object).Count",
    );
    ps("toolhelp32-process-table", TOOLHELP);
    timed("schtasks-query-v-csv", SCHTASKS, ["/Query", "/TN", TASK, "/V", "/FO", "CSV", "/NH"]);
    timed("schtasks-query-xml", SCHTASKS, ["/Query", "/TN", TASK, "/XML"]);
    timed("netstat-ano", NETSTAT, ["-ano", "-p", "TCP"]);
  },
);
