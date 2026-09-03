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
an admissible source for a mapping cell in this spec; the live install is. Two
cells rest on a second kind of evidence, recorded as such: a decision the
maintainer took at this spec's content gate, cited below as *the content gate
of issue #1111*.

**Vocabulary.** A **target** is one supported CLI, named by the identifier that
repository tooling already uses for it — `claude`, `gemini`, `copilot`,
`antigravity`. A **mapping** is the committed artifact that translates a
capability profile into one target's native declination. An **offering** is one
entry of a mapping describing a model the target can reach, the characteristics
that model provides, and the native value that names it. A **composite
offering** is one whose native identifier itself **encodes** one or more of
those characteristics — Antigravity CLI's `gemini-3.8-flash-high` encodes both
a capability class and a reasoning level in a single token — so that the
characteristic is served by choosing the identifier rather than by setting a
second field.

A **surface** is a place a target expresses a declared item, and there are
exactly three kinds. The **frontmatter surface** is the set of native
frontmatter fields of the compiled agent output. The **guidance surface** is
the instruction-bearing prose of that same compiled agent output — the agent's
`description`, or another part of it a reader interprets as instruction — which
the **orchestrating model** reads when it spawns the agent, and through which a
declination is stated as a request rather than as a field. The **out-of-band
surface** is any other place the target expresses the item: a session flag, a
user configuration file. The first two are parts of the compiled agent output;
the third is not.

A **resolution** is the term
[spec 0143 delta-01](0143-copilot-subagent-model-fallback.delta-01.md) defines:
the outcome, for one agent and one target, of resolving that agent's capability
profile against the mapping in force. Its outcome is either a **directed
declination** — the native values the target is to receive, each on a named
surface — or **no resolution**, which is the fallback path requirement 6 of
that delta establishes: the agent runs on the orchestrating session's model, by
transitivity. To **drop** an item is what
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
and the projection-totality assertion this ticket asked a checker to make over
that table retires with it, requirement 49's general selection-totality
assertion taking its place. The Antigravity mapping declares no frontmatter
surface, and states its declination on the guidance surface instead — the
strategy the maintainer directed at the content gate of issue #1111, and the
subject of Decision 6. Recorded for the maintainer to confirm in
`## Open questions`.

**Premise 2 — Gemini CLI's reasoning knobs are not an agent-frontmatter
surface.** Epic #1100 lists Gemini 3 `thinking_level` as the CLI's reasoning
surface alongside its agent-file `model:`. On Gemini CLI 0.46.0 the agent file
(`.gemini/agents/*.md`) natively carries `model`, `temperature` and `max_turns`
and nothing else of interest here; `thinkingLevel`, `thinkingBudget`, `topP`,
`topK` and `maxOutputTokens` are reachable only through `settings.json`
`modelConfigs.overrides`, matched to an agent by `overrideScope`. **Consequence:**
a mapping states, per item, which surface expresses it, and the three surfaces
are not interchangeable.

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
takes the cheapest sufficient one, which bounds the cost surprise to one step
and admits no capability surprise at all. The one place the rule cannot hold is
the ceiling: where no offering reaches the rung, selection keeps the offerings
at the highest rung the mapping declares, which is exactly the best-available
projection spec 0195 requirement 9 mandates for `xxhigh` and `max`. That
requirement of spec 0195 is therefore a corollary of the floor rule rather than
a special case bolted beside it, and the rule is total over the seven rungs for any mapping with at
least one offering.

**Decision 3 — a resolution directs a declination into the compiled agent
output and nowhere else, across two surfaces of it.** Three of the four targets
express something relevant in a place that is not the compiled agent output:
Gemini's `settings.json`, Copilot's `~/.copilot/config.json`, Antigravity's
session flags. Spec 0143 and its delta are written about the compiled agent
output and about nothing else, and Copilot's is a user-scope file outside any
repository build's reach. A mapping therefore **names** an out-of-band surface
as recorded evidence of where the target expresses an item, and that naming
directs nothing: an item the target expresses on neither the frontmatter nor
the guidance surface is dropped. Promoting an out-of-band surface to a directed
one is an additive change a later delta of this spec can make once seam (d)
establishes a mechanism, which is cheaper than specifying a mechanism now for a
surface no build writes.

**Decision 4 — the guard of spec 0143 delta-01 requirement 8 withholds the
frontmatter `model:` field alone, and a Claude Code resolution still applies
under it.** The first draft of this spec made the guard suppress the whole
resolution, because the delta's replaced requirement 2 obliges a compiled output
to carry the declination "where a resolution does apply", and a resolution whose
emission was suppressed would have contradicted it. Decision 6 removes the
dilemma rather than dodging it: the declination can be carried in the compiled
output as prose instead of as a field. The re-derivation against the delta is
exact, clause by clause. Its replaced requirement 1 prohibits a `model:`
**frontmatter field** whose value has an origin other than a resolution, and
requirement 8 conditions "`model:` emission into the `.claude/agents/` output
surface" — both name that field, and prose naming a model is not it. Its
replaced requirement 2 obliges the compiled output to carry "the declination the
resolution names" and prescribes no field through which to carry it, so a
guidance-surface statement discharges it. Its requirement 7 asserts that the
outputs carry no `model:` frontmatter field while no resolution applies
anywhere, and a guidance-only direction emits no such field in any case. So
under the withheld guard a Claude Code resolution applies, its declination
reaches the compiled output as prose, and every clause of the delta holds
without strain. What the guard buys is unchanged: no `model:` field enters
`.claude/agents/`, which is the surface a GitHub Copilot CLI reader consumes and
the field its routing defect keys on.

