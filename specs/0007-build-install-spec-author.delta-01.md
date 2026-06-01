---
id: "0007"
slug: build-install-spec-author
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 174
version: 1.0.1
---

# Delta 01 — align R2/R3 with built-artefact reality

## ADDED

(none — this delta is corrective, not additive.)

## MODIFIED

**R2** — the path enumeration for matching agent files SHALL be
corrected to reflect the actual mirror layouts produced by
`scripts/build-components.sh`.

> Original R2 (excerpt): *"the matching slim agent file when it exists,
> at the three paths `.claude/agents/<NAME>.md`, `.gemini/agents/<NAME>.md`,
> and `.github/agents/<NAME>.md`."*

Replacement: the three agent paths SHALL be:

- `.claude/agents/<NAME>/AGENT.md` (Claude uses a sub-directory layout
  for agents, parallelling the skill layout, NOT a flat `<NAME>.md`).
- `.gemini/agents/<NAME>.md` (flat layout, correct in the original).
- `.github/agents/<NAME>.md` (flat layout, correct in the original).

Asymmetric agent presence (some CLIs have the agent, others do not)
remains a verification failure per the unchanged second half of R2.

**R3** — the required-fields list for the file-level verification SHALL
be corrected to match the frontmatter schema actually emitted by
`scripts/build-components.sh`.

> Original R3 (excerpt): *"For each found output file, the target SHALL
> verify: (a) the file exists and is non-empty, (b) the YAML frontmatter
> parses as valid YAML, and (c) the required fields `name`, `type`, and
> `metadata.provenance.version` are present and non-empty."*

Replacement: the verification SHALL check the following on each found
output file:

- (a) The file exists and is non-empty (unchanged from original).
- (b) The YAML frontmatter parses as valid YAML (unchanged from
  original).
- (c) For all skill outputs (`.claude/skills/<NAME>/SKILL.md`,
  `.gemini/skills/<NAME>/SKILL.md`, `.github/skills/<NAME>/SKILL.md`)
  AND for Claude / GitHub-Copilot agent outputs
  (`.claude/agents/<NAME>/AGENT.md`, `.github/agents/<NAME>.md`):
  the field `name` SHALL be present and non-empty in the YAML
  frontmatter, AND the field `metadata.provenance.version` SHALL be
  present and non-empty in the YAML frontmatter.
- (d) For the Gemini agent output (`.gemini/agents/<NAME>.md`)
  specifically: the field `name` SHALL be present and non-empty in
  the YAML frontmatter, AND a line of the form `<!-- crewrig-provenance:
  version="<semver>" ... -->` SHALL be present immediately after the
  YAML frontmatter (Gemini's agent format stores provenance in an
  HTML comment rather than in the YAML frontmatter; this is the
  convention emitted by the build script).

The previously-required `type` field SHALL be DROPPED from the
verification list. The field is not part of the frontmatter schema
emitted by `scripts/build-components.sh` for any artefact (skill or
agent, any CLI); requiring it caused the verification to fail against
every existing built file. The original R3 wording was aspirational,
not descriptive.

## REMOVED

(none — the dropped `type` field is recorded under MODIFIED above
because R3 as a whole is restated, not deleted.)

## Notes

This delta is purely corrective: the original spec 0007 was written
without inspecting the actual mirror artefacts produced by
`scripts/build-components.sh`. The blocker surfaced at DEV time when
the developer cross-checked the spec against the filesystem (see
issue #174 logbook for the diagnostic detail). PATCH-bump (`1.0.0` →
`1.0.1`) per `docs/spec-format.md` → *Versioning*: clarification /
wording fix, no in-flight implementation invalidated (DEV had not
started writing any code yet).

After this delta-spec merges, the developer resumes DEV with the
corrected R2 path layout and R3 field set. The Taskfile target's
behaviour against the actual built outputs is unchanged in intent
(file-level smoke check, no live API invocation, strict separation
from #178); only the verification's field list and one path string
are aligned with reality.
