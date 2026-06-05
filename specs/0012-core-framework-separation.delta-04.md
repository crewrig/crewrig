---
id: "0012"
slug: core-framework-separation
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 224
version: 1.4.0
---

# Core Framework Separation

## ADDED

(none)

## MODIFIED

**R6** — Correct the component-to-directory assignment introduced in delta-03.
The governing axis is installation location, not component origin. `artifacts/core/`
is installed at the project level (per-repo); `artifacts/library/` is installed
at the user-home level (globally available across all projects). The harness
system belongs in `library/` because its value is precisely that it can be
invoked from any project, not only from CrewRig forks. All other upstream
components — the SDLC lifecycle tools and the operational role skills and agents
— are project-scoped and therefore belong in `artifacts/core/`.

Original (as amended by delta-03):

> 6\. The core layer SHALL include, at minimum: the lifecycle governance files
> (`AGENTS.md`, `docs/`), the build and install scripts (`scripts/`), the
> specification history (`specs/`), the format contract (`artifacts/FORMAT.md`),
> the `artifacts/core/` directory containing the SDLC lifecycle skill set
> (`artifacts/core/skills/spec-author/`, `artifacts/core/skills/pr-logbook/`,
> `artifacts/core/skills/pr-reviewer/`) and SDLC lifecycle agent set
> (`artifacts/core/agents/spec-author/`, `artifacts/core/agents/pr-logbook/`,
> `artifacts/core/agents/pr-reviewer/`, `artifacts/core/agents/architect/`),
> and the `artifacts/library/` directory containing the harness skill set
> (`artifacts/library/skills/harness-report/`,
> `artifacts/library/skills/harness-curator/`), the harness agent set
> (`artifacts/library/agents/harness-curator/`), and the operational role
> skills and agents enumerated in R8.

Replacement:

> 6\. The core layer SHALL include, at minimum: the lifecycle governance files
> (`AGENTS.md`, `docs/`), the build and install scripts (`scripts/`), the
> specification history (`specs/`), the format contract (`artifacts/FORMAT.md`),
> the `artifacts/core/` directory containing the SDLC lifecycle skill set
> (`artifacts/core/skills/spec-author/`, `artifacts/core/skills/pr-logbook/`,
> `artifacts/core/skills/pr-reviewer/`), the SDLC lifecycle agent set
> (`artifacts/core/agents/spec-author/`, `artifacts/core/agents/pr-logbook/`,
> `artifacts/core/agents/pr-reviewer/`, `artifacts/core/agents/architect/`),
> and the operational role skills and agents enumerated in R8; and the
> `artifacts/library/` directory containing the harness skill set
> (`artifacts/library/skills/harness-report/`,
> `artifacts/library/skills/harness-curator/`) and the harness agent set
> (`artifacts/library/agents/harness-curator/`).

---

**R8** — Relocate the operational role skills and agents from `artifacts/library/`
back to `artifacts/core/`. These components are project-scoped: they are built
into the per-repo `.claude/skills/` and `.gemini/skills/` directories, not
installed globally. `artifacts/library/` is reserved exclusively for the harness
system, which is the only upstream component whose value depends on global
(user-home) installation.

Original (as amended by delta-03):

> 8\. The `artifacts/library/` directory SHALL include, in addition to the
> harness components listed in R6, the operational role skill directories
> `architect`, `developer`, `tester`, `astro`, `frontend`, `doc-writer`,
> `security`, `web-tester`, `github-actions`, `copywriting`; and the
> operational role agent directories `accessibility-auditor`,
> `accessibility-tester`, `astro-developer`, `ci-configurator`, `ci-debugger`,
> `copywriter`, `designer`, `developer`, `doc-writer`, `frontend-developer`,
> `regression-sentinel`, `scenario-author`, `security`, `seo-specialist`,
> `tester`, `visual-regression-tester`, `web-conformity-checker`. These
> components are maintained by upstream, are useful to any project adopting
> the CrewRig framework regardless of whether it uses the CrewRig SDLC
> lifecycle, and serve as reference implementations; adopting organisations
> may copy any of them into their `artifacts/community/` or
> `artifacts/organisation/` tiers and adapt them freely.

Replacement:

> 8\. The `artifacts/core/` directory SHALL include, in addition to the SDLC
> lifecycle components listed in R6, the operational role skill directories
> `architect`, `developer`, `tester`, `astro`, `frontend`, `doc-writer`,
> `security`, `web-tester`, `github-actions`, `copywriting`; and the
> operational role agent directories `accessibility-auditor`,
> `accessibility-tester`, `astro-developer`, `ci-configurator`, `ci-debugger`,
> `copywriter`, `designer`, `developer`, `doc-writer`, `frontend-developer`,
> `regression-sentinel`, `scenario-author`, `security`, `seo-specialist`,
> `tester`, `visual-regression-tester`, `web-conformity-checker`. These
> components are project-scoped, built into the per-repo CLI output directories,
> and serve as reference implementations that adopting organisations may copy
> into their `artifacts/community/` or `artifacts/organisation/` tiers.
> `artifacts/library/` SHALL contain exclusively the harness skill set and
> harness agent set enumerated in R6.

## REMOVED

(none)