**Decision 5 — the core mappings declare only what the live install grounds.**
An ungrounded characteristic is absent from the mapping rather than assumed
into it, and a declaration that the absent characteristic would have served is
dropped and reported. This is why the Claude offerings carry no context window
and no modality list: nothing on disk states them. The cost is a mapping that
serves fewer declarations than it eventually will; the benefit is that no
resolution rests on a guess, every cell is re-derivable from a cited
observation, and each later delta that adds a cell arrives with its own
evidence. The admitted exception is a characteristic the maintainer decided at a
gate, which is carried as an explicit assumption rather than smuggled in as a
fact — the Haiku carve-out, the efficacy of the guidance surface, and the
capability ranking of the Gemini and Antigravity identifiers are all marked that
way.

The same discipline settles a smaller choice. The Claude Code mapping names
family aliases rather than concrete model identifiers, because the alias form is
what the live probe grounds — `claude --help` illustrates its `--model` domain
with aliases — while the concrete identifiers are the one thing the probe found
inconsistent on disk, that same help text printing `claude-fable-5` where the
current identifier is `claude-fable-5-1`. An alias also survives a vendor point
release, which is the staleness epic #1100 exists to end. Gemini CLI and
Antigravity CLI get the opposite treatment for the same reason: their on-disk
sources illustrate their model surfaces with concrete identifiers and document
no alias domain, so concrete identifiers are what those mappings name.

**Decision 6 — the orchestrator-guidance surface.** A declination does not have
to be a field. The maintainer's observation at the content gate of issue #1111
is that a Claude Code session, asked in prose to run a given kind of agent on a
given model, does so — with no declaration in the agent source at all. That
makes the instruction-bearing prose of a compiled agent output a real surface,
and it is the surface that unlocks the two targets a field-only design left
stranded: Claude Code, whose frontmatter `model:` is withheld by the guard, and
Antigravity CLI, which has no per-agent frontmatter surface to withhold. Both
now state their declination as a request the orchestrating model reads. The
surface is deliberately weaker than a field, and the spec says so rather than
pretending otherwise: an orchestrator *may* honor the request, where a field
*is* the configuration. Two things about it are unverified and marked as
assumptions in the mapping files — that orchestrators honor such guidance
reliably, for which the maintainer's live experience is the whole of the
evidence; and that prose naming a model inside `.claude/agents/` does not itself
disturb a GitHub Copilot CLI reader, which probe A never tested because every
one of its legs set a `model:` field. `## Open questions` proposes probe C in
the issue #1103 harness to settle the second, covering the neighbouring cell in
the same run: whether a non-`model` frontmatter key such as `effort:` is
likewise inert for that reader.

**Decision 7 — composite offerings, and reasoning served by model selection.**
Some targets do not separate the model from its reasoning level: Antigravity
CLI's `agy models` lists `gemini-3.8-flash-high` and `gemini-3.8-flash-low` as
two identifiers, not one identifier with a dial, and the vendor family names of
Gemini CLI encode a capability class the same way. An offering therefore
declares which of the characteristics it provides its own identifier
**encodes**, and selection matches on those: among the candidates the
intelligence floor leaves, the offering whose encoded reasoning rung best
matches the declared one is preferred — exactly, else the nearest lower rung,
else the nearest higher. Nearest *lower* first, because a reasoning rung states
the depth the work needs and the cheaper neighbour is the one a cost-conscious
default should reach for before the dearer one; the ordering is fixed here so
that two implementations cannot disagree. This is model selection, not
approximation of what the target receives, which spec 0195 requirement 20
carves out in its own last sentence — so an inexact encoded match records **no**
drop, and instead a diagnostic note, because a reader who asked for `medium` and
got an identifier that says `low` deserves to be told without being told that
something was omitted.

**Decision 8 — no resolution ever fails.** The maintainer's direction at the
content gate of issue #1111 is that a failure to associate an agnostic mapping
with a real model must never block: keeping the same model by transitivity is
always preferable to an error. So a resolution has no failure outcome at all.
A malformed mapping cell, a profile no offering serves, a target with no mapping,
a withheld guard — each degrades to the fallback path of spec 0143 delta-01
requirement 6, the agent running on the orchestrating session's model, with the
whole account of what happened on the diagnostic output. The hermetic checker
keeps its teeth, because it is a different instrument at a different moment: it
fails a pull request that proposes a malformed mapping, which is authoring-time
feedback to a human, and it never runs as part of a resolution. The two
instruments meet only in that a mapping the checker would reject can still be
resolved against, degrading cell by cell.

