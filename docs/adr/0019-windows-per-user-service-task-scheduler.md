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
- One task per daemon, in the `\CrewRig\` folder: logon trigger for the current
  user only, interactive token at least privilege, no stored password, one
  running instance, no execution time limit, restart on failure with the
  shortest interval and the largest count the scheduler allows.
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

- **Restart floor and finite count.** The scheduler restarts a failed run no
  sooner than one minute after it and a finite number of times. A launcher that
  keeps failing closed (for example on a missing token) can exhaust the count
  and stop for good, where launchd and systemd never give up. Unverified until
  measured (see *Measurements*).
- **No PID in `schtasks` output.** The supervised PID comes from the Task
  Scheduler running-task interface (`EnginePID`), read through the single
  inspection module `scripts/lib/service/os-inspect.ts`. When that call fails
  the owner verdict is UNVERIFIABLE, never USURPED, and status reports
  UNDETERMINED. Install verification, rollback and uninstall use `schtasks`
  exit statuses only and never depend on that call.
- **The launcher must end non-zero whenever its child ends.** The scheduler
  restarts only a failed run and does not watch a process the task started, so
  the process the task runs is the one whose end means the daemon is down. The
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

Results of the plan's measurement steps 17 to 19 are **TO BE FILLED** from the
`MEASURE:` lines of the `windows-service-task` job of PR B, together with the
run they come from. Until a row is filled, the corresponding consequence above
is a stated expectation, not a finding, and no gap that depends on it is
recorded as one in [`cli-matrix.md`](../cli-matrix.md).

| Item | Plan step | Result |
|---|---|---|
| `/Run` of an interactive-token task from a non-interactive session | 17 | pending |
| Statuses of `/Query /TN … /XML` for an absent task and of a refused `/Create` | 17 | pending |
| Whether a task action that exits 0 is restarted | 17 | pending |
| Restart timing (interval observed, count reached) | 17 | pending |
| Standard-user leg (no elevation) | 17 | pending |
| GPO-refusal producibility on the runner | 17 | pending |
| `EnginePID` versus the launcher PID, on the real MCP chain | 18 | pending |
| Whether `/End` kills the whole daemon tree, on both chains | 19 | pending |
| Launcher console window on a desktop session | 19 | pending |
