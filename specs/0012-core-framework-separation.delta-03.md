---
id: "0012"
slug: core-framework-separation
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 224
version: 1.3.0
---

# Core Framework Separation

## ADDED

(none)

## MODIFIED

**R6** — Split `artifacts/core/` into two distinct upstream-owned directories.
`artifacts/core/` is restricted to the SDLC lifecycle tools that drive
CrewRig's own development process. A new `artifacts/library/` directory holds
the harness system and the operational role skills and agents — components
maintained by upstream that are useful to any project adopting the CrewRig
framework, not solely to CrewRig itself.

Original (as amended by delta-02):

> 6\. The core layer SHALL include, at minimum: the lifecycle governance files
> (`AGENTS.md`, `docs/`), the build and install scripts (`scripts/`), the
> specification history (`specs/`), the format contract (`artifacts/FORMAT.md`),
> and the `artifacts/core/` directory, which contains the harness skill set
> (`artifacts/core/skills/spec-author/`, `artifacts/core/skills/harness-curator/`,
> `artifacts/core/skills/harness-report/`, `artifacts/core/skills/pr-logbook/`,
> `artifacts/core/skills/pr-reviewer/`), the harness agent set
> (`artifacts/core/agents/spec-author/`, `artifacts/core/agents/harness-curator/`,
> `artifacts/core/agents/pr-logbook/`, `artifacts/core/agents/pr-reviewer/`,
> `artifacts/core/agents/architect/`), and the operational role skills and
> agents that the upstream CrewRig project uses for its own development workflow.

Replacement:

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

---

**R8** — Relocate the operational role skills and agents from `artifacts/core/`
to `artifacts/library/`. These components are delivered by upstream and are
useful to any project adopting the CrewRig framework — they are not specific to
CrewRig's own development workflow. The harness components enumerated in R6
(harness-report, harness-curator) are the stable anchor of `artifacts/library/`;
the role skills and agents extend it as reusable reference implementations.

Original (as amended by delta-02):

> 8\. The `artifacts/core/` directory SHALL include, in addition to the harness
> and SDLC lifecycle components listed in R6, the operational role skill and
> agent directories that the upstream CrewRig project uses for its own
> development: `architect`, `developer`, `tester`, `astro`, `frontend`,
> `doc-writer`, `security`, `web-tester`, `github-actions`, `copywriting`
> (skills) and `accessibility-auditor`, `accessibility-tester`,
> `astro-developer`, `ci-configurator`, `ci-debugger`, `copywriter`,
> `designer`, `developer`, `doc-writer`, `frontend-developer`,
> `regression-sentinel`, `scenario-author`, `security`, `seo-specialist`,
> `tester`, `visual-regression-tester`, `web-conformity-checker` (agents).
> These components are maintained by upstream and serve as reference
> implementations; adopting organisations may copy any of them into their
> `artifacts/community/` or `artifacts/organisation/` tiers and adapt them
> freely.

Replacement:

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

---

**R11** — Add `library/` as a fourth sub-directory of `artifacts/`. The
directory structure is now `core/`, `library/`, `community/`, `organisation/`
plus the top-level `FORMAT.md`.

Original (as amended by delta-02):

> 11\. The `artifacts/` directory SHALL reside at the root of the repository
> and SHALL contain exactly three subdirectories — `core/`, `community/`, and
> `organisation/` — plus a top-level `FORMAT.md` file. No other top-level
> entries are permitted inside `artifacts/`. The `community-config/` directory
> is deprecated and SHALL be removed once all its contents have been migrated
> into the appropriate `artifacts/` subdirectory.

Replacement:

> 11\. The `artifacts/` directory SHALL reside at the root of the repository
> and SHALL contain exactly four subdirectories — `core/`, `library/`,
> `community/`, and `organisation/` — plus a top-level `FORMAT.md` file. No
> other top-level entries are permitted inside `artifacts/`. The
> `community-config/` directory is deprecated and SHALL be removed once all
> its contents have been migrated into the appropriate `artifacts/`
> subdirectory.

## REMOVED

(none)
