---
id: "0168"
slug: spec-status-transition-enforcement
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1762
version: 1.1.0
---

# Automated Enforcement of Spec Status Transitions

Delta-01 ties the spec `status: draft` tolerance of requirement 1 to the Draft
state of the pull request. A spec-PR is opened while its spec is `draft`, so
requirement 1 as written turns every spec-PR red by design until the status is
flipped. After this delta a Draft PR/MR may carry a `draft` spec; the merge
guarantee of requirement 1 is unchanged because a Draft PR/MR cannot be merged.

## ADDED

### Requirements

- **R7. Draft signal, fail-closed.** `scripts/lib/spec-linter.js` SHALL read one
   engine-neutral input, the environment variable `CREWRIG_PR_DRAFT`. Only the
   exact value `true` marks the change as a Draft PR/MR. Every other state of
   the variable (absent, empty, `false`, or any other value) SHALL leave
   requirement 1 fully enforced, so a push to `main` or a release branch, a
   local run and an engine that supplies no signal behave exactly as before
   this delta.
- **R8. Skip scope.** When `CREWRIG_PR_DRAFT` is `true`, ONLY the requirement 1
   block (the `newDraftOffenders` check) SHALL be skipped. Every other check
   SHALL run unchanged: per-file format rules, id collision, the spec 0109
   base-branch `status: draft` check for specs already on the base, requirement
   2 (implementation branch must be `implemented`) and the `interaction-mode`
   requirements. When the skip takes effect and at least one added or modified
   spec or delta-spec carries `status: draft`, the linter SHALL print a
   non-failing `[NOTICE]` naming each such file and stating that its draft
   status was tolerated because the change is a Draft PR/MR.
- **R9. GitHub mapping.** The `lint-specs` job in `.github/workflows/build.yml`
   SHALL set `CREWRIG_PR_DRAFT` from `github.event.pull_request.draft`, to
   `true` only on a `pull_request` event whose PR is a draft and to the empty
   string otherwise.
- **R10. GitLab mapping.** The `lint-specs` capability in `ci/ci-capabilities.yml`
    SHALL declare `CREWRIG_PR_DRAFT` in its `env:` block, next to `BASE_REF`,
    mapped from the predefined variable `CI_MERGE_REQUEST_DRAFT` (available in
    GitLab 17.10 and later, per the GitLab CI/CD documentation of predefined
    variables and `workflow:rules`; the version is to be re-checked at plan
    time). GitLab 17.10 is the minimum supported version for this feature, and
    an older instance leaves the variable undefined, which
    R7 treats as not draft. `.gitlab-ci.yml` SHALL be regenerated
    with `node scripts/build-ci.ts` so the generated job carries the mapping,
    and `scripts/check-ci-parity.ts` (specs 0047, 0049) SHALL stay green.
- **R11. Re-trigger on readiness.** The `pull_request` trigger of
    `.github/workflows/build.yml` SHALL declare
    `types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]`
    so that marking a PR ready re-runs CI with the signal cleared and requirement
    1 enforced on the head SHA, and converting back to draft re-evaluates it.
    The neutral trigger vocabulary of `ci/ci-capabilities.yml`
    (`docs/ci-reference-format.md`) has no `types` filter and none is added:
    GitHub triggers are hand-authored, and GitLab merge-request pipelines are
    generated from `on: pull-request` unchanged.
- **R12. GitLab readiness asymmetry.** On GitLab, marking a merge request ready
    edits its draft state and, as far as this spec was able to ground it, does
    not by itself create a new pipeline; the head pipeline of the MR may
    therefore be a stale one created while the MR was draft. The procedure
    (R14) SHALL consequently require a fresh merge-request pipeline
    after marking an MR ready and before merging it, and SHALL NOT rely on the
    stale head pipeline. (Verification of the engine behaviour is open question
    1.)