**Complexity tier — `standard`.** The implementation creates a new class of
committed artifact (four mapping files), a normative format document for it, and
a hermetic checker over it, plus the co-maintenance `AGENTS.md` requires of a
new core-layer path in `docs/layers.md` and `.crewrig/core-paths.txt` and a
`docs/cli-matrix.md` row. The guidance surface of Decision 6 adds a template to
two of the four mapping files and a rendering obligation on seam (d); it adds no
new artifact class and no new checker, since the template is validated by the
same hermetic check as every other cell. That is more than the single
documentation surface a `small` tier covers, and it warrants a developer, a
tester and a reviewer. It is not `large`: the design questions are settled here
at SPECS rather than deferred to sub-spec decomposition, and the deliverable is
one coherent artifact class rather than several.

## Intent

Each supported command-line interface has one committed file that says which
models it can reach, what each of those models provides, and how the
characteristics an agent declares turn into something that interface
understands. An agent that declares it needs medium capability and medium
reasoning gets the cheapest model that is at least that capable, stated as a
native field where the interface has one and as an instruction to whoever spawns
the agent where it does not; anything the chosen model cannot express is left
out rather than approximated, with a record of every omission on the output of
whoever ran the translation. Nothing here can fail: an interface with no file,
a declaration nothing serves, a file with a bad entry — each one quietly leaves
the agent running on the model of the session that spawned it, and says so. A
declaration an organization wants changed is changed in its own file, entry by
entry, without touching the ones upstream ships.

## Requirements

Requirements 1 through 9 define the mapping artifact and its extension point,
10 through 14 its surfaces, 15 through 28 the resolution rules, 29 through 33
the shared-read guard, 34 through 45 the content of the four core default
mappings, and 46 through 51 the validation surface.

1. The framework SHALL carry, for each supported target, at most one core-level
   default mapping, and each such mapping SHALL be a single committed file in
   the core layer, at `model-mappings/<target>.yml`, whose name identifies the
   target it serves.
2. A mapping file SHALL be classified in the layer boundary contract
   (`docs/layers.md`) and in the synchronization manifest
   (`.crewrig/core-paths.txt`) as core-owned and upstream-owned.
3. A mapping SHALL declare the target it serves, and that declaration SHALL
   agree with the target its filename identifies.
4. A mapping SHALL declare, for each surface it names, that surface's kind and —
   for a frontmatter surface — the native key it uses for each item and the
   domain of values that key admits; and SHALL declare, for each offering, a
   stable identifier unique within the file, a rank unique within the file, the
   native value that names the model, the characteristics of spec 0195 that the
   model provides, and which of those characteristics the native value itself
   encodes.
5. Every offering, every surface item and every guard term a mapping declares
   SHALL carry either a citation of the observation that grounds it or an
   explicit statement that it is an assumption, and SHALL NOT carry both and
   SHALL NOT carry neither.
6. A mapping's offerings, surfaces, guidance templates and guard state SHALL
   each be individually addressable by a stable identifier.
7. The organization-level override channel of seam (e) SHALL be able, through
   the addressability of requirement 6, to add or replace an offering, a
   surface, a guidance template or a guard state on any target, and to declare a
   mapping for a target the core layer leaves unconfigured. This spec SHALL
   define that addressability and SHALL NOT define the channel, its location,
   its format or its precedence.
8. This spec SHALL record, and SHALL NOT resolve, the synchronization
   consequence of requirement 7: an organization-level override changes the
   compiled agent outputs of a fork, so the upstream synchronization contract
   has to treat committed compiled agent outputs as regenerable artifacts whose
   drift from upstream is acceptable for as long as the build regenerates them
   from the declarations in force and its drift check passes against that
   regeneration. Amending `docs/layers.md` and the contract of
   `scripts/sync-from-upstream.sh` to that effect is handed to seams (d) and
   (e) and SHALL NOT be attempted here.
9. A mapping MAY declare zero offerings. A mapping declaring zero offerings
   SHALL yield *no resolution* for every agent on its target, and the target
   SHALL be a supported, unconfigured state rather than an error.
10. A mapping SHALL express every item through exactly one of three surface
    kinds — the frontmatter surface and the guidance surface, both parts of the
    compiled agent output, and the out-of-band surface, which is not.
11. A resolution SHALL direct a declination only into the compiled agent output,
    onto its frontmatter surface, its guidance surface, or both, and SHALL NOT
    direct anything onto an out-of-band surface.
12. A mapping SHALL name each out-of-band surface on which its target expresses
    an item this vocabulary can declare, together with the items concerned.
    Naming an out-of-band surface SHALL direct no emission.
13. A declared item whose target expresses it on neither a frontmatter nor a
    guidance surface SHALL be dropped with the reason `unsupported-on-cli`,
    whether or not an out-of-band surface for it is named.
14. A mapping declaring a guidance surface SHALL declare the template through
    which a directed declination is stated, and which declination items that
    template carries. The template SHALL state the declination as prose
    addressed to the model that spawns the agent, and SHALL introduce no
    frontmatter field. Where one item is directed onto both the frontmatter and
    the guidance surface, both SHALL state the same resolved value, and the
    frontmatter field SHALL be the authoritative one.
