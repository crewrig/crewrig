---
id: "0168"
slug: spec-status-transition-enforcement
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 974
version: 1.0.0
---

# Automated Enforcement of Spec Status Transitions

## Intent

`docs/spec-format.md` mandates that a spec lands on `main` carrying `status: approved`
via its spec-PR, and transitions to `status: implemented` inside its corresponding
implementation PR. When enforcement relies solely on manual recall or optional merge
scripts (such as `scripts/merge-spec-pr.sh`), agents and human contributors can bypass
the transition by invoking `gh pr merge` directly, causing merged specs on `main` to
remain stale `draft` or `approved`.

This specification establishes mechanical CI enforcement for both status transitions
so that neither a spec-PR nor an implementation PR can merge into `main` with an
unrecorded or lagging spec status.

## Requirements

1. **Spec-PR status validation in CI.** A pull request introducing a new non-delta
   specification file (`specs/<NNNN>-<slug>.md`) or operating on a `spec/<NNNN>-*`
   branch SHALL NOT pass CI if the introduced or modified specification carries
   `status: draft`. The spec file MUST carry `status: approved` (and its mandatory
   `interaction-mode` field) before merging to `main`.
2. **Implementation PR status validation in CI.** A pull request operating on an
   implementation branch (`(feat|fix|refactor|perf|chore)/<NNNN>-*` where `<NNNN>`
   matches a non-delta specification in `specs/`) SHALL NOT pass CI if the corresponding
   specification file `specs/<NNNN>-<slug>.md` does not carry `status: implemented`.
3. **Merge wrapper alignment.** `scripts/merge-spec-pr.sh` SHALL continue to verify
   that the spec file carries `status: approved` before delegating to `gh pr merge`,
   serving as a local fast-fail guard ahead of CI.
4. **Attribution and bystander rules preservation.** The base-branch status check in
   `scripts/lib/spec-linter.js` (governed by Spec 0109 Delta-02) SHALL remain
   non-blocking (`[WARN]`) for unrelated bystander PRs that do not touch or implement
   a pre-existing defective spec, while failing (`[FAIL]`) on any change that modifies
   or introduces the spec as well as on `main`'s own build.
5. **Documentation.** `docs/spec-format.md`, `docs/spec-pr-workflow.md`, and
   `AGENTS.md` SHALL document the CI enforcement rules for both the `draft` → `approved`
   and `approved` → `implemented` transitions.
6. **Automated test coverage.** The spec linter test suite (`scripts/tests/test-spec-linter.sh`)
   SHALL test both the spec-PR `status: approved` requirement and the implementation-PR
   `status: implemented` requirement, verifying failures when transitions are omitted.

## Scenarios

**Scenario:** A new spec PR carrying status: draft is rejected by CI

```text
Given a pull request on branch spec/0168-sample-spec
And the spec file specs/0168-sample-spec.md carries status: draft
When the spec linter runs in CI
Then it reports a failure naming specs/0168-sample-spec.md
And it instructs the author to transition status to approved before merge.
```

**Scenario:** A new spec PR carrying status: approved passes CI

```text
Given a pull request on branch spec/0168-sample-spec
And the spec file specs/0168-sample-spec.md carries status: approved
And interaction-mode is declared in frontmatter
When the spec linter runs in CI
Then it reports no status violation for specs/0168-sample-spec.md.
```

**Scenario:** An implementation PR that forgets to transition spec status is rejected

```text
Given an implementation pull request on branch feat/0168-sample-spec
And the spec file specs/0168-sample-spec.md still carries status: approved
When the spec linter runs in CI
Then it reports a failure stating that specs/0168-sample-spec.md must be transitioned to status: implemented.
```

**Scenario:** An implementation PR with status: implemented passes CI

```text
Given an implementation pull request on branch feat/0168-sample-spec
And the spec file specs/0168-sample-spec.md carries status: implemented
When the spec linter runs in CI
Then it reports no status violation for specs/0168-sample-spec.md.
```

**Scenario:** An unrelated PR on a base branch with a pre-existing draft spec receives a warning only

```text
Given a pull request on branch fix/unrelated-fix touching docs/readme.md
And the base branch main contains a pre-existing spec with status: draft
When the spec linter runs in CI
Then it reports a non-blocking [WARN] for the pre-existing draft spec
And the check exits 0.
```

## Out of scope

- Repairing historical specs already on `main` (addressed by issue #971).
- Modifying the lifecycle states or their definitions in `docs/spec-format.md`.
- Status requirements for delta-specs (`*.delta-*.md`), which remain governed by their own convention.

## Open questions

None.
