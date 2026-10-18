# Pre-write grounding

## Pre-write grounding

Before writing the `## Requirements` section of a spec that qualifies
a **verification, audit, or sanity-check tool** whose acceptance is
file-level, run a short grounding pass against the codebase. The pass
realizes R16 of
[`specs/0002-spec-author-skill.md`](../../../../../specs/0002-spec-author-skill.md)
(introduced by delta-03) and exists because the friction reported in
issue #194 — spec 0007 mandated a `type` field that no built artifact
ever exhibited, discovered only at DEV time — proves that a WHAT
qualified in isolation from the actual code drifts. The grounding
step is the cheap safety net that catches the drift at qualification
time.

**Mode applicability.** The grounding step runs in all four
interaction modes — `MINIMAL`, `INTERMEDIATE`, `FULL`, and `AUTO`.
In `AUTO` the user has no interactive surface to challenge the
requirements list before the spec PR opens, so grounding is the only
catcher; any anomaly bullet emitted in `AUTO` carries the
`[AUTO-PARKED]` discipline of R10 and is audited post hoc via the PR
diff. A residual risk remains in `AUTO` — a missed-in-scope
classification produces no bullet at all and no `[AUTO-PARKED]`
entry to audit — acknowledged in spec 0002 delta-03's `### Risks`
section.

### Detection

Classify the spec as in-scope for grounding when ANY of the four
conditions below holds for any drafted requirement. Use the
disjunction, not a conjunction — a single match flips the spec
in-scope.

- **a. Quantifier pattern.** The requirement contains *"every"* or
  *"each"* followed by a noun naming a built artifact class.
  Example: *"every built `SKILL.md` frontmatter SHALL contain a
  `type` field"* — `every` + `SKILL.md frontmatter` triggers.
- **b. File-level assertion.** The requirement asserts a property at
  the file level: an `exit zero`-style claim, a field-presence claim,
  a layout claim, or a content-shape claim. Example: *"the linter
  SHALL exit zero on a clean checkout"* — file-level outcome triggers.
- **c. Validation-verb on existing class.** The requirement uses a
  validation, rejection, refusal, or enforcement verb (*refuse*,
  *reject*, *validate*, *require*, *mandate*, *disallow*, *enforce*,
  *forbid*) acting on a property of an artifact class the codebase
  already produces. Example (the iter:1 reviewer counter-example
  that motivated this clause): *"the build script SHALL refuse to
  publish bundles whose `provenance` block is missing the `version`
  field"* — `refuse` + property of `bundles` (an existing class)
  triggers via condition c. Note that condition a does NOT fire here
  (no `every` / `each`); condition c is the catcher.
- **d. Semantic catch-all.** The drafted requirement describes the
  shape, structure, or content of a class of artifacts the codebase
  already produces, regardless of surface wording. Example: *"the
  ADR header MUST carry the status badge in the second line"* — no
  quantifier, no validation verb, but the requirement targets the
  shape of an existing class.

**False-positive preference.** When uncertain whether a requirement
triggers any of the four conditions, treat it as in-scope and run the
grounding step. Grounding ceremony in an out-of-scope case costs one
extra file read; grounding skipped in an in-scope case re-introduces
the original #194 friction. Bias accordingly.

### Inspection

When the spec is in-scope:

1. **Pick the artifact class.** Read the noun in the drafted
   requirement (e.g. *"every built SKILL.md frontmatter"* →
   `artifacts/core/skills/*/SKILL.md`). When the requirement names
   multiple classes, pick one per class.
2. **Pick at least one real instance.** A safe default is the
   most-recently-modified file under the class's canonical path
   (`git log -1 --name-only` scoped to the path). Choose more
   instances when the class is heterogeneous (e.g. skills and
   agents both ship `metadata.provenance` — inspect one of each).
3. **Read the instance end-to-end** when the file is short, or read
   the relevant section (frontmatter, header block, target field)
   when the file is long. Use the same `Read` / equivalent tool the
   skill already uses for repository content; no new tooling
   required.

### Comparison

Cross-check the observed shape against the drafted requirement. Look
specifically for:

- **Missing fields.** The requirement mandates a field that the
  observed instance does not exhibit. (The #194 origin case — spec
  0007's `type` field.) Distinguish "absent from this instance" from
  "absent from every instance" — the latter is the *New field on
  existing class* path below.
- **Layout divergence.** The requirement implies a structural layout
  (field nesting, section ordering, header level) the observed
  instance does not match.
- **Path mismatch.** The requirement assumes a canonical path
  (`artifacts/core/skills/<name>/SKILL.md`) that does not match
  where the class actually lives in the codebase.

The comparison is informational — the skill is checking that the
WHAT it is about to qualify matches the WHAT already in the codebase,
not refactoring the codebase to match the spec.

### Anomaly emission

When the comparison surfaces an anomaly, emit a single bullet under
`## Open questions` prefixed `[GROUNDING:]`. The bullet blocks skill
exit per R10's open-question discipline (`MINIMAL` / `INTERMEDIATE` /
`FULL`) or lands as `[AUTO-PARKED]` (`AUTO`). One bullet per anomaly,
each one one line, naming the observed shape, the drafted requirement,
and the reconciliation that the user (or AUTO-mode audit reader) must
take.

Worked example:

```text
- [GROUNDING:] artifacts/core/skills/spec-author/SKILL.md frontmatter
  has no 'type' field; the drafted R8 mandates it. Reconcile before exit
  — either drop R8, retarget the requirement at a different artefact
  class, or scope the back-fill in `## Out of scope`.
```

The bullet names enough context for the reader to act without
re-reading the inspection trail: which file was inspected, what the
delta is, what the next decision is.

### Conforming-case silence

When the inspection confirms the observed shape matches the drafted
requirements, emit **nothing**. No `[GROUNDING:]` bullet, no
"grounding confirmed" line, no audit trail in the spec body. The
absence of pushback is the only signal. This keeps the spec lean —
the spec body documents the WHAT, not the qualification ceremony —
and the grounding step is auditable from the absence of an open
question, not from a manufactured marker.

### New field on existing class

When the spec mandates a field, attribute, or property that no
instance of the artifact class currently exhibits on `main` (the
PR-189 scenario that originated this discipline), still run the
inspection. The purpose is no longer to confirm field presence
(absent by definition) but to confirm two adjacent facts:

- The artifact class genuinely exists in the codebase under the
  path the spec assumes — no typo, no stale path.
- The existing instances have a coherent shape into which the new
  field can be added without breaking the structure.

Emit a `[GROUNDING:]` bullet under `## Open questions` stating
explicitly that the field is absent from every existing instance and
naming who is responsible for the back-fill: the implementation PR
that realizes this spec, a migration PR scoped under `## Out of
scope`, or a separate follow-up ticket. This forces the back-fill
scope decision into the spec PR rather than deferring it to DEV time.

Worked example:

```text
- [GROUNDING:] No `artifacts/core/skills/*/SKILL.md` on main carries
  a `type: skill` frontmatter field; the drafted R8 mandates it.
  Back-fill responsibility: the implementation PR for this spec SHALL
  add `type:` to every existing skill source in the same diff.
```
