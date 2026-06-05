---
id: "0013"
slug: layer-taxonomy-boundary-contract
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 227
version: 1.4.0
---

# Layer Taxonomy and Boundary Contract

## ADDED

(none)

## MODIFIED

**R6** — Correct the core path enumeration to match spec 0012 R6 and R8 as
amended by delta-04. Operational role skills and agents move from
`artifacts/library/` to `artifacts/core/`; `artifacts/library/` retains
exclusively the harness system. The governing axis is installation location:
`artifacts/core/` components are built into the per-project CLI output
directories; `artifacts/library/` components are installed into the user's
home CLI directories and are therefore available across all projects.

Original (as amended by delta-03):

> 6\. `docs/layers.md` SHALL classify as `core`, at minimum: `AGENTS.md`,
> `CLAUDE.md`, `docs/`, `scripts/`, `specs/`, `artifacts/FORMAT.md`, the SDLC
> lifecycle skill set under `artifacts/core/skills/` (`spec-author`,
> `pr-logbook`, `pr-reviewer`), the SDLC lifecycle agent set under
> `artifacts/core/agents/` (`spec-author`, `pr-logbook`, `pr-reviewer`,
> `architect`), the harness skill set under `artifacts/library/skills/`
> (`harness-report`, `harness-curator`), the harness agent set under
> `artifacts/library/agents/` (`harness-curator`), and the operational role
> skills and agents under `artifacts/library/` enumerated in spec 0012 R8
> (as amended by delta-03): skills `architect`, `developer`, `tester`, `astro`,
> `frontend`, `doc-writer`, `security`, `web-tester`, `github-actions`,
> `copywriting`; and agents `accessibility-auditor`, `accessibility-tester`,
> `astro-developer`, `ci-configurator`, `ci-debugger`, `copywriter`,
> `designer`, `developer`, `doc-writer`, `frontend-developer`,
> `regression-sentinel`, `scenario-author`, `security`, `seo-specialist`,
> `tester`, `visual-regression-tester`, `web-conformity-checker`.

Replacement:

> 6\. `docs/layers.md` SHALL classify as `core`, at minimum: `AGENTS.md`,
> `CLAUDE.md`, `docs/`, `scripts/`, `specs/`, `artifacts/FORMAT.md`, the SDLC
> lifecycle skill set under `artifacts/core/skills/` (`spec-author`,
> `pr-logbook`, `pr-reviewer`), the SDLC lifecycle agent set under
> `artifacts/core/agents/` (`spec-author`, `pr-logbook`, `pr-reviewer`,
> `architect`), the operational role skills under `artifacts/core/skills/`
> enumerated in spec 0012 R8 (as amended by delta-04): `architect`, `developer`,
> `tester`, `astro`, `frontend`, `doc-writer`, `security`, `web-tester`,
> `github-actions`, `copywriting`; the operational role agents under
> `artifacts/core/agents/` enumerated in spec 0012 R8 (as amended by delta-04):
> `accessibility-auditor`, `accessibility-tester`, `astro-developer`,
> `ci-configurator`, `ci-debugger`, `copywriter`, `designer`, `developer`,
> `doc-writer`, `frontend-developer`, `regression-sentinel`, `scenario-author`,
> `security`, `seo-specialist`, `tester`, `visual-regression-tester`,
> `web-conformity-checker`; and the harness skill set under
> `artifacts/library/skills/` (`harness-report`, `harness-curator`) and
> harness agent set under `artifacts/library/agents/` (`harness-curator`).

## REMOVED

(none)
