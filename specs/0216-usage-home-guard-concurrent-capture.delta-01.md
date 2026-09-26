---
id: "0216"
slug: usage-home-guard-concurrent-capture
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1259
version: 2.0.0
---

# Usage-suite HOME safety check vs. concurrently capturing sessions

## ADDED

The real usage-capture pipeline's mirror synchronization subsystem
(referenced, but not detailed, by the parent spec's `## Out of scope`)
maintains two queues under the real usage root: a **pending queue** and a
**mirrored queue**. Promoting an entry from the pending queue to the
mirrored queue is normal, successful pipeline operation — not data loss —
and the entry keeps an identical name across the move. R2 as merged treats
this promotion identically to any other disappearance, which means a
usage-suite run on a workstation with a live, capture-enabled session
flakes every time that session promotes an entry during the run. This was
empirically confirmed during independent pre-merge verification of the
implementation PR for this spec (issue #1259, PR #1295): a live run against
the real usage root observed 60 pending-queue files disappear, and all 60
had an identically named counterpart appear in the mirrored queue — a
100% match against the promotion pattern, zero unexplained disappearances.

A new fourth scenario captures the now-excused case:

```text
**Scenario:** A pending-queue entry is legitimately promoted during the run

Given a file exists in the real usage root's pending queue before a
usage-suite test script runs
When that file is no longer present in the pending queue after the suite
completes, and a file with the identical name is present in the mirrored
queue
Then the HOME safety check does not report a failure for that path,
regardless of any concurrently running session's activity during the run
```

**Residual, deliberately out-of-scope risk (extends the parent spec's
`## Out of scope`).** This delta excuses exactly one state-machine
transition — pending-queue entry to mirrored-queue entry — because it is
the only one empirically observed and the only one the mirror
synchronization subsystem currently documents as normal. Any other kind of
legitimate removal the real pipeline might perform in the future (for
example, a hypothetical prune or cleanup sweep of stale entries in either
queue, or in any other subtree) remains unconditionally treated as a
failure by this spec, exactly as R2 already mandates for everything outside
the one excused transition. Widening the exception to cover such a sweep is
explicitly out of scope for this delta; if it causes flakiness in the
future, that will need its own delta at that time, grounded in its own
empirical observation the same way this one was.

## MODIFIED

Original R2:

```text
2. The check SHALL report a failure whenever any file that existed under the
   real usage root before the suite ran is no longer present after the run,
   regardless of which process is responsible — the suite MUST NOT ever
   remove content from the real usage root, and a disappearance SHALL never
   be excused as a concurrent writer's activity.
```

Replacement:

```text
2. The check SHALL report a failure whenever any file that existed under the
   real usage root before the suite ran is no longer present after the run
   — the suite MUST NOT ever remove content from the real usage root — UNLESS
   every one of the following holds, in which case the check SHALL NOT
   report a failure for that specific path:
   (a) the disappeared file's parent is the real usage root's mirror
       synchronization pending queue, and
   (b) a file bearing the identical name is present, after the run,
       somewhere under the mirror synchronization mirrored queue.
   This is the real usage-capture pipeline's own documented pending-to-
   mirrored promotion, not data loss, and is the ONLY disappearance this
   check SHALL ever excuse. Every other disappearance — including a
   pending-queue file that vanishes with no corresponding mirrored-queue
   counterpart, and any disappearance anywhere outside the pending and
   mirrored queues — SHALL still never be excused as a concurrent writer's
   activity, exactly as before.
```

Original Scenario 3 (the "for any reason" clause this delta narrows):

```text
**Scenario:** A file present before the run is missing afterward

Given a file exists under the real usage root before a usage-suite test
script runs
When that file is no longer present under the real usage root after the
suite completes, for any reason
Then the HOME safety check reports a failure naming the missing path,
regardless of any concurrently running session's activity during the run
```

Replacement:

```text
**Scenario:** A file present before the run is missing afterward

Given a file exists under the real usage root before a usage-suite test
script runs
When that file is no longer present under the real usage root after the
suite completes, for any reason other than the pending-to-mirrored-queue
promotion excused by R2
Then the HOME safety check reports a failure naming the missing path,
regardless of any concurrently running session's activity during the run —
unless that file was a pending-queue entry legitimately promoted to the
mirrored queue during the run, per R2's exception, in which case the new
fourth scenario governs instead
```

## REMOVED

(none)
