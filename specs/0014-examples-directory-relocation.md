---
id: "0014"
slug: examples-directory-relocation
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 228
version: 1.0.0
---

# Examples Directory and Illustrative-Component Relocation

## Intent

CrewRig gains a dedicated `examples/` directory at the repository root that
hosts all illustrative role skills and agent definitions, making their
demonstrative nature immediately visible to newcomers. The 10 illustrative
skills and 17 illustrative agents currently co-located with core harness
components in `community-config/` are relocated there. Each relocated
component carries a notice indicating that it is a template to adapt rather
than a component to extend in place.

## Requirements

1. A directory named `examples/` SHALL exist at the root of the repository.
2. All 10 illustrative role skill directories currently in
   `community-config/skills/` and classified as `examples` in `docs/layers.md`
   SHALL be relocated into `examples/`.
3. All 17 illustrative agent directories currently in
   `community-config/agents/` and classified as `examples` in `docs/layers.md`
   SHALL be relocated into `examples/`.
4. The internal structure of each relocated component (its `SKILL.md` or
   `AGENT.md` file and any supporting files) SHALL be preserved unchanged
   during relocation.
5. Each relocated component SHALL include a human-readable notice indicating
   that it is an illustrative starting point intended to be copied and adapted,
   not a core component to be extended in place. The notice SHALL be visible
   without opening the component's definition file (e.g., in a `README.md`
   or as a frontmatter field).
6. `scripts/build-components.sh` SHALL be updated to discover and compile
   illustrative components from their new location in `examples/` in addition
   to (or instead of) `community-config/`, so that built outputs remain
   equivalent to the pre-relocation state.
7. `docs/layers.md` SHALL be updated to reflect the new physical paths of the
   relocated components under `examples/`, replacing the `community-config/`
   paths currently listed in the examples layer enumeration.
8. `docs/cli-matrix.md` SHALL be updated if the relocation changes any
   CLI-specific integration point tracked in that document.
9. After relocation, the `community-config/skills/` directory SHALL contain
   only harness skill directories and any overlay skill directories; no
   illustrative skills SHALL remain there.
10. After relocation, the `community-config/agents/` directory SHALL contain
    only harness agent directories and any overlay agent directories; no
    illustrative agents SHALL remain there.

## Scenarios

**Scenario:** Newcomer locates an illustrative developer skill

Given a developer new to CrewRig who wants to build a team-specific
`developer` skill
When they browse the repository root
Then they find `examples/` as a clearly named directory, locate the
illustrative `developer` skill inside it, and read a notice indicating it
is a template to adapt.

**Scenario:** Build output is equivalent after relocation

Given the `examples/` directory containing all relocated illustrative skills
and agents
When `scripts/build-components.sh` is executed
Then the compiled outputs under `.claude/`, `.gemini/`, and `.github/`
include the same harness components and illustrative components as before
the relocation, with no diff from the pre-relocation state.

**Scenario:** community-config/ is clean after relocation

Given the completed relocation of all illustrative components
When a contributor lists `community-config/skills/` and
`community-config/agents/`
Then they see only harness components and overlay-designated areas —
no illustrative role skills or illustrative agents remain in those directories.

## Out of scope

- Relocating the identity and configuration templates (`config/SOUL.md.template`,
  `config/PROFILE.md.template`) into `examples/` — that is a follow-up
  concern deferred to a later sub-spec or a dedicated delta.
- Relocating the persona and context starting points (`config/level/`,
  `config/expertise/`, `config/teams/`) into `examples/` — same deferral.
- Creating the synchronisation mechanism that enforces core-layer immutability
  — covered by sub-spec D.
- Updating `AGENTS.md` to reference `examples/` — may be included in the
  implementation PR if trivially scoped but is not normatively required here.

## Open questions

(none)
