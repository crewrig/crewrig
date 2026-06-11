# Specification format

This document defines the normative file format for the SPECS stage of
the lifecycle introduced in
[ADR-0010](adr/0010-spec-plan-review-lifecycle.md). It is the contract
that every spec under `/specs/` SHALL satisfy and that downstream
tooling (the `spec-author` skill in issue #168, the routing engine in
issue #172, the future spec linter) will rely on.

The format is intentionally minimal: YAML frontmatter for machine-read
fields, Markdown body for human-read content, a fixed set of mandatory
sections so a reviewer always knows where to look.

## Frontmatter schema

Every spec file SHALL open with a YAML frontmatter block delimited by
`---` lines. Fields are listed below with their type, cardinality, and
constraints. Unknown fields are tolerated by the format but SHOULD NOT
be introduced without first amending this document.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `id` | string | yes | `<NNNN>` zero-padded to four digits, monotonic, allocated by the ticket creator. Must match the filename prefix. |
| `slug` | string | yes | kebab-case, ASCII, no leading/trailing hyphen. Must match the filename slug. |
| `status` | enum | yes | One of `draft`, `approved`, `implemented`, `archived`, `superseded`. |
| `complexity` | enum | yes | One of `trivial`, `small`, `standard`, `large`. Must match an ADR-0010 complexity tier. |
| `interaction-mode` | enum | from `approved` onward | One of `FULL`, `INTERMEDIATE`, `MINIMAL`, `AUTO`. Must match an ADR-0010 interaction mode. MAY be omitted in `draft`, in which case the value defaults to `INTERMEDIATE`; SHALL be present explicitly once the spec reaches `approved`. |
| `related-issue` | integer | yes | The GitHub issue number this spec qualifies (the logbook anchor, per `AGENTS.md` → *Logbook Issues → Rule A*). |
| `version` | semver | yes | Starts at `1.0.0` on the initial spec. Bumps follow the delta-spec convention below. |
| `max-iterations` | integer | no | Overrides the ADR-0010 default of 5. Bounded `[1, 20]` inclusive. Omit to inherit the default. |
| `superseded-by` | string | conditional | Required when `status: superseded`, prohibited otherwise. Value is the `id` of the spec that supersedes this one. |

### Worked frontmatter

```yaml
---
id: "0042"
slug: build-dryrun-flag
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 421
version: 1.0.0
---
```

## Mandatory body sections

A spec body SHALL contain the following five sections, in this order,
each introduced by a level-2 heading. Sections MAY be empty in a draft
but MUST be present (a future linter relies on header presence to
validate format conformance).

### 1. `## Intent`

One paragraph, plain prose, that captures the user-facing WHAT in a
single breath. The intent answers "what would a user notice if this
spec were realised?". HOW words (`by`, `via`, `using`, technology
names, library choices) are forbidden here; they belong in the plan
artefact defined in issue #169.

### 2. `## Requirements`

