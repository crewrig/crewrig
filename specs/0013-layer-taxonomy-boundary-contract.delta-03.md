---
id: "0013"
slug: layer-taxonomy-boundary-contract
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 227
version: 1.3.0
---

# Layer Taxonomy and Boundary Contract

## ADDED

(none)

## MODIFIED

**R6** — Update the core path enumeration to reflect the `artifacts/core/` and
`artifacts/library/` structure introduced by spec 0012 delta-03. Both
directories are upstream-owned and belong to the `core` layer. `artifacts/core/`
holds the SDLC lifecycle tools; `artifacts/library/` holds the harness system
and the reusable operational role skills and agents. `artifacts/FORMAT.md` is
added as a core path.

Original:

> 6\. `docs/layers.md` SHALL classify as `core`, at minimum, the paths
> enumerated in spec 0012 R6 (as amended by delta-01): `AGENTS.md`,
> `CLAUDE.md`, `docs/`, `scripts/`, `specs/`, the five harness skill
> directories under `community-config/skills/` (`spec-author`,
> `harness-curator`, `harness-report`, `pr-logbook`, `pr-reviewer`), and the
> five harness agent directories under `community-config/agents/`
> (`spec-author`, `harness-curator`, `pr-logbook`, `pr-reviewer`, `architect`).

Replacement:

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

---

**R7** — Update the overlay path enumeration to reference the
`artifacts/community/` and `artifacts/organisation/` namespaces introduced by
spec 0012 delta-02 R7. `community-config/mcp-servers/` and
`community-config/hooks/` move to `artifacts/community/`;
`community-config/themes/` is not carried forward into the new structure.
The designated areas for organisation-specific skills and agents become the
`skills/` and `agents/` sub-directories within `artifacts/community/` and
`artifacts/organisation/`.

Original (as amended by delta-02):

> 7\. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering
> the categories named in spec 0012 R7: `crewrig.config.toml`,
> `config/ORGANIZATION.md`, `config/TOOLS.md`, `config/claude/`,
> `config/gemini/`, `config/copilot/`, `extensions/`,
> `community-config/mcp-servers/`, `community-config/hooks/`,
> `community-config/themes/`, and the designated areas for organisation-specific
> skills and agents.

Replacement:

> 7\. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering
> the categories named in spec 0012 R7 (as amended by delta-02):
> `crewrig.config.toml`, `config/ORGANIZATION.md`, `config/TOOLS.md`,
> `config/claude/`, `config/gemini/`, `config/copilot/`, `extensions/`,
> `artifacts/community/mcp-servers/`, `artifacts/community/hooks/`, and the
> two organisation-owned artifact tiers — `artifacts/community/` (sandbox for
> experimentation and new development) and `artifacts/organisation/` (validated,
> production-ready components) — each containing `skills/` and `agents/`
> sub-directories owned exclusively by the adopting organisation.

---

**R8** — Remove the `community-config/`-based illustrative skills and agents
from the examples enumeration. These paths no longer exist in the new
structure: the operational role skills and agents are now classified as `core`
under `artifacts/library/` (per spec 0012 R8, as amended by delta-03). The
examples layer retains only the persona and context starting-point directories
and the identity template files.

Original (as amended by delta-01):

> 8\. `docs/layers.md` SHALL classify as `examples`, at minimum: the
> illustrative role skill directories under `community-config/skills/` that
> are not part of the harness skill set (as enumerated in spec 0012 R8,
> amended by delta-01); the illustrative agent directories under
> `community-config/agents/` that are not part of the harness agent set; and
> the persona and context starting-point directories `config/level/`,
> `config/expertise/`, and `config/teams/`.

Replacement:

> 8\. `docs/layers.md` SHALL classify as `examples`, at minimum: the persona
> and context starting-point directories `config/level/`, `config/expertise/`,
> and `config/teams/`; and the identity template files `config/SOUL.md.template`
> and `config/PROFILE.md.template`. The operational role skills and agents
> formerly enumerated here are now classified as `core` under
> `artifacts/library/` per spec 0012 R8 (as amended by delta-03) and SHALL be
> listed under the core layer in `docs/layers.md`.

---

**R9** — Replace the forward reference to the cancelled `examples/` directory
with a reference to the forthcoming `artifacts/` namespace. Spec 0012 R11 (as
amended by delta-03) no longer introduces an `examples/` directory; the
`artifacts/` directory and its four sub-directories (`core/`, `library/`,
`community/`, `organisation/`) are introduced by the directory-restructuring
sub-specification (sub-spec B of spec 0012).

Original:

> 9\. For paths not yet present in the repository at authoring time — notably
> `examples/`, planned by spec 0012 R11 — `docs/layers.md` SHALL note that
> the path is forthcoming and reference the sub-specification that introduces it.

Replacement:

> 9\. For paths not yet present in the repository at authoring time — notably
> the `artifacts/` directory and its four sub-directories `core/`, `library/`,
> `community/`, and `organisation/`, defined by spec 0012 R11 (as amended by
> delta-03) and introduced by the directory-restructuring sub-specification —
> `docs/layers.md` SHALL note that these paths are forthcoming and reference
> the sub-specification that introduces them.

## REMOVED

(none)