- **R13. Merge safety, stated per forge.** A Draft PR/MR cannot be merged on
    either forge, so the only way to merge is to mark it ready. The guarantee of
    requirement 1 then holds as follows, and this requirement claims no more:
  - *Mechanical, GitHub.* A `build.yml` run created by a `ready_for_review`
    event, or by any later event on a ready PR, carries
    `github.event.pull_request.draft` equal to `false`, so requirement 1 is
    enforced on that run. A non-draft PR carrying a `draft` spec fails it.
  - *Residual, GitHub.* A run replays the event payload that created it, so a
    re-run of a run created while the PR was draft keeps
    `CREWRIG_PR_DRAFT=true` and can end green on the head SHA after the PR was
    marked ready. The merge step SHALL therefore rely only on a run created
    after the ready transition (R14(d)), and `scripts/merge-spec-pr.ts` SHOULD
    verify it where the forge exposes both timestamps (R15).
  - *Procedural, GitLab.* The variable is fixed at pipeline creation and R12
    applies: enforcement of requirement 1 on a ready MR rests on the fresh
    pipeline that R14(d) requires, not on a mechanism of the engine.
- **R14. Spec-PR procedure.** Every procedure that opens a spec-PR or delta
    spec-PR SHALL open it as a Draft PR/MR while the spec is `status: draft`
    (`gh pr create --draft`, `glab mr create --draft`). After the approval
    event the procedure SHALL, in order: (a) commit the flip to
    `status: approved` with `interaction-mode`; (b) `git push`; (c) mark the
    PR/MR ready (`gh pr ready`, `glab mr update --ready`); (d) wait for the
    CI run created by the ready transition (on GitLab, a fresh MR pipeline per
    R12) to be green, and never accept a re-run of a run created while the PR/MR
    was draft; (e) only then merge. The documentation SHALL
    name the Gitea equivalent if one exists, and otherwise state that the
    Draft-PR path is unavailable there and requirement 1 applies unchanged
    (open question 2).
- **R15. Merge wrapper.** `scripts/merge-spec-pr.ts` SHOULD also refuse, with a
    message naming the readiness step, a PR that is still a Draft PR
    (`gh pr view --json isDraft`). This is not a safety measure, since GitHub
    already refuses to merge a draft PR (R13); it replaces an opaque
    forge error with the missing procedural step. Where the forge exposes both
    the ready transition time and the creation time of the head SHA's CI run,
    the wrapper SHOULD also refuse a run that predates the transition (R13,
    residual). The existing refusal of a `draft` spec file is unchanged.
- **R16. Documentation and CLI symmetry.** The procedure change SHALL be documented
    identically for Claude Code, Gemini CLI, Copilot CLI and Antigravity, with
    no CLI-specific behaviour. It touches: `docs/spec-pr-workflow.md`,
    `docs/spec-format.md` (merge mechanic and the CI enforcement rules),
    `docs/interaction-modes.md` (user-gate definition and spec-PR exception),
    `docs/pr-format.md`, the `AGENTS.md` Spec-PR workflow pointer, and the
    skills that open or merge a spec-PR, `artifacts/core/skills/spec-author/`
    and `artifacts/core/skills/pr-logbook/` (plus
    `artifacts/library/skills/user-validate/` only if its gate procedure names
    the merge step). Every modified skill source SHALL bump
    `metadata.provenance.version` (AGENTS.md, Version Bump Convention), and the
    commit SHALL run `node scripts/lib/node-floor-guard.js` then
    `node scripts/build-components.ts` and stage the regenerated outputs.
- **R17. Automated tests.** The spec linter suite
    (`scripts/tests/spec-linter-*.test.ts`, run by the existing glob in the
    `lint-specs` job) SHALL cover: a draft spec with `CREWRIG_PR_DRAFT=true`
    passes and prints the `[NOTICE]`; the same spec with the variable `false`,
    empty or absent fails on requirement 1; a non-requirement-1 defect stays red
    under the signal; the spec 0109 base-branch draft check stays enforced under
    the signal; requirement 2 stays enforced under the signal. A separate test
    SHALL assert the mapping in both generated files: the `lint-specs` job in
    `.github/workflows/build.yml` (signal source and `types` list) and in
    `.gitlab-ci.yml` (`CI_MERGE_REQUEST_DRAFT`).

### Scenarios

**Scenario:** A Draft PR carrying only a draft spec is green

```text
Given a pull request on branch spec/0999-sample-spec that is a Draft PR
And CREWRIG_PR_DRAFT is true
And specs/0999-sample-spec.md carries status: draft and no other defect
When the spec linter runs in CI
Then it exits 0
And it prints a [NOTICE] naming specs/0999-sample-spec.md as tolerated.
```

**Scenario:** The same PR marked ready without the flip is red

```text
Given the pull request of the previous scenario is marked ready for review
And CREWRIG_PR_DRAFT is false or empty
And specs/0999-sample-spec.md still carries status: draft
When the spec linter runs in CI
Then it reports the spec 0168 R1 failure naming specs/0999-sample-spec.md.
```

