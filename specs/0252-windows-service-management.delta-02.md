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
> trigger restarts the task, `stop` of the Windows MCP daemon is a restart request, as it
> is under launchd and systemd (requirement 5): after `stop` the task is started again
> within about a minute (measured: the MCP chain was serving again within the 20 to 30
> seconds a state read takes, run 37991291835), and only `uninstall` ends it for good.
> The ChromaDB daemon's `stop` keeps the contract of requirement 14: it does nothing to a
> supervised daemon.

### Requirement 6 and 7 — the triggers (seat finding s7-F1)

Original (excerpt of requirement 7, and of the first row of the table of requirement 6):

> Each SHALL: trigger at logon of the current user only; …

> Task Scheduler per-user task (logon trigger, interactive token, least privilege,
> restart on failure)

Replacement:

> Each SHALL: trigger at logon of the current user and by the repeating time trigger
> of this requirement, and by no other trigger and for no other user; …

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
  delete it. A failed disable does not stop the uninstall; it is reported.
- **Requirement 24.** The post-`stop` assertions (the state is not running, `LastTaskResult
  0x41306`) and the failed-last-result assertion of the restart proof race the repeating
  trigger and SHALL be measured, not asserted: the Windows job asserts that the daemon tree
  is gone right after `stop`, that the task is started again within the bounded wait after
  its action process ends (kill and clean exit, each chain), and that `uninstall` leaves no
  task and no daemon process; the non-zero end of the launcher and of the flagged wrapper is
  asserted by their unit tests on every operating system.
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