15. A resolution SHALL NOT fail, block, or raise an error on the build, on any
    check, or on the agent. Every situation this spec's rules leave unresolvable
    — a malformed or unreadable mapping cell, a profile no offering serves, a
    target carrying no mapping, a guard withholding a surface — SHALL degrade to
    the fallback path of requirement 6 of spec 0143 delta-01, the agent running
    on the orchestrating session's model, and SHALL be recorded on the
    diagnostic output alone.
16. A resolution SHALL select a model only where the profile declares the
    `intelligence` axis. Where the profile omits that axis, the resolution SHALL
    direct no model, SHALL drop every other declared selection axis with the
    reason `unserved-value`, and SHALL still direct the tuning knobs the target
    expresses on its frontmatter surface.
17. Where the profile declares the `intelligence` axis, the resolution SHALL
    form its candidate set from the offerings whose declared `intelligence` rung
    is at or above the declared rung; where no offering reaches the declared
    rung, the candidate set SHALL be the offerings at the highest rung the
    mapping declares. Neither outcome SHALL record a drop on the `intelligence`
    axis.
18. The selection of requirement 17 SHALL satisfy requirement 9 of spec 0195:
    both the `xxhigh` rung and the `max` rung SHALL project onto the best model
    the mapping makes available for that target wherever the mapping declares at
    least one offering.
19. The remaining selection axes SHALL narrow the candidate set of requirement
    17 in this order — `context`, `modalities`, `locality`, `specialization`,
    `speed` — and a narrowing that would empty the candidate set SHALL instead
    be abandoned, leaving the candidate set unchanged, and SHALL record one drop
    for that axis with the reason `unserved-value`.
20. A declared `specialization` value that no candidate offering serves SHALL
    fall back to the unconstrained value `general` and SHALL record one drop
    with the reason `unserved-value`, per requirement 12 of spec 0195. A core
    mapping SHALL owe nothing beyond that fallback.
21. Where the profile declares the `reasoning` axis and at least one candidate
    offering encodes a reasoning rung in its native value, the candidate set
    SHALL be narrowed to the offerings encoding the best-matching rung, which
    SHALL be the declared rung where a candidate encodes it, otherwise the
    nearest rung below it, otherwise the nearest rung above it. A candidate
    encoding no reasoning rung SHALL be excluded from that narrowing while any
    candidate encodes one.
22. The narrowing of requirement 21 is model selection and SHALL NOT record a
    drop, per the delimitation requirement 20 of spec 0195 states in its own
    terms. Where the rung it matches is not the declared rung, the resolution
    SHALL record one diagnostic note naming the declared rung and the encoded
    rung selected; that note SHALL NOT be a drop record.
23. The resolution SHALL select the lowest-ranked offering the narrowings of
    requirements 17, 19 and 21 leave, and SHALL direct that offering's native
    value onto every surface the mapping declares for the model item.
24. A mapping whose target expresses reasoning on its frontmatter surface SHALL
    declare, for each of the six reasoning rungs, either the native value in
    that surface's domain onto which the rung projects, or that the rung is
    unmapped. A rung declared unmapped SHALL be dropped with the reason
    `out-of-range-for-target`, and SHALL NOT be resolved to an adjacent rung.
25. An offering SHALL declare whether the model it names supports the target's
    frontmatter reasoning surface. A declared reasoning rung SHALL be dropped
    with the reason `unsupported-on-model` where the selected offering declares
    no such support, and likewise where no offering is selected; the drop SHALL
    be recorded and SHALL NOT raise an error.
26. A declared tuning knob SHALL be directed onto the native key the target's
    frontmatter surface declares for it, and SHALL be dropped with the reason
    `out-of-range-for-target` where the declared value falls outside the domain
    that surface declares.
27. Every drop this spec's resolution rules produce SHALL be recorded exactly as
    requirements 20 through 22 of spec 0195 specify: one record per dropped
    item, naming the agent, the target, the dotted path of the declared key, the
    declared value and one reason from the closed set; emitted on the diagnostic
    output of whatever performed the resolution; never placed inside a compiled
    agent output; and never failing the resolution.
28. A resolution's outcome SHALL be a deterministic function of the agent source
    and the mapping in force, and the ranks a mapping declares SHALL be a strict
    total order over its offerings, so that requirement 23 names exactly one
    offering whenever the candidate set is not empty.
29. The Claude Code mapping SHALL declare a guard encoding requirement 8 of spec
    0143 delta-01, and that guard SHALL be evaluable from the mapping alone by
    whatever performs the resolution.
30. The guard SHALL declare exactly two terms — that the upstream defect
    `github/copilot-cli#4437` is not established fixed, and that a GitHub
    Copilot CLI reader may consume the `.claude/agents/` surface — each carrying
    the evidence that establishes its recorded state.
31. The guard SHALL admit exactly two states. In the **withheld** state, in
    force while either term holds, a resolution for Claude Code SHALL direct no
    `model:` field onto the frontmatter surface and SHALL direct the model item
    of its declination onto the guidance surface instead; every other item of
    the declination SHALL be directed as requirements 16 through 26 select. In
    the **directed** state, in force only while neither term holds, the model
    item SHALL additionally be directed onto the frontmatter surface.