Numbered list. Each line is a normative statement using either `SHALL`
or `MUST`. Imperatives without a modal verb are forbidden ("the system
sends a notification" is not a requirement; "the system SHALL send a
notification" is). HOW words are forbidden inside a requirement line
for the same reason as in `## Intent`.

Each requirement SHOULD be independently testable. A requirement that
cannot be reduced to a scenario in `## Scenarios` is a smell — either
split it, or move the untestable part to `## Out of scope`.

### 3. `## Scenarios`

Each scenario uses the Given / When / Then form:

```text
**Scenario:** <short title>

Given <pre-condition>
When  <triggering action>
Then  <observable outcome>
```

A spec SHALL include at least one happy-path scenario and at least one
failure-path scenario. Scenarios are the bridge between the spec and
the regression tests that the `tester` agent will produce in DEV; if a
scenario cannot be turned into an automated check, escalate to the
plan stage for a manual-verification clause.

### 4. `## Out of scope`

Bullet list. Each bullet names a behaviour, an integration, or a
boundary that this spec deliberately excludes. The spec reviewer
rejects implicit scope; if a behaviour is not explicitly in
`## Requirements` and not explicitly excluded here, the spec is
under-specified and SHALL be sent back to the author.

This section MAY be empty only for a `trivial`-tier spec.

### 5. `## Open questions`

Bullet list. Captures unresolved questions at authoring time. The
section MAY be empty. If non-empty in a `status: approved` spec, the
reviewer SHALL require written closure on the logbook issue (per
`AGENTS.md` → *Logbook Issues*) before approval — questions left open
in an approved spec are pre-baked `spec`-class findings in the REVIEW
loop and waste a downstream iteration.

## Delta-spec convention

`spec`-class findings produced by the REVIEW loop (per ADR-0010 →
*Finding classification taxonomy*) do not edit the original spec on
`main`. The original's **normative content** is immutable once merged;
corrections chain via delta-spec files. (Lifecycle *metadata* — `status`,
`superseded-by` — and meaning-preserving editorial edits are exempt from this
freeze; see *Lifecycle states → Recording a status transition* and *Editorial
edits*.)

### File layout

```text
/specs/<NNNN>-<slug>.md                # original (immutable on main)
/specs/<NNNN>-<slug>.delta-01.md       # first delta
/specs/<NNNN>-<slug>.delta-02.md       # second delta, builds on delta-01
```

Delta numbers are zero-padded to two digits and allocated monotonically
per parent spec.

### Delta-spec frontmatter

A delta-spec carries the same frontmatter schema as the original, with
two additional constraints:

- `id` SHALL be the parent's id (the file is identified by its
  filename suffix, not by a new id).
- `version` SHALL bump the parent's version per the rules below.
- The delta-spec body replaces the mandatory body sections with the
  three delta sections defined next.

### Delta-spec body sections

```markdown
## ADDED

<requirements, scenarios, or out-of-scope items that the delta introduces>

## MODIFIED

<requirements, scenarios, or out-of-scope items the delta changes; quote the
original line, then show the replacement>

## REMOVED

<items the delta deletes; quote the original line>
```

The three delta sections SHALL be authored at H2 level. The H1 of a
delta-spec file remains the spec's title; no intermediate H2 wrapper
(`## Body`, `## Delta sections`, or any other) SHALL be introduced.

All three sections MUST be present (empty is allowed); the linter will
check for presence, not content. This mirrors the OpenSpec delta
convention so external readers familiar with that vocabulary recognise
the structure.

### Versioning

The `version` field on a delta-spec records the cumulative state of
the parent after the delta lands. Bump per semver intent:

- `PATCH` — clarification, wording fix, scenario added without
  changing any existing requirement.
- `MINOR` — additive normative change (new requirement, new scenario
  that constrains a previously unspecified case).
- `MAJOR` — breaking normative change (requirement modified or
  removed in a way that invalidates an in-flight implementation).

The cumulative version is read from the highest-numbered delta-spec;
the original file's `version` is never edited after merge.

## Lifecycle states

The `status` field tracks where the spec sits in its own life. Each
transition has a single authority and an accompanying artefact; the
table below is the contract.

| `status` | Trigger | Authority | Accompanying artefact |
|---|---|---|---|
| `draft` | Spec file opened in the working branch | Spec author (human or `spec-author` skill) | Spec file in the worktree, no PR yet |
| `approved` | Spec PR merged on `main` | Spec reviewer (per the interaction mode declared in frontmatter) | Merged spec PR + logbook comment recording the approval |
| `implemented` | Implementation PR for `related-issue` merged on `main` | Implementation team's `pr-logbook` | Merged implementation PR + logbook closure comment |
| `archived` | Related issue closed without implementation (`won't fix`, duplicate, abandoned) | Ticket closer | Logbook comment explaining the archival |
| `superseded` | A newer spec replaces this one (often through a `spec`-class loop that grows beyond a delta) | Author of the superseding spec | `superseded-by` field set; superseding spec exists with its own id |

A `status` regression (e.g. `approved` → `draft`) is prohibited; if a
spec must be re-opened, supersede it instead.

### Recording a status transition

