---
id: "0012"
slug: core-framework-separation
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 224
version: 1.2.0
---

# Core Framework Separation

## ADDED

(none)

## MODIFIED

**R6** — Replace the `community-config/`-based path enumeration with the new
`artifacts/` unified namespace. The harness skill set and harness agent set,
together with the operational role skills and agents the upstream CrewRig
project uses for its own development, all reside under `artifacts/core/`.
`community-config/` is superseded by this structure.

Original (as amended by delta-01):

> 6\. The core layer SHALL include, at minimum: the lifecycle governance files
> (`AGENTS.md`, `docs/`), the harness skill set (`spec-author`,
> `harness-curator`, `harness-report`, `pr-logbook`, `pr-reviewer`), the
> harness agent set (`spec-author`, `harness-curator`, `pr-logbook`,
> `pr-reviewer`, `architect`), the build and install scripts (`scripts/`),
> and the specification history (`specs/`).

Replacement:

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

---

**R7** — Replace the `community-config/`-based overlay path enumeration with
the new `artifacts/community/` and `artifacts/organisation/` structure. These
two directories constitute the overlay zone: `artifacts/community/` is the
sandbox for developing and experimenting with new org-specific components,
and `artifacts/organisation/` holds the validated, production-ready components
promoted from the sandbox.

Original:

> 7\. The overlay layer SHALL provide designated locations for: organisation
> identity, agent personality configuration, user profiles, team
> configurations, MCP server declarations, and organisation-specific skills
> and agents.

Replacement:

> 7\. The overlay layer SHALL provide designated locations for: organisation
> identity (`crewrig.config.toml`, `config/ORGANIZATION.md`, `config/TOOLS.md`),
> CLI-specific overlay configuration (`config/claude/`, `config/gemini/`,
> `config/copilot/`), MCP server declarations and lifecycle hooks
> (`artifacts/community/mcp-servers/`, `artifacts/community/hooks/`), and two
> tiers of organisation-specific component areas:
> `artifacts/community/` (sandbox — experimentation and new development) and
> `artifacts/organisation/` (validated — production-ready components approved
> for use across the organisation). Both tiers follow the same internal
> structure (`skills/`, `agents/`) and are owned exclusively by the adopting
> organisation.

---

**R8** — Remove the `examples` directory concept entirely. Illustrative role
skills and agents are relocated into `artifacts/core/` alongside the harness
components. The operational nature of these components (actively used by the
upstream CrewRig project) takes precedence over their illustrative role; their
location in `artifacts/core/` communicates that they are upstream-maintained
reference implementations that adopting organisations may study and copy into
their own overlay tiers.

Original (as amended by delta-01):

> 8\. The examples directory SHALL include, at minimum: the illustrative role
> skills currently in `community-config/skills/` that are not part of the
> harness skill set (`architect`, `developer`, `tester`, `astro`, `frontend`,
> `doc-writer`, `security`, `web-tester`, `github-actions`, `copywriting`),
> and the illustrative agent definitions currently in
> `community-config/agents/` that are not part of the harness agent set
> defined in R6 (`accessibility-auditor`, `accessibility-tester`,
> `astro-developer`, `ci-configurator`, `ci-debugger`, `copywriter`,
> `designer`, `developer`, `doc-writer`, `frontend-developer`,
> `regression-sentinel`, `scenario-author`, `security`, `seo-specialist`,
> `tester`, `visual-regression-tester`, `web-conformity-checker`).

Replacement:

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

---

**R11** — Remove the `examples/` directory naming requirement, which is
superseded by the `artifacts/core/` model introduced in the amendments above.

Original:

> 11\. The examples directory SHALL be named `examples/` and SHALL reside at
> the root of the core layer.

Replacement:

> 11\. The `artifacts/` directory SHALL reside at the root of the repository
> and SHALL contain exactly three subdirectories — `core/`, `community/`, and
> `organisation/` — plus a top-level `FORMAT.md` file. No other top-level
> entries are permitted inside `artifacts/`. The `community-config/` directory
> is deprecated and SHALL be removed once all its contents have been migrated
> into the appropriate `artifacts/` subdirectory.

## REMOVED

**R3** — The "dedicated examples directory" requirement is superseded by the
`artifacts/core/` model. Operational role skills and agents that also serve
as reference implementations reside in `artifacts/core/` alongside harness
components; there is no separate examples directory.

Original:

> 3\. The repository SHALL provide a dedicated **examples directory** containing
> illustrative role skills and configuration templates that currently reside
> alongside core harness skills.

This requirement is removed. Its intent (making reference implementations
discoverable and visually distinct from harness components) is now served by
the `artifacts/core/` vs `artifacts/community/` vs `artifacts/organisation/`
directory split.