32. A resolution performed under a guard in the withheld state SHALL record one
    diagnostic note naming the guard, the term that holds, and the surface the
    model item was directed onto instead. That note SHALL NOT be a drop record
    and SHALL NOT be placed inside any compiled agent output.
33. A change of the guard's recorded state to **directed** SHALL carry, in the
    mapping, the evidence requirement 8 of spec 0143 delta-01 demands, and SHALL
    NOT be made on the strength of an indeterminate or absent observation.
34. The Claude Code mapping SHALL declare a frontmatter surface with the native
    key `model`, whose domain this mapping declares as exactly the four family
    aliases `haiku`, `sonnet`, `opus` and `fable` rather than concrete model
    identifiers, and the native key `effort`, whose domain is `low`, `medium`,
    `high`, `xhigh` and `max`. It SHALL declare no tuning knob on that surface,
    so that all five knobs of spec 0195 are dropped with the reason
    `unsupported-on-cli`.
35. The Claude Code mapping SHALL declare a guidance surface whose template
    carries the model item and the reasoning item. The efficacy of that surface
    SHALL be carried as an assumption citing the maintainer's observation at the
    content gate of issue #1111, and SHALL NOT be carried as a citation of the
    live-verification research report, which tested no orchestrator behavior.
36. The Claude Code mapping SHALL declare exactly four offerings, ranked
    ascending — `haiku` providing the `medium` rung, `sonnet` the `high` rung,
    `opus` the `xhigh` rung, and `fable` the `xxhigh` rung — each encoding its
    `intelligence` rung in its alias and encoding no reasoning rung. It SHALL
    project the six reasoning rungs onto the `effort` domain identically for
    `low` through `max` and as unmapped for `none`, and SHALL declare the
    `haiku` offering as supporting no frontmatter reasoning surface, so that a
    reasoning rung declared alongside it is ignored rather than emitted or
    refused. That last declaration SHALL be carried as an assumption on the
    per-model fact and SHALL cite the content gate of issue #1111 for the
    behavior.
37. The Claude Code mapping's guard SHALL be recorded in the **withheld** state,
    both of its terms holding: probe run `20260902T153919Z-0aa9` of issue #1103
    returned the verdict `BUG-PRESENT` against `github/copilot-cli#4437` on
    GitHub Copilot CLI 1.0.82, and the same run's control leg is direct live
    evidence that GitHub Copilot CLI consumes the `.claude/agents/` surface.
38. The Gemini CLI mapping SHALL declare a frontmatter surface with the native
    key `model`, admitting the concrete identifiers its offerings name; the
    native key `temperature`, admitting `0.0` through `2.0`; and the native key
    `max_turns`, admitting integers of at least `1`.
39. The Gemini CLI mapping SHALL declare exactly three offerings, ranked
    ascending — `gemini-3.1-flash-lite` providing the `low` rung,
    `gemini-3.5-flash` the `medium` rung, and `gemini-3.1-pro-preview` the
    `high` rung — each encoding its `intelligence` rung in its family name and
    encoding no reasoning rung.
40. The Gemini CLI mapping SHALL name `settings.json` `modelConfigs.overrides`,
    matched by `overrideScope`, as the out-of-band surface carrying reasoning,
    `top-p`, `top-k` and `max-output-tokens`, and SHALL declare no guidance
    surface, so that each of those four items is dropped with the reason
    `unsupported-on-cli`. Directing reasoning onto a guidance surface for this
    target SHALL await an observation that a Gemini CLI orchestrator honors such
    a request, which the research report does not supply.
41. The GitHub Copilot CLI mapping SHALL declare zero offerings and SHALL record
    the ground for that state: the model lineup actually served to that CLI is a
    property of the deployment rather than of the core layer, since a
    GitHub-routed deployment and a bring-your-own-key deployment reach disjoint
    sets, and naming a model the deployment does not serve reproduces the silent
    routing failure of `github/copilot-cli#4437`, adjudicated `BUG-PRESENT` on
    run `20260902T153919Z-0aa9`. It SHALL name both surfaces it observes — the
    agent file's `model` key, and `~/.copilot/config.json`
    `subagents.agents.<name>` carrying `model`, `effortLevel` and `contextTier`
    — as recorded evidence directing no emission.
42. The GitHub Copilot CLI mapping SHALL state the condition a later delta must
    meet to declare an offering: either `github/copilot-cli#4437` is established
    fixed, or the offerings are restricted to models the deployment's provider
    is established to serve — which, being deployment knowledge, reaches a
    mapping through the organization-level override channel of seam (e) rather
    than through the core layer. The guidance surface of requirement 14 SHALL
    NOT be read as lifting that condition, because the ground for it is the
    unknown lineup rather than an absent field, and prose naming an unserved
    model misdirects an orchestrator exactly as a field does.
