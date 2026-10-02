---
id: "0171"
slug: push-base-ref-test-strays
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1445
version: 2.0.0
---

# Push Event Base Ref Resolution for Test Strays Guard

## ADDED

Reason: [`specs/0170-efficient-test-strays-guard.delta-01.md`](0170-efficient-test-strays-guard.delta-01.md)
R9 makes `scripts/check-test-strays.sh` execute zero suites in every circumstance, with no base ref
needed and none consulted, and the owner approved that direction on #1445 (2026-10-02). A base ref
therefore no longer has anything to resolve; this delta removes what R9 contradicts and nothing else.

- **Requirement 6.** `scripts/check-test-strays.sh` SHALL accept and ignore the former `--base-ref <ref>`,
  `--cache-dir <dir>` and `--jobs <n>` options (each with its value) and SHALL NOT read
  `$GITHUB_BASE_REF`, `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME` or `$CI_COMMIT_BEFORE_SHA`, so that an
  invocation with or without a base ref behaves identically. Any positional argument or other option
  remains a usage error (exit 2).

## MODIFIED

- **Intent, items 1 and 3** (resolve the diff base from the environment; push events complete in
  milliseconds because no suite changed) become: `scripts/check-test-strays.sh` needs no base ref, and
  push and pull-request events behave identically, executing zero suites at runtime (spec 0170 delta-01
  R9).
- **Requirement 3** ("If no test suites under `scripts/tests/` are modified in the resolved diff, ...
  SHALL execute zero suites at runtime and exit 0 with `OK: zero runtime strays across all test
  suites.`") becomes: `scripts/check-test-strays.sh` SHALL execute zero suites at runtime in every
  circumstance; after a clean static syntax pass it SHALL exit 0 with exactly one line, `OK: <N> test
  suites pass the static syntax check; none executed.`, where `<N>` is the number of suites checked.
  The former literal is replaced because the script no longer scans for runtime strays.
- **Scenario 1** (push event on `main` with no test modifications) becomes: given a push event on `main`,
  with or without a base ref available, when the script runs, then it performs the static `bash -n`
  pass only, executes zero suites, and exits 0 with the line from Requirement 3 as modified.

## REMOVED

- **Intent, item 2**: "In CI workflows (...), `check-test-strays.sh` is invoked with explicit
  `--base-ref` parameters or inherits environment variables that resolve the previous commit for push
  events."
- **Requirement 1**: the `BASE_REF` precedence (`--base-ref`, `$GITHUB_BASE_REF`,
  `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `$CI_COMMIT_BEFORE_SHA`, `HEAD~1`).
- **Requirement 2**: computing `git diff --name-only <merge-base> HEAD -- scripts/tests/` and executing
  the modified or added suites.
- **Requirement 4**: the static-validation-plus-un-cached-execution fallback when `BASE_REF` cannot be
  resolved.
- **Requirement 5**: the regression cases for `HEAD~1` automatic resolution in
  `scripts/tests/test-check-test-strays.sh`. The wider rewrite of that suite belongs to spec 0170
  delta-01 (its requirement 8 as modified), not to this delta.
- **Scenario 2**: push event on `main` modifying a single test suite and executing only that suite.

**Not touched.** `scripts/lib/base-ref-resolve.sh` and its `resolve_remote_ref` cases (issue #1401) stay and are not touched by this delta; only the call from `scripts/check-test-strays.sh` goes away, as a consequence of spec 0170 delta-01 R9 and R19. Other consumers of that library are unaffected.
