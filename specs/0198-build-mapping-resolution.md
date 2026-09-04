---
id: "0198"
slug: build-mapping-resolution
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1116
version: 1.0.0
---

# Build-time resolution of capability profiles against per-CLI model mappings

Authored for issue #1116, seam (d) part 2 of epic #1100 (CLI-agnostic model
declaration for subagents). Part 1 — issue #1114, merged as `f8336dc` —
landed the inert artifacts of
[`specs/0197-model-mapping.md`](0197-model-mapping.md): the four core default
mappings under `model-mappings/`, their normative format document
[`docs/model-mapping-format.md`](../docs/model-mapping-format.md), and the
hermetic checker `scripts/check-model-mappings.sh`. Nothing in the repository
reads a mapping today. This spec makes the build read one.

The three merged specs this one consumes divide cleanly. Seam (a) —
[`specs/0195-agent-capability-profile.md`](0195-agent-capability-profile.md),
merged as `bdfdd8c` — defines what an agent source declares. Seam (b) —
[`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md),
merged as `b565e87` — defines what happens when nothing maps and guards the
`.claude/agents/` surface. Seam (c) — spec 0197 — defines the mapping, the
resolution rules, and the four core mappings. This spec adds no vocabulary, no
mapping cell and no resolution rule: it states what the build does with the
three. The organization-level override channel is seam (e), the migration of
the existing agent sources is seam (f), and the compiled-layout convention is
seam (g).

**Vocabulary.** The terms **target**, **mapping**, **offering**, **composite
offering**, **surface** (frontmatter, guidance, out-of-band), **resolution**,
**directed declination** and **drop** are used exactly as spec 0197 defines
them, and **capability profile**, **axis**, **rung** and **tuning knob**
exactly as spec 0195 defines them. Two terms are added here. The **emission**
is what a resolution's directed declination becomes in one compiled agent
output file — frontmatter fields, rendered guidance prose, or nothing. The
**diagnostic output** is the stream on which the build reports drop records
and diagnostic notes; spec 0195 requirement 22 and spec 0197 requirement 27
oblige it to exist and forbid its content from entering a compiled output, and
this spec fixes its destination and its shape.

**Named contradictions.** Three statements already on `main` are contradicted
or made incomplete by the change this spec specifies. Following the discipline
that a contradicted document is named rather than silently corrected, each is
recorded; the first two are repaired by requirements of this spec because they
are ordinary repository documents, and the third is not, because it sits in a
merged spec whose body is immutable.

**Contradiction 1 — `docs/layers.md` says the source of truth for the built
outputs is `artifacts/` alone.** Its *Built outputs* section states that the
compiled trees "are never edited directly; the source of truth is always
`artifacts/`". From the moment the build resolves a mapping, a compiled agent
output is a function of `artifacts/` **and** `model-mappings/`, and a change to
either regenerates it. Requirement 41 amends the sentence. Nothing about the
sync policy of those trees changes here — see Decision 6.

**Contradiction 2 — the `component-drift` capability does not watch
`model-mappings/`.** Its trigger `paths:` set in `ci/ci-capabilities.yml`
covers `scripts/build-components.sh`, `scripts/lib/**`, `artifacts/**`,
`extensions/**`, `.crewrig/core-paths.txt` and `docs/layers.md`, and its
`cache.files` set is the same list minus `docs/layers.md`. A pull request
changing a mapping alone would therefore leave stale compiled outputs
uncontested, and would do so while showing a green board — the drift job
having never run. Requirement 45 closes it.

**Contradiction 3 — `scripts/check-components.sh` does not exist.** Both the
parent spec 0143 requirement 4 and its delta-01 replacement name that script as
the checker that verifies compiled outputs against their sources. No such file
is in the tree; the drift check is `bash scripts/build-components.sh --target
all --check`, run by the `component-drift` capability. The replaced requirement
4 is discharged here against the script that exists, and the phantom name is
named rather than repaired: a merged spec's body is immutable, and correcting
it is a delta of spec 0143 that this ticket does not open.

**Decision 1 — the rendered guidance prose is appended to the compiled
`description`, and the compiled body is left untouched.** Spec 0197's own
definition of the guidance surface is "the instruction-bearing prose of that
same compiled agent output — the agent's `description`, or another part of it a
reader interprets as instruction — which the orchestrating model reads **when
it spawns the agent**". That last clause settles the placement. The body of a
compiled agent output becomes the spawned agent's own system prompt: it is read
after the spawn, by an agent that cannot change the model it is already running
on. A request placed there is addressed to the one reader who cannot honour it.
The `description` is the part of the output the orchestrating model reads at
the moment it decides what to spawn and on what, it is the cell probe C of
issue #1113 tests in its C3 and C4 legs, and it is the first surface spec 0197
names. The alternative — a fixed, marked block in the compiled body, which the
ticket proposed — is rejected on that ground alone, and on a second: a marked
block is a new structural convention in every compiled output, which is seam
(g)'s subject, while appending to a field the build already composes introduces
no convention at all. The cost is real and recorded: the `description` is also
what an orchestrator matches an agent against when choosing *which* agent to
spawn, so the appended sentences enter that matching. `## Open questions`
carries it; requirement 15 of spec 0197 bounds the cost of it being wrong to an
agent inheriting the session model.

**Decision 2 — drop records and diagnostic notes go to the build's diagnostic
output and to no committed file.** Spec 0195 Decision 4 hands this question
here, framing the argument it does not settle: "an output carrying build
commentary is an output whose drift guard now depends on that commentary". The
same argument reaches a committed *report* file, one step further out. A
committed report is a third artifact the drift guard must regenerate
byte-for-byte, and its content is a function of the mappings in force — so the
moment seam (e) lets an organization override a mapping cell, every fork's
report diverges from upstream's, and the guard that protects it becomes a guard
that fires on a correct tree. It would also be empty today, no agent source
declaring a profile, so committing it buys a diff no reader would read and a
guard no change would satisfy. The records go to the diagnostic stream, in a
fixed machine-readable line form so a test can pin them, and the build accepts
a caller-named destination for the same records so tooling and tests can
collect them without parsing an interleaved build log. Nothing is committed and
nothing enters a compiled output.

**Decision 3 — the profile validator lands here, as a hermetic check script
wired as its own CI capability.** Spec 0195 requirements 23 through 25 specify
a hermetic check over a declared profile and its own `## Out of scope` routes
the implementation to "seam (d) or seam (f)". It lands here for a mechanical
reason: the resolver must parse `metadata.model:` anyway, so the domains it
reads and the domains the check asserts are the same domains, and splitting
them across two tickets guarantees they drift. The precedent is
`check-model-mappings`, landed by part 1 — a hermetic script plus its own
mutation test suite, declared as one changeset-gated capability in
`ci/ci-capabilities.yml`, realized on both engines. The check is deliberately
*not* folded into the build: a build that refuses a malformed profile would
contradict requirement 15 of spec 0197, while an authoring-time gate that
refuses one contradicts nothing — the same two-instrument split spec 0197
Decision 8 draws between its checker and its resolution.

**Decision 4 — the resolver reads a mapping through exactly one resolution
point, and no rule of the resolution knows where a mapping came from.**
Requirements 6 and 7 of spec 0197 define the addressability the
organization-level override channel plugs into and forbid this spec's
predecessor from defining the channel. Honouring that here costs one
constraint: the build obtains "the mapping in force for target T" from a single
named point, and every rule downstream of it addresses the result only through
the grammar `docs/model-mapping-format.md` → *Addressing* publishes. Seam (e)
then replaces one function and touches no rule. The alternative — each rule
opening `model-mappings/<target>.yml` where it needs it — costs nothing today
and costs seam (e) a rewrite of the resolver, which is exactly the coupling
requirement 6 exists to prevent.

**Decision 5 — a source that declares no profile produces byte-identical
output, and that is a requirement rather than an expectation.** Requirement 45
of spec 0197 obliges the four core mappings to leave every committed compiled
output unchanged, and requirement 7 of spec 0143 delta-01 obliges the compiled
outputs to carry no `model:` field while no resolution applies. Both hold
trivially today because no agent source declares a profile, and both stop
holding trivially the moment this spec's code path exists — the path could
change an output for a profile-less source through an accident of assembly
order, a stray blank line, or a re-quoted `description`. So the invariant is
stated as its own requirement with its own test, and the whole-tree drift check
is what verifies it: `bash scripts/build-components.sh --target all --check`
must report zero drift on the tree this ticket merges.

**Decision 6 — the synchronization consequence of spec 0197 requirement 8 is
recorded here and acted on in seam (e).** That requirement names the
consequence and forbids resolving it in spec 0197: an organization-level
override changes a fork's compiled agent outputs, so the upstream
synchronization contract has to treat those outputs as regenerable artifacts
whose drift from upstream is acceptable while the build regenerates them from
the declarations in force. The condition that makes the drift possible is the
override channel, and the override channel is seam (e). Reclassifying the
compiled output trees now would weaken a guard against a state that cannot yet
arise, and a guard weakened ahead of its need protects nothing while looking
like it does. What lands here is the part that is true the day this ticket
merges: the compiled trees are regenerable from `artifacts/` **and**
`model-mappings/`, which is contradiction 1 above, and `docs/layers.md` says so
in the same diff. The reclassification of those trees and the amendment of the
`scripts/sync-from-upstream.sh` contract stay with seam (e), which is the
ticket that can state the condition under which the drift is acceptable,
because it is the ticket that creates it.

**Decision 7 — no requirement of this spec is conditioned on probe C.**
Probe C, issue #1113, is open in parallel and tests four cells: whether prose
naming a model in `.claude/agents/` disturbs a GitHub Copilot CLI reader (C1),
whether a non-`model` frontmatter key such as `effort:` is inert for that
reader (C2), and whether a Claude Code (C3) and an Antigravity CLI (C4)
orchestrator honour a description-borne request. Waiting on it would stall this
ticket behind an end-to-end run; guessing its outcome would bake an unverified
fact into a code path. Neither is necessary, because the build this spec
specifies is governed entirely by what a mapping declares. A refutation on C1,
C3 or C4 is absorbed by an edit to `model-mappings/*.yml` alone — a mapping
that declares no guidance surface emits no prose, and the resolver is not
touched. A refutation on C2 is the one case that reaches a merged spec: the
guard of spec 0197 requirements 30 and 31 withholds the `model:` field alone,
so widening it to `effort:` is a delta of spec 0197. Even there the build needs
no change, because the delta reaches it through the mapping. Requirement 43
states the property and requirement 44 states what each outcome costs.

**Complexity tier — `standard`.** The implementation adds a real code path to
`scripts/build-components.sh` and its library, a second hermetic check script
with its own mutation test suite, a CI capability realized on two engines, a
fixture corpus and a golden-output test suite, plus the co-maintenance
`AGENTS.md` requires of a change under `artifacts/` and of a change to a
CLI-specific integration point (`docs/cli-matrix.md`). That is a developer, a
tester and a reviewer, which is more than the single documentation surface a
`small` tier covers. It is not `large`: the design questions are settled here
at SPECS rather than deferred to sub-spec decomposition, the resolution rules
are inherited verbatim from a merged spec rather than designed, and the
deliverable is one code path with one validator beside it.

## Intent

An agent source that states what its work needs from a model gets that
statement turned into something each command-line interface understands, at the
moment the components are compiled. Where an interface has a native field for
the thing, the compiled agent carries the field; where it has none but its
orchestrator reads instructions, the compiled agent asks in prose for what it
needs; where the interface can express neither, the request is left out and the
person who ran the compilation is told exactly what was left out and why. An
agent source that states nothing produces exactly the file it produces today,
byte for byte. Nothing here can fail a compilation: an unreadable declaration,
an interface with nothing to offer, a request no available model serves — each
one quietly leaves the agent running on the model of the session that spawns
it, and says so. A statement an interface could never honour is caught when it
is written, not when it is compiled.

## Requirements

Requirements 1 through 6 bind the resolution's place in the build, 7 through 18
the resolution rules it inherits from spec 0197, 19 through 26 the per-target
emission, 27 through 31 the rendering of guidance prose, 32 through 35 the
diagnostic output, 36 through 39 the profile validator, 40 through 42 the
documentation surfaces, 43 through 44 the probe-C decoupling, and 45 through 48
the continuous-integration guards.

1. `scripts/build-components.sh` SHALL resolve each agent source it compiles
   against the mapping in force for each target it compiles that source for,
   and SHALL emit the outcome into that target's compiled agent output. Where a
   source carries no `metadata.model:` mapping, the outcome SHALL be *no
   resolution* and the emission SHALL be nothing, which is requirement 3 of
   spec 0195.
2. The build SHALL obtain the mapping in force for a target from exactly one
   named point, whose outcome SHALL be either one mapping or the recorded
   absence of one. Every rule of requirements 7 through 31 SHALL address that
   outcome only through the addressing grammar published in
   `docs/model-mapping-format.md` → *Addressing*, and SHALL NOT depend on a
   mapping's file path, on the number of mapping files present, or on any
   property of where a mapping was read from.
3. A target for which the named point of requirement 2 reports no mapping SHALL
   yield *no resolution* for every agent on that target, SHALL emit nothing, and
   SHALL be a supported state rather than an error — the state requirement 9 of
   spec 0197 defines for a mapping declaring zero offerings, extended to a
   mapping that is absent.
4. No resolution SHALL fail, block, or raise an error on the build, on any
   check, or on any agent, which is requirement 15 of spec 0197. A build in
   which every resolution degrades SHALL exit with the status it would have
   exited with had no source declared a profile, and every degradation SHALL be
   recorded on the diagnostic output alone.
5. A resolution's outcome and its emission SHALL each be a deterministic
   function of the agent source and the mapping in force, which is requirement
   28 of spec 0197, and SHALL NOT depend on the order in which sources are
   compiled, on the value of `--target`, or on the tier the source belongs to.
6. The resolution SHALL be exercisable against one named agent source and one
   named target without writing any compiled output, and that exercise SHALL
   report the same selected offering, the same directed items, the same drop
   records and the same diagnostic notes the build emits for the same pair.
7. A resolution SHALL select a model only where the profile declares the
   `intelligence` axis. Where the profile omits that axis, the resolution SHALL
   direct no model, SHALL drop every other declared selection axis with the
   reason `unserved-value`, and SHALL still direct the tuning knobs the target
   expresses on its frontmatter surface — requirement 16 of spec 0197.
8. Where the profile declares the `intelligence` axis, the candidate set SHALL
   be the offerings whose declared `intelligence` rung is at or above the
   declared rung; where no offering reaches the declared rung, the candidate set
   SHALL be the offerings at the highest rung the mapping declares. Neither
   outcome SHALL record a drop on the `intelligence` axis — requirement 17 of
   spec 0197, whose ceiling clause discharges requirement 9 of spec 0195 through
   requirement 18 of spec 0197.
9. The candidate set SHALL then be narrowed on `context`, `modalities`,
   `locality`, `specialization` and `speed`, in that order; a narrowing that
   would empty the candidate set SHALL be abandoned, leaving the candidate set
   unchanged, and SHALL record one drop for that axis with the reason
   `unserved-value` — requirement 19 of spec 0197.
10. A declared `specialization` value that no candidate offering serves SHALL
    fall back to the unconstrained value `general` and SHALL record one drop
    with the reason `unserved-value` — requirement 20 of spec 0197 and
    requirement 12 of spec 0195. The resolution SHALL owe nothing further on
    that axis.
11. Where the profile declares the `reasoning` axis and at least one candidate
    offering encodes a reasoning rung in its native value, the candidate set
    SHALL be narrowed to the offerings encoding the best-matching rung — the
    declared rung where a candidate encodes it, otherwise the nearest rung
    below it, otherwise the nearest rung above it — and a candidate encoding no
    reasoning rung SHALL be excluded from that narrowing while any candidate
    encodes one. This narrowing SHALL record no drop; where the rung it matches
    is not the declared rung it SHALL record one diagnostic note naming the
    declared rung and the encoded rung selected — requirements 21 and 22 of
    spec 0197.
12. The resolution SHALL select the lowest-ranked offering the narrowings of
    requirements 8, 9 and 11 leave, and SHALL direct that offering's
    `native-value` onto every surface the mapping declares for the `model` item
    — requirement 23 of spec 0197.
13. A declared `reasoning` rung SHALL be directed onto the target's frontmatter
    reasoning surface as the native value that surface's `projection` names for
    that rung; a rung the projection declares `unmapped` SHALL be dropped with
    the reason `out-of-range-for-target` and SHALL NOT be resolved to an
    adjacent rung — requirement 24 of spec 0197 and requirement 11 of spec 0195.
14. A declared `reasoning` rung SHALL be dropped with the reason
    `unsupported-on-model` where the selected offering declares
    `supports-reasoning-surface: false`, and likewise where no offering is
    selected — requirement 25 of spec 0197.
15. A declared tuning knob SHALL be directed onto the native key the target's
    frontmatter surface declares for it, and SHALL be dropped with the reason
    `out-of-range-for-target` where the declared value falls outside the domain
    that surface declares — requirement 26 of spec 0197. A tuning knob for which
    the target's frontmatter surface declares no item SHALL be dropped with the
    reason `unsupported-on-cli` — requirement 13 of spec 0197.
16. A declared item the target expresses on neither a frontmatter nor a guidance
    surface SHALL be dropped with the reason `unsupported-on-cli`, whether or
    not the mapping names an out-of-band surface for it — requirement 13 of
    spec 0197.
17. A mapping whose declared ranks are not a strict total order over its
    offerings, or one of whose cells the resolution cannot read, SHALL NOT fail
    the build: the unreadable cell SHALL degrade to *no resolution* for the
    items it governs, and the degradation SHALL be recorded on the diagnostic
    output — requirements 15 and 51 of spec 0197.
18. For a profile declaring `intelligence` and nothing else, the offering the
    resolution selects against a committed mapping SHALL be the offering
    `bash scripts/check-model-mappings.sh --print-selection` names for that
    mapping and that rung, for every one of the seven rungs and every one of the
    four committed mappings.
19. A resolution SHALL direct a declination only onto the frontmatter surface of
    a compiled agent output, its guidance surface, or both, and SHALL direct
    nothing onto an out-of-band surface a mapping names — requirement 11 of
    spec 0197.
20. The Claude Code emission SHALL write, into `.claude/agents/`, the native key
    the mapping's frontmatter surface declares for the `reasoning` item carrying
    the value requirement 13 directs, and SHALL write the native key that
    surface declares for the `model` item **only** while the mapping's guard is
    recorded `directed`. While that guard is recorded `withheld`, the emission
    SHALL write no `model:` frontmatter field, SHALL direct the model item onto
    the guidance surface instead, and SHALL record one diagnostic note naming
    the guard, the term that holds and the surface the model item was directed
    onto — requirements 29 through 32 of spec 0197 and requirement 8 of
    spec 0143 delta-01.
21. The Gemini CLI emission SHALL write, into `.gemini/agents/`, the native keys
    the mapping's frontmatter surface declares for the `model`, `temperature`
    and `max-turns` items, carrying the values requirements 12 and 15 direct.
    The mapping declaring no guidance surface, no prose SHALL be emitted for
    that target and every item that surface does not express SHALL be dropped
    per requirement 16.
22. The Gemini CLI emission of requirement 21 SHALL be enabled only alongside a
    recorded observation that Gemini CLI accepts those three keys on a
    `.gemini/agents/*.md` frontmatter — the re-probe spec 0197 → *Open
    questions* asks for before seam (d) emits — and that observation SHALL be
    recorded on the logbook issue. Where the observation establishes that the
    keys are refused, the emission SHALL NOT be enabled, the correction of the
    mapping SHALL be a delta of spec 0197 rather than a change to this spec's
    rules, and the compiled Gemini outputs SHALL stay byte-identical, which
    requirement 3 already yields for a mapping declaring no such surface.
23. The GitHub Copilot CLI emission SHALL write nothing into `.github/agents/`
    beyond what the build writes today, for every agent source, for as long as
    that mapping declares zero offerings and no guidance surface — requirements
    41 and 42 of spec 0197. Every declared item SHALL be dropped per
    requirement 16 and every drop SHALL be recorded.
24. The Antigravity CLI emission SHALL write no model frontmatter field into
    `.agents/agents/`, the mapping declaring no frontmatter surface, and SHALL
    carry the directed model item onto the guidance surface alone — requirement
    43 of spec 0197. Every tuning knob SHALL be dropped per requirement 16.
25. No emission SHALL introduce into a compiled agent output a second top-level
    `metadata:` key, and no emission SHALL place the source's `metadata.model:`
    mapping, any part of it, any drop record or any diagnostic note inside a
    compiled agent output — requirement 22 of spec 0195 and requirement 27 of
    spec 0197.
26. For an agent source carrying no `metadata.model:` mapping, every compiled
    output on every target SHALL be byte-identical to the output the build
    produced for that source before this spec was implemented, and
    `bash scripts/build-components.sh --target all --check` SHALL report zero
    drift on the tree that implements this spec — requirement 45 of spec 0197
    and requirement 7 of spec 0143 delta-01.
27. Rendered guidance prose SHALL be emitted into the compiled agent output's
    `description` field, after the description the source declares, and SHALL
    NOT be emitted into the compiled body. The compiled body SHALL remain
    byte-identical to the body the build produces for the same source today.
28. Rendering SHALL substitute, for each placeholder of the mapping's guidance
    `template`, the resolved native value of the item that placeholder names —
    `{{model}}` taking the selected offering's `native-value` and
    `{{reasoning}}` taking the value requirement 13 directs. A rendered template
    SHALL be emitted as a single line, every line break of the template becoming
    one space.
29. A sentence of the template whose placeholder names an item the resolution
    did not direct — dropped, unmapped, or absent from the profile — SHALL be
    omitted from the rendered prose, and the remaining sentences SHALL be
    emitted in template order. Where every sentence is omitted, no prose SHALL
    be emitted and the compiled `description` SHALL be byte-identical to the one
    the source declares.
30. Rendering SHALL be idempotent with respect to the source: a second build
    over an unchanged source and an unchanged mapping SHALL produce a
    byte-identical compiled output, and no rendered prose SHALL ever be appended
    to prose a previous build appended.
31. Where a rendered fragment cannot be emitted without altering the structure
    of the compiled output — a fragment that would not survive as the value of
    the `description` field — the fragment SHALL be omitted, the resolution
    SHALL degrade to *no resolution* for the items that fragment carried, and
    the degradation SHALL be recorded on the diagnostic output; the build SHALL
    NOT emit a malformed output and SHALL NOT fail.
32. Every drop the resolution produces SHALL be recorded as one record naming
    the agent, the target, the dotted path of the declared key, the declared
    value, and one reason from exactly `unsupported-on-cli`,
    `unsupported-on-model`, `out-of-range-for-target` and `unserved-value` —
    requirement 21 of spec 0195 and requirement 27 of spec 0197.
33. Drop records and diagnostic notes SHALL be emitted on the build's standard
    error stream, one record per line, fields in a fixed order separated by a
    single tab, each line opening with a token that distinguishes a drop record
    from a diagnostic note. The set of records emitted for a given tree SHALL be
    a deterministic function of the agent sources and the mappings in force —
    requirement 22 of spec 0195.
34. The build SHALL accept a caller-named destination to which it writes the
    same records in the same form. Absent that destination the records SHALL
    still be emitted per requirement 33. No such destination SHALL be committed
    to the repository, and the build SHALL write no committed report of drops or
    notes.
35. A build over a tree in which no agent source declares a profile SHALL emit
    no drop record and no diagnostic note.
36. A declared capability profile SHALL be verifiable by a check that is
    hermetic: decidable from the agent source and the domains spec 0195 defines
    alone, without network access, without an installed CLI, and without
    consulting any mapping — requirement 23 of spec 0195.
37. That check SHALL reject a `metadata.model:` value that is not a mapping, a
    key outside the sets requirement 19 of spec 0195 defines, a value outside a
    closed domain of requirements 6 and 10 through 17 of spec 0195, and a tuning
    value of the wrong type or outside its range — requirement 24 of spec 0195.
    It SHALL NOT reject a profile on the ground that no mapping in force serves
    it, and SHALL NOT reject a `specialization` value on the ground that spec
    0195 does not enumerate it — requirement 25 of spec 0195.
38. That check SHALL bind the `metadata.model:` mapping alone. A source
    carrying no such mapping SHALL be reported clean, and a source carrying
    `metadata.claude.model` — which every core agent source carries today and
    seam (f) removes — SHALL NOT be rejected on that ground.
39. That check SHALL be an authoring-time gate over a proposed change and its
    rejection SHALL NOT become a resolution failure: a profile the check would
    reject SHALL still be resolvable against under requirement 4, degrading the
    keys it cannot read.
40. `artifacts/FORMAT.md` SHALL document the `metadata.model:` block as an
    optional agent-source field: the eight keys requirement 19 of spec 0195
    admits, the five tuning knobs requirement 17 of spec 0195 admits, the closed
    domain of each, the meaning of an absent block, and where the mappings and
    the resolution that consume it live. That documentation SHALL carry the
    obligation that a later delta of spec 0195 changing one of those domains
    updates this section and the check of requirement 36 in the same change —
    the obligation `docs/model-mapping-format.md` → *Domains* already carries
    for the mapping side.
41. `docs/layers.md` → *Built outputs* SHALL state that a compiled agent output
    is regenerated from `artifacts/` and `model-mappings/` together. It SHALL
    NOT reclassify the sync policy of any compiled output tree, and SHALL NOT
    amend the contract of `scripts/sync-from-upstream.sh`; requirement 8 of
    spec 0197 hands both to seam (e).
42. `docs/cli-matrix.md` SHALL carry a row for the per-target emission of
    requirements 20 through 24, naming for each of the four targets what a
    resolution writes and what it withholds, per the *CLI Matrix Maintenance*
    obligation of `AGENTS.md`.
43. No requirement of this spec SHALL be conditioned on the outcome of probe C
    of issue #1113, and the build SHALL be implementable, mergeable and correct
    while that probe is unresolved.
44. Retiring a guidance surface SHALL require no change to the resolution rules
    of requirements 7 through 31: a mapping that declares no guidance surface
    SHALL emit no prose on its target, and the items that surface carried SHALL
    be dropped per requirement 16. Widening the guard of requirement 20 beyond
    the `model:` field SHALL be a delta of spec 0197 and SHALL likewise reach
    the build through the mapping alone.
45. The `component-drift` capability in `ci/ci-capabilities.yml` SHALL watch
    `model-mappings/**` in its trigger `paths:` sets and in its `cache.files`
    set, so that a change to a mapping alone runs the drift check and cannot
    pass on a cached result derived from a different mapping.
46. A change to a mapping whose regenerated compiled outputs are not committed
    in the same change SHALL fail the drift check of requirement 45.
47. The check of requirement 36 SHALL be declared as its own capability in
    `ci/ci-capabilities.yml`, changeset-gated, watching the check script, its
    test suite and `artifacts/**`, and SHALL be realized on both engines so that
    `bash scripts/build-ci.sh --check` and the CI-parity check pass.
48. The `check-model-mappings` capability SHALL remain the authoring-time gate
    over mapping content and SHALL NOT gate a resolution: a mapping that
    capability would reject SHALL still be resolvable against per requirement 17
    — requirement 51 of spec 0197.

## Scenarios

**Scenario:** the canonical example is emitted on Claude Code

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: medium
And   the Claude Code core default mapping, whose guard is recorded withheld
When  bash scripts/build-components.sh runs
Then  the resolution selects the haiku offering
And   the compiled .claude/agents/ output carries no model: frontmatter field
And   it carries no effort: frontmatter field either, the haiku offering
      declaring supports-reasoning-surface: false
And   its description ends with the sentence naming haiku, rendered from the
      mapping's guidance template
And   the reasoning sentence of that template is omitted, the reasoning item
      having been dropped
And   one drop record is written to standard error naming the agent, claude,
      metadata.model.reasoning, medium and unsupported-on-model
And   one diagnostic note is written naming the guard and the term that holds
```

**Scenario:** a profile-less source is byte-identical

```text
Given the repository tree as merged, in which no agent source declares a
      metadata.model mapping
When  bash scripts/build-components.sh --target all --check runs
Then  it reports zero drift
And   no drop record and no diagnostic note is written
And   no compiled agent output on any target carries a model: frontmatter field
```

**Scenario:** the resolver agrees with the mapping checker

```text
Given a profile declaring intelligence at one of the seven rungs and no other
      axis
And   one of the four committed mappings
When  the resolution of requirement 6 is exercised for that pair
Then  the offering it selects is the offering
      bash scripts/check-model-mappings.sh --print-selection names for that
      mapping and that rung
And   the agreement holds for all seven rungs of all four mappings
And   the copilot mapping names no offering for any rung, and the resolution
      likewise selects none
```

**Scenario:** a composite offering carries reasoning through selection

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: high
And   the Antigravity CLI core default mapping
When  bash scripts/build-components.sh runs
Then  the resolution selects the gemini-3.8-flash-high offering
And   the compiled .agents/agents/ output carries no model frontmatter field
And   its description ends with the sentence naming gemini-3.8-flash-high
And   no drop record is written for the reasoning axis
```

**Scenario:** an unconfigured target emits nothing

```text
Given an agent source whose metadata.model declares intelligence: xhigh and
      reasoning: high
And   the GitHub Copilot CLI core default mapping, which declares zero
      offerings and no guidance surface
When  bash scripts/build-components.sh runs
Then  the compiled .github/agents/ output is byte-identical to the output the
      same source produces with no profile at all
And   both declared items are dropped with the reason unsupported-on-cli
And   two drop records are written to standard error
```

**Scenario:** a target with no mapping file at all

```text
Given a supported target for which model-mappings/ carries no file
And   an agent source declaring a full capability profile
When  bash scripts/build-components.sh runs
Then  the build does not fail and no error is raised
And   the outcome for that target is no resolution and its compiled output is
      byte-identical to the profile-less output
And   the diagnostic output records that no mapping was in force for that target
```

**Scenario:** a malformed mapping cell degrades instead of failing

```text
Given a mapping one of whose offerings carries a native value outside the
      domain that mapping declares for its frontmatter model key
And   an agent source declaring a profile that would select that offering
When  bash scripts/build-components.sh runs
Then  the build does not fail and no error is raised
And   the unreadable cell degrades to no resolution for the items it governs
And   the compiled output carries no field derived from that cell
And   the diagnostic output records what could not be read
And   bash scripts/check-model-mappings.sh rejects that same mapping when it is
      proposed as a change
```

**Scenario:** an unknown profile key is refused at authoring time

```text
Given an agent source whose metadata.model declares a key named inteligence
When  the hermetic profile check runs against that source
Then  the check reports an error naming that key as one spec 0195 does not admit
And   the check reports no error for a sibling source declaring
      specialization: image-generation, an unenumerated value of an open enum
And   the check reports no error for a source carrying metadata.claude.model
      and no metadata.model mapping
And   bash scripts/build-components.sh still compiles the offending source
      without failing, degrading the key it cannot read
```

**Scenario:** a mapping change without regenerated outputs fails the drift check

```text
Given a change that edits model-mappings/claude.yml and commits no regenerated
      compiled agent output
And   at least one agent source declaring a capability profile
When  the continuous-integration pipeline runs on that change
Then  the component-drift capability is triggered, model-mappings/** being in
      its path set
And   bash scripts/build-components.sh --target all --check reports drift
And   the change fails
```

**Scenario:** a guidance surface is retired without touching the resolver

```text
Given probe C of issue #1113 returns DISTURBED for its C1 cell
And   the guidance surface is removed from model-mappings/claude.yml, no other
      file being changed
When  bash scripts/build-components.sh runs
Then  no prose is rendered into any .claude/agents/ description
And   the model item is dropped with the reason unsupported-on-cli and recorded
And   no rule of the resolution and no line of the emission is changed
```

## Out of scope

- The organization-level override channel — its location, its filename, its
  format, its precedence over core entries, and its exclusion from upstream
  synchronization. Seam (e). Requirement 2 gives that channel its single
  substitution point and nothing more.
- The reclassification of the compiled output trees in `docs/layers.md` and the
  amendment of the `scripts/sync-from-upstream.sh` contract that requirement 8
  of spec 0197 names as a consequence. Seam (e), per Decision 6. Requirement 41
  records the regenerability and changes no policy.
- The migration of the 22 core agent sources to `metadata.model:` profiles and
  the removal of `metadata.claude.model` from them. Seam (f). Requirement 26 is
  the invariant that keeps this ticket's tree unchanged until that migration
  lands; requirement 38 is what keeps the validator quiet about the legacy key
  in the meantime.
- The compiled-layout convention for agent outputs. Seam (g). Requirements 20
  through 24 name output surfaces as directories, never as file patterns within
  them, so the convention is free to change without a delta of this spec.
- Directed emission onto any out-of-band surface — Gemini CLI's `settings.json`
  `modelConfigs.overrides`, GitHub Copilot CLI's `~/.copilot/config.json`
  `subagents.agents.<name>`, and every session-level flag of every target.
  Requirement 19 forbids it; promoting one is an additive delta of spec 0197.
- Any change to the normative text of specs 0195, 0197, 0143 or its delta-01.
  The three contradictions named above are named, not repaired; the two that
  sit in ordinary repository documents are corrected by requirements 41 and 45.
- A committed report of drop records or diagnostic notes, per Decision 2. The
  question spec 0195 → *Out of scope* hands here is answered no.
- Model declaration for skills and commands, and the `disable-model-invocation`
  field. The resolution serves agent sources alone, which is requirement 1 of
  spec 0195.
- Runtime routing. Nothing here changes a target's session default model, its
  interactive model picker, or the behavior of its Auto router.
- The execution of probe C itself, and any delta of spec 0197 its verdicts
  warrant. Issue #1113, per Decision 7.

## Open questions

Each item carries what the content gate owes it: **confirm** where a maintainer
decision is asked for, **audit** where the item is recorded for the record and
no closure is owed on the logbook issue.

- [GROUNDING:] **confirm.** `artifacts/FORMAT.md` on `main` at `f8336dc`
  documents no `metadata.model:` block — no occurrence of the key, of
  "capability profile", or of any axis name — and no agent source under
  `artifacts/core/agents/` or `artifacts/library/agents/` carries one; all 22
  core sources carry `metadata.claude.model` instead. Requirement 40 mandates
  the section. Back-fill responsibility: the implementation PR of this spec adds
  the section and back-fills **no** agent source, seam (f) owning the migration
  per `## Out of scope`. The maintainer is asked to confirm that assignment at
  the content gate, the alternative being a separate documentation ticket
  against spec 0195.
- [GROUNDING:] **confirm.** Decision 1 places the rendered guidance prose in the
  compiled `description`, which is also the text an orchestrator matches an
  agent against when choosing *which* agent to spawn. Appending a model request
  to it therefore enters that matching, and no probe covers the effect —
  probe C's C3 and C4 cells test whether a description-borne request is
  *honoured*, not whether the appended sentences perturb *selection*. The
  maintainer is asked to confirm the placement at the content gate; requirement
  4 bounds the cost of it being wrong to an agent inheriting the session model,
  and requirement 44 makes withdrawal a one-file mapping edit.
- [GROUNDING:] **audit.** Requirement 22 makes the Gemini frontmatter emission
  conditional on the re-probe spec 0197 → *Open questions* asks for. The
  repository currently asserts the opposite of what that emission needs, in two
  places: the comment above the Gemini branch of `build_agents` in
  `scripts/build-components.sh` and `docs/cli-matrix.md` row 4b both state that
  "Gemini CLI 0.42.0+ rejects any frontmatter key outside `name` /
  `description`", a phrasing spec 0197 records as broader than the claim
  actually tested. Whichever way the re-probe lands, one of the two documents
  and the mapping's frontmatter surface will need correcting; the correction of
  the mapping is a delta of spec 0197 and is out of scope here. Recorded for
  audit.
- [GROUNDING:] **audit.** `scripts/check-components.sh`, named by requirement 4
  of spec 0143 and by its delta-01 replacement as the checker that verifies
  compiled outputs against their sources, does not exist in the tree. The check
  that exists is `bash scripts/build-components.sh --target all --check`, run by
  the `component-drift` capability, and requirements 26 and 46 are stated
  against it. Named rather than repaired: a merged spec's body is immutable and
  the correction is a delta of spec 0143 this ticket does not open.
- [GROUNDING:] **audit.** `artifacts/FORMAT.md` → *Build Outputs* → *Agent*
  illustrates the Gemini agent output as carrying a `metadata.provenance`
  frontmatter block. The build emits no such block for that target: it bypasses
  the provenance splice and writes an HTML comment on the first body line
  instead, which `docs/cli-matrix.md` row 4b describes correctly. The drift
  predates this ticket and sits in the same document requirement 40 amends;
  recorded for audit rather than folded into this spec's scope.
- [GROUNDING:] **audit.** Spec 0195 has no implementation ticket of its own —
  its `related-issue` #1109 is closed, and the epic's open children are this
  ticket and probe C alone — while the spec carries `status: approved` and its
  sole named deliverable is the `artifacts/FORMAT.md` section requirement 40
  assigns here. Whether this ticket's implementation PR also records spec 0195's
  `approved` → `implemented` transition, or whether that transition is
  explicitly deferred, is a lifecycle question for the logbook. Recorded for
  audit; no closure is owed here.
- [GROUNDING:] **audit.** `scripts/check-model-mappings.sh --print-selection`
  prints an absolute mapping path in its first column, so the agreement test of
  requirement 18 pins the rung and offering columns alone. Pinning the whole
  line would embed a machine-specific path, which
  `scripts/check-no-machine-paths.sh` exists to prevent. Recorded for the test
  strategy at PLAN.
