---
id: "0132"
slug: spec-pr-draft-approved-guard
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 766
version: 1.0.0
---

# Pre-merge guard for spec-PR draft→approved flip

## Intent

A contributor — human or agent — attempting to merge a spec-PR whose spec still carries `status: draft` is mechanically blocked at the moment of the merge, before the pull request merges. This prevents the omission from landing on `main` and failing the repository's global CI, turning a retrospective CI failure into an immediate local refusal.

## Requirements

1. A new script `scripts/merge-spec-pr.sh` SHALL be introduced to serve as the exclusive merge mechanism for spec-PRs.
2. The script SHALL read the spec file on the current branch. If the spec's frontmatter carries `status: draft`, the script SHALL refuse to proceed, exit non-zero, and output a human-readable failure message instructing the author to commit the `draft` → `approved` flip before merging.
3. If the spec does not carry `status: draft`, the script SHALL delegate the merge to `gh pr merge --squash` (passing through any additional flags).
4. `docs/spec-format.md` → *Merge mechanic* SHALL be amended to mandate the use of `bash scripts/merge-spec-pr.sh` in place of bare `gh pr merge --squash`.
5. The contradiction identified in issue #849 SHALL be resolved by amending `docs/interaction-modes.md` → *User-gate definition* → *Narrow discharge carve-out*. The amendment SHALL state that the lifecycle-metadata transition (`status` and `interaction-mode`) mandated by `docs/spec-format.md` is explicitly NOT a content change, and therefore does NOT forfeit the merge-authorization discharge.

## Scenarios

**Scenario:** a spec-PR carrying status: draft is refused at merge time

```text
Given a spec-PR branch where the spec file still carries status: draft
When  the author runs scripts/merge-spec-pr.sh
Then  the script exits non-zero
And   it prints an error message instructing the author to flip the status
And   the PR is not merged
```

**Scenario:** a spec-PR carrying status: approved merges successfully

```text
Given a spec-PR branch where the spec file carries status: approved
When  the author runs scripts/merge-spec-pr.sh
Then  the script delegates to gh pr merge --squash
And   the PR merges successfully if gh succeeds
```

## Out of scope

- Retroactive changes to previously merged specs that were merged with `status: draft` (this was already handled by spec 0109).
- Modifying the CI `lint-specs` behaviour (this was handled by spec 0109 delta-02).
- Automatically performing the `draft` → `approved` commit within the script. The script is a guard, not an authoring tool; the author retains responsibility for creating the explicit status-flip commit prior to merge.

## Open questions

- None.
