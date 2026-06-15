---
name: tester
description: "Test authoring and test-strategy skill. Activate when writing new tests, planning a test strategy, enumerating edge cases for a feature, or reviewing whether a change has adequate coverage. Optimized for high-signal tests that catch regressions, not coverage theater."
license: Apache-2.0
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.2.3"
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

Before declaring a test skipped because a tool, binary, subcommand, or
service is "unavailable", you MUST run a concrete probe against it and
cite the failure. Acceptable probes, in order of preference:

1. The tool's own discovery flag: `<tool> --help`, `<tool> --version`,
   `<tool> <subcommand> --help`.
2. A minimal real invocation with throwaway input (e.g.
   `<tool> -p "hello"`, a no-op call with `--dry-run`).
3. A `which <tool>` / `command -v <tool>` check, but only as a
   precursor — a binary on `$PATH` may still expose the subcommand you
   need.

A tool is unavailable only when the probe produces one of:

- A non-zero exit code, with stderr captured in the report.
- An explicit error message ("command not found", "unknown subcommand",
  "permission denied", "connection refused").
- A timeout exceeding a stated bound.

Forbidden grounds for declaring unavailability:

- "I don't recognize this subcommand." Recognition is not a probe —
  CLIs evolve faster than training data.
- "The documentation I've seen doesn't mention it." Documentation lags
  releases.
- "The previous attempt in this session failed." Re-probe; the
  environment may have changed (PATH, login shell, credentials).

When a probe fails, quote the exact command run and the exact output
(exit code + first line of stderr) in the skip rationale. A skip
without a quoted failure is a protocol violation and forces the test
to be re-attempted.

## Output expectations

- Tests committed alongside the change they cover, never in a separate
  PR (unless the project explicitly batches test PRs).
- A one-line comment above each test stating the *why* — the behavior
  being asserted — only when the test name alone is not self-evident.
- Test data inline when small; in fixtures when reused or large.

## Finding class taxonomy

When re-spawned as part of a `tech`-class iteration of the
retroactive review loop (per
[`specs/0005-retroactive-routing-engine.md`](../../../specs/0005-retroactive-routing-engine.md)
R4 and [`docs/retroactive-loop.md`](../../../docs/retroactive-loop.md)
→ *Routing matrix*), the skill consumes reviewer findings each
tagged with a `class:` field. The skill SHALL act on findings whose
`class:` is `tech` and that touch the test surface, and SHALL
surface a violation back to the orchestrator if any incoming
finding it is asked to address omits the tag — a missing tag is a
reviewer protocol error. Findings tagged `arch` or `spec` are
out-of-scope for this skill and indicate misrouting; flag and
return.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline. The reporter walks you through identifying the offender,
picking the room, and filling the payload.
