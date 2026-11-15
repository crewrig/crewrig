---
id: "0197"
slug: model-mapping
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 2040
version: 3.0.0
---

# Per-CLI model mapping and core default mappings — delta 03

Authored for issue #2040, follow-up of epic #1100. Decision of the owner,
2026-11-15: the spec SHALL stop pinning model names.

**Context and Problem.** Requirement 39 of spec 0197 names three Gemini CLI
models, and requirement 44 (as replaced by delta-01) names five Antigravity CLI
models and their ranks. Vendors retire and add model identifiers faster than a
spec can be amended, so each lineup change forces a `MAJOR` spec change for a
fact that is data. The model list already lives in `model-mappings/<cli>.yml`,
where every offering carries a citation or an assumption (requirement 5). The
authoring-time check of requirements 46 through 49 verifies shape and sources,
not names.

**Decision.** The spec keeps the invariants that outlive any lineup and no
longer names a model in a requirement. The model list lives only in the mapping
file, each offering justified by its own `grounds:` entry. The implementing PR
of #2040 refreshes `model-mappings/gemini.yml` and
`model-mappings/antigravity.yml` to the owner's current lineup, for example a
medium rung and a high rung and an `xhigh` rung on Gemini CLI, and on
Antigravity CLI composite offerings, each encoding a reasoning suffix, at the
`medium`, `high` and `xhigh` rungs. That example is motivating context, not
normative. Tests and fixtures that pin the old names are updated in that PR.

**Not changed.** Requirements 24, 25, 40, 43, 49 and the resolver stay as they
are. Requirement 49's selection totality is not weakened: the replacements
below restate it for these two mappings, they do not relax it. Spec 0195
requirement 7 reads Claude anchors only and needs no change.

**Versioning.** `MAJOR` bump (from `2.1.0` to `3.0.0`) per `docs/spec-format.md`
-> *Delta-spec convention -> Versioning*: two requirements are replaced in a way
that invalidates the pinned lineup an in-flight implementation or fixture may
assert.

## ADDED

### Added Requirement

- **R52.** A requirement of this spec, or of its deltas, SHALL NOT be the
  place where a model identifier is pinned for a core default mapping. Where a
  core default mapping's offering set changes, the change SHALL be made in
  `model-mappings/<cli>.yml` alone, each added or retained offering carrying
  its own citation or assumption under requirement 5, and SHALL NOT require a
  delta-spec. Every `intelligence` rung a core agent declares SHALL resolve to
  an offering, directly or through requirement 17's highest-declared-rung
  fallback, which records no drop on that axis; the check of requirement 49
  stays the gate.

### Added Scenarios

**Scenario:** an offering is swapped without a spec change

```text
Given the Gemini CLI core default mapping
When  a maintainer replaces one offering with another in the mapping file
And   the new offering carries a citation or an assumption and a rank not
      already used
Then  the check of requirements 46 through 48 accepts the file
And   no delta-spec is required
```

**Scenario:** an offering with neither citation nor assumption is rejected

```text
Given a core default mapping gaining an offering that carries neither a
      citation nor an assumption
When  the check of requirement 47 runs
Then  the mapping is rejected, whatever the identifier the offering names
```

### Added Out of Scope

- Modelling a reasoning surface for Antigravity CLI. It is a follow-up.
- Any change to requirements 24, 25, 43 and 49, to the checker assertions, or to
  the resolver.
- Any change to spec 0195.

## MODIFIED

### Requirement 39 is replaced

- Original R39:

  > **R39.** The Gemini CLI mapping SHALL declare exactly three offerings, ranked
  > ascending — `gemini-3.1-flash-lite` providing the `low` rung,
  > `gemini-3.5-flash` the `medium` rung, and `gemini-3.1-pro-preview` the
  > `high` rung — each encoding its `intelligence` rung in its family name and
  > encoding no reasoning rung.

