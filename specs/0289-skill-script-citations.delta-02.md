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

*Delta 02 of `specs/0289-skill-script-citations.md`. Source: review pass 1 of the implementation PR of issue #1863 (finding `i1-F2`, class `spec`) and the coordinator's instruction to give the check its own CI job. The delta amends R15 of delta 01 so that the check runs in a dedicated job. Version 1.2.0, a MINOR bump. Requirements modified: R15 of delta 01. This delta opens no question.*

## ADDED

Nothing is added.

## MODIFIED

<!-- markdownlint-disable MD029 -->

15. **R15 (enforcement in CI), original (delta 01):** "The check of R12 SHALL be part of the CI governance group, run by the existing source-lint job through the repository's task and path-filter conventions, so that a change to an agent body, to the check or to its fixtures runs it."

   **Amended:** the check of R12 SHALL be part of the CI governance group and run by its own job, `check-agent-script-citations`, declared in the CI capability reference with the repository's task and path-filter conventions, so that a change to an agent body, to the check, to its fixtures or to the bundled skill linter it is held in parity with runs it. The job SHALL NOT share a job with another check, so that a failure names the check at fault.

## REMOVED

Nothing is removed.