43. The Antigravity CLI mapping SHALL declare no frontmatter surface, SHALL
    declare a guidance surface whose template carries the model item, and SHALL
    NOT declare a projection onto any session-level flag. Its guidance surface
    SHALL carry the same assumption requirement 35 imposes on Claude Code's.
    Having no frontmatter surface, that mapping expresses none of the five
    tuning knobs of spec 0195, each of which is therefore dropped with the
    reason `unsupported-on-cli`.
44. The Antigravity CLI mapping SHALL declare exactly six composite offerings,
    ranked ascending, drawn from the fourteen identifiers `agy models` reports —
    `gemini-3.8-flash-low`, `gemini-3.8-flash-medium` and `gemini-3.8-flash-high`
    each providing the `medium` rung and encoding the reasoning rung their suffix
    names; `gemini-3.1-pro-low` and `gemini-3.1-pro-high` each providing the
    `high` rung and likewise encoding their suffix; and
    `claude-opus-4-6-thinking` providing the `xhigh` rung and encoding the `high`
    reasoning rung. It SHALL record the remaining eight observed identifiers as
    evidence it declares no offering for, and SHALL carry every rung assignment
    as an assumption.
45. Every offering, surface item and guard term across the four core default
    mappings SHALL trace to an observation of the live-verification research
    report of issue #1111 or to the content gate of that issue, except where
    requirement 5 marks it an assumption. The four mappings taken together SHALL
    leave every committed compiled agent output unchanged at implementation
    time — no agent source present on `main` then declaring a capability
    profile, so that no resolution applies to any agent on any target — and
    requirement 7 of spec 0143 delta-01 SHALL continue to hold on that tree.
46. A mapping file SHALL be verifiable by a check that is hermetic: decidable
    from the mapping file and the domains of spec 0195 alone, without network
    access, without an installed CLI, and without resolving any agent source.
47. That check SHALL reject a mapping whose declared target is not a supported
    target or disagrees with its filename, a key the mapping schema does not
    admit, an offering or surface item carrying neither a citation nor an
    assumption or carrying both, a duplicate offering identifier, and a
    duplicate rank.
48. That check SHALL reject an offering whose declared characteristics fall
    outside the domains spec 0195 defines, a native value the mapping directs
    that is not a member of the domain the mapping declares for that surface's
    key, and an encoded characteristic that disagrees with the characteristic
    the same offering declares it provides.
49. That check SHALL assert selection totality: a mapping declaring at least one
    offering SHALL select an offering for each of the seven `intelligence`
    rungs, and a mapping whose target expresses reasoning on its frontmatter
    surface SHALL declare an image or an unmapped state for each of the six
    reasoning rungs.
50. That check SHALL assert that a Claude Code mapping declares the guard of
    requirement 29, and that a guard recorded in the **directed** state carries
    an evidence reference for each of its two terms. The check SHALL assert the
    presence of that evidence and SHALL NOT attempt to verify its truth.
51. The check of requirements 46 through 50 SHALL be an authoring-time gate over
    a proposed change, and its rejection SHALL NOT become a resolution failure:
    a mapping the check would reject SHALL still be resolvable against under
    requirement 15, degrading the cells it cannot read.

## Scenarios

**Scenario:** the canonical example resolves

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: medium
And   the Claude Code core default mapping, whose guard is recorded withheld
When  that profile is resolved against the mapping
Then  the selection names the haiku offering, the cheapest offering at or above
      the medium rung
And   the reasoning rung is dropped, because the haiku offering declares no
      support for the effort surface
And   one drop record is emitted naming the agent, the target claude, the path
      metadata.model.reasoning, the value medium and the reason
      unsupported-on-model
And   the model item is directed onto the guidance surface, so the compiled
      agent output states haiku in prose and carries no model: frontmatter field
```

**Scenario:** the top rung is served by best-available projection

```text
Given an agent source whose metadata.model declares intelligence: max
And   the Claude Code core default mapping, whose highest rung is xxhigh at the
      fable offering
When  that profile is resolved against the mapping
Then  the selection names the fable offering
And   no drop is recorded on the intelligence axis
And   a declaration of intelligence: xxhigh selects that same offering
```

**Scenario:** a rung below the lowest offering projects up to the cheapest

```text
Given an agent source whose metadata.model declares intelligence: minimal
And   the Claude Code core default mapping, whose cheapest offering is haiku at
      the medium rung
When  that profile is resolved against the mapping
Then  the selection names the haiku offering, which satisfies the declared floor
And   no drop is recorded on the intelligence axis
And   a declaration of intelligence: low selects that same offering
```

**Scenario:** a composite offering serves reasoning through model selection

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: high
And   the Antigravity CLI core default mapping, whose medium-rung offerings
      encode the reasoning rungs low, medium and high
When  that profile is resolved against the mapping
Then  the selection names the gemini-3.8-flash-high offering, whose encoded rung
      matches the declared rung exactly
And   no drop record is emitted for the reasoning axis, because the rung was
      served by model selection
And   the model item is directed onto the guidance surface, the only surface
      that mapping declares
```

**Scenario:** an inexact encoded match is noted, not dropped

