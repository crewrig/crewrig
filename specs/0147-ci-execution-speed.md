---
id: "0147"
slug: ci-execution-speed
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 906
version: 1.0.0
---

# CI execution speed

## Intent

The CI pipeline for pull requests and pushes completes in under two minutes, and the `check-components` job is no longer a single sequential monolith. A contributor sees a fast, parallel, changeset-aware pipeline in which only the checks relevant to their change run, repeated runs of unchanged work are served from cache, and heavy or non-blocking jobs can be triggered on demand.

## Requirements

1. The CI pipeline's critical-path wall-clock time on a pull request SHALL be under two minutes.
2. The `check-components` job SHALL be decomposed into multiple focused jobs, each responsible for a single concern.
3. Each focused job SHALL run independently and in parallel with the other focused jobs.
4. A focused job SHALL run only when the changeset touches a path that the job's checks exercise; a changeset that touches no such path SHALL NOT trigger the job.
5. When the path mapping for a focused job cannot be determined for a changed file, the job SHALL run (fail-safe).
6. Repeated runs of unchanged work SHALL be served from a cache whose key is derived from the content of the impacted files and the relevant environment variables.
7. A cache hit SHALL NOT skip a check whose inputs changed.
8. Heavy or non-blocking jobs SHALL be triggerable manually.
9. The pipeline SHALL preserve the symmetry contract enforced by `check-ci-parity` (spec 0049): the GitHub Actions pipeline and the generated GitLab pipeline SHALL agree.
10. The optimization SHALL NOT reduce the effective coverage of the checks currently performed.

## Scenarios

**Scenario:** changeset touches one concern

Given a pull request that modifies only files exercised by a single focused job
When the pipeline runs
Then only that job (and any job whose path mapping covers the changed files) is scheduled
And the pipeline completes in under two minutes
And no job whose paths are untouched is scheduled

**Scenario:** cache hit on unchanged work

Given a prior run that cached the output of a job keyed by the content of its inputs
When a new run presents identical input content
Then the job is served from cache and does not re-execute

**Scenario:** ambiguous path mapping

Given a changed file whose mapping to a focused job cannot be determined
When the pipeline evaluates whether to run that job
Then the job runs, even though it may be unnecessary

**Scenario:** cache key does not capture a real change

Given a change to an input file that the cache key does not reflect
When the pipeline evaluates the cache for that job
Then the job re-executes rather than serving stale output

## Out of scope

- Reordering, renaming, or removing existing checks — only their scheduling, grouping, and caching change.
- Adding new checks or new coverage.
- Migrating the CI to a different engine or runner provider.
- Optimizing the e2e suite runtime (tracked separately in issue #159).
- Changing the release workflows (`release-monorepo`, `release-extension`).
- Reducing the number of checks performed.

## Open questions

- None.
