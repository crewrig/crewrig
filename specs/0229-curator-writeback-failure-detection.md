---
id: "0229"
slug: curator-writeback-failure-detection
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1272
version: 1.0.0
---

# Curator write-back failure detection

## Intent

Restore the Harness Curator's issue #69 write-back correlation guarantee for
`--apply`: an operator who sees a curator run succeed can trust that every
drawer contributing to an opened issue is durably stamped `opened_as: <url>`,
so a later run never re-opens a duplicate issue for the same friction.

## Requirements

1. The apply step SHALL treat any drawer-fetch or drawer-update call that
   returns a dict lacking a truthy success indicator (a missing `content`
   field, a present `error` field, or a falsy `success` field) as a
   write-back failure, in addition to any raised exception.
2. The apply step SHALL, after a reported-successful write-back for a
   drawer, re-read that drawer and SHALL count the write-back as failed if
   the re-read content does not contain the `opened_as: <url>` stamp.
3. Each write-back failure — whether from a raised exception, a
   falsy-success dict, or a failed post-write verification — SHALL be
   logged on stderr with the drawer id and a reason, exactly once per
   drawer.
4. The end-of-run summary SHALL continue to report the aggregate
   write-back-failure count on stderr.
5. The apply step SHALL exit with a non-zero status distinct from the
   existing forge-issue-creation-failure status when one or more
   write-back failures occurred and no forge issue-creation failures
   occurred, so an automated caller (e.g. a scheduled cron run) can
   distinguish "issues opened, some drawers unstamped" from full success
   without parsing stderr text.
6. A forge issue-creation failure SHALL continue to take precedence over a
   write-back-only failure in the returned exit status.

## Scenarios

**Scenario:** Drawer update returns a falsy success dict without raising

Given a cluster with one qualifying drawer and a forge issue successfully opened
When  the drawer-update call returns a dict reporting failure (e.g. a falsy
      success field) without raising an exception
Then  the run counts one write-back failure, logs a warning naming the
      drawer, and the process exits with the write-back-failure status

**Scenario:** Drawer update succeeds and verification confirms the stamp

Given a cluster with one qualifying drawer and a forge issue successfully opened
When  the drawer-update call reports success and a re-read of the drawer
      contains the opened_as stamp
Then  the run counts zero write-back failures and exits 0 (assuming no other
      failures)

**Scenario:** Forge issue creation fails

Given a cluster whose forge issue-create invocation exits non-zero
When  the apply step processes that cluster
Then  the cluster is recorded under Failures, its drawers are never written
      to, and the process exits with the existing issue-creation-failure
      status, which takes precedence over any write-back-only status

## Out of scope

- Changing the `--dedup` duplicate-matching logic.
- Changing which drawers qualify for write-back (the `_drawer_id`
  collection rule).
- Retrying a failed write-back within the same run (the next curator
  invocation naturally retries, since an unstamped drawer is not yet
  filtered as resolved).
- Introducing any new CLI-specific integration point — this is an internal
  Python logic fix inside an existing skill script; `docs/cli-matrix.md`
  was consulted and needs no update (no new row, cell, or parity-gap entry
  applies).

## Open questions

(none)
