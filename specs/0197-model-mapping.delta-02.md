---
id: "0197"
slug: model-mapping
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1135
version: 2.1.0
---

# Per-CLI model mapping and core default mappings — delta 02

Authored for issue #1135, follow-up of epic #1100 (recorded at the spec 0200
content gate as point Q3 and in seam (f)'s end-of-seam note on issue #1123).
Modifies the `haiku` offering declaration in `model-mappings/claude.yml` governed
by requirement 36 of spec 0197, flipping `supports-reasoning-surface` from `false`
to `true` and grounding it in live empirical verification rather than an unconfirmed
assumption.

**Context and Problem.** The canonical introductory example of epic #1100 reads
"`medium × medium` → `haiku` at effort `medium`". However, when spec 0197 was authored,
the per-model thinking capability of Claude Code's `haiku` alias was unconfirmed
on disk (`neither claude --help nor artifacts/FORMAT.md states an effort carve-out
for Haiku either way`, spec 0197 R36). In accordance with the conservative discipline
of spec 0197 R36, `model-mappings/claude.yml` declared `haiku` with
`supports-reasoning-surface: false` under an explicit assumption. Consequently,
any profile declaring `intelligence: medium` and a `reasoning` rung resulted in
dropping the reasoning axis (`unsupported-on-model`, spec 0198 R14) rather than
directing it as `effort:` on Claude Code.

**Empirical Verification.** Live execution of Claude Code 2.1.263 confirms that
the `haiku` alias maps to `claude-haiku-4-5-20251001` (Claude 4.5 Haiku), which
natively supports extended thinking. A subagent defined with `model: haiku` and
`effort: medium` executes cleanly without warning or error and emits thinking
tokens (`output_tokens_details.thinking_tokens: 365` observed on live probe).
The per-model carve-out assumption is therefore refuted by direct observation:
Claude Code honours `effort:` alongside `haiku`.

**Emission Consequences.**

1. For existing core agents (`artifacts/core/agents/*/AGENT.md`): None of the 22
   migrated core agent sources declare a `reasoning` axis (spec 0200 Decision 2).
   Their compiled outputs under `.claude/agents/` remain byte-identical (guidance
   sentence naming `haiku`, no `effort:` field).
2. For future profiles or external sources declaring `intelligence: medium` and a
   valid reasoning rung (`low`, `medium`, `high`, `xhigh`, `max`):
   - The shared-read guard (spec 0143 delta-01 R8) withholds the `model:` frontmatter
     key while holding, placing it in guidance prose.
   - The `effort:` frontmatter key is NOT withheld by the guard, so it is directed
     onto the frontmatter surface (e.g. `effort: medium`).
   - The guidance surface template (`Run this agent on the {{model}} model. Give its
     work {{reasoning}} reasoning effort.`) includes both model and reasoning prose.
   - The drop diagnostic `metadata.model.reasoning unsupported-on-model` is eliminated.

**Versioning.** `MINOR` bump (from `2.0.0` to `2.1.0`), per `docs/spec-format.md` ->
*Delta-spec convention -> Versioning*. This change is backward-compatible and additive:
no existing conforming source resolutions are invalidated, and `haiku` gains the
ability to surface declared reasoning effort.

## ADDED

### Added Scenarios

**Scenario:** Profile declaring medium intelligence and medium reasoning directs effort on Claude Code

```text
Given an agent profile declaring intelligence: medium and reasoning: medium
When  the profile resolves against model-mappings/claude.yml
Then  the selected offering is haiku
And   the frontmatter field effort is directed with value medium
And   the compiled guidance prose includes "Give its work medium reasoning effort."
And   no unsupported-on-model drop diagnostic is emitted
```

### Added Out of Scope

- Any change to the 22 core agent source profiles under `artifacts/core/agents/*/AGENT.md` (no source gains a `reasoning` declaration).
- Any change to the Gemini CLI, GitHub Copilot CLI, or Antigravity CLI mapping files.
- Any change to the shared-read guard state or terms (spec 0143 delta-01 R8 stays withheld).

## MODIFIED

### Requirement 36 is replaced

- Original R36:

  > **R36.** The Claude Code mapping SHALL declare exactly four offerings, ranked
  > ascending — `haiku` providing the `medium` rung, `sonnet` the `high` rung,
  > `opus` the `xhigh` rung, and `fable` the `xxhigh` rung — each encoding its
  > `intelligence` rung in its alias and encoding no reasoning rung. It SHALL
  > project the six reasoning rungs onto the `effort` domain identically for
  > `low` through `max` and as unmapped for `none`, and SHALL declare the
  > `haiku` offering as supporting no frontmatter reasoning surface, so that a
  > reasoning rung declared alongside it is ignored rather than emitted or
  > refused. That last declaration SHALL be carried as an assumption on the
  > per-model fact and SHALL cite the content gate of issue #1111 for the
  > behavior.

- Replacement R36:

  > **R36.** The Claude Code mapping SHALL declare exactly four offerings, ranked
  > ascending — `haiku` providing the `medium` rung, `sonnet` the `high` rung,
  > `opus` the `xhigh` rung, and `fable` the `xxhigh` rung — each encoding its
  > `intelligence` rung in its alias and encoding no reasoning rung. It SHALL
  > project the six reasoning rungs onto the `effort` domain identically for
  > `low` through `max` and as unmapped for `none`. It SHALL declare all four
  > offerings, including `haiku`, as supporting the frontmatter reasoning surface
  > (`supports-reasoning-surface: true`), so that a reasoning rung declared
  > alongside `haiku` is directed to `effort:` in frontmatter and to the guidance
  > surface rather than dropped. The `haiku` offering's
  > `supports-reasoning-surface` declaration SHALL be carried as a citation of live
  > verification (observing `claude-haiku-4-5-20251001` in Claude Code 2.1.263 producing
  > thinking tokens under `effort: medium`).

## REMOVED

- None.
