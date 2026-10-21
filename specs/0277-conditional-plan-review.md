---
id: "0277"
slug: conditional-plan-review
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 1757
version: 1.0.0
---

# Conditional plan review

## Intent

Today every plan, at every tier, is cold-reviewed by a second `architect` (`docs/plan-review-protocol.md` → *Review rule*), even when the plan touches one component and no shared contract. After this spec, a standard-tier plan that is small in blast radius and touches no shared contract skips that review, and the skip is decided by a deterministic script whose output is recorded in the plan comment, never by the author's judgement. A large-tier plan is always reviewed, a plan that grows or touches a shared contract is reviewed, and a ticket whose skipped review is later contradicted by a REVIEW `arch` finding gets the review back for good. This is option b of ADR-0020, work package WP6 of epic #1724 (child of #1733).

## Requirements

1. **R1 (command).** `scripts/check-plan-review.ts` SHALL read the spec file path as an argument, and the plan comment body from a file path argument or from stdin. It SHALL print on stdout exactly one decision line, `plan-review: required` or `plan-review: skipped`, followed by one or more `reason:` lines, and SHALL exit 0 for both decisions. It SHALL exit 2 on a usage error or an unreadable input. Its logic SHALL live in `scripts/lib/governance/plan-review-gate.ts`, following `scripts/check-seat-brief.ts` and `scripts/lib/governance/seat-brief.ts`.
2. **R2 (tier gate).** The tier SHALL be read from the spec frontmatter `complexity`. The script SHALL be able to decide `skipped` only for `standard`. For `large` it SHALL print `plan-review: required` with a tier reason. For `trivial` and `small` it SHALL print `plan-review: not-applicable` and exit 0, leaving the existing protocol unchanged for those tiers. An absent, unparsable or unknown tier SHALL yield `required`.
3. **R3 (fail closed).** Any ambiguity SHALL yield `required`, with the ambiguity named in a `reason:` line: a missing or unparsable `Components:` line, an empty component list, an absent tier, an unreadable or empty manifest (R7, R8), a malformed manifest line. The script SHALL never yield `skipped` by default or by absence of evidence.
4. **R4 (threshold).** At `standard`, the script SHALL yield `skipped` only when the component count N is at most 3 AND no shared-contract path is matched (R8). The threshold SHALL be one named constant in the library module. Rationale: 3 is the ADR-0020 starting candidate, a standard plan with up to three components is the single-owner case where a second cold architect adds least, and tuning is one constant plus one spec amendment, with the rollback trigger of R15 as the safety net.
5. **R5 (declared components).** `docs/plan-format.md` SHALL gain a `Components:` bullet inside `### Blast radius`, a comma-separated list of component identifiers, mandatory at `standard` and `large`. The script SHALL count components from this declared list.
6. **R6 (derived components, anti-gaming).** The script SHALL also derive components from every repo-relative file path named in the plan's `### Steps` section, using the manifest `.crewrig/plan-components.txt` (R7), and SHALL count the union of declared and derived components. Under-declaring SHALL NOT lower the count. Compiled outputs of one artifact source (for example `artifacts/core/skills/X` and its `.claude`, `.gemini`, `.github`, `.agents` mirrors) SHALL count as one component together with their source.
7. **R7 (component manifest).** `.crewrig/plan-components.txt` SHALL map a path prefix to a component name, one `prefix component` pair per line, with `#` comments allowed. The longest matching prefix SHALL win. A path with no matching prefix SHALL map to its first path segment. The initial content SHALL map at least: `scripts/lib/governance/` to `governance-libs`, `scripts/` to `scripts`, `docs/adr/` to `adr`, `docs/agent-team-protocol/` to `agent-team-protocol`, `docs/cli-matrix/` to `cli-matrix`, `docs/` to `docs`, `specs/` to `specs`, `ci/` to `ci`, `artifacts/core/skills/<name>/` and `artifacts/core/agents/<name>/` to one component per name together with their compiled mirrors, and `.github/workflows/` and `.gitlab-ci.yml` to `ci`. The architect MAY refine the manifest in PLAN.
8. **R8 (shared-contract manifest).** `.crewrig/shared-contract-paths.txt` SHALL list shared-contract paths, one glob or prefix per line, `#` comments allowed. A hit SHALL be any path named in the plan `### Steps` or in the declared paths of the plan, or named by the spec itself as modified in its Requirements, that matches an entry. The initial manifest SHALL contain: `AGENTS.md`, `docs/spec-format.md`, `docs/plan-format.md`, `docs/reviewer-seat.md`, `docs/plan-review-protocol.md`, `docs/retroactive-loop.md`, `docs/adr/`, `docs/cli-matrix/rows/`, `.crewrig/core-paths.txt`, `ci/ci-capabilities.yml`, `artifacts/core/rules/`, `scripts/lib/governance/`. The architect MAY refine it in PLAN. The matched paths SHALL be listed in a `reason:` line. The script SHALL take the spec file as input so it can read the spec-named paths.
9. **R9 (manifest registration).** Both manifests SHALL be registered in `.crewrig/core-paths.txt` and `docs/layers.md` unless an existing directory entry already covers them; the path-ownership check SHALL pass.
10. **R10 (reasons).** The `reason:` lines SHALL state the tier, the declared count, the derived count, the union count N with the threshold, and the matched shared-contract paths (or `none`). The decision line and reasons SHALL be stable text so that they can be diffed and asserted.
11. **R11 (non-sticky decision, anti-weakening).** The decision SHALL be recomputed for every plan version. Once a plan review has run on a ticket, with any verdict, the review SHALL stay mandatory for every later revision of that plan, whatever the script says. A REVIEW-stage `arch` finding on a ticket that skipped plan review SHALL route back to PLAN as `docs/retroactive-loop.md` already provides, and the revised plan SHALL then be cold-reviewed. This is the ADR-0020 rollback signal.
12. **R12 (floor, not ceiling).** The orchestrator MAY always run the plan review when the script says `skipped`. The script never forbids a review.
13. **R13 (skip record).** The script output SHALL be posted verbatim in the PLAN logbook comment as the skip record. A skip with no recorded script output SHALL be a process violation, and a REVIEW pass that finds it SHALL emit a `class: tech` finding.
14. **R14 (unchanged controls).** The user plan-validation gate in FULL and INTERMEDIATE SHALL be unchanged and still run. PLAN-revision cap semantics SHALL be unchanged, and a skipped review consumes zero revisions. The cold `pr-reviewer` on every PR SHALL be untouched. ADR-0010 → *Complexity tiers* wording that bounds size and removes no checklist item SHALL be preserved.
15. **R15 (docs).** The following SHALL be updated in the same diff: `docs/plan-review-protocol.md` (the *Review rule* and a new *Conditional review* section carrying R1 to R14), `docs/plan-format.md` (R5), the tier table of `docs/adr/0010-spec-plan-review-lifecycle.md` (a cold-plan-review note per tier, standard conditional per the script, large always, the cap column staying the single source of truth), `docs/interaction-modes.md` (the second-`architect` cold-review wording of the PLAN row), the *Plan review protocol* summary of `AGENTS.md`, the `arch` loop note of `docs/retroactive-loop.md`, and `docs/agent-team-protocol/orchestrator.md` and `docs/agent-team-protocol/templates.md` wherever the plan review is a template step. `docs/adr/0020-risk-proportional-ceremony.md` SHALL gain a minimal status note that option b shipped as this spec with N=3.
16. **R16 (component wiring).** `artifacts/core/skills/architect/SKILL.md` and `artifacts/core/agents/architect/AGENT.md` SHALL be checked, and any line restating the second-architect rule SHALL be aligned with R15, with `metadata.provenance.version` bumped per the Version Bump Convention, `node scripts/lib/node-floor-guard.js` then `node scripts/build-components.ts` run, and compiled outputs staged in the same commit. The docs index SHALL be rebuilt if `docs/` frontmatter changes.
17. **R17 (task target).** `Taskfile.yml` SHALL gain a `check-plan-review` target taking `{{.CLI_ARGS}}`, shaped like `check-seat-brief`.
18. **R18 (fixtures and tests).** Committed fixtures under `scripts/tests/fixtures/plan-review/` and a unit test `scripts/tests/check-plan-review.test.ts` SHALL cover, each asserting decision line and exit code: standard, 3 or fewer components, no shared path, `skipped`; 4 components, `required`; one component with a shared-contract hit, `required`; large, `required`; an under-declared plan whose Steps reveal a fourth component, `required`; a missing `Components:` line, `required`; an empty manifest, `required`; small, `not-applicable`; compiled mirrors of one source counted once, `skipped`; a spec-named shared path with a clean plan, `required`. Tests SHALL NOT remove or restore any path they did not create with `mkdtemp`.
19. **R19 (CI).** A CI job `check-plan-review` SHALL be added to `ci/ci-capabilities.yml` with a paths filter, running the script on a skipping fixture (expects `skipped`) and a requiring fixture (expects `required`), and the unit test SHALL be added to the governance test job. `.github/workflows/build.yml` and `.gitlab-ci.yml` SHALL be regenerated with `scripts/build-ci.ts`. `scripts/tests/check-plan-review-ci-wiring.test.ts` SHALL mirror `check-seat-brief-ci-wiring.test.ts`.
20. **R20 (author-side tool).** As with the seat brief linter, the script is run by the orchestrator at PLAN time; CI proves it against committed fixtures only and is not a gate on live plans.
21. **R21 (four-CLI symmetry).** The script SHALL be a plain `node` script with no CLI-specific code path, on the same Node 24 floor, run identically on Claude Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI. The doc and skill lines SHALL compile unchanged to every CLI output. No `docs/cli-matrix/rows/` row is needed unless a CLI-specific integration point is touched, in which case the row source and `docs/cli-matrix.md` are updated in the same diff.
22. **R22 (invariants).** This spec adds a deterministic control and removes none (ADR-0020 4.1.1, 4.1.2), ships on all four CLIs together (4.1.5), keeps REVIEW `arch` findings routing back to PLAN, and lands as its own PR, not bundled with another WP6 option. Spec 0277 is also the baseline for N.
23. **R23 (rollback and measurement).** The rollback trigger SHALL be an `arch` finding at REVIEW on a standard ticket that skipped plan review, plus the epic rule: revert if Q1, Q2 or Q3 degrades on 2 of 3 comparable tickets. After 2 to 3 comparable tickets, E4, Q2, Q3 and Q4 SHALL be measured and a keep or rollback entry SHALL be recorded as a logbook comment on #1733. This is a process obligation, not a script.

