# ADR 0019 — Windows per-user daemon service as a Task Scheduler task

<!-- crewrig-doc: section=architecture-adr nav_order=190 published=true title="ADR 0019 — Windows per-user daemon service as a Task Scheduler task" -->

**Status:** Accepted — 2026-10-09 (spec 0252 requirement 6, issue #1330; owner
decision of 2026-10-09)

## Context

The two MemPalace background daemons (the shared ChromaDB server and the shared
MCP HTTP server, [ADR 0016](0016-shared-mempalace-mcp-http-server.md)) run
under launchd on macOS and under systemd user units on Linux. Windows has no
equivalent in the shell scripts. Spec 0252 gives the service module the same
five operations (install, start, stop, status, uninstall) on every operating
system, with the same per-user scope and no administrator elevation (parent
spec 0215, requirement 20). Windows therefore needs one per-user supervision
mechanism that restarts a daemon that fails, with no POSIX layer.

## Decision

Each Windows daemon is **a Task Scheduler task registered for the current user
from an XML definition**, driven only through `schtasks`:

- `schtasks /Create /XML` registers it, `/Run` starts it, `/End` stops it,
  `/Query` inspects it, `/Delete` removes it.
- The XML templates live in `config/windows/` beside `config/launchd/` and
  `config/systemd/`, with the same `__NAME__` placeholder convention and the
  same refusal of a residual placeholder.
