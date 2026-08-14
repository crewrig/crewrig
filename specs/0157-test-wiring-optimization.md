---
id: "0157"
slug: test-wiring-optimization
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 939
version: 1.0.0
---

# test-wiring job optimization

## Intent

The `test-wiring` CI job completes in well under two minutes. The `Check Test Strays` step, which today takes about eight minutes by serially executing all 74 test suites just to scan their output for stray `command not found` errors, runs a fast, changeset-aware, cache-backed scan instead. A contributor editing one or two test suites sees that step finish in seconds, with no reduction in stray-detection coverage for the suites they changed.

## Requirements

1. The `test-wiring` job's `Check Test Strays` step SHALL complete in under two minutes on the CI critical path.
2. When the changeset modifies one or more test suites under `scripts/tests/`, the strays check SHALL execute only those modified suites, not the full corpus of suites.
3. The stray verdict for a test suite SHALL be content-addressed: a suite whose content hash is unchanged SHALL be served from cache rather than re-executed.
4. The content hash of a suite SHALL incorporate the content of the shared `scripts/lib/**` helpers it may source, so that a change to a shared helper invalidates the cached verdicts of every suite and re-validates them.
5. When the affected-suite set cannot be determined from the changeset, the check SHALL fall back to scanning every suite whose verdict is not cached.
6. The suites selected for execution SHALL run in parallel, bounded by the runner's available vCPUs.
7. The optimization SHALL NOT reduce stray-detection coverage for any suite whose content changed: a suite with a changed content hash SHALL always be re-executed and re-validated.
8. The change SHALL preserve the GitHub-GitLab parity contract (spec 0049): `.github/workflows/build.yml` and the generated `.gitlab-ci.yml` SHALL be updated symmetrically, and `scripts/check-ci-parity.sh` SHALL remain green.
9. The behavior of the other `test-wiring` steps (`Check Test Wiring`, `Test Check Test Wiring`, `Test Check Test Strays`, `Test Worktree Git Guard`) SHALL be unchanged.

## Scenarios

**Scenario:** changeset edits a single test suite

Given a pull request that modifies only `scripts/tests/test-foo.sh`
When the `Check Test Strays` step runs
Then only `test-foo.sh` is executed and scanned for stray commands
And the step completes in seconds, not minutes
And no other test suite is executed by this step

**Scenario:** unchanged suite is served from cache

Given a prior run that cached the stray verdict of `test-foo.sh` keyed by its content hash
When a new run presents the same `test-foo.sh` content and unchanged `scripts/lib/**`
Then `test-foo.sh` is not re-executed and its cached verdict is used

**Scenario:** shared helper changes invalidates all verdicts

Given a prior run that cached stray verdicts for all suites
When a pull request changes a file under `scripts/lib/**`
Then every suite's cached verdict is invalidated
And each suite without a valid cache entry is re-executed, in parallel

**Scenario:** affected set cannot be determined

Given a strays-check invocation without a resolvable changeset
When the step runs
Then it falls back to scanning every suite whose verdict is not cached
And it does not silently skip any suite

**Scenario:** stray command is introduced into a changed suite

Given a pull request that adds a stray `some-bogus-command` line to `scripts/tests/test-foo.sh`
When the `Check Test Strays` step runs
Then `test-foo.sh` is executed, the stray command is detected, and the step fails

**Scenario:** no test suites changed

Given a pull request that touches no file under `scripts/tests/` and no shared helper
When the `Check Test Strays` step evaluates its work
Then it performs no suite execution and completes quickly

## Out of scope

- Changing the logic or behavior of the other `test-wiring` steps.
- Changing the `check-test-wiring.sh` script or its wiring registry.
- Introducing new checks or new test coverage.
- Reducing the number or frequency of checks performed elsewhere in the pipeline.
- Optimizing the runtime of individual heavy test suites (e.g. `test-mcp-daemon.sh`, `test-component-tier-resolution.sh`) — only the strays-scan scheduling changes.
- Migrating the CI to a different engine or runner provider.

## Open questions

- None.