## Scenarios

**Scenario:** small standard plan skips the review

Given a standard-tier spec and a plan declaring `Components: architect-skill` whose Steps name only files of that component and no shared-contract path
When the orchestrator runs `check-plan-review.ts`
Then the output starts with `plan-review: skipped`, the reasons show N=1 and no shared path, and the exit code is 0

**Scenario:** fourth component forces the review

Given a standard-tier plan whose declared and derived components total 4
When the script runs
Then the output starts with `plan-review: required` and a reason shows N=4 against the threshold 3

**Scenario:** shared contract forces the review

Given a standard-tier plan with one component whose Steps edit `docs/spec-format.md`
When the script runs
Then the output is `plan-review: required` and a reason names `docs/spec-format.md`

**Scenario:** under-declaring does not help

Given a standard-tier plan declaring 2 components whose Steps name files in 4 distinct components
When the script runs
Then the union count is 4 and the output is `plan-review: required`

**Scenario:** large tier is always reviewed

Given a large-tier spec and a one-component plan
When the script runs
Then the output is `plan-review: required` with a tier reason

**Scenario:** missing component list fails closed

Given a standard-tier plan with no `Components:` line
When the script runs
Then the output is `plan-review: required` and a reason names the missing line

**Scenario:** compiled mirrors count once

