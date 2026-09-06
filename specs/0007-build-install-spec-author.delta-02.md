---
id: "0007"
slug: build-install-spec-author
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1127
version: 2.0.0
---

# Build and install verification for the spec-author skill — delta 02

Corrects the Claude Code agent path in the replacement text that
[`specs/0007-build-install-spec-author.delta-01.md`](0007-build-install-spec-author.delta-01.md)
(cumulative `1.0.1`) wrote for requirements 2 and 3 of the parent, from the
nested `.claude/agents/<NAME>/AGENT.md` to the flat `.claude/agents/<NAME>.md`.
Authored for issue #1127 and mandated by requirement 29 of spec 0201 (*Flat
compiled layout for Claude Code agents*, seam (g) of epic #1100, merging through
pull request #1128), which names the delta-01 replacement text as the one live
normative contradiction of that specification and assigns its repair here rather
than to an edit of the merged body.

This delta records a consequence spec 0201 already decided. It introduces no
design: requirement 1 of spec 0201 fixes the compiled Claude Code output for an
agent as one regular file named `<agent-name>.md` placed directly in the
`.claude/agents/` directory of that agent's tier output root, requirement 2
forbids any sub-directory of a compiled `.claude/agents/` directory, and
requirement 15 re-points the per-component mirror verification — the
`skill:check` target of `Taskfile.yml`, whose
`CLAUDE_AGENT=".claude/agents/${NAME}/AGENT.md"` line is what the delta-01 text
binds — at that same path. What follows carries those decisions into the
parent's own text, so a reader of spec 0007 alone is not left holding a rule
that contradicts a merged one.

The correction restores the path the parent originally named. Requirement 2 of
spec 0007 at `1.0.0` enumerated `.claude/agents/<NAME>.md`; delta-01 moved it to
the nested form to match the build as it stood, and added the parenthesis "NOT a
flat `<NAME>.md`" — the clause that now contradicts requirement 1 of spec 0201
head-on. This delta moves it back, on a different footing: not on the shape of
the build of the day, but on the vendor's own documentation, which spec 0201
records under *Vendor evidence* — the Claude Code subagents page documents one
file per agent under `.claude/agents/` and no nested form.

`MAJOR` bump, cumulative `2.0.0`. Per `docs/spec-format.md` → *Delta-spec
convention → Versioning*, `MAJOR` is the breaking normative change — a
requirement modified in a way that invalidates an in-flight implementation — and
that is exactly what this is: a mirror check conforming to the current text,
reading the nested path, becomes non-conforming the moment this delta lands. It is an inversion of a
shipped path assertion, not a clarification of it. Requirement 29 of spec 0201
names the same `2.0.0` and orders this delta before the implementation of that
specification merges.

**Nothing observable changes with this delta.** It is normative text only: no
script, no build emission, no committed output file and no
continuous-integration guard is touched here. Until the implementation of spec 0201 merges,
the committed tree still ships the 22 compiled Claude Code agents in the nested
layout, and `task skill:check NAME=<skill-name>` still reads
`.claude/agents/<NAME>/AGENT.md` — because the `Taskfile.yml` line that names it
is re-pointed by requirement 15 of spec 0201, in that specification's change
set, not by this delta. The interval in which the merged text and the shipped
tree disagree is the interval requirement 29 deliberately creates, by ordering
the normative repair ahead of the mechanical one. Nobody should expect this
delta alone to change what the check reads.

**Vocabulary.** *Compiled Claude Code agent output* carries the meaning spec
0201 gives it. `<NAME>` is the component name the `skill:check` target takes as
its `NAME=<skill-name>` parameter, unchanged from the parent.

## ADDED

None.

## MODIFIED

1. **The replacement text delta-01 wrote for requirement 2 is replaced**, so
   that the Claude Code agent path it enumerates is the path of requirement 1 of
   spec 0201. Only the first of the three bullets moves.

   - Original, from delta-01:

     > Replacement: the three agent paths SHALL be:
     >
     > - `.claude/agents/<NAME>/AGENT.md` (Claude uses a sub-directory layout
     >   for agents, parallelling the skill layout, NOT a flat `<NAME>.md`).
     > - `.gemini/agents/<NAME>.md` (flat layout, correct in the original).
     > - `.github/agents/<NAME>.md` (flat layout, correct in the original).

   - Replacement:

     > Replacement: the three agent paths SHALL be:
     >
     > - `.claude/agents/<NAME>.md` (flat layout, one regular file per agent
     >   directly in the compiled Claude Code agent directory, per requirement 1
     >   of spec 0201).
     > - `.gemini/agents/<NAME>.md` (flat layout, correct in the original).
     > - `.github/agents/<NAME>.md` (flat layout, correct in the original).

   The parenthesis is dropped rather than reworded. It asserted a sub-directory
   layout and denied the flat one; both halves are false under requirement 1 of
   spec 0201, and the replacement bullet already states what the path is, so
   nothing is left for the parenthesis to carry.

   The sentence that closes delta-01's requirement 2 item is **UNCHANGED**:

   > Asymmetric agent presence (some CLIs have the agent, others do not)
   > remains a verification failure per the unchanged second half of R2.

   Requirement 15 of spec 0201 preserves that property explicitly — the mirror
   verification "SHALL continue to treat the three per-command-line-interface
   agent mirrors as all present or all absent" — so the all-or-nothing rule
   survives the path change untouched. Only where the check looks for the Claude
   Code mirror moves; whether an asymmetric result fails does not.

