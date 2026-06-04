---
id: "0013"
slug: layer-taxonomy-boundary-contract
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 227
version: 1.2.0
---

# Layer Taxonomy and Boundary Contract

## ADDED

(none)

## MODIFIED

**R7** — Remove `config/SOUL.md` and `config/PROFILE.md` from the overlay
enumeration. These files are gitignored (`.gitignore` lines 25–26) and are
never committed to any repository — neither upstream nor in an adopting
organisation's fork. Each developer generates them locally from the
corresponding `examples`-layer templates (`config/SOUL.md.template`,
`config/PROFILE.md.template`). Classifying gitignored, user-local files as
`overlay` is a misclassification; they belong to the user-local category
alongside `.env`.

Original (as amended by delta-01):

> 7\. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering
> the categories named in spec 0012 R7: `crewrig.config.toml`, `config/SOUL.md`,
> `config/PROFILE.md`, `config/ORGANIZATION.md`, `config/TOOLS.md`,
> `config/claude/`, `config/gemini/`, `config/copilot/`, `extensions/`,
> `community-config/mcp-servers/`, `community-config/hooks/`,
> `community-config/themes/`, and the designated areas for organisation-specific
> skills and agents.

Replacement:

> 7\. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering
> the categories named in spec 0012 R7: `crewrig.config.toml`,
> `config/ORGANIZATION.md`, `config/TOOLS.md`, `config/claude/`,
> `config/gemini/`, `config/copilot/`, `extensions/`,
> `community-config/mcp-servers/`, `community-config/hooks/`,
> `community-config/themes/`, and the designated areas for organisation-specific
> skills and agents.

---

**R11** — Extend the completeness requirement to explicitly cover the
user-local / gitignored category: the document SHALL note that gitignored
user-generated files (e.g. `config/SOUL.md`, `config/PROFILE.md`) carry no
layer classification, in the same way as runtime-generated ephemeral paths.

Original:

> 11\. Any path in the repository that `docs/layers.md` does not classify SHALL
> be treated as a documentation gap, not as implicitly `core` or implicitly
> `overlay` — the document SHALL be complete at the time it is introduced.

Replacement:

> 11\. Any committed path in the repository that `docs/layers.md` does not
> classify SHALL be treated as a documentation gap, not as implicitly `core`
> or implicitly `overlay` — the document SHALL be complete at the time it is
> introduced. Gitignored, user-generated files that are derived from examples-layer
> templates (e.g. `config/SOUL.md` generated from `config/SOUL.md.template`)
> carry no layer classification and SHALL be noted in the document's
> user-local section alongside runtime-ephemeral paths.

## REMOVED

(none)
