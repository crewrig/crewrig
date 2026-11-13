---
id: "0299"
slug: architect-modernization
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1919
version: 1.1.0
---

# Modernize the architect skill and agent with frozen evals, a byte-accounting script and a measured delta

*Delta 01 of `specs/0299-architect-modernization.md`. Source: issue #1919. R2(c) and the shipped `architect` `SKILL.md` both list the ADR sections as Context, Decision, Status and Consequences, which is not the repository ADR shape (`# ADR-<NNNN>: <title>`, then Status, Context, Decision, Consequences, as laid out by `assets/adr.template.md` of the `doc-writer` skill, checked by its `scripts/lint-adr.ts` and fixed by spec 0297 R7). The divergent list steers models away from the repository shape, and eval 3 fails when the model writes it, Status first. Version 1.1.0, a MINOR bump. Requirements modified: R2(c) and, for its case (f), the ADR expectation; R12 and R13 are replaced for this ticket by R17. Requirements added: R16 to R18. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

16. **R16 (single-sourced ADR layout).** The `architect` `SKILL.md` SHALL NOT keep a section list that diverges from the repository ADR shape. It SHALL point at the `doc-writer` skill, by its name only and with no `scripts/` path of its own (the technique of the `pr-reviewer` pointer in R6), whose `new-adr.ts` lays out and numbers the ADR and whose `lint-adr.ts` checks it. When that skill is not installed, since an adopter can install `architect` without it, the skill SHALL say so explicitly and fall back to the shape of the latest file in the ADR directory of the repository; when the repository holds no ADR either (the case of an eval run, which installs only the skill under test), it SHALL fall back to one sentence stating the repository order, Status, Context, Decision, Consequences. That sentence is the only section list the skill keeps and it SHALL match the `doc-writer` template. The skill SHALL keep what is specific to the architect: each section short, the rejected alternatives recorded and the grounding discipline for claims in an ADR. After the change the skill, the built copies under the four CLI trees and `AGENT.md` SHALL carry no section list that diverges from the repository shape; `AGENT.md` holds no such list today (no match for the section names in its body), so it needs no edit and no version bump.
17. **R17 (measurement).** The ticket SHALL take exactly one paid measurement of `architect` with `task skill-evals -- architect`, on the eval runner as it is on `main` when measured, and SHALL commit the `evals/results.json` of that non-mock run: R18 changes the content hash, and a `results.json` with another hash is `stale`, which blocks. The gate is not blocking for this ticket (`FAIL_BLOCKING=false`), and R12 is replaced here: the `--base` of the run is the `evals/results.json` of `main` before the change, a `regression` line or a `fail` status does not block the merge, and the pull request SHALL report the eval pass rate, the probe pass rate, the difference against that base, the cost, and whether eval 3 passes. R13 is replaced here by the single measurement; a later `SKILL.md` change needs the owner's approval, asked through the wave coordinator. No wording iteration beyond this ticket SHALL be made to chase the score.
18. **R18 (packaging).** `SKILL.md` SHALL bump `metadata.provenance.version` from 2.0.0 to 2.0.1: a PATCH bump, because the change replaces a wording that contradicts the repository convention and adds no section, field or contract. The built components SHALL be regenerated in the same change, and the amended `evals/evals.json` stays out of the built copies as R11 requires.

### Scenarios

### Happy path — an ADR that follows the repository shape

- **Given** the brief of a one-way change and the `doc-writer` skill installed,
- **When** the `architect` skill writes the ADR and `lint-adr.ts` of `doc-writer` checks it,
- **Then** the ADR has Status, Context, Decision and Consequences in that order, records a rejected alternative, and the linter reports no section-order finding.

### Failure path — `doc-writer` absent

- **Given** an installation of `architect` without `doc-writer`, once with an ADR directory whose latest file is `docs/adr/<NNNN>-<slug>.md` and once with no ADR at all,
- **When** the skill writes an ADR,
- **Then** it says that `doc-writer` is not installed, follows the section order of that latest file in the first case and the one-sentence repository order Status, Context, Decision, Consequences in the second.

### Failure path — eval 3 against the old order

- **Given** the amended eval 3,
- **When** a model writes an ADR with Status first,
- **Then** the expectation on the section order passes, and an ADR in the order Context, Decision, Status, Consequences does not.

### Out of scope

- Changes to the eval runner, its settings or its tolerance.
- Changes to the `doc-writer` skill, its template or its linter.
- Changes to the legacy ADRs of the repository.
- Wording iterations of `SKILL.md` to raise the eval score beyond this ticket.

## MODIFIED

2(c). **R2(c) (Architecture Decision Record case), original:** "(c) an Architecture Decision Record for a one-way change, with the sections Context, Decision, Status and Consequences, each short;"

   **Amended:** (c) an Architecture Decision Record for a one-way change, with the repository ADR shape, namely the sections Status, Context, Decision and Consequences in that order, each short, with the rejected alternatives recorded. The ADR expectation of case (f) SHALL expect the same shape. In `artifacts/core/skills/architect/evals/evals.json`, the `expected_output` and the expectations of eval 3 and the section expectation of eval 6 SHALL be amended accordingly; the `checks` stay order-free. This amends frozen cases through a delta: the freeze of R4 ended with ticket #1915 and does not apply.

## REMOVED

Nothing is removed.
