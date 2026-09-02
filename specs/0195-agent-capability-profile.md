---
id: "0195"
slug: agent-capability-profile
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1109
version: 1.0.0
---

# CLI-agnostic agent capability profile

Authored for issue #1109, seam (a) of epic #1100 (CLI-agnostic model
declaration for subagents). It defines the vocabulary an agent source uses to
state the model its work needs, and nothing else. The per-CLI mapping files
and their resolution rules are seam (c), the build that consumes them is seam
(d), the organization-level override channel is seam (e), the migration of the
existing agent sources is seam (f), and the compiled-layout convention is
seam (g). Seam (b) — the reconciliation of spec 0143 — is already merged, and
this spec depends on it: the semantics of an absent profile are exactly the
fallback path that
[`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md)
requirement 6 establishes.

**Vocabulary.** A **capability profile** is the set of characteristics one
agent source declares about the model its work needs. An **axis** is one named
characteristic of that set. A **rung** is one value of an ordered axis, and an
**anchor** is a model named in this document solely to calibrate a rung — never
a mapping entry and never a value an agent source may write. A
**generation-tuning knob** is a parameter that configures a model's generation
rather than selecting a model. A **target** is one pair of a supported CLI and
the model a resolution names for it. To **drop** a declared item is to omit it
from what a target receives, without substituting anything for it. A
**model-mapping resolution** is the term spec 0143 delta-01 defines: the
outcome, for one agent and one CLI, of resolving that agent's capability
profile against the mapping in force for that CLI. This spec defines the
profile that such a resolution reads; it defines neither the mapping nor the
resolution.

**The intelligence rungs and their anchors** (normative):

| Rung | Value | Anchor |
|---|---|---|
| 1 | `minimal` | none — below the `haiku` anchor (on-device and nano-class offerings) |
| 2 | `low` | none — below the `haiku` anchor (flash-lite-class offerings) |
| 3 | `medium` | Claude Code `haiku` |
| 4 | `high` | Claude Code `sonnet` |
| 5 | `xhigh` | Claude Code `opus` |
| 6 | `xxhigh` | Claude Code `fable` |
| 7 | `max` | none — headroom above the `fable` anchor |

**Decision 1 — semantic tokens, one spelling per value.** The rungs are named,
not numbered, and no numeric alias is admitted. Two reasons. First, the
canonical example of epic #1100 — *intelligence `medium` × reasoning `medium`
resolves on Claude Code to `haiku` at `medium` reasoning* — has to be a
sentence an agent source can write; `intelligence: 3` does not read as that
sentence, and a reader would have to consult a table to learn what `3` means,
which is the very opacity that made `metadata.claude.model: sonnet`
uninterpretable to a fork targeting another CLI. Second, the repository already
has the precedent this axis should follow: the ADR-0010 complexity tiers are
`trivial | small | standard | large`, semantic tokens with a normative
characteristic-to-behavior table, and epic #1100 cites them by name as the
model to imitate. An alias table was considered and rejected: two spellings for
one value force every consumer — mappings, diagnostics, drop records, drift
guards — to normalize before comparing, and leave reviewers arguing about which
spelling a diff should use. The ordinal index 1 through 7 is retained, because
degradation and diagnostics need a total order to speak about, but it is a
property of the scale rather than a value an agent source may write. The
ladder `minimal < low < medium < high < xhigh < xxhigh < max` is derivable
rather than memorized: it extends the five-token magnitude ladder that Claude
Code's own `effort` field and Gemini 3's `thinking_level` already share, by one
rung below and one rung between `xhigh` and the ceiling. `max` names the
ceiling of whichever axis carries it, which is why the `fable` anchor sits at
`xxhigh` and the headroom rung above it takes the ceiling name.

**Decision 2 — `none` is a distinct reasoning rung, not a synonym for `low`.**
Non-thinking models exist, and one supported CLI already exposes the state
natively: Gemini 3's `thinking_level` admits `off`, alongside `low`, `medium`,
`high` and `max`, while Claude Code's `effort` floor is `low` and is not
accepted at all on Haiku (environment evidence, not a normative dependency).
Collapsing `none` into `low` would leave a native value unreachable from the
vocabulary, which makes the vocabulary lossy against a surface that exists
today. `none` is also not the same statement as omitting the axis: omission
places no constraint and lets whatever default the target carries stand, while
`none` is an active request to run without extended chain-of-thought, honored
where a target has an off switch and dropped — not lowered to `low` — where it
has none.

**Decision 3 — no `auto` value.** The vocabulary stays deterministic. An
ordered axis whose members are comparable cannot also carry a member that
compares with nothing; every mapping table, degradation rule, linter and
diagnostic would have to special-case it forever. The state `auto` would name
is already reachable and already the default: omit the axis, or omit the whole
profile, and the target's own default — which on Gemini CLI and Copilot CLI is
their Auto router — decides. Adding `auto` would therefore be a second spelling
for an existing state, the same objection that rejected the numeric aliases.
Two of the four supported CLIs expose no per-agent Auto router at all, so the
value would be unmappable on half the matrix from the day it shipped. Should a
profile ever need to *force* a router against a differing session default,
admitting it later is an additive change this document's own extension rule
already permits.

**Decision 4 — four generation-tuning knobs, and the drop is reported on the
resolver's diagnostic stream.** A knob is admitted only where it is defined
compatibly across the major inference surfaces and configures generation rather
than selecting a model or bounding the harness: `temperature`, `top-p`,
`top-k`, `max-output-tokens`. Gemini CLI's agent frontmatter already accepts
`temperature`, which is the existing native surface the block is calibrated
against. `seed`, `presence-penalty` and `frequency-penalty` are rejected as
single-vendor or speculative; `stop-sequences` is rejected because an agent
source that constrains the token stream can break the host CLI's own protocol;
`max-turns` is rejected because it bounds the harness's orchestration rather
than the model's generation, and admitting it would blur what the block means.
The knobs take the kebab-case spelling the repository's frontmatter already
uses, not the snake_case of the underlying APIs. The report of a drop belongs
on the diagnostic output of whatever performs the resolution, one record per
dropped item, and never inside a compiled agent output: an output carrying
build commentary is an output whose drift guard now depends on that commentary.
Whether the diagnostic stream is additionally persisted as a committed report
is a build concern, and so belongs to seam (d).

**Decision 5 — closed keys, open specialization values, hermetic validation.**
An unknown key under the profile is rejected, not warned about and not ignored.
The surface is a closed, committed, authored one with a single consumer, so an
unknown key is either a typo that silently discards the author's intent or an
extension that never passed through a spec — and this repository has already
paid for the first failure mode once, with `metadata.claude.model` sitting in
23 sources that no build step ever read. An unknown *value* of `specialization`
is a different matter and stays legal, because the maintainer made that axis an
open enum: a validator that conflates an unrecognized key with an unrecognized
open-enum value would reject the axis's whole point. Validation stays hermetic
— decidable from the source file and this document's domains alone — which
means a profile no mapping serves is valid, not broken; being unserved is a
degradation the drop rule handles, not an authoring error.

**Complexity tier — `small`, not `standard`.** The tier drives DEV team
composition, and what this spec's implementation does is document the block on
the format surface: `artifacts/FORMAT.md`, with the co-maintenance that
`AGENTS.md` requires of any change under `artifacts/`. There is no code path to
write and none to change — the build splices only `metadata.provenance` into
compiled outputs and reads no other `metadata` key, and no check script
validates component frontmatter against a closed schema, so a profile added to
a source is inert until seam (d) reads it. There is likewise no behavior to
test: the validation check this spec specifies is built in seam (d) or (f), and
every consumer of the vocabulary is a later seam. The design risk that would
argue for an architect is discharged here, at SPECS, where the five decisions
above are recorded and reviewed; were implementation to surface an
architectural question anyway, ADR-0010 routes that as an `arch` finding
through the PLAN loop with an updated team.

## Intent

An agent source states the model its work needs in terms that stay meaningful
without knowing which command-line interface will run the agent, which vendor
supplies the model, or which model families exist this quarter: how much raw
capability the work demands, how much chain-of-thought depth, what
specialization, what context window, what throughput, what modalities, what
locality — and, optionally, the generation settings the work wants. An agent
source that states nothing keeps exactly the behavior it has today. A statement
that a given target cannot honor is dropped rather than approximated, and every
drop is visible to whoever ran the resolution.

## Requirements

1. An agent source SHALL be able to declare the model its work needs as a
   capability profile under a single `metadata.model:` mapping in its
   frontmatter, sibling of `metadata.provenance:`.
2. A capability profile SHALL be interpretable without reference to any
   particular CLI, vendor, or model. The vocabulary SHALL admit no concrete
   model identifier, no model-family alias, and no CLI-namespaced key; every
   declarable value SHALL state a characteristic a model must have rather than
   name a model that has it.
3. An agent source that carries no `metadata.model:` mapping SHALL keep the
   behavior in force before this vocabulary exists — session-model inheritance
   — which is the fallback path that requirement 6 of
   `specs/0143-copilot-subagent-model-fallback.delta-01.md` establishes. This
   vocabulary SHALL NOT make a profile mandatory on any agent source.
4. A `metadata.model:` mapping that declares no axis and no tuning knob SHALL
   be indistinguishable in meaning from an absent one.
5. Every axis SHALL have a state that places no constraint on a resolution, and
   omitting that axis from a present `metadata.model:` mapping SHALL select
   that state.
6. The `intelligence` axis SHALL be a totally ordered scale of exactly seven
   rungs, declared by the values `minimal`, `low`, `medium`, `high`, `xhigh`,
   `xxhigh` and `max` in that ascending order. The scale SHALL carry an ordinal
   index of 1 through 7 in that same order, for the ordering, degradation and
   diagnostic needs of later seams; the index SHALL NOT be a declarable value,
   and no numeric or alternative spelling of a rung SHALL be admitted.
7. The `intelligence` rungs SHALL carry the anchors recorded in the table *The
   intelligence rungs and their anchors* above, which is normative. An anchor
   SHALL be read as a calibration point for authors, and SHALL NOT be read as a
   mapping entry, as a guarantee that a resolution selects that model, or as a
   value an agent source may declare.
8. An `intelligence` rung that no anchor names SHALL be a valid declaration.
9. The `reasoning` axis SHALL be a totally ordered scale of exactly six values,
   declared by `none`, `low`, `medium`, `high`, `xhigh` and `max` in that
   ascending order, stating the chain-of-thought depth the agent's work needs.
10. `reasoning: none` SHALL state that the work requires no extended
    chain-of-thought, SHALL be distinct in meaning from `reasoning: low`, and
    SHALL be distinct in meaning from omitting the axis. Where a target
    expresses no such state, `reasoning: none` SHALL be dropped and SHALL NOT
    be resolved to `low` or to any other value.
11. The `specialization` axis SHALL be an open enum of kebab-case tokens
    naming a domain of work, whose unconstrained state is the value `general`.
    A value this vocabulary does not enumerate SHALL be a valid declaration.
12. The `context` axis SHALL be a positive integer count of tokens, read as the
    minimum context window the work needs. Its unconstrained state SHALL be the
    absence of the axis, and SHALL NOT be spelled as a token count.
13. The `speed` axis SHALL admit exactly the values `standard` and `fast`,
    stating whether the work prefers throughput over the ordinary latency of
    the resolved rung; `standard` SHALL be its unconstrained state.
14. The `modalities` axis SHALL be a list of tokens drawn from exactly
    `text`, `vision` and `image-out`. `text` SHALL denote the baseline every
    model provides and SHALL place no constraint; an empty list SHALL be
    indistinguishable in meaning from the list `[text]` and from the absence of
    the axis.
15. The `locality` axis SHALL admit exactly the values `any` and `local-only`,
    stating whether the work requires a model served by a locally hosted or
    self-hosted provider; `any` SHALL be its unconstrained state.
16. Generation-tuning knobs SHALL be declared under a single `tuning:` mapping
    nested inside `metadata.model:`, and SHALL be exactly `temperature` (a
    number, `0.0` to `2.0` inclusive), `top-p` (a number, greater than `0.0`
    and at most `1.0`), `top-k` (an integer of at least `1`) and
    `max-output-tokens` (an integer of at least `1`). An empty `tuning:`
    mapping SHALL be indistinguishable in meaning from an absent one.
17. A generation-tuning knob SHALL configure a model's generation. No parameter
    whose effect is to select a model, or to bound the harness's own
    orchestration of an agent, SHALL be admitted into the `tuning:` mapping.
18. The keys admitted under `metadata.model:` SHALL be exactly `intelligence`,
    `reasoning`, `specialization`, `context`, `speed`, `modalities`,
    `locality` and `tuning`, and the keys admitted under `tuning:` SHALL be
    exactly the four of requirement 16. Admitting a further axis, rung, or
    knob SHALL require a delta of this spec.
19. A declared axis constraint or tuning knob that a target cannot express
    SHALL be dropped. It SHALL NOT be approximated: no clamping to a range the
    target accepts, no substitution of an adjacent rung or value, and no
    emission of a nearest equivalent.
20. Every drop SHALL be recorded as one record naming the agent, the target
    CLI, the dotted path of the declared key, the declared value, and one
    reason drawn from exactly `unsupported-on-cli`, `unsupported-on-model`,
    `out-of-range-for-target` and `unserved-value`.
21. Drop records SHALL be emitted on the diagnostic output of whatever performs
    the resolution, and SHALL NOT be placed inside any compiled agent output.
    A drop SHALL NOT fail a resolution, and the set of records SHALL be a
    deterministic function of the agent sources and the mapping in force.
22. A declared capability profile SHALL be verifiable by a check that is
    hermetic: decidable from the agent source and the domains this document
    defines alone, without network access, without an installed CLI, and
    without consulting any mapping.
23. That check SHALL reject a `metadata.model:` value that is not a mapping, a
    key outside the sets of requirement 18, a value outside a closed domain of
    requirements 6 and 9 through 16, and a tuning value of the wrong type or
    outside its range.
24. That check SHALL NOT reject a profile on the ground that no mapping in
    force serves it, and SHALL NOT reject a `specialization` value on the
    ground that this document does not enumerate it.

## Scenarios

**Scenario:** the canonical profile is expressible

```text
Given an agent source whose metadata.model declares intelligence: medium
And   the same mapping declares reasoning: medium
When  a reader interprets the declaration without knowing the target CLI
Then  it states that the work needs the capability of rung 3, the rung the
      Claude Code haiku anchor calibrates
And   it states that the work needs medium chain-of-thought depth
And   it names no model and no CLI
```

**Scenario:** the remaining selection axes carry their meaning

```text
Given an agent source whose metadata.model declares context: 200000
And   the same mapping declares speed: fast, modalities: [text, vision] and
      locality: local-only
When  a reader interprets the declaration
Then  it states a floor of 200000 context tokens, a preference for throughput,
      a need for image input alongside text, and a requirement for a locally
      or self-hosted provider
And   omitting any one of those keys states no constraint on that axis
```

**Scenario:** an unenumerated specialization is a valid declaration

```text
Given an agent source whose metadata.model declares specialization:
      image-generation
And   this vocabulary enumerates no such value
When  the hermetic profile check runs against that source
Then  the check reports no error
And   the check reports no error either for a source that omits the axis, which
      states the unconstrained value general
```

**Scenario:** the generation-tuning block is declared

```text
Given an agent source whose metadata.model.tuning declares temperature: 0.2,
      top-p: 0.95, top-k: 40 and max-output-tokens: 8192
When  the hermetic profile check runs against that source
Then  the check reports no error
And   a tuning mapping that declares none of the four is indistinguishable in
      meaning from a source that omits the tuning mapping
```

**Scenario:** an agent source declares no profile

```text
Given an agent source that carries no metadata.model mapping
When  that agent runs on any supported CLI
Then  it inherits the active session model, the fallback path requirement 6 of
      spec 0143 delta-01 establishes
And   the hermetic profile check reports no error for that source
And   a source whose metadata.model mapping is empty behaves identically
```

**Scenario:** a value outside a closed domain is rejected

```text
Given an agent source whose metadata.model declares reasoning: off
And   the reasoning axis admits none, low, medium, high, xhigh and max
When  the hermetic profile check runs against that source
Then  the check reports an error naming the key, the declared value and the
      admitted domain
```

**Scenario:** an unknown key under the profile is rejected

```text
Given an agent source whose metadata.model declares a key named inteligence
When  the hermetic profile check runs against that source
Then  the check reports an error naming that key as one this vocabulary does
      not admit
And   the check does not silently ignore the key and does not downgrade the
      report to a warning
```

**Scenario:** a knob the target cannot express is dropped and reported

```text
Given an agent source whose metadata.model declares reasoning: medium
And   a resolution for one CLI that names a model exposing no reasoning control
When  that resolution is performed
Then  the reasoning constraint is dropped rather than approximated
And   one drop record is emitted on the resolver's diagnostic output, naming
      the agent, that CLI, metadata.model.reasoning, the value medium and the
      reason unsupported-on-model
And   the compiled agent output carries no trace of the dropped constraint and
      no trace of the record
```

**Scenario:** a valid profile that no mapping serves

```text
Given an agent source whose metadata.model declares intelligence: max
And   no mapping in force serves that rung on any supported CLI
When  the hermetic profile check runs against that source
Then  the check reports no error
And   the resolution for each CLI drops the constraint and records one drop
      with the reason unserved-value
```

## Out of scope

- The per-CLI mapping files, their format, their resolution rules and the
  degradation policy for a combination no mapping covers — seam (c) of
  epic #1100. This spec defines what a profile declares, never what a
  declaration resolves to on any CLI.
- The build's consumption of a profile, the frontmatter it emits per CLI, and
  the continuous-integration guards over that emission — seam (d). Whether the
  drop records of requirement 21 are additionally persisted as a committed
  report is a build concern and belongs there too.
- The implementation of the hermetic check of requirements 22 through 24, which
  lands in seam (d) or seam (f). This spec states what the check asserts; it
  builds nothing.
- The organization-level override channel for mappings — seam (e).
- The migration of the existing agent sources and the removal of
  `metadata.claude.model` from them — seam (f). No agent source on `main`
  carries a `metadata.model:` mapping today, and this spec back-fills none:
  requirement 3 makes the profile optional precisely so that the vocabulary can
  land before the migration does. The informal tiering the 22 core sources
  carry today under `metadata.claude.model` — audit and copy roles on `haiku`,
  implementation and design roles on `sonnet`, `architect` alone on `opus` —
  is expressible on the intelligence rungs `medium`, `high` and `xhigh`
  respectively, which is the property seam (f) relies on; performing that
  translation is seam (f)'s work.
- The compiled-layout convention for agent outputs — seam (g).
- Any change to the normative text of spec 0143 or of its delta-01. This spec
  consumes the fallback rule that delta established and amends neither
  document. In particular, it places no requirement on `model:` emission into
  any compiled output surface: requirements 1 through 4 and 8 of spec 0143
  delta-01 continue to govern that question alone.
- Model declaration for skills and commands. The vocabulary is an agent-source
  surface; the `disable-model-invocation` field is untouched.
- Runtime routing. Nothing here changes a CLI's session default model, its
  interactive model picker, or the behavior of its Auto router.

## Open questions

- [GROUNDING:] No agent source under `artifacts/core/agents/` or
  `artifacts/library/agents/` on `main` carries a `metadata.model:` mapping;
  all 22 core sources carry `metadata.claude.model` instead, and
  `harness-curator` carries no model declaration at all. Requirement 3 makes
  the new mapping optional rather than mandatory, so no back-fill is owed by
  the implementation of this spec; responsibility for adding profiles to the
  existing sources and removing `metadata.claude.model` from them is assigned
  to seam (f) of epic #1100, as recorded in `## Out of scope` above. Recorded
  for audit; no closure is owed on the logbook issue.