- Replacement R39:

  > **R39.** The Gemini CLI mapping SHALL declare its offerings, each with a
  > distinct rank and an `intelligence` rung, in `model-mappings/gemini.yml`,
  > each justified by its own citation or assumption (requirement 5). No
  > offering SHALL encode a reasoning rung, and every offering SHALL declare
  > `supports-reasoning-surface: false`, since the mapping declares no
  > frontmatter reasoning item (requirement 25). A declared reasoning rung is
  > dropped with the reason `unsupported-on-cli`, because no surface of this
  > mapping expresses reasoning (requirement 40). Every `intelligence` rung a
  > core agent declares SHALL resolve to an offering, directly or through the
  > highest-declared-rung fallback of requirement 17, which records no drop on
  > that axis; requirement 49 stays the gate. Every rung assignment that rests on no vendor measurement
  > SHALL be carried as an assumption bearing the date it was made. The empty
  > offering set remains permitted, as requirement 41 does for another target.

### Requirement 44 is replaced

- Original R44 (as replaced by delta-01):

  > **R44.** The Antigravity CLI mapping SHALL declare exactly five composite
  > offerings drawn from the fourteen identifiers `agy models` reports —
  > `gemini-3.8-flash-medium` (rank 1), `gemini-3.8-flash-low` (rank 2), and
  > `gemini-3.8-flash-high` (rank 3), each providing the `medium` intelligence
  > rung and encoding the reasoning rung their suffix names; and
  > `gemini-3.1-pro-high` (rank 4) and `gemini-3.1-pro-low` (rank 5), each
  > providing the `high` intelligence rung and likewise encoding their suffix.
  > Under requirement 23's lowest-rank selection, a candidate set omitting an
  > explicit reasoning declaration selects `gemini-3.8-flash-medium` at the
  > `medium` intelligence rung and `gemini-3.1-pro-high` at the `high`, `xhigh`,
  > `xxhigh`, and `max` intelligence rungs. It SHALL declare no offering naming
  > a model outside the Google family, on the ground the maintainer gave at the
  > content gate of issue #1111 — the plan under which Antigravity CLI serves
  > those models is markedly less generous than the one serving the Google family
  > — and that ground SHALL be recorded as a citation of the gate rather than as
  > an assumption. The `high` rung is therefore the highest rung this mapping
  > declares, so a declared `xhigh`, `xxhigh` or `max` rung selects between the
  > two `gemini-3.1-pro` offerings under the ceiling clause of requirement 17
  > rather than reaching any non-Google model. It SHALL record the remaining nine
  > observed identifiers as evidence it declares no offering for, and SHALL
  > carry every rung assignment as an assumption.

- Replacement R44:

  > **R44.** The Antigravity CLI mapping SHALL declare its offerings, each with
  > a distinct rank and an `intelligence` rung, in
  > `model-mappings/antigravity.yml`, each justified by its own citation or
  > assumption (requirement 5), drawn from the identifiers `agy models`
  > reports. It SHALL declare only offerings naming a Google-family model, on
  > the ground the maintainer gave at the content gate of issue #1111 — the plan
  > under which Antigravity CLI serves non-Google models is markedly less
  > generous than the one serving the Google family — and that ground SHALL be
  > recorded as a citation of the gate rather than as an assumption. It SHALL
  > record every observed identifier it declares no offering for as evidence,
  > with the ground for leaving it undeclared. An offering whose native
  > identifier encodes a reasoning rung SHALL be composite and SHALL provide the
  > rung it encodes (requirement 48). Every offering SHALL declare
  > `supports-reasoning-surface: false`, since the mapping declares no
  > frontmatter surface (requirements 25 and 43); a declared reasoning rung
  > that the selected offering does not encode is therefore not directed onto
  > any surface and is dropped with the reason `unsupported-on-cli`. Every
  > `intelligence` rung a core agent declares SHALL resolve to an offering,
  > directly or through the highest-declared-rung fallback of requirement 17,
  > which records no drop on that axis; requirement 49 stays the gate. Under requirement 23 the lowest-ranked candidate is
  > selected, so the ranks SHALL be authored such that a profile declaring no
  > reasoning axis selects the offering the maintainer intends as the default
  > for its rung, and that choice SHALL be carried in the mapping. Every rung
  > assignment that rests on no vendor measurement SHALL be carried as an
  > assumption bearing the date it was made.

### Scenarios pinning model names are replaced

Each original scenario below keeps its title and its intent, and its Given,
When and Then now name no model: the selected offering is described by the
characteristics it provides and encodes.

