---
id: "0157"
slug: test-wiring-optimization
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1445
version: 2.0.0
---

# test-wiring job optimization

This delta retires the changeset-aware, cache-backed runtime scan of spec 0157
(and of its delta-01). Spec 0170 delta-01 (requirement R9) makes
`scripts/check-test-strays.sh` execute zero suites in every circumstance, and
(R10-R11) makes the job that owns a suite produce that suite's stray verdict.
The execution-set, content-hash, cache, fallback and parallelism requirements of
spec 0157 therefore have nothing left to govern. Requirement 8 (GitHub-GitLab
parity) is kept unchanged.

## ADDED

1. A requirement, numbered 10 (numbers 2 to 7 are retired by this delta and
   not reused):

   > The stray verdict of a changed test suite SHALL be produced by the job
   > that owns the suite, as specified by spec 0170 delta-01 requirements R10
   > and R11, and SHALL NOT be produced by the `Check Test Strays` step.

## MODIFIED

1. **`## Intent`.**

   Original:

   > The `Check Test Strays` step, which today takes about eight minutes by
   > serially executing all 74 test suites just to scan their output for stray
   > `command not found` errors, runs a fast, changeset-aware, cache-backed
   > scan instead. A contributor editing one or two test suites sees that step
   > finish in seconds, with no reduction in stray-detection coverage for the
   > suites they changed.

   Replacement:

   > The `Check Test Strays` step, which today takes about eight minutes by
   > serially executing all 74 test suites just to scan their output for stray
   > `command not found` errors, runs a static syntax check of every test suite
   > and executes none. A stray command in a suite is detected once, in the job
   > that owns the suite. A contributor editing one or two test suites sees the
   > `Check Test Strays` step finish in seconds.

2. **Requirement 1.**

   Original:

   > The `test-wiring` job's `Check Test Strays` step SHALL complete in under
   > two minutes on the CI critical path.

   Replacement:

   > The `test-wiring` job's `Check Test Strays` step SHALL complete in under
   > two seconds, matching spec 0170 delta-01 requirement R9.

3. **Requirement 9.**

   Original:

   > The behavior of the other `test-wiring` steps (`Check Test Wiring`,
   > `Test Check Test Wiring`, `Test Check Test Strays`,
   > `Test Worktree Git Guard`) SHALL be unchanged.

   Replacement:

   > The behavior of the other `test-wiring` steps (`Check Test Wiring`,
   > `Test Check Test Wiring`, `Test Check Test Strays`,
   > `Test Worktree Git Guard`) SHALL be unchanged, except that the three
   > steps that execute a test suite are checked for strays as suite commands
   > under spec 0170 delta-01 requirements R10 and R11.

4. **Scenario "no test suites changed".**

   Original:

   ```text
   Given a pull request that touches no file under `scripts/tests/` and no shared helper
   When the `Check Test Strays` step evaluates its work
   Then it performs no suite execution and completes quickly
   ```

   Replacement (unconditional):

   ```text
   Given any pull request, whatever files it changes
   When the `Check Test Strays` step runs
   Then it performs no suite execution and completes in under two seconds
   ```

## REMOVED

1. **Requirement 2** and its delta-01 replacement text (the strays check
   executes the union of the modified suites and the cache-miss suites).
2. **Requirement 3** (the stray verdict is content-addressed and a suite with
   an unchanged content hash is served from cache).
3. **Requirement 4** (the content hash incorporates the `scripts/lib/**`
   helpers a suite may source).
4. **Requirement 5** (fall back to scanning every suite whose verdict is not
   cached when the affected set cannot be determined).
5. **Requirement 6** (the suites selected for execution run in parallel,
   bounded by the available vCPUs).
6. **Requirement 7** (a suite with a changed content hash is always
   re-executed and re-validated).
7. The scenarios *"changeset edits a single test suite"*, *"unchanged suite is
   served from cache"*, *"shared helper changes invalidates all verdicts"*,
   *"affected set cannot be determined"* and *"stray command is introduced into
   a changed suite"*, and delta-01's scenario *"cold cache re-executes all
   cache-miss suites"*.

The removed machinery is replaced by Requirement 10 above: the stray verdict of
a changed suite is produced by its owning job (spec 0170 delta-01 R10-R11).