The append-only rule (see *Delta-spec convention*) governs a spec's
**normative content** — the body sections (`## Intent`, `## Requirements`,
`## Scenarios`, `## Out of scope`, `## Open questions`) and the identifying
frontmatter fields (`id`, `slug`). It does **not** freeze the
lifecycle-tracking metadata: the `status` and `superseded-by` fields are
*expected* to change after merge, since the table above defines transitions
that occur once the spec PR, the implementation PR, or a superseding spec
lands.

Such a transition SHALL be recorded by a **metadata-only edit** to the
merged spec's frontmatter. The authority named in the table above changes
the `status` field (and sets `superseded-by` when moving to `superseded`)
and touches nothing else — no body line, no `id`, no `slug`, no `version`.
A diff that alters any normative content under cover of a status bump is a
violation. The `version` field stays immutable on the original after merge;
the cumulative version lives on the highest-numbered delta (per
*Versioning*).

This carve-out admits lifecycle metadata. A second, equally narrow carve-out
admits meaning-preserving editorial edits to body prose; it is defined next.

### Editorial edits

Alongside the lifecycle-metadata carve-out above, the append-only rule permits
**meaning-preserving editorial edits** — orthography and typo corrections — to
the body prose of a merged spec. An editorial edit may change the spelling or
surface form of a word but SHALL NOT alter meaning. Permitted: fixing a
misspelling, normalising a British spelling to American, repairing a typo.

Forbidden, still: any change to the substance of a requirement, scenario,
intent, or out-of-scope item. Correcting the spelling of a word inside a
requirement is allowed; changing what that requirement obliges, permits, or
forbids is not. Substantive corrections chain via **delta-specs** (see
*Delta-spec convention*), never as in-place edits — exactly as before this
carve-out. A diff that alters normative meaning under cover of an editorial
fix is a violation, mirroring the same guard on the lifecycle-metadata
carve-out.

This carve-out is deliberately narrow in the same spirit as the
lifecycle-metadata one: it admits surface-form corrections only, leaving every
normative guarantee of the merged spec untouched.

## Naming convention

Spec files live under the top-level `/specs/` directory. The naming
pattern is fixed:

- Original: `/specs/<NNNN>-<kebab-slug>.md`
- Delta: `/specs/<NNNN>-<kebab-slug>.delta-<NN>.md`

`<NNNN>` is the spec id, zero-padded to four digits, allocated
monotonically across the whole repository (not per-year, not
per-component). The ticket creator picks the next free number by
inspecting the existing `/specs/` directory before opening the spec
file. Collisions are resolved by the second author bumping to the next
free number; spec ids are cheap and never reused.

`<kebab-slug>` mirrors the `slug` frontmatter field. The filename slug
and the frontmatter slug SHALL match exactly.

`<NN>` (delta suffix) is zero-padded to two digits and unique within
its parent.

## Linting hints

The format is designed to be machine-checkable. A future spec linter
(not in scope for issue #167) will rely on the invariants below; spec
authors and reviewers SHOULD anticipate them.

- The file SHALL pass `markdownlint-cli` with the project's
  `.markdownlintrc` configuration (CI invocation: `markdownlint
  "**/*.md" --ignore node_modules --ignore extension-skeleton --ignore
  communication`). In particular: no MD018 traps (do not let a wrapped
  line start with `#NNN` at column 1 — write `issue #NNN` or reflow
  the sentence).
- The five mandatory body section headings SHALL be present and SHALL
  appear in the order defined above. Heading text SHALL match
  verbatim (case-sensitive, no trailing punctuation).
- The frontmatter SHALL parse as YAML and SHALL contain every required
  field listed in the schema table.
- For a delta-spec, the three delta section headings (`## ADDED`,
  `## MODIFIED`, `## REMOVED`) SHALL be present in that order, at H2
  level. The H1 of a delta-spec file is the spec title; no
  intermediate H2 wrapper is allowed.
- Enum-valued fields SHALL contain a value from the listed set; any
  other value is a lint error.

Implementing the linter itself, wiring it into CI, and back-filling
existing specs are out of scope for this document and are tracked in
issue #178.
