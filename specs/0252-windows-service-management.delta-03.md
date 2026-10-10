---
id: "0252"
slug: windows-service-management
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1330
version: 1.3.0
---

# OS service management and the daemon lifecycle scripts in TypeScript

*Delta 03 of `specs/0252-windows-service-management.md`, after its delta-01 and delta-02.
Source: ticket #1330, the final whole-ticket review passes 21 to 23 of seat `review/1330`
(PRs #1546 and #1544). Two behaviours of the merged code contradict the letter of the
approved spec, and the spec is declared implemented, so it SHALL NOT contradict the code.
(1) Pass 21 found that the launcher of requirement 11 exited 143 instead of 0 on a stop
under systemd's control-group stop: systemd signals every process of the unit at once, the
child can end before the launcher's `SIGTERM` handler runs, and the launcher then judged the
end unasked (the test `systemd stop: launcher and child gone, no spurious restart` failed once
in four runs of the service selection). The fix (PR #1546) judges an unasked child end after a
grace of 250 ms in which a stop request still counts as requested; the launcher can therefore
outlive its child by up to 250 ms, which requirement 11 forbids in so many words (finding
`i1-F42`, tracked in #1547). (2) The Windows job of requirement 24 asserted that the whole
`status-mcp-server` entry takes 5 seconds or less; on `windows-latest` it took 4.4 s (run 38012799782),
12.0 s and 5.5 s on loaded runners (run 38012436658, attempts 1 and 2), because the entry
makes two or three PowerShell state reads plus a listener lookup and the first, cold PowerShell
read of a run takes 2.4 to 5.7 s (the values are listed in the replacement below). The owner's bound of 2026-10-09 is on reading a task's
state, which delta-02 already says (requirement 25: the `status` call of the backend). Both
are recorded here as the normative text. This delta runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR targets
`release/1231-ts-migration`. The version is a MINOR bump: requirement 11 is narrowed, the two
other statements of its rule (requirement 7 and one scenario) follow it, and the assertions of
requirements 24 and 25 are restated, no behaviour a plan or a seat
has settled is dropped. Its status follows the table of `docs/spec-format.md`: `draft` on its spec branch, `approved` once this spec-PR merges (the implementation PRs #1544 and #1546 merged before it, as for delta-01 and delta-02, and the parent's own `implemented` flip came with PR #1542).*

## ADDED

Nothing is added.

## MODIFIED

### Requirement 11 — the launcher outlives its child by at most the stop-race grace

Original (excerpt):

> The launcher SHALL NOT stay alive after its child has ended, and a child that ends with a
> non-zero status keeps that status. A launcher asked to stop ends the child, then exits
> with the status a clean stop has under the supervisor.

Replacement:

> The launcher SHALL NOT stay alive after its child has ended, except for a bounded grace of
> 250 milliseconds (`stopGraceMs` of `launcher-child.ts`) in which it decides whether a stop
> was requested: a supervisor that stops a whole control group (systemd) signals the launcher
> and the child at once, and the child can end before the launcher's handler runs. A child end
> with no stop request by the end of the grace is an unasked end and the rules above apply
> unchanged; a stop request that arrives within the grace counts as requested and the launcher
> exits with the status a clean stop has. No escalation timer is armed for a child that
> already ended. A child that ends with a non-zero status keeps that status. A launcher asked
> to stop ends the child, then exits with the status a clean stop has under the supervisor.
> The same grace applies to the trust wrapper of requirement 12, which shares the supervision
> core: a wrapped command that ends by itself ends the wrapper 250 ms later.

### Requirements 24 and 25 — the bound on a Windows state read

Original (excerpt of delta-02, requirement 24 and 25):

> The Windows job also asserts that reading the state of a running task (the `status` call of
> the backend) takes 5 seconds or less.

and

> A state read is not a gap: it SHALL take 5 seconds or less on Windows, as the owner
> required on 2026-10-09. The bound is asserted on the `status` call of the backend (0.6 s
> measured); the first, cold snapshot of a run took 4.5 s, inside the bound with little margin,
> and is printed, not asserted.

Replacement:

> A state read SHALL take 5 seconds or less on Windows, as the owner required on 2026-10-09.
> The bound is on a state read: the `status` call of the backend, asserted by the Windows jobs
> `windows-service-task` and `windows-mcp-daemon`. The first, cold read of a run is the one
> exception: it took 2.4 to 5.7 s across the runs read (2.4 s run 38010460918; 3.3 s and 3.7 s
> in run 38012436658 attempts 1 and 2; 4.5 s run 37995988520; 5.7 s run 38012799782), so it can
> exceed the bound; it is printed and not asserted, and the `status` call of the backend
> that each Windows job times after it is asserted. The bound is NOT a bound on the whole `status-mcp-server` entry, which makes two or
> three such reads and a listener lookup: its total is printed (`MEASURE: status-entry`: 4.4 s on
> `windows-latest`, run 38012799782; 12.0 s and 5.5 s on loaded runners, run 38012436658
> attempts 1 and 2) and is guarded against a hang at 30 seconds. A plan step or test that
> phrases the 5 seconds on the entry is read as this text.

### Requirement 7 and the scenario "the daemon dies while its launcher would stay alive"

Original (excerpts):

> … and SHALL NOT outlive a child that was killed (requirement 11 states the rule,
> requirement 24 tests it).

and

> Then the launcher ends at once with a non-zero status, the Task Scheduler records a failed
> run and starts the task again, …

Replacement:

> … and SHALL NOT outlive a child that was killed, except for the bounded stop-race grace of
> requirement 11 as amended by this delta (requirement 11 states the rule, requirement 24
> tests it).

and

> Then the launcher ends, within the stop-race grace of requirement 11 (250 ms) and with a
> non-zero status, the Task Scheduler records a failed run and starts the task again, …

## REMOVED

Nothing is removed.
