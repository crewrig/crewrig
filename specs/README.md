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
implementation PR that realises them. The exact branching and
ordering rules for that flow are formalised in issue #170 and are
not duplicated here — see the spec format document and ADR-0010 for
the contract, and issue #170 for the operational protocol once it
lands.

## Creating a new spec

1. Pick the next free id by inspecting filenames in this directory.
   Ids are monotonic, zero-padded to four digits, never reused.
2. Copy `_template.md` to `<NNNN>-<your-slug>.md`.
3. Fill in the frontmatter and the five mandatory body sections.
4. Open the spec PR against `main` (per issue #170 once available;
   until then, follow the standard branch-and-PR flow in `AGENTS.md`).