```text
Given an agent source whose metadata.model declares intelligence: high and
      reasoning: medium
And   the Antigravity CLI core default mapping, whose high-rung offerings encode
      the reasoning rungs low and high and none encodes medium
When  that profile is resolved against the mapping
Then  the selection names the gemini-3.1-pro-low offering, the nearest rung below
      the declared one
And   one diagnostic note is recorded naming the declared rung medium and the
      encoded rung low
And   no drop record is emitted, because model selection is projection rather
      than an omission from what the target receives
```

**Scenario:** an item no in-band surface expresses is dropped

```text
Given an agent source whose metadata.model declares intelligence: medium and
      reasoning: high
And   the Gemini CLI core default mapping, which declares no guidance surface
      and names settings.json modelConfigs.overrides as the out-of-band surface
      carrying reasoning
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
And   an agent source whose metadata.model declares intelligence: high and
      reasoning: high
When  that profile is resolved against the mapping
Then  a resolution applies and names the sonnet offering
And   the compiled agent output carries no model: frontmatter field, and states
      the sonnet declination on its guidance surface instead
And   one diagnostic note is emitted naming the guard, the term that holds and
      the guidance surface the model item was directed onto
```

**Scenario:** the shared-read guard is directed

```text
Given a Claude Code mapping whose guard is recorded directed, carrying evidence
      for each of its two terms
And   an agent source whose metadata.model declares intelligence: high
When  that profile is resolved against the mapping
Then  the resolution directs the sonnet declination onto the frontmatter surface
      as well as onto the guidance surface
And   no guard note is emitted
```

**Scenario:** an unconfigured target directs nothing

```text
Given the GitHub Copilot CLI core default mapping, which declares zero offerings
And   an agent source whose metadata.model declares intelligence: xhigh and
      reasoning: high
When  that profile is resolved against the mapping
Then  the resolution outcome is no resolution
And   the compiled agent output for Copilot carries no model field and no
      guidance statement of a model
And   the agent runs on the orchestrating session's model
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

**Scenario:** a malformed mapping cell degrades instead of failing

```text
Given a mapping file one of whose offerings carries a native value outside the
      domain that mapping declares for its frontmatter model key
And   an agent source declaring a profile that would select that offering
When  the resolution runs during a build
Then  the build does not fail and no error is raised
And   the unreadable cell degrades to the fallback path, the agent running on
      the orchestrating session's model
And   the diagnostic output records what could not be read
And   the same mapping file is rejected by the hermetic check when it is
      proposed as a change
```

**Scenario:** a mapping directing a value outside its declared domain is
rejected

```text
Given a mapping file whose frontmatter surface declares the effort key admitting
      low, medium, high, xhigh and max
And   a reasoning projection directing the value none onto that key
When  the hermetic mapping check runs against that file
Then  the check reports an error naming the file, the key, the directed value
      and the declared domain
And   the check reports the same class of error for an offering whose declared
      intelligence rung is outside the seven spec 0195 admits, and for an
      offering whose encoded rung disagrees with the rung it declares it provides
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
  against it, the frontmatter it emits per target, the prose it renders from a
  guidance template, the persistence of the drop records and diagnostic notes,
  and the continuous-integration guards over any of that. Seam (d). This spec
  states what a mapping contains and what a resolution outcome is; it emits
  nothing and builds nothing.
- The organization-level override channel: its location, its filename, its
  format, its precedence over core entries, and its exclusion from upstream
  synchronization. Seam (e). This spec defines only the addressability that
  channel plugs into, in requirements 6 and 7.
- The amendment of the upstream synchronization contract that requirement 8
  names as a consequence — `docs/layers.md`, the contract of
  `scripts/sync-from-upstream.sh`, and the treatment of committed compiled
  agent outputs as regenerable artifacts. Recorded here, handed to seams (d)
  and (e), and likely to need a delta of the documents concerned.
- The migration of the existing agent sources and the removal of
  `metadata.claude.model` from them. Seam (f). No agent source on `main`
  declares a capability profile today, which is why requirement 45 holds
  trivially at implementation time.
- The compiled-layout convention for agent outputs. Seam (g). Requirement 8 of
  spec 0143 delta-01 binds the `.claude/agents/` surface whatever per-file
  layout it adopts, and the guard of requirement 29 inherits that property.
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

- [GROUNDING:] **confirm.** The `inherit | flash | pro` tier that epic #1100
  makes a binding constraint of this ticket is not present on Antigravity CLI
  1.1.25: not in `agy --help`, not in `agy models`, not in the workstation's
  `antigravity-cli/settings.json`, and not in the ten on-disk documentation
  files read in full. This spec retires the constraint and states the
  Antigravity declination on the guidance surface instead. The maintainer is
  asked to confirm the retirement at the content gate, or to name the source of
  the tier claim so the premise can be re-tested against that surface — the
  Antigravity IDE product is the suspected origin and was not probed.