Given a standard-tier plan whose Steps name `artifacts/core/skills/architect/SKILL.md` and its four compiled mirrors
When the script runs
Then they count as one component and the output is `plan-review: skipped` if nothing else applies

**Scenario:** empty manifest fails closed

Given an empty `.crewrig/shared-contract-paths.txt`
When the script runs on an otherwise skippable plan
Then the output is `plan-review: required` and a reason names the manifest

**Scenario:** review stays mandatory after it has run

Given a ticket whose plan `v1` was cold-reviewed and whose plan `v2` the script would skip
When the orchestrator posts `v2`
Then the review is run anyway, per R11

**Scenario:** REVIEW arch finding on a skipped ticket

Given a standard ticket that skipped plan review and a REVIEW pass that emits an `arch` finding
When the loop routes the finding
Then it routes back to PLAN and the revised plan is cold-reviewed

**Scenario:** unreadable input

Given a spec path that does not exist
When the script runs
Then it exits 2 and stderr names the path

## Out of scope

- Other WP6 options (g, f, a) and the REJECT options (c, e).
- Any change to the large-tier review, which stays unconditional.
- Any change to the `pr-reviewer`, to review seats other than `plan/<ticket>`, or to small and trivial tier behaviour.
- Judging plan quality or semantic blast radius; the script counts and matches paths only.
- A hook intercepting the `Agent` call, or a CI gate on live plans.
- Changing the per-tier PLAN-revision caps of ADR-0010.

## Open questions

- Resolved: N=3 is the starting value, tunable by one constant and one spec amendment (R4).
- Resolved: both manifests are initial proposals the architect may refine in PLAN (R7, R8); changing N or the manifests' purpose is a spec amendment.
- Resolved: the script yields `not-applicable` for small and trivial rather than a decision, to keep the existing protocol untouched.
