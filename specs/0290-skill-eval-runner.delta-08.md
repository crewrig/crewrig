---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1938
version: 3.4.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 08 of `specs/0290-skill-eval-runner.md`, building on delta-01 to delta-07. Source: issue #1938, found on #1919 and #1934. A `stale` attestation blocks `task ci:pre-push` as it blocks pull-request CI, so a skill edit cannot be pushed, even to open a draft pull request for an early review, until a paid measurement exists. Measuring before the review penalises every review fix with a second paid measurement. The owner's decision (issue #1938): a `stale` attestation warns before the pull request is ready for review and blocks once it is; `invalid` is unchanged; `docs/skill-evals.md` states the intended order. Requirements added: R52. Requirements modified: R37. The version bump is MINOR (additive behaviour). Confirming a regression before blocking, raised in a comment on the issue, is out of scope. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

52. **A `stale` attestation warns until the pull request is ready for review.** The attestation check of R37 SHALL read one engine-neutral input, the environment variable `CREWRIG_PR_DRAFT`, the one that spec 0168 delta-01 (R9 to R11) defines for the spec linter; only the exact string `true` has an effect. When it is `true`, a `stale` outcome SHALL be reported as a warning: the finding line ends with the suffix `[warning]`, after a space, in place of `[blocking]`, the `stale` outcome does not make the run exit non-zero, and the reason is printed unchanged. Under any other value, including unset and empty, a `stale` outcome blocks as before. The outcome `invalid`, and the other outcomes of R37, are unaffected by the variable: `invalid` blocks whatever its value. The input is wired as follows. (a) `task ci:pre-push` SHALL export `CREWRIG_PR_DRAFT=true` to the task `skill-evals-attestation`, as it already does to `lint-specs` and to no other task, and SHALL still remove any ambient `CREWRIG_PR_DRAFT` from every task environment before it does so: a push is made before a pull request is ready for review, so the warning applies on that path whatever the caller exports. (b) In the GitHub pull-request pipeline, the job running the check SHALL set `CREWRIG_PR_DRAFT` from the draft state of the pull request, with the mapping of spec 0168 delta-01 (`true` for a draft pull request, the empty string otherwise), and the workflow SHALL run on the `ready_for_review` and `converted_to_draft` transitions, as the existing triggers of `build.yml` already do, so that a pull request marked ready is checked again with `stale` blocking. (c) In the GitLab pipeline, the capability `skill-evals-attestation` of `ci/ci-capabilities.yml` SHALL declare `CREWRIG_PR_DRAFT: "$CI_MERGE_REQUEST_DRAFT"` as the capability `lint-specs` does, and the derived `.gitlab-ci.yml` SHALL be regenerated, so the drift check of spec 0049 stays green. (d) A run with no pull-request context leaves the variable unset and keeps the blocking behaviour. The check SHALL read no other variable to decide this, and SHALL NOT infer the draft state itself.
    Acceptance: with `CREWRIG_PR_DRAFT=true`, a skill whose `results.json` is stale (absent, or carrying another content hash) yields a `[warning]` line, exit 0; with the variable unset, empty or `false`, the same skill yields `[blocking]`, exit 1; with `true`, an `invalid` skill still yields `[blocking]`, exit 1, and a mix of one `stale` and one `invalid` skill exits 1 naming only the `invalid` one as blocking; `task ci:pre-push` runs the attestation task with `CREWRIG_PR_DRAFT=true` and every other task but `lint-specs` and the attestation without it, even when the caller exports it; the GitHub job and the GitLab capability carry the mapping and `check-ci-parity` passes.

## MODIFIED

**R37 (attestation check), as modified by delta-01 and delta-04.** Original (delta-01): "Outcomes: `invalid` and `stale` SHALL be blocking (non-zero exit naming the skill and the reason) with no setting to relax them". Replacement: `invalid` SHALL be blocking with no setting to relax it, and `stale` SHALL be blocking with no setting to relax it, except under the draft signal of requirement 52, where it is reported as a warning and does not block. Every other clause stands. The implementation SHALL update `docs/skill-evals.md`: the attestation paragraph says that `stale` blocks only once the pull request is ready for review and warns in `task ci:pre-push` and on a draft pull request, and a new passage states the intended order of a skill change, which is: review the change to zero blocking findings, then run one measurement, then run a review pass bounded to the increment of the `results.json` file (the attestation, which changes nothing else), so that a review fix is never paid for twice.
    Acceptance: as the acceptance of requirement 52; `docs/skill-evals.md` states the warning rule and the order of the three steps.

## REMOVED

None.

## Consequences (intended, not debt)

- A skill edit can be pushed, and a draft pull request opened, with a stale attestation. The author still has to measure before marking the pull request ready: the check runs again on `ready_for_review` and blocks.
- `--no-verify` stays forbidden; the warning removes the reason to want it.
- A pull request opened ready (not as a draft) with a stale attestation blocks at once, as today.
- A stale attestation that is only warned about reaches the pull-request page as a warning line in the job log and in `$GITHUB_STEP_SUMMARY`, so the review can see it.

## Scenarios

**Scenario:** a stale attestation warns on a draft pull request

```text
Given a skill whose SKILL.md changed and whose evals/results.json records another content hash
And   CREWRIG_PR_DRAFT is "true"
When  the attestation check runs
Then  the finding line ends with "[warning]" and the run exits 0
```

**Scenario:** a stale attestation blocks on a ready pull request and on a push

```text
Given the same skill
And   CREWRIG_PR_DRAFT is unset, empty or "false"
When  the attestation check runs
Then  the finding line ends with "[blocking]" and the run exits 1
```

**Scenario:** an invalid skill blocks on a draft pull request

```text
Given a skill whose evals.json is invalid and CREWRIG_PR_DRAFT is "true"
When  the attestation check runs
Then  the finding line ends with "[blocking]" and the run exits 1
```

## Out of scope

- Requiring a confirmed regression (a second run, or a re-run of the failing evals) before a recorded `regression` blocks.
- Any change to `no-evals`, `fail` or `regression` handling, to the content hash or to the runner.
- Any other task of `ci:pre-push` receiving the draft signal.

## Open questions

None.
