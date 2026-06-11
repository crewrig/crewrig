---
id: "0003"
slug: spec-pr-workflow
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 170
version: 1.0.0
---

# Spec-PR workflow and branching convention

## Intent

Contributors gain a dedicated branching and pull-request convention that
lets a specification be qualified and merged on its own, independently of
any implementation, so the SPECS stage of the ADR-0010 lifecycle produces
an auditable artifact on `main` before the PLAN and DEV stages start.

## Requirements

1. Every non-trivial ticket SHALL be qualified by a dedicated **spec-PR**
   whose head branch is named `spec/<NNNN>-<slug>` where `<NNNN>-<slug>`
   matches the spec file's frontmatter `id` and `slug`.
2. The spec-PR head branch SHALL contain exactly one new file under
   `/specs/` (a new spec or a delta-spec per `docs/spec-format.md` →
   *Delta-spec convention*) and SHALL NOT contain any other change.
3. The spec-PR SHALL be merged to `main` before any implementation branch
   for the same ticket is cut.
4. The implementation branch SHALL be cut from `main` after the spec-PR
   merges and SHALL be named with the prefix matching the work type
   (`feat/<NNNN>-<slug>`, `fix/...`, `docs/...`, `refactor/...`).
5. The spec-PR and the implementation-PR SHALL remain independent: the
   implementation-PR MUST NOT auto-close the spec-PR, and the spec-PR
   MUST close on its own merge via its own `Closes #<related-issue>`
   directive when appropriate, preserving an auditable history.
6. When the retroactive REVIEW loop produces one or more `spec`-class
   findings (per ADR-0010 → *Routing matrix*), each iteration SHALL
   produce its own delta-spec PR, and a single implementation-PR MAY
   cumulatively cover N delta-spec PRs that target the same ticket.
7. AGENTS.md SHALL declare the spec-PR workflow in a dedicated section
   and SHALL amend the *Branching Strategy* section to reference it.
8. `/specs/README.md` SHALL include a contributor-facing pointer to the
   two-PR flow.
9. A helper script or `Taskfile.yml` target MAY be provided to cut a
   `spec/<NNNN>-<slug>` branch and scaffold the spec-PR body from
   `_template.md`; if provided it SHALL be optional, not gating.
10. Worktree isolation per AGENTS.md → *Worktree Isolation* SHALL apply
    to both the spec-branch and the implementation-branch.

## Scenarios

### Happy path — single qualification cycle

Given a non-trivial ticket #N with no pre-existing spec
When the orchestrator runs the `spec-author` skill at step 0
Then the skill writes `specs/<NNNN>-<slug>.md` on a new branch
  `spec/<NNNN>-<slug>` cut from `main`
And a spec-PR is opened from that branch to `main`
And the spec-PR review is APPROVE with zero findings of any class
And the spec-PR is merged to `main`
And only then is the implementation branch `feat/<NNNN>-<slug>` cut
  from `main` to carry the code change.

### Happy path — `spec`-class loop iteration

Given a merged spec `<NNNN>-<slug>` on `main`
And a REVIEW pass on the implementation-PR surfaces a `spec`-class
  finding (per ADR-0010 → *Routing matrix*)
When the retroactive routing engine re-invokes `spec-author`
Then a delta-spec branch `spec/<NNNN>-<slug>-delta-<NN>` is cut from `main`
And a new delta-spec-PR is opened, reviewed, and merged
And the existing implementation branch absorbs the delta in its next
  REVIEW pass without opening a new implementation-PR.

### Failure path — implementation branch cut prematurely

Given a non-trivial ticket #N whose spec-PR is open but not yet merged
When an agent attempts to open `feat/<NNNN>-<slug>` against `main`
Then the workflow detects the ordering violation
And the implementation-PR is rejected with a `class: tech` finding
  citing AGENTS.md → *Spec-PR workflow*
And the agent SHALL not retry until the spec-PR is merged on `main`.

## Out of scope

- The `spec-author` skill itself — already implemented in issue #168.
- The build/install integration for the spec-author skill across CLIs
  — tracked in issue #174.
- The retroactive routing engine that detects `spec`-class findings and
  re-invokes the skill — tracked in issue #172.
- The plan format and plan-review protocol — tracked in issue #169.
- The spec linter — tracked in issue #178.
- Enforcement at the GitHub branch-protection layer (e.g., blocking a
  `feat/<NNNN>-<slug>` PR via required-status-check). This spec defines
  the convention; protocol-level enforcement may come later as a
  separate ticket once the convention has run in practice.
- Multi-spec PRs (one PR carrying two unrelated specs). Each spec-PR
  carries exactly one spec or one delta.

## Open questions

(none — all interview questions were resolved at SPECS time.)
