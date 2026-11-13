---
id: "0289"
slug: skill-script-citations
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1863
version: 1.2.0
---

# Skill script citations resolve or are repo-scoped

*Delta 02 of `specs/0289-skill-script-citations.md`. Source: review pass 1 of the implementation PR of issue #1863 and the full test run on that PR. A dedicated CI job for the check was tried and rejected: it adds a job to every CI surface and overruns the CI-surface budget of specs 0285 and 0287 by far more than the job it replaces costs. The delta keeps R15 of delta 01 (the check runs in the existing source-lint job), makes the failure name the check, and records the budget consequence. Version 1.2.0, a MINOR bump. Requirements modified: none. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

19. **R19 (failure names the check).** The check SHALL open its failure output with a line naming it, `check-agent-script-citations`, and the source-lint job's name in the CI capability reference SHALL state that the job also fences agent script citations, so that a citation failure is never read as a description-length failure.
20. **R20 (CI-surface budget).** The two path-filter lines the check adds to the source-lint job raise the total of the three CI surfaces by four lines. The pin of the CI-surface size ratchet (specs 0285 and 0287) SHALL be raised from 9080 to 9090 for this change. The hard cap of 9100 is unchanged.

## MODIFIED

Nothing is modified.

## REMOVED

Nothing is removed.