2. **Clause (c) of the replacement text delta-01 wrote for requirement 3 is
   replaced**, for the same reason and with the same substitution. The two
   fields the clause checks are untouched.

   - Original, from delta-01:

     > - (c) For all skill outputs (`.claude/skills/<NAME>/SKILL.md`,
     >   `.gemini/skills/<NAME>/SKILL.md`, `.github/skills/<NAME>/SKILL.md`)
     >   AND for Claude / GitHub-Copilot agent outputs
     >   (`.claude/agents/<NAME>/AGENT.md`, `.github/agents/<NAME>.md`):
     >   the field `name` SHALL be present and non-empty in the YAML
     >   frontmatter, AND the field `metadata.provenance.version` SHALL be
     >   present and non-empty in the YAML frontmatter.

   - Replacement:

     > - (c) For all skill outputs (`.claude/skills/<NAME>/SKILL.md`,
     >   `.gemini/skills/<NAME>/SKILL.md`, `.github/skills/<NAME>/SKILL.md`)
     >   AND for Claude / GitHub-Copilot agent outputs
     >   (`.claude/agents/<NAME>.md`, `.github/agents/<NAME>.md`):
     >   the field `name` SHALL be present and non-empty in the YAML
     >   frontmatter, AND the field `metadata.provenance.version` SHALL be
     >   present and non-empty in the YAML frontmatter.

   The field checks — `name` and `metadata.provenance.version`, both present and
   non-empty in the YAML frontmatter — are **UNCHANGED**. Requirement 3 of spec
   0201 keeps the bytes of each compiled Claude Code agent output identical
   across the move, so the frontmatter the clause reads at the new path is the
   frontmatter it read at the old one. Only the path string moves.

### What is unchanged, and why

Everything below survives this delta. Each survives for a reason of its own, not
merely by omission.

- **The skill paths of requirements 1, 2 and 3** — `.claude/skills/<NAME>/`,
  `.gemini/skills/<NAME>/`, `.github/skills/<NAME>/`, and the
  `SKILL.md` files within them. Spec 0201 moves compiled **agent** outputs only;
  requirement 2 of that specification forbids a sub-directory under a compiled
  `.claude/agents/` directory and says nothing about `.claude/skills/`, whose
  per-component sub-directory layout is the one that command line interface
  documents. The parallel delta-01 drew between the two layouts is what breaks;
  the skill side of it does not.
- **The Gemini and GitHub Copilot agent paths** — `.gemini/agents/<NAME>.md` and
  `.github/agents/<NAME>.md`. Both were already flat and already correct in the
  parent at `1.0.0`; delta-01 changed neither, and spec 0201 changes only the
  Claude Code emission. They are quoted above inside the replacement text solely
  because the clauses that carry them are restated whole.
- **Clauses (a) and (b) of delta-01's requirement 3 replacement** — the file
  exists and is non-empty, and the YAML frontmatter parses as valid YAML. Both
  are path-agnostic assertions about whatever file the enumeration resolves to.
- **Clause (d) of delta-01's requirement 3 replacement** — the Gemini agent
  output's `name` field plus the `<!-- crewrig-provenance: version="<semver>"
  ... -->` line following the frontmatter. It governs `.gemini/agents/<NAME>.md`
  alone, a path this delta does not touch, and the provenance convention it
  describes is a property of the Gemini agent format rather than of any
  directory layout.
- **The dropped `type` field** — delta-01 removed `type` from the required-field
  list of requirement 3 because no artifact the build emits carries it. That
  finding is about a frontmatter schema, not about a path; the move of the
  Claude Code output neither reinstates the field nor gives it a new place to
  hide. It stays dropped.
- **Requirements 1, 4, 5, 6, 7, 8 and 9 of the parent, in full.** Requirement 1
  names skill directories only. Requirements 4 and 5 fix the failure behaviour
  and the file-level ceiling of the check — non-zero exit with a single-line
  summary, no live command-line-interface invocation — neither of which depends
  on where a mirror sits. Requirement 6 keeps the target separate from the spec
  linter, a boundary between two tools. Requirements 7 and 8 concern a
  `docs/cli-matrix.md` note and the acceptance invocation
  `task skill:check NAME=spec-author`, which exits zero on a clean checkout
  before and after the move. Requirement 9 is a historical no-edit constraint on
  a change set merged long ago.
- **Both scenarios of the parent**, and every bullet of its `## Out of scope`
  and `## Open questions` sections. Neither scenario names an agent path: the
  happy path asserts symmetry across the three command line interfaces and a
  zero exit, and the failure path asserts drift between a source and its skill
  mirrors. Both hold verbatim at either layout.

## REMOVED

None.
