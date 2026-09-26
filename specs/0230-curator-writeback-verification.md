---
id: "0230"
slug: curator-writeback-verification
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1272
version: 1.0.0
---

# Harness Curator write-back stamping is verified, not merely attempted

## Intent

A maintainer running the Harness Curator's `--apply` step trusts that when
the run reports success, every drawer that fed an opened issue is actually
stamped `opened_as: <issue-url>` in MemPalace — so a later curator run
recognizes that friction as already routed and never re-opens a duplicate
issue for it, and so a run that leaves any drawer unstamped is visible in
the run's own exit code, not discovered days later as a pile of duplicate
issues.

## Requirements

1. The `--apply` write-back step SHALL treat a dict response from
   `tool_get_drawer` or `tool_update_drawer` that carries an `error` key,
   or that lacks the field each call is expected to return (`content` for
   `tool_get_drawer`, a truthy `success` for `tool_update_drawer`), as a
   write-back failure — in addition to, not instead of, a raised
   exception.
2. After a `tool_update_drawer` call that neither raised nor returned an
   error-shaped dict, the write-back step SHALL re-read the same drawer
   via `tool_get_drawer` and SHALL confirm that the re-read content
   contains the exact `opened_as: <issue-url>` line before treating that
   drawer's stamp as successful.
3. Every write-back failure path — a raised exception, an error-shaped
   dict from either call, or a re-read that does not confirm the stamp —
   SHALL increment the run's `writeback_failures` counter exactly once per
   affected drawer and SHALL print one `warn:` line to stderr identifying
   the drawer id and the failure reason.
4. When a completed `--apply` run has zero forge issue-creation failures
   (the existing `failures` list is empty) and `writeback_failures` is
   greater than zero, the script SHALL exit with status `5` instead of
   `0`.
5. When a completed `--apply` run has both one or more forge
   issue-creation failures and one or more write-back failures, the
   script SHALL exit with status `4`, unchanged from the pre-existing
   behavior — the issue-creation failure exit code SHALL take priority
   over the write-back-failure exit code.
6. A run invoked with `--dry-run-apply` SHALL NOT be affected by
   Requirements 1–5: that path never imports `mempalace.mcp_server` and
   never calls `tool_get_drawer` or `tool_update_drawer`, and its exit
   code SHALL remain `0` on a clean dry run exactly as before this spec.

## Scenarios

**Scenario:** a normal stamp succeeds and is verified

Given an `--apply` run has just opened an issue for a cluster whose single
contributing drawer has a `_drawer_id`
When the write-back step calls `tool_get_drawer`, then
`tool_update_drawer` with the drawer's existing content plus an appended
`opened_as: <issue-url>` line, and neither call raises or returns an
error-shaped dict
Then the write-back step re-reads the drawer via `tool_get_drawer`
And the re-read content contains the exact `opened_as: <issue-url>` line
And `writeback_failures` is not incremented for that drawer
And no `warn:` line is printed for that drawer

**Scenario:** `tool_update_drawer` reports failure without raising

Given an `--apply` run has just opened an issue for a cluster whose single
contributing drawer has a `_drawer_id`
When the write-back step calls `tool_update_drawer` and it returns
`{"success": false, "error": "<reason>"}` without raising an exception
Then the write-back step SHALL count this as a write-back failure without
attempting the re-read verification of Requirement 2
And it prints a `warn:` line to stderr naming the drawer id and `<reason>`
And `writeback_failures` is incremented by exactly one for that drawer
And, at the end of the run, given the run's `failures` list is empty, the
script exits with status `5`

## Out of scope

- Any change to the friction dedup logic (`_existing_issue_url` and its
  surrounding cache).
- Any change to how the forge argv is built (`_build_cmd`,
  `_detect_forge`) or to which forge CLI (`gh`, `glab`, `tea`) is invoked.
- Any change to `curate.py` or to how clusters are formed, scored, or
  routed to a canonical repository.
- Any change to the `--dry-run-apply` path's output shape (Requirement 6
  states only that it is unaffected, not that its output changes).
- The write-back step's clobber-window behavior under a concurrent edit
  to the same drawer between the `tool_get_drawer` read and the
  `tool_update_drawer` write — this spec verifies that a stamp attempt is
  correctly counted and confirmed, not that the read-then-replace pattern
  itself is atomic.
- The exact wording of the `warn:` line's failure-reason text — the
  requirement is that the drawer id and a failure reason are present, not
  a specific string format.
- The scheduled auto-mode cron wrapper (`scripts/schedule-curator.sh`)
  reacting to the new exit code `5` — this spec covers only `apply.py`
  emitting the correct exit code; a caller changing its own behavior in
  response is a separate concern.

## Open questions

- None. Grounding confirmed: `artifacts/library/skills/harness-curator/scripts/apply.py`'s
  `main()` write-back loop (around line 371) matches the shape this spec
  describes exactly — a bare `try/except Exception` around
  `tool_get_drawer`/`tool_update_drawer` with no inspection of a
  dict-shaped error response, and the run's final exit code path (`return
  4` on issue-creation failures, `return 0` otherwise) has no branch for
  `writeback_failures`.
