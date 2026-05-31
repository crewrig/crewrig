# Plan format

This document defines the normative format for the PLAN artefact of
the lifecycle introduced in
[ADR-0010](adr/0010-spec-plan-review-lifecycle.md) — specifically
*Stage definitions → PLAN*. It is the contract that every plan SHALL
satisfy and the schema that the plan reviewer (per `AGENTS.md` →
*Plan review protocol*) and the retroactive routing engine
(issue #172) will rely on. The format is mandated by
[`specs/0004-plan-format-and-review.md`](../specs/0004-plan-format-and-review.md);
every section below traces back to one of its requirements R1..R11.

## Not a file — a comment

A plan is **a GitHub comment posted on the logbook issue**, not a
file in the repository. Consequently a plan has **no YAML
frontmatter** and no file path. Future readers SHOULD NOT graft a
frontmatter schema by analogy with
[`docs/spec-format.md`](spec-format.md): the spec format applies to
artefacts that ship on `main` and need machine-readable metadata; the
plan format applies to discussion-thread comments whose machine-read
fields (id, status, related issue) are already carried by the GitHub
issue itself.

## Header conventions

The first line of every plan comment SHALL be a level-2 heading
matching exactly one of the patterns below.

| Comment kind | Header | Requirement |
|---|---|---|
| Initial plan | `## PLAN — issue #<N> (spec <NNNN>)` | R1 |
| Revision | `## PLAN v<N+1> — issue #<N> (spec <NNNN>) — revision after <trigger>` | R9 |
| Review | `## PLAN review — issue #<N>` followed by `### Verdict: APPROVE` or `### Verdict: REQUEST CHANGES` on the next non-empty line | R6 |

`<N>` is the logbook issue number, `<NNNN>` the zero-padded spec id,
and `<trigger>` is a short noun phrase describing why the revision
exists (`DEV finding`, `user request`, `REQUEST CHANGES review`,
etc.).

## Mandatory body sections

An initial or revised plan comment SHALL contain the following five
level-3 headings, in this order, with their text matching verbatim
(case-sensitive, no trailing punctuation). A future plan linter will
rely on header presence and ordering to validate conformance.

**1. `### Approach`** — one paragraph, plain prose. Captures the
semantics of the plan — *what stance the implementation takes* — in a
single breath. No file-by-file enumeration here; that belongs in
`### Steps`.

**2. `### Steps`** — ordered list. Each step SHALL name the concrete
file path(s) it touches and a one-line description of the edit. A step
MAY carry the `[P]` marker as its first token (after the list number)
to indicate the step CAN run in parallel with the preceding step;
absence of `[P]` means strictly sequential (R4).

```markdown
1. Edit `path/to/a.md` — add the X section after Y.
2. [P] Edit `path/to/b.md` — refresh the Z table.
3. Run `scripts/build-components.sh` and stage the regenerated outputs.
```

**3. `### Blast radius`** — bullet list. Each bullet names one of: an
affected code path, a downstream ticket, a build output, a version-bump
trigger (per *AGENTS.md → Version Bump Convention*), or a CLI-matrix
trigger surface (per *AGENTS.md → CLI Matrix Maintenance*). When a
category is genuinely empty for the ticket, state so explicitly
(`Build outputs: none.`) rather than omitting the bullet — silence
reads as oversight.

**4. `### Alternatives considered and rejected`** — at least one
alternative, each followed by a one-line rationale. The purpose is to
surface the design space the author traversed; a plan with zero
rejected alternatives is rarely a plan that explored options.

**5. `### Rollback strategy`** — one paragraph. Names the concrete
revert path (commit revert, configuration rollback, data migration
reversal, etc.) and any coordination required with downstream tickets
or deployed components.

## Optional sections

**`### Risks`** — discrete risks with a one-line mitigation or
acceptance note each. When present, the section SHALL appear **after**
`### Rollback strategy` (R3). Plans that surface non-trivial
uncertainty SHOULD include it; plans whose blast radius is fully
bounded MAY omit it.

## Finding tag schema

Every plan-review finding SHALL carry exactly one `class:` field
whose value is one of `tech`, `arch`, or `spec` (R7). The class
drives the loop target of the retroactive review loop; the routing
matrix is defined once, in `AGENTS.md` → *Retroactive review loop*,
and SHALL NOT be duplicated here.

A reviewer comment that lists multiple findings SHALL tag each
finding individually:

```markdown
**Finding 1**

class: tech
<one-paragraph description and remediation pointer>

**Finding 2**

class: arch
<one-paragraph description and remediation pointer>
```

Findings without a `class:` tag are malformed and SHALL be returned
to the reviewer for retagging before the routing engine consumes
them.

## Append-only revisions

Once a plan comment is validated (by the reviewer in autonomous
modes or by the user in `FULL` / `INTERMEDIATE` mode), it SHALL NOT
be edited or deleted (R9). Subsequent revisions are posted as **new
comments** with the revision header above, citing the trigger.
Silent edits of a validated plan break the audit trail the
retroactive review loop relies on and are prohibited.

## Worked example

The first live use of the PLAN stage was the validated plan for
issue #170 (the spec-PR workflow ticket), authored by the
`architect` role in `INTERMEDIATE` mode and validated by the user
before the implementation branch was cut. It is the canonical
worked example this document points to (R10):

- <https://github.com/crewrig/crewrig/issues/170#issuecomment-4588163138>

Readers should treat the comment's structure — five mandatory
sections, file-path-anchored steps, an explicit deferral
recommendation, zero `[P]` markers because the steps were
genuinely sequential — as the lived demonstration of the schema
above.