**Scenario:** A Draft PR with another defect is red

```text
Given a Draft PR with CREWRIG_PR_DRAFT true
And specs/0999-sample-spec.md carries status: draft and a malformed frontmatter field
When the spec linter runs in CI
Then it reports the frontmatter failure and exits non-zero
And a base-branch status: draft spec modified by the same change is still reported as a failure.
```

**Scenario:** An absent signal leaves requirement 1 enforced

```text
Given a push to main, a release branch or a local run
And CREWRIG_PR_DRAFT is unset
And an added spec carries status: draft
When the spec linter runs
Then it reports the spec 0168 R1 failure.
```

**Scenario:** A GitLab Draft MR supplies the signal

```text
Given a GitLab merge request with the Draft state
And the generated lint-specs job maps CI_MERGE_REQUEST_DRAFT to CREWRIG_PR_DRAFT
When the lint-specs job runs
Then CREWRIG_PR_DRAFT is true and requirement 1 is skipped as for a GitHub Draft PR.
```

**Scenario:** Marking a PR ready re-runs CI

```text
Given a GitHub spec-PR that was green as a Draft PR
And the author has pushed the status: approved flip
When the PR is marked ready for review
Then a ready_for_review event starts a new build.yml run
And CREWRIG_PR_DRAFT is empty in its lint-specs job
And the run is green because the spec carries status: approved.
```

**Scenario:** Re-running a draft-era run does not satisfy the merge step

```text
Given a GitHub spec-PR whose run was created while the PR was a Draft PR
And the PR has since been marked ready after the flip to status: approved
When the draft-era run is re-run and ends green
Then the merge procedure does not accept it
And the merge waits for the run created by the ready transition.
```

### Complexity

`standard`. The change is not one skipped block: it spans the linter, two CI
engines (the `build.yml` signal mapping and trigger types, and the
`ci/ci-capabilities.yml` mapping with the regenerated `.gitlab-ci.yml`), new
comparison logic in `scripts/merge-spec-pr.ts`, about six documents, two to
three skill sources with a component rebuild, and a new test matrix.
`docs/adr/0010-spec-plan-review-lifecycle.md` (*Complexity tiers and team
sizing*) is the governing source and excludes an `architect` and a `tester`
from `small`; this change needs both, so it takes the full Template team.

### Out of scope

- Editing `Taskfile.yml`.
- Any change to spec 0168 requirement 2.
- Any change to the delta-spec and base-branch rules of spec 0109.
- Automation of PR titles or labels.

### Open questions

1. GitLab: does marking an MR ready create a new pipeline? Requirement 12
   assumes not; the plan should verify it on a real instance and relax the
   fresh-pipeline step if it does.
2. Gitea: `tea pulls create` has no documented `--draft` flag to our knowledge.
   Should the Gitea path use the `WIP:` title convention, or stay on
   requirement 1 unchanged?
3. GitLab: which command re-runs a merge-request pipeline in the procedure
   (`glab ci run` with MR context, or the "Run pipeline" action)? To be fixed
   at plan time.
4. Does `scripts/check-ci-parity.ts` compare `env:` values or only keys? The
   GitHub value is an expression and the GitLab value a variable reference, as
   for `BASE_REF`; confirm no parity change is needed.

## MODIFIED

Original requirement 1:

> 1. **Spec-PR status validation in CI.** A pull request introducing a new non-delta
>    specification file (`specs/<NNNN>-<slug>.md`) or operating on a `spec/<NNNN>-*`
>    branch SHALL NOT pass CI if the introduced or modified specification carries
>    `status: draft`. The spec file MUST carry `status: approved` (and its mandatory
>    `interaction-mode` field) before merging to `main`.

Replacement:

> 1. **Spec-PR status validation in CI.** A pull request introducing a new non-delta
>    specification file (`specs/<NNNN>-<slug>.md`) or operating on a `spec/<NNNN>-*`
>    branch SHALL NOT pass CI if the introduced or modified specification carries
>    `status: draft`, except while the pull request is a Draft PR/MR, signalled
>    per requirements R7 to R11 and R14 of delta-01. The spec file MUST carry
>    `status: approved` (and its mandatory `interaction-mode` field) before the
>    pull request is marked ready and merged to `main`.

## REMOVED

None.