- Original (spec 0197) **a composite offering serves reasoning through model
  selection**, and **an inexact encoded match is noted, not dropped**, which
  name `gemini-3.8-flash-high` and `gemini-3.1-pro-low`; and original (spec
  0197) **an item no in-band surface expresses is dropped** and **a
  specialization no offering serves falls back to general**, which name
  `gemini-3.5-flash` and `gemini-3.1-pro-preview`.

- Replacement scenarios:

  **Scenario:** a composite offering serves reasoning through model selection

  ```text
  Given an agent source declaring intelligence: medium and reasoning: high
  And   the Antigravity CLI core default mapping, whose composite offerings at
        the medium rung encode more than one reasoning rung including high
  When  that profile is resolved against the mapping
  Then  the selection names the offering at the medium rung whose encoded
        reasoning rung is high
  And   no drop record is emitted for the reasoning axis
  And   the model item is directed onto the guidance surface
  ```

  **Scenario:** an inexact encoded match is noted, not dropped

  ```text
  Given an agent source declaring intelligence: <rung> and reasoning: <r>
  And   the Antigravity CLI core default mapping, whose candidate offerings at
        that rung encode reasoning rungs none of which equals <r>
  When  that profile is resolved against the mapping
  Then  the selection names the candidate encoding the nearest rung below <r>,
        otherwise the nearest above
  And   one diagnostic note names the declared rung and the encoded rung
  And   no drop record is emitted
  ```

  **Scenario:** an item no in-band surface expresses is dropped

  ```text
  Given an agent source declaring intelligence: <rung> and reasoning: high
  And   the Gemini CLI core default mapping, which declares no guidance surface
  When  that profile is resolved against the mapping
  Then  the selection names the offering the mapping ranks lowest among those
        at or above <rung>, or, where no offering reaches <rung>, among those at
        the highest rung the mapping declares
  And   the reasoning rung is dropped with the reason unsupported-on-cli
  And   no value is directed onto the out-of-band surface the mapping names
  ```

  **Scenario:** a specialization no offering serves falls back to general

  ```text
  Given an agent source declaring intelligence: high and specialization:
        image-generation
  And   the Gemini CLI core default mapping, whose offerings serve only the
        general specialization
  When  that profile is resolved against the mapping
  Then  the selection is unchanged by the specialization narrowing
  And   one drop record is emitted with the reason unserved-value
  ```

- Original (delta-01) scenarios **Profile declaring intelligence medium with no
  reasoning resolves to flash-medium on Antigravity**, **... high with no
  reasoning resolves to pro-high on Antigravity**, **... medium with explicit
  reasoning low resolves to flash-low on Antigravity** and **... high with
  explicit reasoning low resolves to pro-low on Antigravity**, which name the
  selected offering and quote the guidance prose `Run this agent on the
  <model> model.` with a concrete model.

- Replacement scenario, standing for all four:

  **Scenario:** an Antigravity profile resolves to the mapping's declared offering

  ```text
  Given an agent profile declaring intelligence: <rung> and, optionally,
        reasoning: <r>
  When  the profile resolves against model-mappings/antigravity.yml
  Then  the selected offering is the lowest-ranked candidate left by the
        narrowings of requirements 17, 19 and 21
  And   the compiled guidance prose is "Run this agent on the <native id of
        that offering> model."
  ```

### Open questions of the base spec are restated

- Original (two `[GROUNDING:]` bullets of spec 0197): the **confirm** bullet
  tying the rung assignments to "the three Gemini offerings in requirement 39
  and the five Antigravity offerings in requirement 44", and the **audit**
  bullet on "five of the fourteen identifiers", which names the nine
  undeclared identifiers.

- Replacement: the rung assignments of the Gemini CLI and Antigravity CLI
  mappings rest on the vendors' own family naming where no measurement exists;
  each such assignment SHALL be a dated assumption in the mapping file
  (requirements 39 and 44). The identifiers an Antigravity mapping leaves
  undeclared, and the ground for each, are recorded in the mapping file as
  observed evidence, not in this spec.

### Effect on compiled agent outputs

The implementing PR changes the compiled guidance and frontmatter model values
of the core agents on Gemini CLI and Antigravity CLI to the refreshed lineup;
the other targets stay byte-identical. The "22 migrated agents" effect list of
delta-01 describes a point-in-time resolution, not a requirement.

## REMOVED

- None.
