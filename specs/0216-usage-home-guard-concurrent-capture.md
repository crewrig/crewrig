---
id: "0216"
slug: usage-home-guard-concurrent-capture
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1259
version: 1.0.0
---

# Usage-suite HOME safety check vs. concurrently capturing sessions

## Intent

A developer running a usage-suite test script on a workstation where a live,
capture-enabled CLI session is writing into the real usage root at the same
time sees the script's HOME safety check report success when the suite
itself has left the real usage root untouched, and sees the check report a
precise, named failure when the suite's own content has escaped into the
real usage root — instead of the check reporting a blanket failure whenever
any concurrently running session has touched that root at all.

## Requirements

1. The HOME safety check SHALL distinguish a write to the real usage root
   that the suite under test produced from a write that a different,
   concurrently running process produced, and SHALL report a failure only
   for the former.
2. The check SHALL report a failure whenever any file that existed under the
   real usage root before the suite ran is no longer present after the run,
   regardless of which process is responsible — the suite MUST NOT ever
   remove content from the real usage root, and a disappearance SHALL never
   be excused as a concurrent writer's activity.
3. The check SHALL classify a newly observed file under the real usage root
   as a failure only when its identity matches content the suite is known
   to have produced during the run. A newly observed file whose identity
   does not match SHALL NOT be classified as a failure, regardless of its
   modification time, its owning process, or any other signal not derived
   from the suite's own recorded output.
4. When the check reports a failure, it SHALL identify the specific file or
   files responsible for that failure, rather than reproducing the complete
   set of files observed before and after the run.
5. When every newly observed file under the real usage root was produced by
   a process other than the suite, and no previously existing file has
   disappeared, the check SHALL report success — even though the set of
   files under the real usage root differs between the start and the end of
   the run.
6. This behavior SHALL apply identically wherever a usage-suite test script
   performs this HOME safety check, so that no such check regresses to
   treating any difference between the pre-run and post-run file listings
   of the real usage root as a failure.

## Scenarios

**Scenario:** Suite runs cleanly alongside a live capture-enabled session

Given a workstation has a live, capture-enabled CLI session concurrently
writing entries into the real usage root
When a usage-suite test script runs to completion without producing any
content of its own in the real usage root
Then the HOME safety check reports success, even though the real usage
root's file listing differs between the start and the end of the run

**Scenario:** Suite's own content escapes into the real usage root

Given a usage-suite test script is running under a hermeticity regression
that causes some of its own output to be written into the real usage root
instead of its sandboxed root
When the suite completes and the HOME safety check runs, whether or not a
concurrently running session is also writing into the real usage root at
the same time
Then the check reports a failure and names the specific escaped file or
files, rather than reporting success or reproducing the full before/after
listing

**Scenario:** A file present before the run is missing afterward

Given a file exists under the real usage root before a usage-suite test
script runs
When that file is no longer present under the real usage root after the
suite completes, for any reason
Then the HOME safety check reports a failure naming the missing path,
regardless of any concurrently running session's activity during the run

## Out of scope

- Redirecting, mocking, or otherwise overriding `$HOME` (or the real usage
  root) for the duration of either suite's run.
- Pausing, disabling, or otherwise coordinating with live usage-capture
  hooks belonging to other sessions while a usage-suite test script runs.
- Any change to the usage-capture pipeline itself (capture hooks, journal
  writers, mirror synchronization) that produces the writes this check must
  tolerate.
- Any change to when or how the pre-run snapshot of the real usage root is
  captured; only the post-run comparison and classification is in scope.
- Any change to a usage-suite test script's observable outcome when it runs
  in isolation, with no concurrently writing session and no hermeticity
  regression present (its outcome is unchanged by this spec).
- Consolidating the HOME safety check of the affected usage-suite test
  scripts into a shared implementation; each script's check may continue to
  be realized independently.

## Open questions

(none)
