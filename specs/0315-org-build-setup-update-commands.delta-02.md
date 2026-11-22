---
id: "0315"
slug: org-build-setup-update-commands
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 2121
version: 1.2.0
---

# The `build`, `setup` and `update` commands of the organization config repository (WP4 of epic 1822)

Records in R6 what the merged code already does and the parent leaves unsaid: the steps that an organization (two-root) `setup` skips, the step it adds, and the reason for each. It comes from the non-blocking spec-class finding i1-F3 of the cold review of PR #2119 (WP4, issue #2114), ledgered by the owner and settled here before the final merge of epic 1822. The code is `ORG_SKIPPED_STEPS` and `orgSteps` in `scripts/lib/setup/flow.ts` and `scripts/lib/setup/steps-distribution.ts`; this delta changes no behaviour.

Cumulative effect: R6 gains the organization-run step-list rules (the two skipped steps, the added step and its failure rule), and one scenario is added (two Given/When/Then blocks). R8 stays the requirement that mandates installing `init-team` together with both commands; R6 only places that installation in the step list. Every other requirement and scenario of the parent and of delta-01 is unchanged.

## ADDED

### Scenario "an organization run skips two steps and adds one"

```text
Given the setup step list of each CLI descriptor (claude, copilot, gemini, antigravity), as a checkout run takes it
When  the step list of an organization (two-root) run is derived from it
Then  it contains neither `deps-install` nor `copilot-workspace-files`; it contains `distribution-skills` exactly once, immediately after `tiers`; every other step of the checkout list is present in the same order; and the step list of a checkout run is identical to the descriptor's, with no `distribution-skills` in it.
```

```text
Given a descriptor whose step list has no `tiers` step
When  the step list of an organization run is derived
Then  `distribution-skills` is placed immediately before the last step (the summary).
```

## MODIFIED

### R6, last sentence

Original sentence:

```text
`setup` SHALL be idempotent: a second run with the same answers changes nothing.
```

Replacement:

```text
`setup` SHALL be idempotent: a second run with the same answers changes nothing. An organization run SHALL take the step list of the same CLI's checkout run with two changes, and a checkout run SHALL take neither. (a) It SHALL skip the step `deps-install`, which runs `npm ci` and records its stamp in `.crewrig-state/` inside the version root (a cached version, which R12 forbids altering), and the step `copilot-workspace-files`, which writes `.github/copilot/settings.json` from its template into the version root; R12 forbids both writes, and both steps serve the workspace of a CrewRig checkout, not the user's projects. The checkout's compile needs `js-yaml`, which `deps-install` supplies there; in an organization run it comes from the archive's own vendored copy (0314 R18; 0315 R10). (b) It SHALL add the step `distribution-skills` right after the `tiers` step, or immediately before the last step (the summary) when the CLI's step list has no `tiers` step. That step SHALL install the skills `init-team`, `init-soul` and `init-personal-profile` for the CLI from the compiled outputs of the version root, as R8 requires; for Gemini CLI, `init-team` is installed as a skill and `init-soul` and `init-personal-profile` as TOML commands. When a source file of the pinned version is missing, the step SHALL end `setup` with code 1 naming it; the targets that the step installed before the missing one, and the steps before it, stay installed.
```

## REMOVED

(none)
