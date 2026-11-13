---
id: "0299"
slug: architect-modernization
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1919
version: 1.2.0
---

# Modernize the architect skill and agent with frozen evals, a byte-accounting script and a measured delta

*Delta 02 of `specs/0299-architect-modernization.md`, built on `specs/0299-architect-modernization.delta-01.md`. Source: issue #1919. A cold local review of the implementation (finding i1-F1) found that the middle fallback of R16 of delta-01, "follow the shape of the latest file in the repository's ADR directory", points at an example that may not be template-shaped. The latest file today, `docs/adr/0023-skill-eval-executor.md`, has an `# ADR 0023 —` title, an inline `**Status:**` line and a `## Decisions` section, so the fallback steers the model away from the shape that `lint-adr.ts` of `doc-writer` checks. Version 1.2.0, a MINOR bump. Requirements modified: R16 of delta-01, and the scenario "`doc-writer` absent" that delta-01 added. R17 and R18 are unchanged. This delta opens no question.*

## ADDED

Nothing is added.

## MODIFIED

<!-- markdownlint-disable MD029 -->

16. **R16 (single-sourced ADR layout), original (delta-01):** "The `architect` `SKILL.md` SHALL NOT keep a section list that diverges from the repository ADR shape. It SHALL point at the `doc-writer` skill, by its name only and with no `scripts/` path of its own (the technique of the `pr-reviewer` pointer in R6), whose `new-adr.ts` lays out and numbers the ADR and whose `lint-adr.ts` checks it. When that skill is not installed, since an adopter can install `architect` without it, the skill SHALL say so explicitly and fall back to the shape of the latest file in the ADR directory of the repository; when the repository holds no ADR either (the case of an eval run, which installs only the skill under test), it SHALL fall back to one sentence stating the repository order, Status, Context, Decision, Consequences. That sentence is the only section list the skill keeps and it SHALL match the `doc-writer` template. The skill SHALL keep what is specific to the architect: each section short, the rejected alternatives recorded and the grounding discipline for claims in an ADR. After the change the skill, the built copies under the four CLI trees and `AGENT.md` SHALL carry no section list that diverges from the repository shape; `AGENT.md` holds no such list today (no match for the section names in its body), so it needs no edit and no version bump."

**Amended (R16):** The `architect` `SKILL.md` SHALL NOT keep a section list that diverges from the repository ADR shape. It SHALL point at the `doc-writer` skill, by its name only and with no `scripts/` path of its own (the technique of the `pr-reviewer` pointer in R6), whose `new-adr.ts` lays out and numbers the ADR and whose `lint-adr.ts` checks it. When that skill is not installed, since an adopter can install `architect` without it, the skill SHALL say so explicitly and fall back directly to ONE sentence stating the repository order, Status first, then Context, Decision and Consequences, with Consequences listing the positive, negative and neutral effects, as the `doc-writer` template lays them out. That sentence is the only section list the skill keeps and it SHALL match the `doc-writer` template. The earlier fallback to the shape of the latest file in the ADR directory of the repository is REMOVED: the skill SHALL NOT read the repository's ADR directory to infer a section order, whether that directory is empty, holds template-shaped files or holds legacy files. The skill SHALL keep what is specific to the architect: each section short, the rejected alternatives recorded and the grounding discipline for claims in an ADR. After the change the skill, the built copies under the four CLI trees and `AGENT.md` SHALL carry no section list that diverges from the repository shape; `AGENT.md` holds no such list today (no match for the section names in its body), so it needs no edit and no version bump.

**R17 and R18 are unchanged.** R17 still prescribes a single paid measurement of `architect`; this delta lands before that measurement, so it costs no extra one. R18 still bumps `SKILL.md` from 2.0.0 to 2.0.1.

Scenario "Failure path — `doc-writer` absent" (added by delta-01), original:

> - **Given** an installation of `architect` without `doc-writer`, once with an ADR directory whose latest file is `docs/adr/<NNNN>-<slug>.md` and once with no ADR at all,
> - **When** the skill writes an ADR,
> - **Then** it says that `doc-writer` is not installed, follows the section order of that latest file in the first case and the one-sentence repository order Status, Context, Decision, Consequences in the second.

**Amended (scenario):**

### Failure path — `doc-writer` absent

- **Given** an installation of `architect` without `doc-writer`, whatever the ADR directory of the repository holds,
- **When** the skill writes an ADR,
- **Then** it says that `doc-writer` is not installed and writes Status, Context, Decision and Consequences in that order.

## REMOVED

Nothing is removed as a requirement. The only fallback removed is the "latest file in the ADR directory" clause of R16, quoted and replaced under MODIFIED.

### Out of scope

- Changes to the eval runner, its settings or its tolerance.
- Changes to the `doc-writer` skill, its template or its linter.
- Changes to the legacy ADRs of the repository.