- One task per daemon, in the `\CrewRig\` folder: a logon trigger for the current
  user and a repeating one-minute time trigger (the keep-alive, see *Measurements*),
  interactive token at least privilege, no stored password, one running instance
  (a new instance is ignored), no execution time limit. `RestartOnFailure` is also
  set but is not relied on: it was measured to restart nothing.
- The task action is `process.execPath` with the installed TypeScript program
  as first argument (the launcher for MCP, the trust wrapper for ChromaDB).

The mechanism is the owner's choice of 2026-10-09, taken between this option
and the second row of the table below. No fallback to another mechanism exists
in the code: a fallback needs a new decision.

## Alternatives considered

| Alternative | Verdict | Reason |
|---|---|---|
| Task Scheduler per-user task (logon trigger, interactive token, least privilege, restart on failure) | **chosen** | Needs no elevation for a task bound to the current user; ships with every Windows edition; has the five operations; supervises and restarts. Costs are listed under *Consequences*. |
| `HKCU\…\Run` key or Startup-folder shortcut plus a CrewRig-owned Node supervisor | rejected by the owner | No elevation either, but CrewRig would write and own a respawn loop, a stop path and a PID file. The owner check of spec 0158 requirement 2 forbids trusting a file a same-user process can write, so the supervisor itself would have to be trusted. |
| Windows service (`sc.exe`, NSSM, WinSW) | rejected | Creating a service needs administrator rights, which the parent requirement 20 forbids. NSSM and WinSW are also third-party binaries. |
| Per-user service templates (Windows 10 1903+) | rejected | Only system components can register them; a user cannot. |
| WSL or Git Bash running the systemd/launchd path | rejected | Needs a POSIX layer, which parent requirement 5 forbids once step (b) has shipped. |
| A container (Docker) | rejected | A new prerequisite outside parent requirement 5. |

## Consequences

- **Restart floor.** The keep-alive trigger starts a task again about one minute
  after its action process ends (measured 25 to 58 s), where launchd and systemd
  restart in 3 to 10 s. The trigger has no end, so there is no finite restart
  count: a launcher that keeps failing closed is started again every minute, as
  under launchd and systemd.
- **No PID in `schtasks` output.** The supervised PID comes from the Task
  Scheduler running-task interface (`EnginePID`), read through the single
  inspection module `scripts/lib/service/os-inspect.ts`. When that call fails
  the owner verdict is UNVERIFIABLE, never USURPED, and status reports
  UNDETERMINED. Install verification, rollback and uninstall use `schtasks`
  exit statuses only and never depend on that call.
- **The launcher must end non-zero whenever its child ends.** The scheduler
  does not watch a process the task started, so the process the task runs is the
  one whose end means the daemon is down; a repeating one-minute time trigger
  with `IgnoreNew` then starts the task again (`RestartOnFailure` alone was
  measured to restart nothing, see *Measurements*). The
  launcher ends non-zero when its child ends for any reason it was not asked to
  stop for, a clean exit included. The ChromaDB trust wrapper gets the same rule
  through the optional `--end-nonzero-on-child-exit` flag, which the Windows
  task passes.
- **Group Policy refusal fails closed.** Enterprise Group Policy may prohibit
  per-user tasks. A refused `schtasks /Create` exits non-zero, quotes the
  `schtasks` error verbatim, states that nothing was switched and that
  MemPalace keeps working in stdio mode, and points to `doctor-mempalace`.
  Nothing is left half-registered, and no other mechanism is tried.
- **Launcher console window unverified.** The task runs a console program, so
  the launcher's own console window is not hidden by the action shape. Only the
  daemon child is started with no console window. Whether the launcher window
  shows on a desktop session is **unverified** until measured on one (the hosted
  runner has none); a decision to hide it by another action shape needs a
  delta-spec of spec 0252.
- **Token file protection.** The bearer token file is protected by the
  user-profile ACL instead of mode 0600. The task definition carries no secret:
  the launcher reads the token itself.
- **The task is CrewRig's only on evidence.** Install and uninstall act on an
  existing task only when its description marker and the first token of its
  arguments match that task's own program; a foreign task is left alone and
  reported.

## Measurements

Results of the plan's measurement steps 17 to 19, read from the `MEASURE:` lines
of the `windows-service-task` job of PR #1533 on `windows-latest`: run 37984532681
(first complete lifecycle), run 37989182023 and run 37991291835 (with the
keep-alive trigger). Where a row says *not measured*, the corresponding
consequence above stays a stated expectation and no gap that depends on it is
recorded as one in [`cli-matrix.md`](../cli-matrix.md).

| Item | Plan step | Result |
|---|---|---|
| `/Create` from XML and `/Run` of an interactive-token task, from the runner's session | 17 | Works: install succeeds and the daemon serves within 0.5 to 1 s, on both chains. Not measured from a non-interactive session. |
| Status of `/Query /TN … /XML` for an absent task | 17 | `1` (non-zero), as assumed. |
| Status of a refused `/Create` (Group Policy) | 17 | Not produced on the runner. The refusal path is tested through the executable seam of `exec.ts` with a stub `schtasks` that returns the verbatim "Access is denied" text. |
| Whether a task action that exits 0 is restarted by `RestartOnFailure` | 17 | **No.** With `RestartOnFailure` (interval one minute, count 999) alone, a task whose action ended with `LastTaskResult 0x1` (killed child) or after a clean child exit was not started again within 240 s, on both chains (run 37984532681). |
| Restart through a repeating one-minute time trigger with `IgnoreNew` | 17 | **Yes.** The task is started again 25 to 58 s after its action process ends (kill and clean exit, both chains; runs 37989182023 and 37991291835). While the task runs, the trigger leaves `LastTaskResult 0x800710e0` (an instance ignored). The trigger has no end, so there is no finite restart count. |
| Launcher and trust wrapper exit when their child ends | 17 | Yes: the program ends in about 250 ms with `LastTaskResult 0x1`, for a killed child and for a clean child exit, on both chains. |
| Standard-user leg (no elevation) | 17 | Not measured: the runner's token is an administrator's and no restricted-token leg exists yet. |
| `EnginePID` versus the launcher PID, on the real MCP chain | 18 | **Equal** (`enginePid=5628 launcherPid=5628`, run 37991291835; also `6708/6708` and `7604/7604` in earlier runs). On the ChromaDB chain `EnginePID` equals the trust wrapper's PID. The stand-in daemon's `ppid` is that PID on both chains. |
| Whether `/End` kills the whole daemon tree, on both chains | 19 | Yes: after `stop`, neither the daemon nor its parent is alive and `/healthz` is down. `LastTaskResult` is `0x41301` while running and `0x41306` after `stop`; with the keep-alive trigger the task may be started again within a minute (stop is a restart request). |
| Cost of reading a task's state (`Schedule.Service` COM plus the process table through CIM) | 18 | First measured at 18 to 33 s per call; the cause was a PowerShell child environment without `PSModulePath` (PowerShell rebuilds its module path on every start). With `PSModulePath` the read takes 0.4 s (probe job, runs 37994796307, 37995100078, 37995308756) and the `status` call of the backend 0.57 to 0.61 s in the lifecycle job (run 37995988520); the first, cold snapshot of a run took 4.5 s. Not a gap: spec 0252 delta-02 sets a 5 s bound, asserted on `status`. |
| Launcher console window on a desktop session | 19 | Not measured (the hosted runner has no desktop): *unverified*. |
