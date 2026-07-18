---
id: "0077"
slug: e2e-readme-budget
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 542
version: 1.0.0
---

# Trim the e2e walkthrough READMEs back within budget and de-quarantine their tests

## Intent

Two end-to-end walkthrough READMEs that had grown past their deliberate
conciseness budget are brought back within it, and the two content-guarantee
tests that were quarantined for exceeding that budget run again as part of
continuous integration. A reader of `tests/e2e/README.md` and
`tests/e2e/lib/README.md` still finds every fact those documents are required to
carry — the three command-line auth walkthroughs, the credential-rotation
cadence, the read-only security posture, the cross-references to the originating
epic and its child tickets, the helper-library descriptions, and the pointer
between the two files — only expressed more tightly. The two tests that assert
those guarantees no longer sit on the exemption allowlist as known failures:
they pass and are executed by a workflow, so the guarantees are enforced
continuously again rather than parked.

## Requirements

1. `tests/e2e/README.md` and `tests/e2e/lib/README.md` SHALL each be within the
   200-line budget that their content-guarantee tests enforce.
2. The reduction that brings each README within budget SHALL preserve every
   content guarantee its test asserts, dropping no guaranteed fact and tightening
   prose only. For `tests/e2e/README.md`: coverage of all three CLI auth flows
   (Claude Code, Gemini CLI, GitHub Copilot CLI), the 90-day personal-access-token
   (PAT) rotation cadence, the read-only-mount security posture, and at least one
   cross-reference to the originating epic or its child issues. For
   `tests/e2e/lib/README.md`: coverage of the three helper libraries
   (`assert.sh`, `structural.sh`, `llm_judge.sh`), the `ANTHROPIC_JUDGE_API_KEY`
   separation rationale, the `max_calls` cap, and the macOS/BSD grep caveat. And
   the pointer from `tests/e2e/README.md` to `tests/e2e/lib/README.md`.
3. `scripts/tests/test-e2e-readme.sh` and `scripts/tests/test-e2e-libs-readme.sh`
   SHALL pass, SHALL be executed by at least one CI workflow, and SHALL be removed
   from `ci/test-wiring-exemptions.txt`, so that neither lingers on the allowlist
   as a test deliberately not run in CI once it is fixed and wired — honoring the
   allowlist's hygiene rule that a fixed-and-wired test must not remain a redundant
   exemption, and the spec-0076 guard rule that forbids a stale exemption naming a
   test that has changed state.
4. Wiring the two tests into CI SHALL preserve the ordered
   GitHub-Actions-to-GitLab command-parity guarantee established by spec 0076; the
   ordered command-parity gate SHALL remain green.

## Scenarios

**Scenario:** both walkthrough READMEs are within budget, tests pass, and the
quarantine is lifted (happy path)

Given the fix has trimmed `tests/e2e/README.md` and `tests/e2e/lib/README.md` so
      each is 200 lines or fewer with every asserted content guarantee still
      present
When  `scripts/tests/test-e2e-readme.sh` and `scripts/tests/test-e2e-libs-readme.sh`
      run in CI and neither is listed in `ci/test-wiring-exemptions.txt`
Then  both tests pass, both are executed by a CI workflow, and the test-wiring
      guard is green with no stale or redundant exemption for either test

**Scenario:** the trim preserves every guaranteed fact (happy path)

Given a reader opens the trimmed `tests/e2e/README.md` and `tests/e2e/lib/README.md`
When  they look for the content those files are required to carry
Then  they find all three CLI auth walkthroughs, the 90-day PAT rotation cadence,
      the read-only-mount posture, the epic/child issue cross-references, the three
      helper-library descriptions, the `ANTHROPIC_JUDGE_API_KEY` separation
      rationale, the `max_calls` cap, the macOS/BSD grep caveat, and the pointer
      from the top-level README to the lib README

**Scenario:** a README over budget fails its content-guarantee test (failure path)

Given `tests/e2e/README.md` is 289 lines, above the 200-line budget — the pre-fix
      state this ticket resolves
When  `scripts/tests/test-e2e-readme.sh` runs
Then  the test fails on the budget assertion, reporting the over-budget line
      count, and the test cannot be de-quarantined until the file is back within
      budget

**Scenario:** command-parity gate stays green after wiring (non-regression)

Given the two tests have been wired into CI and removed from the exemption
      allowlist
When  the ordered GitHub-Actions-to-GitLab command-parity gate runs
Then  it remains green, because the ordered per-test enumeration is preserved
      identically across both CI surfaces

## Out of scope

- Revising the 200-line budget value itself. The budget is intentional and locked
  by issue #78; this ticket brings the files back within it rather than raising it.
- Changing any content-guarantee assertion in the two tests. The tests are made to
  pass by fixing the READMEs, never by loosening or removing what the tests check.
- The other quarantined end-to-end tests — `test-e2e-runner.sh` (issue #543) and
  `test-e2e-toml-merge.sh` (issue #544) — each owned by a separate ticket.
- Restructuring the end-to-end harness, its scenario runner (`tests/e2e/run.sh`),
  or the scenarios themselves.

## Open questions
