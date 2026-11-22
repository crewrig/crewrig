---
id: "0264"
slug: windows-timing-budget-calibration
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 2066
version: 1.2.0
---

# Windows timing-budget calibration

*Delta-02 of `specs/0264-windows-timing-budget-calibration.md`, raised by issue #2066
(the `windows / windows-e2e-harness` job failed one entry at 10 019 ms against
the fixed 10 000 ms bound). Delta-01
(issue #1776) already exists on `main`; this delta builds on it and touches neither
its requirements nor requirements 1 to 11 and 13 to 20 of the parent. It amends the
last sentence of requirement 12 and adds requirement 21.*

## ADDED

<!-- markdownlint-disable MD029 -->

21. **Per-entry timing line.** For every spawned entry checked through `check()` in
    `scripts/tests/lib/windows-e2e-run.ts`, the harness SHALL print exactly one log
    line naming the leg, the entry and its elapsed milliseconds, on a pass as well as
    on a failure (including a failure of the time bound), so that the per-entry
    maximum is observable in the job log. A run with no checked entry prints no such
    line. The implementation PR SHALL record, next to `BOUND_MS`, the per-entry
    maximum observed in the log of one green `windows / windows-e2e-harness` run that
    carries these lines; this replaces the statement that no per-entry maximum is
    known.

<!-- markdownlint-enable MD029 -->

### Scenarios

**Scenario:** An entry slower than the old bound passes

Given an entry checked through `check()` that takes 10 019 ms and whose assertions hold
When `check()` runs
Then no failure is recorded for the time bound, and the timing line of requirement 21
shows 10 019 ms.

**Scenario:** An entry slower than the new bound is still reported

Given an entry checked through `check()` that returns after 30 001 ms
When `check()` runs
Then a failure is recorded naming the leg, stating that the run reached or exceeded the
30 000 ms bound, and carrying the run's diagnostic, and the timing line of requirement
21 shows 30 001 ms.

**Scenario:** A green run prints one timing line per checked entry

Given a green run of the three legs (`direct`, `cmd`, `pwsh`)
When the job log is read
Then each leg shows one timing line per entry it checked through `check()`, each with
the leg, the entry and its milliseconds.

## MODIFIED

**R12, last sentence.** Original: "`BOUND_MS` (10 000 ms) in
`scripts/tests/lib/windows-e2e-run.ts` stays a hang guard and keeps its value; the
implementation PR SHALL record the observed maximum next to it."

Replacement: "`BOUND_MS` in `scripts/tests/lib/windows-e2e-run.ts` becomes 30 000 ms; an entry
passes only when its elapsed time is strictly below it. It stays a hang guard, not a budget: only a hang or a pathological slowdown fails it. The
bound is checked once the entry returns; an entry that never returns is stopped by the
job's `timeout-minutes` (requirement 15), not by `BOUND_MS`. The
implementation PR SHALL record next to it the per-entry maximum of requirement 21."

Rationale. The entry `scripts/e2e-capture-versions.ts` spends its time in five
sequential `docker image inspect` calls against the runner's Docker engine; `docker.exe`
is reachable through System32, which the hermetic PATH cannot drop. Run 44184175477,
attempt 1, failed at 10 019 ms on that entry, while the whole three-leg suite took
27.6 s against 17.7 to 18.4 s on the October green runs. 30 s is about three times the
worst observed entry.

Rejected alternatives (all out of scope): `cancel-on-failure`; a docker stub placed
ahead of System32 (it would need a delta of spec 0261 R17); a `bestOf` retry inside
`check()` (it re-runs entries that have side effects, against requirement 10); a bound
relative to a measured baseline.

## REMOVED

Nothing is removed. The statement in the `BOUND_MS` comment that "no per-entry maximum
is known" is superseded by requirement 21.
