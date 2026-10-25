# Runbook — Finding the real failure in a cancelled CI run

<!-- crewrig-doc: published=false -->

Tracked in [issue #1742](https://github.com/crewrig/crewrig/issues/1742).

## Symptom

A `Build & Validate` run ends as `cancelled` and every failing-looking check
reads `cancelled` (in a called workflow the job reads `gate / <job>`); the job-level view shows no `failure`.

## Cause

The `cancel-on-failure` action (`.github/actions/cancel-on-failure/`) cancels
the whole run from the failing job's `if: failure()` step. The cancel also
rewrites that job's conclusion to `cancelled`. The real failure survives only
as a step with `conclusion: failure`.

## Diagnosis

1. Open the run summary: since #1742 the action records the failing job and
   step there, and as an error annotation.
2. For older runs, or if the summary is missing, query attempt 1 — a rerun
   replaces the job list in the default view, so always name the attempt:

   ```sh
   gh api repos/<owner>/<repo>/actions/runs/<run-id>/attempts/1/jobs \
     --jq '.jobs[] | {job: .name, failed: [.steps[] | select(.conclusion=="failure") | .name]} | select(.failed | length > 0)'
   ```

3. Do not rerun cancelled jobs before this: a rerun of a job that fails on a
   PR defect cannot pass and erases the evidence from the default view.
