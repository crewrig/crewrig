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
> trigger restarts the task, `stop` of a Windows daemon is a restart request, as it is
> under launchd and systemd (requirement 5): after `stop` the task is started again
> within about a minute, and only `uninstall` ends it for good.

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

## REMOVED

Nothing is removed.
