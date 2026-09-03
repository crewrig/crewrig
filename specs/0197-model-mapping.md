---
id: "0197"
slug: model-mapping
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1111
version: 1.0.0
---

# Per-CLI model mapping and core default mappings

Authored for issue #1111, seam (c) of epic #1100 (CLI-agnostic model
declaration for subagents). Seam (a) —
[`specs/0195-agent-capability-profile.md`](0195-agent-capability-profile.md),
merged as `bdfdd8c` — defines what an agent source declares. Seam (b) —
[`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md),
merged as `b565e87` — defines what happens when nothing maps. This spec
defines the thing in between: the mapping itself, how a declared profile
resolves against it, and what the four core default mappings contain. The
build that consumes a mapping is seam (d), the organization-level override
channel is seam (e), the migration of the existing agent sources is seam (f),
and the compiled-layout convention is seam (g).

**Evidence base.** Every native field name, value domain, model identifier and
per-model constraint below is cited from the live-verification research report
posted on this spec's logbook (issue #1111, comment 5523492666), which probed
the four CLIs installed on the maintainer's workstation — Claude Code 2.1.259,
Gemini CLI 0.46.0, GitHub Copilot CLI 1.0.81, Antigravity CLI 1.1.25 — through
version probes, `--help` text, on-disk vendor documentation and schemas, and
read-only configuration inspection. Where the report left an item unconfirmed
and a mapping cell needs it, the cell is a **documented assumption** and the
matching entry in `## Open questions` says so. Vendor web documentation is not
an admissible source for a mapping cell in this spec; the live install is.

**Vocabulary.** A **target** is one supported CLI, named by the identifier that
repository tooling already uses for it — `claude`, `gemini`, `copilot`,
`antigravity`. A **mapping** is the committed artifact that translates a
capability profile into one target's native declination. An **offering** is one
entry of a mapping describing a model the target can reach, the characteristics
that model provides, and the native value that names it. A **surface** is a
place a target expresses a declared item: the **agent-file surface** is the
compiled agent output for that target, and an **out-of-band surface** is any
other place the target expresses the item — a session flag, a user
configuration file. A **resolution** is the term
[spec 0143 delta-01](0143-copilot-subagent-model-fallback.delta-01.md) defines:
the outcome, for one agent and one target, of resolving that agent's capability
profile against the mapping in force. Its outcome is either a **directed
declination** — the native values the target is to receive, each on a named
surface — or **no resolution**, which is the fallback path requirement 6 of
that delta establishes. To **drop** an item is what
[spec 0195](0195-agent-capability-profile.md) requirement 20 defines: to omit
it from what the target receives, substituting nothing.

**Contradicted premises.** Three premises this ticket and epic #1100 carried
are contradicted by the live installs. Following the discipline that a
contradicted document is named rather than silently corrected, each is recorded
below; none is repaired by editing the document that carries it.

**Premise 1 — Antigravity CLI exposes no per-agent model surface.**
Epic #1100 states that Antigravity subagent frontmatter carries
`model: inherit | flash | pro`, calls it "a genuine 2-rung tier", and makes "a
7-rung × 6-level profile must project onto `inherit | flash | pro`" a binding
constraint of this ticket. On
Antigravity CLI 1.1.25 no such surface exists: `AGENT.md` carries `name` and
`description` alone, in this repository's own compiled output and in the
workstation's installed third-party agent alike; `--model` and
`--effort low|medium|high` are session-level flags of the whole invocation; and
`agy models` lists fourteen concrete identifiers, not an abstract tier. Ten
on-disk documentation files were read in full and none names the tier; the only
`inherit` hits are unrelated configuration-file inheritance. The token appears
to originate in the Antigravity IDE product's web documentation, not the CLI.
**Consequence:** the `inherit | flash | pro` projection constraint is retired,
the Antigravity core mapping is emission-free under epic rule 4, and no
projection onto session-level flags is invented in its place. The
projection-totality assertion this ticket asked a checker to make over that
table retires with it, and requirement 38's general selection-totality
assertion takes its place. Recorded for the maintainer to confirm in
`## Open questions`.

**Premise 2 — Gemini CLI's reasoning knobs are not an agent-frontmatter
surface.** Epic #1100 lists Gemini 3 `thinking_level` as the CLI's reasoning
surface alongside its agent-file `model:`. On Gemini CLI 0.46.0 the agent file
(`.gemini/agents/*.md`) natively carries `model`, `temperature` and `max_turns`
and nothing else of interest here; `thinkingLevel`, `thinkingBudget`, `topP`,
`topK` and `maxOutputTokens` are reachable only through `settings.json`
`modelConfigs.overrides`, matched to an agent by `overrideScope`. **Consequence:**
a mapping states, per item, which surface expresses it, and the two surfaces are
not interchangeable.

**Premise 3 — spec 0195 Decision 2's `thinking_level` rationale is factually
wrong for this install.** That decision's rationale states that "Gemini 3's
`thinking_level` admits `off`, alongside `low`, `medium`, `high` and `max`". The
`ThinkingLevel` enum in the `@google/genai` SDK bundled with Gemini CLI 0.46.0
admits exactly `THINKING_LEVEL_UNSPECIFIED`, `LOW` and `HIGH`, identically
across three independent bundle copies; the off state is reached through the
numeric `thinkingBudget: 0`, not through an enum value. **Consequence:** none
normative. Spec 0195's `none` rung stands, because a target that expresses the
state numerically still expresses it; only the rationale's illustration is
wrong, and a rationale is not a requirement. Named here rather than repaired,
since a merged spec's body is immutable.

A fourth item is a reconciliation rather than a contradiction. The build script,
`docs/cli-matrix.md` row 4b and the Gemini frontmatter test all assert that
"Gemini CLI 0.42.0+ rejects any frontmatter key outside `name`/`description`".
The tested claim behind that sentence is narrower — release 0.42.0 rejected this
repository's own `type:` and `metadata:` keys, not the CLI-native optional keys
that 0.46.0's bundled documentation enumerates. The two statements are
compatible on a close reading, but the broader phrasing is not evidence that
Gemini rejects `model:` or `temperature:`, and this spec does not rely on it in
either direction; `## Open questions` carries the re-probe.

**Decision 1 — one mapping file per target, in a top-level `model-mappings/`
directory, in YAML.** The repository already has the precedent this artifact
should follow: `ci/ci-capabilities.yml` is a committed, engine-neutral YAML
reference whose normative shape lives in a `docs/` format document, placed at
the top level rather than under a vendor directory precisely so it reads as
neutral rather than owned by one engine. A mapping is the same kind of object —
a committed declaration that describes rather than executes — and gets the same
treatment. YAML rather than the JSON of `mcp-servers.org.json` for two reasons:
a mapping cell must carry the evidence citation that justifies it, and JSON
admits no comments, so the citation would have to be smuggled into a data field
or dropped; and the repository already parses YAML in every component's
frontmatter, so no new capability is introduced. The directory is not placed
under `artifacts/`, whose contract is the single-source zone for skills, agents
and commands: a mapping is a build input, not a component, and nothing deploys
it to a CLI.

**Decision 2 — the intelligence axis is a floor, and selection takes the
cheapest offering that satisfies it.** Epic #1100 leaves the missing-cell
semantics open, framing the choice as "degrade up = cost surprise, degrade down
= capability surprise". Spec 0195 settles the reading in advance: a rung states
"how much raw capability the work demands", which is a minimum and not an
equality. So selection keeps the offerings at or above the declared rung and
takes the lowest-ranked of those — the cheapest sufficient one — which bounds
the cost surprise to one step and admits no capability surprise at all. The one
place the rule cannot hold is the ceiling: where no offering reaches the rung,
selection takes the highest-ranked offering, which is exactly the
best-available projection spec 0195 requirement 9 mandates for `xxhigh` and
`max`. Requirement 9 is therefore a corollary of the floor rule rather than a
special case bolted beside it, and the rule is total over the seven rungs for
any mapping with at least one offering.

**Decision 3 — a resolution directs emission only into the agent-file
surface.** Three of the four targets express something relevant in a place that
is not the compiled agent output: Gemini's `settings.json`, Copilot's
`~/.copilot/config.json`, Antigravity's session flags. Spec 0143 and its
delta are written about the compiled agent output and about nothing else, and
Copilot's is a user-scope file outside any repository build's reach. A mapping
therefore **names** an out-of-band surface as recorded evidence of where the
target expresses an item, and that naming directs nothing: an item with no
agent-file surface is dropped. Promoting an out-of-band surface to a directed
one is an additive change a later delta of this spec can make once seam (d)
establishes a mechanism, which is cheaper than specifying a mechanism now for a
surface no build writes.

**Decision 4 — the guard of spec 0143 delta-01 requirement 8 is a mapping-level
predicate, and while it holds, the outcome is *no resolution* rather than a
withheld emission.** The delta's replaced requirement 2 obliges a compiled
output to carry the declination "where a resolution does apply", so a state in
which a resolution applies but its emission is suppressed would contradict a
merged spec. Placing the guard *before* selection avoids that entirely: while
the guard holds, every Claude Code resolution outcome is *no resolution*, and
requirements 1, 2, 6 and 7 of the delta all hold unchanged. The mapping the
guard would have selected stays observable on the resolver's diagnostic
output, so the canonical example remains demonstrable without an emission.

**Decision 5 — the core mappings declare only what the live install grounds.**
An ungrounded characteristic is absent from the mapping rather than assumed
into it, and a declaration that the absent characteristic would have served is
dropped and reported. This is why the Claude offerings carry no context window
and no modality list: nothing on disk states them. The cost is a mapping that
serves fewer declarations than it eventually will; the benefit is that no
resolution rests on a guess, every cell is re-derivable from a cited
observation, and each later delta that adds a cell arrives with its own
evidence. The one admitted exception is a characteristic the maintainer decided
at a gate — the Haiku carve-out below — which is carried as an explicit
assumption rather than smuggled in as a fact.

The same discipline settles a smaller choice. The Claude Code mapping names
family aliases rather than concrete model identifiers, because the alias form is
what the live probe grounds — `claude --help` illustrates its `--model` domain
with aliases — while the concrete identifiers are the one thing the probe found
inconsistent on disk, that same help text printing `claude-fable-5` where the
current identifier is `claude-fable-5-1`. An alias also survives a vendor point
release, which is the staleness epic #1100 exists to end. Gemini CLI gets the
opposite treatment for the same reason: its bundled documentation illustrates
its agent-file `model:` key with concrete identifiers and documents no alias
domain for it, so concrete identifiers are what that mapping names.

**Complexity tier — `standard`.** The implementation creates a new class of
committed artifact (four mapping files), a normative format document for it,
and a hermetic checker over it, plus the co-maintenance `AGENTS.md` requires of
a new core-layer path in `docs/layers.md` and `.crewrig/core-paths.txt` and a
`docs/cli-matrix.md` row. That is more than the single documentation surface a
`small` tier covers, and it warrants a developer, a tester and a reviewer. It
is not `large`: the design questions are settled here at SPECS rather than
deferred to sub-spec decomposition, and the deliverable is one coherent
artifact class rather than several.

## Intent

Each supported command-line interface has one committed file that says which
models it can reach, what each of those models provides, and how the
characteristics an agent declares turn into the fields that interface
understands. An agent that declares it needs medium capability and medium
reasoning gets the cheapest model that is at least that capable, and anything
the chosen model cannot express is left out rather than approximated, with a
record of every omission on the output of whoever ran the translation. A
command-line interface whose file lists no model is a supported state and
receives nothing, exactly as it does today. Where one interface reads another's
files and would be misrouted by what it found there, the file that would have
supplied the value withholds it until that hazard is gone.

## Requirements

Requirements 1 through 7 define the mapping artifact, 8 through 10 its
surfaces, 11 through 20 the resolution rules, 21 through 25 the shared-read
guard, 26 through 34 the content of the four core default mappings, and 35
through 39 the validation surface.

1. The framework SHALL carry, for each supported target, at most one core-level
   default mapping, and each such mapping SHALL be a single committed file in
   the core layer, at `model-mappings/<target>.yml`, whose name identifies the
   target it serves.
2. A mapping file SHALL be classified in the layer boundary contract
   (`docs/layers.md`) and in the synchronization manifest
   (`.crewrig/core-paths.txt`) as core-owned and upstream-owned.
3. A mapping SHALL declare the target it serves, and that declaration SHALL
   agree with the target its filename identifies.
4. A mapping SHALL declare, for each surface it names, the native key that
   surface uses for each item and the domain of values that key admits; and
   SHALL declare, for each offering, a stable identifier unique within the file,
   a rank that is unique within the file, the native value that names the model,
   and the characteristics of spec 0195 that the model provides.
5. Every offering and every surface item a mapping declares SHALL carry either a
   citation of the observation that grounds it or an explicit statement that it
   is an assumption, and SHALL NOT carry both and SHALL NOT carry neither.
6. A mapping's offerings and surface items SHALL be individually addressable by
   their stable identifiers, so that the organization-level override channel of
   seam (e) can replace or add one entry without restating the file. This spec
   SHALL define that addressability and SHALL NOT define the channel, its
   location, or its precedence.
7. A mapping MAY declare zero offerings. A mapping declaring zero offerings
   SHALL yield *no resolution* for every agent on its target, and the target
   SHALL be a supported, unconfigured state rather than an error.
8. A resolution SHALL direct an emission only into the agent-file surface of its
   target.
9. A mapping SHALL name each out-of-band surface on which its target expresses
   an item this vocabulary can declare, together with the items concerned.
   Naming an out-of-band surface SHALL direct no emission.
10. A declared item whose target expresses it on no agent-file surface SHALL be
    dropped with the reason `unsupported-on-cli`, whether or not an out-of-band
    surface for it is named.
11. A resolution SHALL select a model only where the profile declares the
    `intelligence` axis. Where the profile omits that axis, the resolution SHALL
    direct no model, SHALL drop every other declared selection axis with the
    reason `unserved-value`, and SHALL still direct the tuning knobs the target
    expresses on its agent-file surface.
12. Where the profile declares the `intelligence` axis, the resolution SHALL
    select the lowest-ranked offering whose declared `intelligence` rung is at
    or above the declared rung; where no offering reaches the declared rung, it
    SHALL select the highest-ranked offering the mapping declares. Neither
    outcome SHALL record a drop on the `intelligence` axis.
13. The selection of requirement 12 SHALL satisfy requirement 9 of spec 0195:
    both the `xxhigh` rung and the `max` rung SHALL project onto the best model
    the mapping makes available for that target wherever the mapping declares at
    least one offering.
14. The remaining selection axes SHALL narrow the candidate set of requirement
    12 in this order — `context`, `modalities`, `locality`, `specialization`,
    `speed` — and a narrowing that would empty the candidate set SHALL instead
    be abandoned, leaving the candidate set unchanged, and SHALL record one drop
    for that axis with the reason `unserved-value`.
15. A declared `specialization` value that no candidate offering serves SHALL
    fall back to the unconstrained value `general` and SHALL record one drop
    with the reason `unserved-value`, per requirement 12 of spec 0195. A core
    mapping SHALL owe nothing beyond that fallback.
16. A mapping whose target expresses reasoning on its agent-file surface SHALL
    declare, for each of the six reasoning rungs, either the native value in
    that surface's domain onto which the rung projects, or that the rung is
    unmapped. A rung declared unmapped SHALL be dropped with the reason
    `out-of-range-for-target`, and SHALL NOT be resolved to an adjacent rung.
17. An offering SHALL declare whether the model it names supports the target's
    reasoning surface. A declared reasoning rung SHALL be dropped with the
    reason `unsupported-on-model` where the selected offering declares no such
    support, and likewise where no offering is selected.
18. A declared tuning knob SHALL be directed onto the native key the target's
    agent-file surface declares for it, and SHALL be dropped with the reason
    `out-of-range-for-target` where the declared value falls outside the domain
    that surface declares.
19. Every drop this spec's resolution rules produce SHALL be recorded exactly as
    requirements 20 through 22 of spec 0195 specify: one record per dropped
    item, naming the agent, the target, the dotted path of the declared key, the
    declared value and one reason from the closed set; emitted on the diagnostic
    output of whatever performed the resolution; never placed inside a compiled
    agent output; and never failing the resolution.
20. A resolution's outcome SHALL be a deterministic function of the agent source
    and the mapping in force, and the ranks a mapping declares SHALL be a strict
    total order over its offerings, so that requirement 12 names exactly one
    offering for every declared rung.
21. The Claude Code mapping SHALL declare a guard encoding requirement 8 of spec
    0143 delta-01, and that guard SHALL be evaluable from the mapping alone by
    whatever performs the resolution.
22. The guard SHALL declare exactly two terms — that the upstream defect
    `github/copilot-cli#4437` is not established fixed, and that a GitHub
    Copilot CLI reader may consume the `.claude/agents/` surface — each carrying
    the evidence that establishes its recorded state.
23. The guard SHALL admit exactly two states. In the **withheld** state, in
    force while either term holds, every resolution for Claude Code SHALL yield
    *no resolution*, whatever the mapping's offerings would otherwise have
    selected, so that requirements 1, 2, 6 and 7 of spec 0143 delta-01 hold
    unchanged. In the **directed** state, in force only while neither term
    holds, a resolution for Claude Code SHALL yield the declination requirements
    11 through 18 select.
24. A guard in the withheld state SHALL be reported once per resolution run on
    the diagnostic output, naming the guard, the term that holds, and the
    declination the mapping would have selected. That report SHALL NOT be a drop
    record and SHALL NOT be placed inside any compiled agent output.
25. A change of the guard's recorded state to **directed** SHALL carry, in the
    mapping, the evidence requirement 8 of spec 0143 delta-01 demands, and SHALL
    NOT be made on the strength of an indeterminate or absent observation.
26. The Claude Code mapping SHALL declare its agent-file surface as the native
    key `model`, whose domain this mapping declares as exactly the four family
    aliases `haiku`, `sonnet`, `opus` and `fable` rather than concrete model
    identifiers, and the native key `effort`, whose domain is `low`, `medium`,
    `high`, `xhigh` and `max`. It SHALL declare no tuning knob on that surface, so that all five
    knobs of spec 0195 are dropped with the reason `unsupported-on-cli`.
27. The Claude Code mapping SHALL declare exactly four offerings, ranked
    ascending — `haiku` providing the `medium` rung, `sonnet` the `high` rung,
    `opus` the `xhigh` rung, and `fable` the `xxhigh` rung — SHALL project the
    six reasoning rungs onto the `effort` domain identically for `low` through
    `max` and as unmapped for `none`, and SHALL declare the `haiku` offering as
    supporting no reasoning surface. That last declaration SHALL be carried as
    an assumption, not as a citation.
28. The Claude Code mapping's guard SHALL be recorded in the **withheld** state,
    both of its terms holding: probe run `20260902T153919Z-0aa9` of issue #1103
    returned the verdict `BUG-PRESENT` against `github/copilot-cli#4437` on
    GitHub Copilot CLI 1.0.82, and the same run's control leg is direct live
    evidence that GitHub Copilot CLI consumes the `.claude/agents/` surface.
29. The Gemini CLI mapping SHALL declare its agent-file surface as the native
    key `model`, admitting the concrete identifiers its offerings name; the
    native key `temperature`, admitting `0.0` through `2.0`; and the native key
    `max_turns`, admitting integers of at least `1`. It SHALL declare exactly
    three offerings, ranked ascending — `gemini-3.1-flash-lite` providing the
    `low` rung, `gemini-3.5-flash` the `medium` rung, and `gemini-3.1-pro-preview`
    the `high` rung. It SHALL name `settings.json` `modelConfigs.overrides`,
    matched by `overrideScope`, as the out-of-band surface carrying reasoning,
    `top-p`, `top-k` and `max-output-tokens`, so that each of those four is
    dropped with the reason `unsupported-on-cli`.
30. The GitHub Copilot CLI mapping SHALL declare zero offerings and SHALL record
    the ground for that state: the model lineup actually served to that CLI is a
    property of the deployment rather than of the core layer, since a
    GitHub-routed deployment and a bring-your-own-key deployment reach disjoint
    sets, and naming a model the deployment does not serve reproduces the silent
    routing failure of `github/copilot-cli#4437`, adjudicated `BUG-PRESENT` on
    run `20260902T153919Z-0aa9`. It SHALL name both surfaces it observes — the
    agent file's `model` key, and `~/.copilot/config.json`
    `subagents.agents.<name>` carrying `model`, `effortLevel` and `contextTier`
    — as recorded evidence directing no emission.
31. The GitHub Copilot CLI mapping SHALL state the condition a later delta must
    meet to declare an offering: either `github/copilot-cli#4437` is established
    fixed, or the offerings are restricted to models the deployment's provider
    is established to serve — which, being deployment knowledge, reaches a
    mapping through the organization-level override channel of seam (e) rather
    than through the core layer.
32. The Antigravity CLI mapping SHALL declare zero offerings, SHALL declare that
    the target exposes no agent-file model surface, and SHALL record the
    fourteen session-level model identifiers `agy models` reports as evidence
    directing no emission. It SHALL NOT declare a projection onto any
    session-level flag.
33. Every offering, surface item and guard term across the four core default
    mappings SHALL trace to an observation of the live-verification research
    report of issue #1111, except where requirement 5 marks it an assumption.
34. Taken together, the four core default mappings SHALL yield *no resolution*
    for every agent source present on `main` at the time this spec is
    implemented, so that requirement 7 of spec 0143 delta-01 continues to hold
    on the committed tree and no compiled agent output changes.
35. A mapping file SHALL be verifiable by a check that is hermetic: decidable
    from the mapping file and the domains of spec 0195 alone, without network
    access, without an installed CLI, and without resolving any agent source.
36. That check SHALL reject a mapping whose declared target is not a supported
    target or disagrees with its filename, a key the mapping schema does not
    admit, an offering or surface item carrying neither a citation nor an
    assumption or carrying both, a duplicate offering identifier, and a
    duplicate rank.
37. That check SHALL reject an offering whose declared characteristics fall
    outside the domains spec 0195 defines, and a native value the mapping
    directs that is not a member of the domain the mapping declares for that
    surface's key.
38. That check SHALL assert selection totality: a mapping declaring at least one
    offering SHALL select an offering for each of the seven `intelligence`
    rungs, and a mapping whose target expresses reasoning on its agent-file
    surface SHALL declare an image or an unmapped state for each of the six
    reasoning rungs.
39. That check SHALL assert that a Claude Code mapping declares the guard of
    requirement 21, and that a guard recorded in the **directed** state carries
    an evidence reference for each of its two terms. The check SHALL assert the
    presence of that evidence and SHALL NOT attempt to verify its truth.

## Scenarios

**Scenario:** the canonical example resolves

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: medium
And   the Claude Code core default mapping
When  that profile is resolved against the mapping
Then  the selection names the haiku offering, the lowest-ranked offering at or
      above the medium rung
And   the reasoning rung is dropped, because the haiku offering declares no
      support for the effort surface
And   one drop record is emitted naming the agent, the target claude, the path
      metadata.model.reasoning, the value medium and the reason
      unsupported-on-model
```

**Scenario:** the top rung is served by best-available projection

```text
Given an agent source whose metadata.model declares intelligence: max
And   the Claude Code core default mapping, whose highest-ranked offering is
      fable
When  that profile is resolved against the mapping
Then  the selection names the fable offering
And   no drop is recorded on the intelligence axis
And   a declaration of intelligence: xxhigh selects that same offering
```

**Scenario:** a rung below the lowest offering projects up to the cheapest

```text
Given an agent source whose metadata.model declares intelligence: minimal
And   the Claude Code core default mapping, whose lowest-ranked offering is
      haiku at the medium rung
When  that profile is resolved against the mapping
Then  the selection names the haiku offering, which satisfies the declared floor
And   no drop is recorded on the intelligence axis
And   a declaration of intelligence: low selects that same offering
```

**Scenario:** an item the agent-file surface does not express is dropped

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: high
And   the Gemini CLI core default mapping, which names settings.json
      modelConfigs.overrides as the out-of-band surface carrying reasoning
When  that profile is resolved against the mapping
Then  the selection names the gemini-3.5-flash offering
And   the reasoning rung is dropped with the reason unsupported-on-cli
And   the resolution directs no value onto the out-of-band surface the mapping
      names
```

**Scenario:** reasoning none has no image in the target domain

```text
Given an agent source whose metadata.model declares intelligence: high and
      reasoning: none
And   the Claude Code core default mapping, whose effort domain admits low
      through max and declares the none rung unmapped
When  that profile is resolved against the mapping
Then  the selection names the sonnet offering
And   the reasoning rung is dropped with the reason out-of-range-for-target
And   the resolution directs no effort value, and in particular does not direct
      low
```

**Scenario:** the shared-read guard is withheld

```text
Given the Claude Code core default mapping with its guard recorded withheld,
      because github/copilot-cli#4437 is not established fixed and a Copilot CLI
      reader consumes the .claude/agents/ surface
And   an agent source whose metadata.model declares intelligence: high
When  that profile is resolved against the mapping
Then  the resolution outcome is no resolution
And   the compiled agent output for Claude Code carries no model: field, the
      fallback path requirement 6 of spec 0143 delta-01 establishes
And   one guard report is emitted on the diagnostic output naming the guard, the
      term that holds, and the sonnet declination the mapping would have selected
```

**Scenario:** the shared-read guard is directed

```text
Given a Claude Code mapping whose guard is recorded directed, carrying evidence
      for each of its two terms
And   an agent source whose metadata.model declares intelligence: high
When  that profile is resolved against the mapping
Then  the resolution outcome is a directed declination naming the sonnet
      offering
And   no guard report is emitted
```

**Scenario:** an unconfigured target emits nothing

```text
Given the Antigravity CLI core default mapping, which declares zero offerings
      and no agent-file model surface
And   an agent source whose metadata.model declares intelligence: xhigh and
      reasoning: high
When  that profile is resolved against the mapping
Then  the resolution outcome is no resolution
And   the compiled agent output for Antigravity carries no model field
And   no projection onto the retired inherit, flash and pro tier is attempted
```

**Scenario:** a specialization no offering serves falls back to general

```text
Given an agent source whose metadata.model declares intelligence: high and
      specialization: image-generation
And   the Gemini CLI core default mapping, whose offerings serve only the
      general specialization
When  that profile is resolved against the mapping
Then  the selection is unchanged by the specialization narrowing and names the
      gemini-3.1-pro-preview offering
And   one drop record is emitted with the reason unserved-value
```

**Scenario:** a context floor no offering declares is dropped

```text
Given an agent source whose metadata.model declares intelligence: medium and
      context: 1000000
And   the Claude Code core default mapping, whose offerings declare no context
      window
When  that profile is resolved against the mapping
Then  the narrowing on context would empty the candidate set and is abandoned
And   the selection names the haiku offering
And   one drop record is emitted with the reason unserved-value
```

**Scenario:** a mapping directing a value outside its declared domain is
rejected

```text
Given a mapping file whose agent-file surface declares the effort key admitting
      low, medium, high, xhigh and max
And   a reasoning projection directing the value none onto that key
When  the hermetic mapping check runs against that file
Then  the check reports an error naming the file, the key, the directed value
      and the declared domain
And   the check reports the same class of error for an offering whose declared
      intelligence rung is outside the seven spec 0195 admits
```

**Scenario:** a mapping that leaves a rung unselectable is rejected

```text
Given a mapping file declaring at least one offering
And   an intelligence rung for which the mapping's selection rules name no
      offering
When  the hermetic mapping check runs against that file
Then  the check reports an error naming the unselectable rung
And   the check reports no error for a mapping declaring zero offerings, which
      is the supported unconfigured state
```

## Out of scope

- The build's consumption of a mapping — the resolution of agent sources
  against it, the frontmatter it emits per target, the persistence of the drop
  records, and the continuous-integration guards over any of that. Seam (d).
  This spec states what a mapping contains and what a resolution outcome is; it
  emits nothing and builds nothing.
- The organization-level override channel: its location, its filename, its
  format, its precedence over core entries, and its exclusion from upstream
  synchronization. Seam (e). This spec defines only the addressability that
  channel plugs into, in requirement 6.
- The migration of the existing agent sources and the removal of
  `metadata.claude.model` from them. Seam (f). No agent source on `main`
  declares a capability profile today, which is why requirement 34 holds
  trivially at implementation time.
- The compiled-layout convention for agent outputs. Seam (g). Requirement 8 of
  spec 0143 delta-01 binds the `.claude/agents/` surface whatever per-file
  layout it adopts, and the guard of requirement 21 inherits that property.
- Directed emission onto any out-of-band surface — Gemini CLI's `settings.json`
  `modelConfigs.overrides`, GitHub Copilot CLI's `~/.copilot/config.json`
  `subagents.agents.<name>`, and every session-level flag of every target.
  These are named as recorded evidence and nothing more; promoting one is an
  additive delta of this spec.
- Any change to the normative text of spec 0195, of spec 0143, or of that
  spec's delta-01. The three contradicted premises above are named, not
  repaired.
- Runtime routing. Nothing here changes a target's session default model, its
  interactive model picker, or the behavior of its Auto router. In particular
  the `--effort` domain of GitHub Copilot CLI's session flag —
  `none | minimal | low | medium | high | xhigh | max`, a seven-value superset
  of spec 0195's reasoning axis — is recorded as environment evidence and is
  not a mapping surface.
- Model declaration for skills and commands, and the `disable-model-invocation`
  field. The mapping serves agent sources alone.

## Open questions

Each item carries what the content gate owes it: **confirm** where a maintainer
decision is asked for, **audit** where the item is recorded for the record and
no closure is owed on the logbook issue.

- [GROUNDING:] **confirm.** The `inherit | flash | pro` tier that epic #1100 makes a binding
  constraint of this ticket is not present on Antigravity CLI 1.1.25: not in
  `agy --help`, not in `agy models`, not in the workstation's
  `antigravity-cli/settings.json`, and not in the ten on-disk documentation
  files read in full. This spec retires the constraint and makes the Antigravity
  mapping emission-free. The maintainer is asked to confirm the retirement at
  the content gate, or to name the source of the tier claim so the premise can
  be re-tested against that surface — the Antigravity IDE product is the
  suspected origin and was not probed.
- [GROUNDING:] **confirm.** Whether Claude Code's `effort:` field is refused or ignored on
  Haiku is unconfirmed on disk: neither `claude --help` nor
  `artifacts/FORMAT.md` states a per-model carve-out either way. Requirement 27
  carries the carve-out as an assumption, on the strength of the canonical
  example the maintainer fixed at the epic's gate. A minimal live invocation
  against a Haiku model would settle it; until it does, the assumption is
  marked in the mapping file.
- [GROUNDING:] **audit.** The `[1m]` context variants epic #1100 names for `sonnet` and
  `opus` are not confirmed on this install, so no Claude offering declares a
  context window and every declared `context` floor is dropped with
  `unserved-value` per requirement 14. A later delta populates the windows once
  an observation grounds them.
- [GROUNDING:] **confirm.** The intelligence rungs assigned to the three Gemini offerings in
  requirement 29 rest on the vendor's own family naming — pro above flash above
  flash-lite, and the higher version within a family — which is observable in
  the identifiers themselves but is not a capability measurement. The
  assignment is carried as an assumption in the mapping file.
- [GROUNDING:] **audit.** Whether Gemini CLI 0.46.0 accepts `model:`, `temperature:` and
  `max_turns:` in `.gemini/agents/*.md` was not re-probed. The bundled
  documentation of that release enumerates all three; this repository's build
  script and `docs/cli-matrix.md` row 4b carry a broader phrasing of the
  0.42.0-era rejection whose tested claim was narrower. A scratch-file probe
  spends no provider quota and settles it before seam (d) emits.
- [GROUNDING:] **audit.** The domain of Gemini CLI's agent-file `model:` key — concrete
  identifiers only, or also configuration aliases and tier words — is
  undocumented. Requirement 29 names concrete identifiers, the only form the
  bundled documentation illustrates.
- [GROUNDING:] **audit.** Whether GitHub Copilot CLI's `AgentInfo.model` accepts the value
  `auto` is undocumented in the bundled schema. The question is inert while
  requirement 30 keeps that mapping at zero offerings, and becomes live for the
  delta requirement 31 anticipates.
- [GROUNDING:] **audit.** The research report records that `glm-5.3-flash:cloud` is absent
  from `ollama list` on this workstation. That observation is superseded rather
  than contradicted: cloud models are served on demand rather than cached
  locally, and the control leg of probe run `20260902T153919Z-0aa9` on
  issue #1103 spawned a subagent on that exact model. The model is served;
  `ollama list` is not the instrument that would show it.
- [GROUNDING:] **audit.** The gap note of `docs/cli-matrix.md` row 4 still cites the
  earlier `INDETERMINATE` probe A run of 2026-09-02 and is owed a re-date to run
  `20260902T153919Z-0aa9`, whose verdict is `BUG-PRESENT`. Requirements 28 and
  30 cite the later run. Recorded for audit; the re-date is tracked as a
  follow-up on issue #1103 and no closure is owed here.
