---
id: "0252"
slug: windows-service-management
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1330
version: 1.2.0
---

# OS service management and the daemon lifecycle scripts in TypeScript

*Delta 02 of `specs/0252-windows-service-management.md`, after its delta-01.
Source: ticket #1330, PR B (<https://github.com/crewrig/crewrig/pull/1533>). Plan
step 17 asked for a measurement on `windows-latest` of how the Task Scheduler
restarts a task; the first measurement contradicted a premise of requirement 7. In
run 37984532681 a task defined with `RestartOnFailure` (interval one minute, count
999) whose action process ended with `LastTaskResult 0x1` (about 250 ms after the
daemon child was killed, or exited with status 0) was NOT started again within 240
seconds, on the MCP chain and on the ChromaDB chain. In runs 37989182023 and
37991291835, with a repeating one-minute time trigger added to each task, the four
restart legs of each run passed: the task was started again 25 to 58 seconds after its
action process ended (kill and status-0 exit, both chains). The same runs measured
that `LastTaskResult` reads `0x800710e0` while the task runs and the trigger fires
on an instance that `IgnoreNew` ignores, and that a snapshot of the task through the
Task Scheduler's COM interface takes 20 to 30 seconds on that runner. This delta
records these measurements as normative text and changes the restart mechanism
accordingly. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR targets
`release/1231-ts-migration`. The version is a MINOR bump: requirements 7, 15 and 25
are modified and no behaviour a plan or a seat has settled is dropped. The owner's
two conditions of the Windows decision of 2026-10-09 stay in force: the launcher
still ends non-zero whenever its child ends (requirement 11), and a refused
`/Create` still fails closed (requirement 8).*

## ADDED

Nothing is added.

## MODIFIED

### Requirement 7 — the restart mechanism

Original (excerpt):

> … restart on a failed run after the shortest interval the Task Scheduler allows,
> with the largest count it allows; …

and

> The Task Scheduler restarts a task only when the process it runs ends with a
> failure; it does not watch a process that task started. The task's action process
> SHALL therefore be the process whose end means the daemon is down: …

Replacement:

> … be started again after its action process ends, whatever the exit status, by a
> repeating time trigger of the shortest interval the Task Scheduler allows (one
> minute), with no end date and with the multiple-instances policy that ignores a
> new instance while one runs, so that the trigger does nothing while the daemon
> serves and starts the task again within about a minute of its end; the task
> definition MAY also carry a `RestartOnFailure` setting, which SHALL NOT be relied
> on, because it was measured to restart nothing here; …

> The Task Scheduler starts a task again only from one of its triggers, and it does
> not watch a process that task started. The task's action process SHALL therefore
> be the process whose end means the daemon is down: the launcher SHALL end, with a
> non-zero status, whenever its daemon child ends for any reason while the launcher
> was not asked to stop … (the rest of the sentence is unchanged). The non-zero
> status is what the supervisors of the other operating systems and the diagnostics
> read; on Windows the restart itself comes from the repeating trigger. Because the
> trigger restarts the task, `stop` of the Windows MCP daemon stays a restart request, as
> it is under launchd and systemd (requirement 5): `stop-mcp-server` ends the task and runs
> it again at once, as requirement 17 says, and the repeating trigger is the backstop that
> starts it again within about a minute if that run is refused or the task ends later
> (measured: after an end, the MCP chain was serving again within the 20 to 30 seconds a
> state read takes, run 37991291835). Only `uninstall` ends it for good. The ChromaDB
> daemon's `stop` keeps the contract of requirement 14: it does nothing to a supervised
> daemon. Requirement 17 is therefore not amended.

### Requirement 6 and 7 — the triggers (seat finding s7-F1)

Original (excerpt of requirement 7, and of the first row of the table of requirement 6):

> Each SHALL: trigger at logon of the current user only; …
>
> Task Scheduler per-user task (logon trigger, interactive token, least privilege,
> restart on failure)

Replacement:

> Each SHALL: trigger at logon of the current user and by the repeating time trigger
> of this requirement, and by no other trigger and for no other user; …
>
> Task Scheduler per-user task (logon trigger plus a repeating one-minute trigger,
> interactive token, least privilege)

### Requirement 15 — the `task:` line

Original (excerpt):

> … so that a task that has stopped for good after its restart count ran out is
> visible; it fails the section when the task is registered, not running and its last
> result is a failure, that is any result other than success (`0`), running
> (`0x41301`), not yet run (`0x41303`) and terminated by the user (`0x41306`, what
> `stop` produces).

Replacement:

> … so that a task that is registered but not running is visible; it fails the section
> when the task is registered, not running and its last result is a failure, that is
> any result other than success (`0`), running (`0x41301`), not yet run (`0x41303`),
> terminated by the user (`0x41306`, what `stop` produces) and a new instance ignored
> because one was already running (`0x800710e0`, what the repeating trigger leaves
> while the daemon serves).

### Requirement 25 — the known-gap list

Original (excerpt):

> … the one-minute restart floor and the finite restart count on Windows (a launcher
> that keeps failing closed, for instance on a missing token, eventually exhausts it
> and stops for good, where launchd and systemd never give up); …

Replacement:

> … the one-minute restart floor on Windows (measured: the task is started again 25 to
> 58 seconds after its action process ends, run 37991291835); the cost of reading a
> task's state on Windows (measured: 20 to 30 seconds per call on `windows-latest`,
> which makes `status-mcp-server` take about that long there; evidence in the same
> runs); …

The finite restart count is no longer a gap: the repeating trigger has no end, so a
launcher that keeps failing closed is started again every minute, as it is under
launchd and systemd.

### Requirements 5, 24 and 33, the scenarios and delta-01's flag rationale (seat finding s7-F3)

- **Uninstall order (requirement 5, requirement 33).** *Uninstall* of a Windows task SHALL
  first disable the task (`schtasks /Change /TN … /DISABLE`), so that no trigger can start
  it again, then end it and sweep the leftovers of its daemon tree (requirement 33), then
  delete it. A failed disable does not stop the uninstall, which still ends, sweeps and deletes; it is
  reported together with the statement that a trigger may have started a new instance
  after the sweep, so a daemon process of the removed task may still run, and with the
  command that finds it (`status`, then `doctor-mempalace`).
- **Requirement 24.** Original (excerpt): *"… `stop` and `start` change the state `/Query`
  reports, `uninstall` removes it and a second `uninstall` is success, and the daemon process
  tree is gone after `stop`."* and *"… the launcher ends with a non-zero status (`/Query`
  reports a failed last result), the task is started again by the Task Scheduler within a
  bounded wait …"*. Replacement: the Windows job asserts that, at the moment `stop` returns,
  no process of the daemon tree it ended is running (checked by process identifier at that
  moment, before the trigger can fire); that after the action process of the task ends, by
  a kill or by a clean exit of the daemon child, the task is started again within a bounded
  wait of 150 seconds on each chain; and that `uninstall` leaves no task and no daemon
  process. The state `/Query` reports after `stop`, and the last result after the action
  process ends, race the repeating trigger: the job prints them and asserts nothing on them.
  That the launcher and the flagged wrapper end non-zero is asserted by their unit tests on
  every operating system, not by the Windows job.
- **Scenarios.** "the daemon is brought back after a crash on Windows" reads: *the task is
  started again by the repeating trigger within about a minute of its action process
  ending, and the launcher waits for ChromaDB on its deadline*. "stop is a restart request
  on every operating system" reads: *on Windows within about a minute*, and applies to the
  MCP daemon.
- **Delta-01, requirement 7 entry (the ChromaDB wrapper flag).** The flag
  `--end-nonzero-on-child-exit` still makes the wrapper end non-zero whenever its child
  ends, so that its end is a failure for every reader; on Windows the restart comes from
  the repeating trigger, not from the flag.

## REMOVED

Nothing is removed.
