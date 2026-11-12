# Pre-write grounding

Before writing `## Requirements` for a spec that qualifies a **verification,
audit or sanity-check tool** whose acceptance is file-level, check the drafted
requirements against the codebase. A requirement qualified in isolation drifts:
one spec once mandated a `type` field that no built artifact ever carried, and
the mismatch surfaced only at implementation time. The check is cheap and
catches that drift while it is still a one-line edit.

It runs in all four modes. In AUTO nobody can challenge the requirements before
the spec-PR opens, so grounding is the only catcher; an anomaly there is
recorded as `[AUTO-PARKED]` and audited in the PR diff.

## Detection

The spec is in scope when **any** drafted requirement matches one of these:

- **a. Quantifier.** "every" or "each" followed by a built artifact class
  ("every built `SKILL.md` frontmatter SHALL contain a `type` field").
- **b. File-level assertion.** An exit-zero claim, a field-presence claim, a
  layout claim or a content-shape claim ("the linter SHALL exit zero on a clean
  checkout").
- **c. Validation verb on an existing class.** *refuse*, *reject*, *validate*,
  *require*, *mandate*, *disallow*, *enforce* or *forbid* acting on a property of
  an artifact class the codebase already produces ("the build script SHALL
  refuse bundles whose `provenance` block lacks `version`"; no quantifier here,
  so condition c is the one that catches it).
- **d. Catch-all.** The requirement describes the shape or content of an
  existing artifact class, whatever its wording ("the ADR header MUST carry the
  status badge in the second line").

When unsure, treat the spec as in scope: grounding an out-of-scope spec costs
one file read, and skipping an in-scope one brings the drift back.

## Inspection and comparison

1. Name the artifact class in the requirement (for example
   `artifacts/core/skills/*/SKILL.md`); one per class when several are named.
2. Pick at least one real instance, by default the most recently modified file
   of that path (`git log -1 --name-only` scoped to it); more when the class is
   heterogeneous (skills and agents both carry `metadata.provenance`).
3. Read it end to end if short, otherwise the relevant section.
4. Compare with the requirement, looking for a **missing field** (mandated but
   absent from this instance; tell "absent here" from "absent everywhere", see
   below), a **layout divergence** (nesting, ordering, header level) and a
   **path mismatch** (the class lives elsewhere).

You are checking that the WHAT you are about to qualify matches the WHAT in the
codebase, not refactoring the codebase to match the spec.

## Anomaly emission

For each anomaly add one bullet under `## Open questions`, prefixed
`[GROUNDING:]`, in one line naming the observed shape, the drafted requirement
and the reconciliation the reader must take. It blocks exit like any open
question (`[AUTO-PARKED]` in AUTO).

```text
- [GROUNDING:] artifacts/core/skills/spec-author/SKILL.md frontmatter
  has no 'type' field; the drafted R8 mandates it. Reconcile before exit
  - either drop R8, retarget it at another artifact class, or scope the
  back-fill in `## Out of scope`.
```

When everything matches, emit **nothing**: no bullet, no "grounding confirmed"
line. The spec states the WHAT, not the qualification ceremony, and the absence
of an open question is the signal.

## New field on an existing class

When the spec mandates a field that no instance exhibits yet, still inspect, to
confirm that the class exists at the path the spec assumes and that the
instances have a shape the new field can join. Then add a `[GROUNDING:]` bullet
saying the field is absent everywhere and naming who back-fills it: the
implementation PR, a migration PR listed in `## Out of scope`, or a follow-up
ticket. That moves the back-fill decision into the spec-PR instead of leaving it
for implementation time.

```text
- [GROUNDING:] No `artifacts/core/skills/*/SKILL.md` on main carries
  a `type: skill` frontmatter field; the drafted R8 mandates it.
  Back-fill responsibility: the implementation PR for this spec adds
  `type:` to every existing skill source in the same diff.
```
