---
id: "0289"
slug: skill-script-citations
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1863
version: 1.2.0
---

# Skill script citations resolve or are repo-scoped

*Delta 02 of `specs/0289-skill-script-citations.md`. Source: review pass 1 of the implementation PR of issue #1863 and the full test run on that PR. A dedicated CI job for the check was tried and rejected: it adds a job to every CI surface and overruns the CI-surface budget of specs 0285 and 0287 by far more than the job it replaces costs. The delta keeps R15 of delta 01 (the check runs in the existing `check-description-length` job), makes the failure name the check, and records the budget consequence. Version 1.2.0, a MINOR bump. Requirements modified: none. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

19. **R19 (failure names the check).** The check SHALL open its failure output with a line naming it, `check-agent-script-citations`, and the `name:` field of the `check-description-length` capability in the CI capability reference SHALL state that the job also fences agent script citations (a comment would count against the comment budget), so that a citation failure is never read as a description-length failure.
20. **R20 (CI-surface budget).** The check adds its path filters to the `check-description-length` capability and to the GitLab job generated from it, and the total of the three CI surfaces goes from 9076 to 9082 lines. The pin and the floor of the CI-surface size ratchet (specs 0285, 0287 R13 and 0293) SHALL both be raised from 9080 to 9090, the measured total rounded up to the next ten. The hard cap of 9100 is unchanged.

## MODIFIED

Nothing is modified.

## REMOVED

Nothing is removed.
