---
id: "0197"
slug: model-mapping
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 1134
version: 2.0.0
---

# Per-CLI model mapping and core default mappings — delta 01

Authored for issue #1134, follow-up of epic #1100 (recorded at the spec 0200
content gate, 2026-09-06, and in seam (f)'s end-of-seam note on issue #1123).
Modifies the offering ranking of `model-mappings/antigravity.yml` governed by
requirement 44 of spec 0197 so that declared intelligence rungs stop resolving to
the low-reasoning variants when no reasoning rung is declared.

**Context and Problem.** Under spec 0197 requirement 44, the Antigravity CLI
mapping declares five composite offerings drawn from `agy models`:
`gemini-3.8-flash-low`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-high`,
`gemini-3.1-pro-low`, and `gemini-3.1-pro-high`. The original specification
ranked them ascending by their suffix (`low` before `medium` before `high`):

- Rank 1: `gemini-3.8-flash-low`
- Rank 2: `gemini-3.8-flash-medium`
- Rank 3: `gemini-3.8-flash-high`
- Rank 4: `gemini-3.1-pro-low`
- Rank 5: `gemini-3.1-pro-high`

Under spec 0200 Decision 2 and delta-01, no core agent source declares a
`reasoning` rung. When an agent profile omits the `reasoning` axis, the
candidate set formed under requirement 17 is not narrowed by requirement 21,
and requirement 23 selects the candidate of **lowest rank**.

Under the original ranking, this lowest-rank selection steered every migrated
core agent on Antigravity CLI onto a low-reasoning variant:

- Agents declaring `medium` intelligence (10 core agents) resolved to
  `gemini-3.8-flash-low` (rank 1).
- Agents declaring `high` or `xhigh` intelligence (12 core agents, including
  `architect`) resolved to `gemini-3.1-pro-low` (rank 4).

The maintainer accepted this in issue #1123 as a temporary state whose fix
belongs to the mapping rather than to the agent sources. Antigravity CLI does
not serve a `gemini-3.1-pro-medium` offering, so high-capability agents should
default to `gemini-3.1-pro-high` rather than being throttled to minimal
reasoning, while medium-capability agents should default to
`gemini-3.8-flash-medium`.

**Re-ranking Decision.** This delta re-ranks the five composite offerings in
`model-mappings/antigravity.yml` as follows:

- **Rank 1**: `gemini-3.8-flash-medium` (`provides.intelligence: medium`, `provides.reasoning: medium`)
- **Rank 2**: `gemini-3.8-flash-low` (`provides.intelligence: medium`, `provides.reasoning: low`)
- **Rank 3**: `gemini-3.8-flash-high` (`provides.intelligence: medium`, `provides.reasoning: high`)
- **Rank 4**: `gemini-3.1-pro-high` (`provides.intelligence: high`, `provides.reasoning: high`)
- **Rank 5**: `gemini-3.1-pro-low` (`provides.intelligence: high`, `provides.reasoning: low`)

**Properties of the new ranking:**

1. **Default resolution for profile without reasoning:**
   - Declared `medium` intelligence forms candidates
     `{gemini-3.8-flash-medium, gemini-3.8-flash-low, gemini-3.8-flash-high}`.
     Rank 1 (`gemini-3.8-flash-medium`) is the lowest rank and is selected.
   - Declared `high`, `xhigh`, `xxhigh`, or `max` intelligence forms
     candidates `{gemini-3.1-pro-high, gemini-3.1-pro-low}`.
     Rank 4 (`gemini-3.1-pro-high`) is the lowest rank and is selected.
   - Declared `minimal` or `low` intelligence has no offerings at those rungs;
     under requirement 17's floor clause all offerings are candidates, and rank 1
     (`gemini-3.8-flash-medium`) is selected.

2. **Resolution when reasoning is explicitly declared (via requirement 21):**
   - Profile `medium` intelligence + `reasoning: low` narrows to
     `gemini-3.8-flash-low` (rank 2).
   - Profile `medium` intelligence + `reasoning: medium` narrows to
     `gemini-3.8-flash-medium` (rank 1).
   - Profile `medium` intelligence + `reasoning: high` narrows to
     `gemini-3.8-flash-high` (rank 3).
   - Profile `high` intelligence + `reasoning: high` narrows to
     `gemini-3.1-pro-high` (rank 4).
   - Profile `high` intelligence + `reasoning: low` narrows to
     `gemini-3.1-pro-low` (rank 5).
   - Profile `high` intelligence + `reasoning: medium` finds no exact match,
     falls back under requirement 21 to the nearest lower rung (`low`), selecting
     `gemini-3.1-pro-low` (rank 5).

**Versioning.** `MAJOR` bump (from `1.0.0` to `2.0.0`), per `docs/spec-format.md` ->
*Delta-spec convention -> Versioning*. Requirement 44 is replaced with an
ordering that changes the model selection verdict for all profiles lacking an
explicit reasoning declaration, invalidating previously conforming
resolutions.

## ADDED

### Added Scenarios

**Scenario:** Profile declaring intelligence medium with no reasoning resolves to flash-medium on Antigravity

```text
Given an agent profile declaring intelligence: medium and no reasoning axis
When  the profile resolves against model-mappings/antigravity.yml
Then  the selected offering is gemini-3.8-flash-medium
And   the compiled guidance prose is "Run this agent on the gemini-3.8-flash-medium model."
```

**Scenario:** Profile declaring intelligence high with no reasoning resolves to pro-high on Antigravity

```text
Given an agent profile declaring intelligence: high and no reasoning axis
When  the profile resolves against model-mappings/antigravity.yml
Then  the selected offering is gemini-3.1-pro-high
And   the compiled guidance prose is "Run this agent on the gemini-3.1-pro-high model."
```

**Scenario:** Profile declaring intelligence medium with explicit reasoning low resolves to flash-low on Antigravity

```text
Given an agent profile declaring intelligence: medium and reasoning: low
When  the profile resolves against model-mappings/antigravity.yml
Then  the selected offering is gemini-3.8-flash-low
And   the compiled guidance prose is "Run this agent on the gemini-3.8-flash-low model."
```

**Scenario:** Profile declaring intelligence high with explicit reasoning low resolves to pro-low on Antigravity

```text
Given an agent profile declaring intelligence: high and reasoning: low
When  the profile resolves against model-mappings/antigravity.yml
Then  the selected offering is gemini-3.1-pro-low
And   the compiled guidance prose is "Run this agent on the gemini-3.1-pro-low model."
```

### Added Out of Scope

- Any change to the agent capability profile vocabulary defined in spec 0195.
- Any change to the 22 core agent source profiles under `artifacts/core/agents/*/AGENT.md` (no source gains a `reasoning` declaration).
- Any change to the Claude Code, Gemini CLI, or GitHub Copilot CLI mapping files (`model-mappings/claude.yml`, `model-mappings/gemini.yml`, `model-mappings/copilot.yml`).
- Any new model identifiers beyond the five Google-family offerings established in spec 0197 requirement 44.

## MODIFIED

### Requirement 44 is replaced

- Original R44:

  > **R44.** The Antigravity CLI mapping SHALL declare exactly five composite
  > offerings, ranked ascending, drawn from the fourteen identifiers `agy models`
  > reports — `gemini-3.8-flash-low`, `gemini-3.8-flash-medium` and
  > `gemini-3.8-flash-high` each providing the `medium` rung and encoding the
  > reasoning rung their suffix names, and `gemini-3.1-pro-low` and
  > `gemini-3.1-pro-high` each providing the `high` rung and likewise encoding
  > their suffix. It SHALL declare no offering naming a model outside the Google
  > family, on the ground the maintainer gave at the content gate of issue #1111
  > — the plan under which Antigravity CLI serves those models is markedly less
  > generous than the one serving the Google family — and that ground SHALL be
  > recorded as a citation of the gate rather than as an assumption. The `high`
  > rung is therefore the highest rung this mapping declares, so a declared
  > `xhigh`, `xxhigh` or `max` rung selects between the two `gemini-3.1-pro`
  > offerings under the ceiling clause of requirement 17 rather than reaching
  > any non-Google model. It SHALL record the remaining nine observed
  > identifiers as evidence it declares no offering for, and SHALL carry every
  > rung assignment as an assumption.

- Replacement R44:

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

### Effect on compiled agent outputs

The re-ranking modifies the compiled `description` guidance sentence for all 22
migrated core agents on Antigravity CLI (`.agents/agents/<name>/AGENT.md`),
leaving all other targets byte-identical:

1. **The 10 `medium`-rung agents** resolve to `gemini-3.8-flash-medium` (was `gemini-3.8-flash-low`):
   - `accessibility-auditor`
   - `accessibility-tester`
   - `copywriter`
   - `doc-writer`
   - `pr-logbook`
   - `regression-sentinel`
   - `scenario-author`
   - `seo-specialist`
   - `visual-regression-tester`
   - `web-conformity-checker`

2. **The 12 `high`-rung and `xhigh`-rung agents** resolve to `gemini-3.1-pro-high` (was `gemini-3.1-pro-low`):
   - `architect` (`xhigh`)
   - `astro-developer` (`high`)
   - `ci-configurator` (`high`)
   - `ci-debugger` (`high`)
   - `ci-parity` (`high`)
   - `designer` (`high`)
   - `developer` (`high`)
   - `frontend-developer` (`high`)
   - `pr-reviewer` (`high`)
   - `security` (`high`)
   - `spec-author` (`high`)
   - `tester` (`high`)

3. **The 1 profile-less agent (`harness-curator`)** carries no `metadata.model:` block and remains unchanged.

## REMOVED

- None.