- [GROUNDING:] **confirm.** Whether prose naming a model inside a
  `.claude/agents/` compiled output disturbs a GitHub Copilot CLI reader is
  untested. Probe A set a `model:` frontmatter field on every one of its three
  legs, so its `BUG-PRESENT` verdict says nothing about prose. Requirements 31
  and 35 rest on the assumption that it does not. A probe C in the issue #1103
  harness would settle it with two cells against one BYOK session — a
  description naming a model, and a non-`model` frontmatter key such as
  `effort:`, the neighbouring case requirement 31 also leaves directed while the
  guard withholds `model:`. Until that run, both cells are marked assumptions in
  the mapping file.
- [GROUNDING:] **confirm.** Whether an orchestrating model honors a guidance
  statement reliably enough for a mapping to depend on it is supported only by
  the maintainer's own live experience of Claude Code, recorded at the content
  gate of issue #1111. No probe covers it, and the two targets that use the
  surface — Claude Code and Antigravity CLI — carry it as an assumption. The
  maintainer is asked to confirm that the surface may bear this weight; the
  non-blocking invariant of requirement 15 bounds the cost of the assumption
  being wrong to an agent inheriting the session model.
- [GROUNDING:] **audit.** Whether Claude Code's `effort:` field is refused or
  ignored on Haiku is unconfirmed on disk: neither `claude --help` nor
  `artifacts/FORMAT.md` states a per-model carve-out either way. The *behavior*
  is settled — the maintainer directed at the content gate of issue #1111 that
  an unsupported effort be ignored rather than raised as an error — and
  requirement 36 records the carve-out as an assumption on the per-model fact
  alone. Nothing now depends on the fact being confirmed, because requirement 15
  makes both readings non-blocking.
- [GROUNDING:] **audit.** The `[1m]` context variants epic #1100 names for
  `sonnet` and `opus` are not confirmed on this install, so no Claude offering
  declares a context window and every declared `context` floor is dropped with
  `unserved-value` per requirement 19. A later delta populates the windows once
  an observation grounds them.
- [GROUNDING:] **confirm.** The intelligence rungs assigned to the three Gemini
  offerings in requirement 39 and to the six Antigravity offerings in
  requirement 44 rest on the vendors' own family naming — pro above flash above
  flash-lite, opus above the flash classes, and the higher version within a
  family — which is observable in the identifiers themselves but is not a
  capability measurement. Every assignment is carried as an assumption in the
  mapping files.
- [GROUNDING:] **audit.** Requirement 44 declares six of the fourteen
  identifiers `agy models` reports. The eight it leaves undeclared are the
  `gemini-3.7-flash` and `gemini-3.6-flash` generations, superseded by
  `gemini-3.8-flash` within the same family, and `claude-sonnet-4-6` and
  `gpt-oss-120b-medium`, each of which would be unreachable behind a
  lower-ranked offering at the same rung. They are recorded in the mapping as
  observed rather than dropped from the record.
- [GROUNDING:] **audit.** Whether Gemini CLI 0.46.0 accepts `model:`,
  `temperature:` and `max_turns:` in `.gemini/agents/*.md` was not re-probed. The
  bundled documentation of that release enumerates all three; this repository's
  build script and `docs/cli-matrix.md` row 4b carry a broader phrasing of the
  0.42.0-era rejection whose tested claim was narrower. A scratch-file probe
  spends no provider quota and settles it before seam (d) emits.
- [GROUNDING:] **audit.** The domain of Gemini CLI's agent-file `model:` key —
  concrete identifiers only, or also configuration aliases and tier words — is
  undocumented. Requirement 38 names concrete identifiers, the only form the
  bundled documentation illustrates.
- [GROUNDING:] **audit.** Whether GitHub Copilot CLI's `AgentInfo.model` accepts
  the value `auto` is undocumented in the bundled schema. The question is inert
  while requirement 41 keeps that mapping at zero offerings, and becomes live
  for the delta requirement 42 anticipates.
- [GROUNDING:] **audit.** The research report records that `glm-5.3-flash:cloud`
  is absent from `ollama list` on this workstation. That observation is
  superseded rather than contradicted: cloud models are served on demand rather
  than cached locally, and the control leg of probe run `20260902T153919Z-0aa9`
  on issue #1103 spawned a subagent on that exact model. The model is served;
  `ollama list` is not the instrument that would show it.
- [GROUNDING:] **audit.** The gap note of `docs/cli-matrix.md` row 4 still cites
  the earlier `INDETERMINATE` probe A run of 2026-09-02 and is owed a re-date to
  run `20260902T153919Z-0aa9`, whose verdict is `BUG-PRESENT`. Requirements 37
  and 41 cite the later run. Recorded for audit; the re-date is tracked as a
  follow-up on issue #1103 and no closure is owed here.
- [GROUNDING:] **audit.** Requirement 8 records that an organization-level
  override changes a fork's compiled agent outputs, which the upstream
  synchronization contract does not currently anticipate: `docs/layers.md`
  classifies the compiled output trees as core-owned, and
  `scripts/sync-from-upstream.sh` halts on a local modification to a `strict`
  path. Treating those outputs as regenerable artifacts whose drift is
  acceptable while the build's drift check passes is the shape of the answer the
  maintainer named at the content gate of issue #1111, and it likely needs a
  delta of the layer and synchronization documents. Recorded for audit and
  handed to seams (d) and (e); no closure is owed here.
