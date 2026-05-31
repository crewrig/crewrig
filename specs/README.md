# `/specs/` — Specifications

This directory holds every specification produced by the SPECS stage of
the lifecycle defined in
[ADR-0010](../docs/adr/0010-spec-plan-review-lifecycle.md).

A spec is the normative WHAT of a ticket: what a user-facing change
must achieve, written down before any plan is drafted and any code is
written. The HOW (steps, blast radius, alternatives) lives in the plan
artefact attached to the logbook issue (format defined in issue #169);
the realisation lives on a feature branch.

## Layout

```text
specs/
├── README.md                              # this file
├── _template.md                           # copy-ready template for new specs
├── 0001-spec-format-self.md               # worked example: spec for issue #167
└── <NNNN>-<slug>.md                       # one spec per ticket
    <NNNN>-<slug>.delta-<NN>.md            # delta-spec amendments (optional)
```

- Spec file format, frontmatter schema, mandatory body sections, and
  the delta-spec convention live in
  [`docs/spec-format.md`](../docs/spec-format.md).
- Lifecycle contract (SPECS → PLAN → DEV → REVIEW), finding
  classification, complexity tiers, and interaction modes live in
  [ADR-0010](../docs/adr/0010-spec-plan-review-lifecycle.md).

## Two-PR flow

Specs ship in a **dedicated spec PR**, separately from the
implementation PR that realises them. The spec-branch is named
`spec/<NNNN>-<slug>` (or `spec/<NNNN>-<slug>-delta-<NN>` for
delta-spec amendments), carries exactly one new file under `/specs/`,
and MUST merge to `main` before the implementation branch
(`feat/<NNNN>-<slug>` and siblings) is cut. The two PRs are
independent — each closes its own related issue, and the
implementation-PR does not auto-close the spec-PR. The normative
contract — branch naming, one-file rule, ordering, independence, and
the delta-spec cumulative rule — lives in
[`AGENTS.md#spec-pr-workflow`](../AGENTS.md#spec-pr-workflow); the
classification and routing of `spec`-class loop findings live in
[ADR-0010](../docs/adr/0010-spec-plan-review-lifecycle.md).

## Creating a new spec

1. Pick the next free id by inspecting filenames in this directory.
   Ids are monotonic, zero-padded to four digits, never reused.
2. Copy `_template.md` to `<NNNN>-<your-slug>.md`.
3. Fill in the frontmatter and the five mandatory body sections.
4. Open the spec PR against `main` following the
   [Spec-PR workflow](../AGENTS.md#spec-pr-workflow) in `AGENTS.md`.
