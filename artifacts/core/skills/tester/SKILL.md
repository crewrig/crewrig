---
name: tester
description: "Writes high-signal tests and plans test strategy: a regression test for a bug fix verified failing-then-passing, the priority edge cases of a behaviour, integration tests against real dependencies, and the check that a tool is really unavailable before a test is skipped. Use when asked to write tests, add a regression test, plan a test strategy, enumerate edge cases, review whether a change has adequate coverage, or decide whether to skip a test for a missing tool. Not for web end-to-end tests with Playwright or RobotFramework (web-tester), for fixing the code under test (developer), or for reviewing a pull request (pr-reviewer)."
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 (the script runs as node scripts/probe-tool.ts) and the project's own test runner."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.3.0"
claude:
  allowed-tools:
    - Read
    - Write
    - Edit
    - Bash
    - Grep
    - Glob
  user-invocable: true
---

# Tester

Tests exist to catch regressions and to document behavior, not to
inflate a coverage number. Bias toward fewer, sharper tests.

## When to activate

- A feature is being added and the project's convention requires tests.
- A bug fix lacks a regression test.
- The user asks for a test plan or edge-case enumeration.
- A diff is up for review and you suspect under-tested behavior.

If the project has no test infrastructure and the user has not asked
for one, do not invent one — say so and move on.

## Operating mode

### 1. Identify the unit of behavior

Pick the smallest *observable* behavior to test, not the smallest
*function*. A function with no observable contract has nothing to
test. A file-level helper called only from one place is best tested
through the caller.

### 2. Golden path + edge cases (not exhaustively)

For each behavior, plan:

- **One golden-path test** that exercises the success case.
- **One or two edge-case tests** for the failure modes that matter.
- **A regression test** if the test was triggered by a bug fix —
  named so it is obvious which bug it guards.

Edge cases to consider, in this order of priority:

1. Empty / null / zero-length input.
2. Boundary values (off-by-one, overflow, encoding edges).
3. Known-bad input (malformed, adversarial — see security skill).
4. Concurrent / repeated invocations if the surface is stateful.
5. Partial failure (network mid-call, disk full, signal interrupt).

Stop adding cases when the marginal case becomes contrived. Coverage
of contrived cases costs maintenance forever.

### 3. Real dependencies where it matters

For integration tests:

- Hit a real database when the project's convention is integration
  testing (use Testcontainers, Docker Compose, or the project's
  scaffold). Mocked DB tests have a known failure mode where they
  pass while the real schema is broken.
- Mock an external API only when its calls are non-deterministic, slow,
  or rate-limited. Otherwise prefer a recorded fixture (VCR-style).

If the project has explicit guidance ("don't mock the database"),
follow it without rediscovering the lesson.

### 4. Test naming and structure

Name tests by behavior, not by function:

```text
✓ test_login_with_valid_credentials_returns_session_token
✗ test_login_function
```

Structure each test as **arrange / act / assert**, with a blank line
between each phase. Multi-assertion tests are fine when the assertions
together describe one behavior; split when they describe two.

### 5. Verifying a fix

When the trigger is a bug fix:

1. Write the test *first*. Run it. Confirm it fails for the *right*
   reason — not a setup error.
2. Apply the fix.
3. Run the test. Confirm it passes.
4. Run the rest of the suite to detect regressions in unrelated areas.

A test that never failed before the fix proves nothing.

### 6. Tool availability is empirical, not assumed

A test skipped because a tool, binary, subcommand or service is
"unavailable" is only as good as the check behind it: CLIs evolve faster
than anyone's memory of them, so a skip rationale resting on a guess gets
the test attempted again later at the user's expense.

Before declaring the skip, run the probe:

```sh
node scripts/probe-tool.ts <tool> [<subcommand>] [--timeout <seconds>] [--json]
```

It runs the tool's help flag, then its version flag, directly and not
through a shell, and looks the tool up on `PATH` as a precursor only
(a binary on `PATH` can still lack the subcommand you need).

| Exit | Meaning | What to do |
|---|---|---|
| `0` | A probe exited `0`: the tool answers. | Write the test. Do not skip. |
| `1` | No probe succeeded. The finding quotes each command, its exit code or `command not found` or `timed out`, and the first line of stderr. | Run one minimal real invocation with throwaway input, since a tool can exist and still exit non-zero on its help flag. If that fails too, quote the finding and that invocation in the skip rationale. |
| `2` | Usage error. | Fix the command line. |
| `3` | `PATH` is not set. | Set it, or give the tool as a path. |

These are not grounds for a skip: "I do not recognise this subcommand",
"the documentation I have seen does not mention it", or "the previous
attempt in this session failed". None is a probe, and the environment
may have changed (`PATH`, login shell, credentials) since.

A skip without a quoted failure forces the test to be attempted again.

## Output expectations

- Tests committed alongside the change they cover, never in a separate
  PR (unless the project explicitly batches test PRs).
- A one-line comment above each test stating the *why* — the behavior
  being asserted — only when the test name alone is not self-evident.
- Test data inline when small; in fixtures when reused or large.

## Findings from a review loop

When you are re-spawned to act on the findings of a review, act only on
the findings tagged `class: tech` that touch the test surface. Return a
finding with no tag to the orchestrator as a protocol error, and return
an `arch` or `spec` finding as misrouted, without acting on either. The
rule and its reason are in `references/shared-finding-class-taxonomy.md`.

## Friction reporting

When something in the workflow misleads or blocks you, tag it with the
`harness-report` skill. The rule is in
`references/shared-friction-reporting.md`.
