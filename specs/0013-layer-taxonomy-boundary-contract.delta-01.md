---
id: "0013"
slug: layer-taxonomy-boundary-contract
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 227
version: 1.1.0
---

# Layer Taxonomy and Boundary Contract

## ADDED

(none)

## MODIFIED

**R7** — Remove `config/teams/`, `config/expertise/`, and `config/level/` from
the overlay enumeration; reclassify them as examples (plan-review iter:4
Finding 1: the implementation placed these paths under `examples` after an
interactive classification review, contradicting R7's explicit enumeration).
Also add `extensions/` to the overlay enumeration, reflecting the
interactive-review decision that the adopting organisation owns its own
extension registry (iter:4 consistency fix).

Original:

> 7\. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering
> the categories named in spec 0012 R7: `crewrig.config.toml`, `config/SOUL.md`,
> `config/PROFILE.md`, `config/ORGANIZATION.md`, `config/TOOLS.md`,
> `config/teams/`, `config/expertise/`, `config/level/`, `config/claude/`,
> `config/gemini/`, `config/copilot/`, `community-config/mcp-servers/`,
> `community-config/hooks/`, `community-config/themes/`, and the designated
> areas for organisation-specific skills and agents.

Replacement:

> 7\. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering
> the categories named in spec 0012 R7: `crewrig.config.toml`, `config/SOUL.md`,
> `config/PROFILE.md`, `config/ORGANIZATION.md`, `config/TOOLS.md`,
> `config/claude/`, `config/gemini/`, `config/copilot/`, `extensions/`,
> `community-config/mcp-servers/`, `community-config/hooks/`,
> `community-config/themes/`, and the designated areas for organisation-specific
> skills and agents.

---

**R8** — Extend the examples enumeration to include the persona and context
starting-point files, in addition to the already-required illustrative skills
and agents (plan-review iter:4 consistency fix following the R7 amendment above).

Original:

> 8\. `docs/layers.md` SHALL classify as `examples`, at minimum, the
> illustrative role skill directories under `community-config/skills/` that
> are not part of the harness skill set (as enumerated in spec 0012 R8,
> amended by delta-01) and the illustrative agent directories under
> `community-config/agents/` that are not part of the harness agent set.

Replacement:

> 8\. `docs/layers.md` SHALL classify as `examples`, at minimum: the
> illustrative role skill directories under `community-config/skills/` that
> are not part of the harness skill set (as enumerated in spec 0012 R8,
> amended by delta-01); the illustrative agent directories under
> `community-config/agents/` that are not part of the harness agent set; and
> the persona and context starting-point directories `config/level/`,
> `config/expertise/`, and `config/teams/`.

## REMOVED

(none)
