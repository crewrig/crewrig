---
id: "0200"
slug: core-agent-profile-migration
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1123
version: 1.0.0
---

# Migration of the core agent sources to capability profiles

Authored for issue #1123, seam (f) of epic #1100 (CLI-agnostic model
declaration for subagents). Seams (a) through (e) are on `main`: the
capability-profile vocabulary
([`specs/0195-agent-capability-profile.md`](0195-agent-capability-profile.md)),
the reconciliation of spec 0143
([`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md)),
the four core default mappings
([`specs/0197-model-mapping.md`](0197-model-mapping.md)), the build's
resolution of a profile against the mapping in force
([`specs/0198-build-mapping-resolution.md`](0198-build-mapping-resolution.md))
and the organization-level override channel with its `regenerable`
synchronization policy
([`specs/0199-org-model-mapping-override.md`](0199-org-model-mapping-override.md)).
Every mechanism exists and no agent source uses it. This spec migrates the
core agent sources onto the vocabulary, retires the legacy
`metadata.claude.model` key, and is therefore the first change in the epic
whose committed compiled agent outputs differ from what they contain today.

The compiled-layout convention — seam (g), the flat
`.claude/agents/<name>.md` output layout — is not done. The epic prefers (g)
before (f); the maintainer chose to run (f) first. This spec records that
ordering and its one consequence: the migration lands in the nested
`.claude/agents/<name>/AGENT.md` layout, and seam (g) later moves the same
files, regenerating the same content at a different path.

**Vocabulary.** *Target*, *mapping*, *offering*, *surface*, *resolution*,
*drop*, *rung* and *capability profile* carry the meanings specs 0195 and
0197 give them. Three terms are used here. The **legacy key** is
`metadata.claude.model`, the CLI-namespaced model declaration 22 core agent
sources carry on `main` and this spec removes. A source's **tier** is the
Claude Code model alias its legacy key names — `haiku`, `sonnet` or `opus`.
The **guidance prose** is the sentence a mapping's guidance surface template
renders into a compiled agent output's `description` field (spec 0197 R14,
spec 0198 R27).

**Evidence base.** Every behavioural claim below was observed on the tree
at `723ad8f`. Claims about what a resolution emits were produced by
`bash scripts/build-components.sh --resolve <source> <target>` against
scratch agent sources declaring one rung each, and confirmed end to end by a
throwaway build over one real source (`architect` at `intelligence: xhigh`)
whose four compiled outputs were diffed and then reverted. No claim below
rests on a vendor document or on reading a mapping by eye.

**The 23 sources and their tiers.** 22 sources under
`artifacts/core/agents/*/AGENT.md` carry the legacy key — 10 `haiku`, 11
`sonnet`, 1 `opus`. `artifacts/library/agents/harness-curator/AGENT.md`
carries no model declaration. The only two keys any component source under
`artifacts/` carries beneath `metadata:` are `claude` (22 sources) and
`provenance` (45 sources); no skill source and no command source carries a
`metadata.claude:` mapping. Spec 0195's `## Out of scope` says 23 sources
carry the legacy key; the tree carries 22, `harness-curator` being the
twenty-third agent source rather than a twenty-third carrier. The
discrepancy is recorded, not repaired: it changes no requirement of that
spec.

**The legacy key is read by nothing.** `scripts/build-components.sh` reads
`.claude.allowed-tools`, `.claude.user-invocable`,
`.claude.disable-model-invocation`, `.claude.context` and `.claude.agent`
from a source's **top-level** `claude:` section, and reads no
`metadata.claude` path at all. `inject_provenance` splices only the
`metadata.provenance` block into a compiled output, so the legacy key
reaches no compiled output on any target. Removing it therefore changes no
committed byte by itself.

**What each rung emits, per target.** Verified for `medium`, `high` and
`xhigh`, with and without a declared `reasoning` rung:

| Declared rung | Claude Code | Gemini CLI | GitHub Copilot CLI | Antigravity CLI |
|---|---|---|---|---|
| `medium` | prose `Run this agent on the haiku model.`; no `model:` field (guard `withheld`) | `model: gemini-3.5-flash` | nothing | prose `Run this agent on the gemini-3.8-flash-low model.` |
| `high` | prose `… on the sonnet model.`; no `model:` field | `model: gemini-3.1-pro-preview` | nothing | prose `… on the gemini-3.1-pro-low model.` |
| `xhigh` | prose `… on the opus model.`; no `model:` field | `model: gemini-3.1-pro-preview` | nothing | prose `… on the gemini-3.1-pro-low model.` |

`high` and `xhigh` produce the same Gemini CLI and Antigravity CLI emission,
because `gemini-3.1-pro-preview` is the highest rung the Gemini mapping
declares and `high` is the highest rung the Antigravity mapping declares, so
the ceiling clause of spec 0197 R17 selects the same offering for both rungs
without recording a drop.

**What a declared `reasoning` rung would additionally do.** On Claude Code
it is dropped `unsupported-on-model` at `medium` (the `haiku` offering
declares `supports-reasoning-surface: false`) and emitted as an `effort:`
frontmatter field at `high` and `xhigh`. On Gemini CLI it is always dropped
`unsupported-on-cli`. On GitHub Copilot CLI it is always dropped. On
Antigravity CLI it is **not** dropped: reasoning is encoded in each
offering's identifier, so declaring it changes the selected offering —
`medium × medium` selects `gemini-3.8-flash-medium` instead of
`gemini-3.8-flash-low`, and `high × high` selects `gemini-3.1-pro-high`
instead of `gemini-3.1-pro-low`.

**The diagnostic stream a migrated tree produces.** One
`model-note … guard-withheld` line per migrated agent on the Claude Code
target, and one
`model-drop … copilot metadata.model.intelligence <rung> unsupported-on-cli`
line per migrated agent on the GitHub Copilot CLI target. No other drop and
no other note, because no source declares any other axis.

**The diff a migrated source produces.** For `architect` at
`intelligence: xhigh`: one changed line in `.claude/agents/architect/AGENT.md`
(the `description`), one changed line in `.agents/agents/architect/AGENT.md`
(the `description`), one added line in `.gemini/agents/architect.md` (the
`model:` field), and `.github/agents/architect.md` byte-identical. No
compiled body changed on any target.

**Contradicted premises.** Three statements in merged repository artifacts
disagree with what this spec requires or with what a reader would expect it
to require. Each is named
rather than silently worked around, and the disposition of each is stated.

**Premise 1 — `artifacts/FORMAT.md`'s "Claude Code Overrides" table
documents `model` and `effort` as source-authored override fields.** Rows
114 and 115 of that table read `model` — *Model override* and `effort` —
*Effort level override*, presented alongside `allowed-tools`,
`user-invocable`, `disable-model-invocation`, `context` and `agent` as
fields "the `claude:` section adds". The build reads five of those seven and
has never read `model` or `effort`, so the two rows document a behaviour
that does not exist and invite an author to write a declaration nothing
consumes — the exact failure mode spec 0195 Decision 5 names. Deleting them
is nonetheless not available: `model-mappings/claude.yml` grounds both its
`model` and its `effort` frontmatter items on a citation naming
"artifacts/FORMAT.md's 'Claude Code Overrides' table (line 103), which
documents the native `model` key", so a deletion strands the only
repository-side support for a merged mapping's declared surface.
**Disposition:** the two rows are **demoted, never deleted** — restated as
the native Claude Code per-agent frontmatter keys that a model-mapping
resolution directs, with an explicit statement that a source-authored
`claude.model` or `claude.effort` is read by nothing. The fact the mapping
cites stays recorded in `artifacts/FORMAT.md`; the misdirection ends.
Requirement 26 carries this.

**Premise 2 — `docs/agent-team-protocol.md` → *Model compatibility rule*:
every spawned `Agent` MUST use the parent orchestrator's model.** That rule
binds when the orchestrating session runs on a non-default model provider,
and it exists because a model mismatch makes a spawn silently
non-functional. After this migration every compiled Claude Code and
Antigravity CLI agent carries prose asking the orchestrator to run the agent
on a named Anthropic or Google model — which, on such a backend, is a
request for exactly the mismatch the rule forbids. **Disposition:** the rule
keeps precedence and the document says so. Requirement 28 obliges the change
set to record, in `docs/agent-team-protocol.md`, that the compiled guidance
prose is a statement of the work's need and is subordinate to the
model-compatibility rule wherever the two disagree. No mapping and no source
changes: the guidance prose is advisory by construction (spec 0197 R14
forbids it from introducing a frontmatter field).

**Premise 3 — epic #1100's canonical example, recorded in spec 0195 Decision
1: `intelligence: medium × reasoning: medium` "resolves on Claude Code to
`haiku` at `medium` reasoning".** The merged Claude Code mapping declares
the `haiku` offering `supports-reasoning-surface: false` (spec 0197 R36), so
that profile resolves on Claude Code to `haiku` with the reasoning item
**dropped** `unsupported-on-model` — verified live. The example therefore
describes an outcome the mapping in force does not produce. **Disposition:**
the example is read as an illustration of what the *vocabulary* can express,
which is all spec 0195 Decision 1 offers it as, and not as a mandate on what
this migration writes. This spec declares no `reasoning` rung on any source
(Decision 2), so the discrepancy never becomes an emission. It is a property
of a mapping, correctable by a mapping change, and is named here so that a
reviewer holding the example as a target finds the argument rather than
reconstructing it.

**A premise a reviewer may expect to be contradicted, and is not.** Spec
0198 R26 requires that "for an agent source carrying no `metadata.model:`
mapping, every compiled output on every target SHALL be byte-identical to
the output the build produced for that source before this spec was
implemented". Its antecedent is conditional. After this migration the 22
migrated sources no longer satisfy it, so R26 no longer binds them — it is
not contradicted, it stops applying. R26 keeps a live witness in the tree
regardless, because `harness-curator` stays profile-less (Decision 4).

**Decision 1 — the translation is the anchor table's, and it is the whole
translation.** Each migrated source declares `intelligence` at the rung spec
0195 R7's normative anchor table calibrates on that source's tier: `haiku` →
`medium`, `sonnet` → `high`, `opus` → `xhigh`. Spec 0195's `## Out of scope`
records this correspondence as "the property seam (f) relies on", and spec
0197 R36 declares the Claude Code mapping's four offerings on the same
anchors, so on Claude Code the translation round-trips exactly: a source
that said `haiku` yields prose naming `haiku`. No judgement is exercised
per agent, and no source's tier is revisited in this change set. Revisiting
one would be a second, differently-evidenced change riding on a migration
whose whole warrant is equivalence, and it would leave a reviewer unable to
tell a translation error from a deliberate re-tiering. A per-agent review of
the tiering is named in `## Out of scope`.

**Decision 2 — no source declares `reasoning`.** Three grounds. First, the
legacy key encodes a model tier and nothing else, so any reasoning rung this
migration wrote would be invented rather than translated, in a change set
whose warrant is equivalence. Second, on `high` and `xhigh` sources a
declared rung is emitted as an `effort:` frontmatter field into
`.claude/agents/` — the surface GitHub Copilot CLI also reads, whose
shared-read hazard spec 0143 delta-01 R8 exists to police and whose prose
leg is exactly what probe C of issue #1113 has not yet tested. The merged
specs permit that emission (spec 0197 R31 directs every item other than the
model onto the frontmatter even under a `withheld` guard), so this is a
choice not to exercise a permission while its blast radius is unmeasured,
not a prohibition. Third, on `medium` sources the rung is dropped on Claude
Code and on Gemini CLI, so it would buy nothing on two of four targets while
still changing the third.

The decision has a visible cost, stated rather than hidden: with no
reasoning declared, the Antigravity CLI resolution selects the
lowest-ranked offering at the rung, so every migrated agent lands on
`gemini-3.8-flash-low` or `gemini-3.1-pro-low` — the *low*-reasoning
variants, `architect` included. That outcome is a property of the
Antigravity mapping's rank order, and the seam architecture puts its
correction in the mapping: a delta of spec 0197 re-ranking those offerings,
or an organization's own override through the channel of spec 0199. Fixing
it by writing a reasoning rung into 22 sources would move a per-target
ranking decision into a CLI-agnostic vocabulary, which is the coupling
epic #1100 exists to remove. The alternative — declaring `reasoning` at the
tier's matching rung on every source — was rejected on those grounds; the
narrower alternative of declaring it on `architect` alone was rejected as
unevidenced special-casing.

**Decision 3 — no source declares `specialization`, `context`, `speed`,
`modalities`, `locality`, or any tuning knob.** A core mapping owes nothing
beyond the `general` fallback on `specialization` (spec 0197 R20), so every
declared value would drop `unserved-value` on every target: 4 drop records
per source, changing no output byte. No core mapping's offerings declare
context floors, modalities or locality to narrow on, so the same holds for
those three axes. Of the five tuning knobs, Claude Code declares none on its
frontmatter surface (spec 0197 R34), Antigravity CLI declares no frontmatter
surface at all (R43) and GitHub Copilot CLI declares zero offerings (R41);
only Gemini CLI expresses `temperature` and `max_turns`, and this change set
has no evidence for a per-agent value of either. The whole profile of a
migrated source is therefore one key. A profile is a declaration of need,
and a need nothing evidences is not declared.

**Decision 4 — `harness-curator` stays profile-less, deliberately.** It is
the one agent source that never carried a tier, so there is nothing to
translate; inventing one would be Decision 1's rejected re-tiering under
another name. Keeping it profile-less also keeps a live witness in the tree
for two merged requirements that would otherwise have none: spec 0195 R3
(session-model inheritance for a source that declares nothing) and spec 0198
R26 (byte-identity of a profile-less source's compiled outputs). A test that
asserts a property no committed artifact exhibits is a test of a fixture;
this keeps it a test of the tree. Its absence of a profile is therefore a
requirement here (requirement 5), not an omission.

**Decision 5 — the guard against the legacy key is a new, dedicated,
closed-key check; spec 0198 R38 is kept, not retired.** R38 binds
`scripts/check-agent-profiles.sh` to the `metadata.model:` mapping alone and
states that a source carrying `metadata.claude.model` "SHALL NOT be rejected
on that ground". Adding the rejection to that script contradicts both
clauses. Two alternatives were rejected. Widening the profile validator and
landing a delta of spec 0198 to permit it costs a second spec-PR for one
clause and dissolves a real separation — profile *conformance* and migration
*completeness* are different questions with different failure modes.
Recording the prohibition as an unenforced convention was rejected outright:
the legacy key survived 22 sources for the length of the repository's life
precisely because nothing checked it.

The new check asserts a **closed key set** rather than the absence of one
key: under `metadata:` on an upstream-owned component source, exactly
`provenance` and `model` are admitted. Closing the class costs the same as
grepping for the instance and catches the next CLI-namespaced key as well as
this one, which is the mischief spec 0195 Decision 5 identifies. It binds
`artifacts/core/**` and `artifacts/library/**` — the tiers
`.crewrig/core-paths.txt` governs — and reports clean for
`artifacts/community/**` and `artifacts/org/**`, because policing an
adopter's own metadata is not this framework's business and nothing else
does it.

**Decision 6 — the byte-identity invariant is replaced, not abandoned.**
Spec 0198 R26 made the committed outputs verifiable against a fixed
historical baseline. That baseline is gone for 22 sources by design. What
replaces it is a *derivability* invariant that is strictly stronger for the
migrated sources and unchanged for the rest: the committed compiled agent
outputs equal what a fresh build produces from the sources and the mappings
in force, which `bash scripts/build-components.sh --target all --check`
already decides; the compiled skill and command outputs stay byte-identical
to `723ad8f`; the four GitHub Copilot CLI agent outputs stay byte-identical
to `723ad8f`; and `harness-curator`'s four outputs stay byte-identical to
`723ad8f` on every target. The historical baseline survives everywhere it
still has meaning.

**Complexity tier — `standard`, not `small`.** The tier drives DEV team
composition. This change set writes a new check script with its own test
suite and its own `ci/ci-capabilities.yml` capability realized on both
engines, regenerates every committed agent output on three of four targets,
edits four documentation surfaces including one whose current text
contradicts the change (Premise 2), and disposes of a citation chain that
runs from a merged mapping file through a logbook comment into a document
this change set edits (Premise 1). A `small` team — developer, `pr-logbook`,
`pr-reviewer` — carries no seat for the CI-parity and cross-document work,
and an error in the regenerated trees ships wrong guidance prose into every
agent on two CLIs without any historical baseline left to catch it. The
design risk is discharged here, at SPECS: the six decisions above settle
every choice, so the PLAN stage sequences work rather than designing it.

## Intent

Every core agent source states the model its work needs in the CLI-agnostic
vocabulary instead of naming a Claude Code model, and the CLI-namespaced
declaration that named one disappears from the framework's sources along
with the documentation that invited it. A reader of any compiled agent
learns, for the first time, which model that agent's work asks for, stated
in the terms the command-line interface reading it understands: as a
sentence for the interfaces that take prose, as a native field for the one
that takes a field, and as nothing for the one whose served model lineup the
framework cannot know. An agent that states no need keeps exactly the
behaviour it has today, and an organization that wants a different model
behind a stated need changes the mapping rather than the agents.

## Requirements

Requirements 1 through 6 bind the profiles the sources declare, 7 through 12
the removal of the legacy key and the guard over it, 13 through 21 the
regenerated outputs and their invariants, 22 through 24 the version bumps,
25 through 31 the documentation surfaces, 32 through 34 the decoupling from
probe C and from seam (g), and 35 through 40 the tests and continuous-
integration guards.

1. Each agent source under `artifacts/core/agents/` that carries a
   `metadata.claude.model` key on the tree at `723ad8f` SHALL carry a
   `metadata.model:` mapping declaring exactly one key, `intelligence`.
2. The `intelligence` rung a source declares SHALL be the rung the normative
   anchor table of requirement 7 of spec 0195 calibrates on the Claude Code
   model alias that source's `metadata.claude.model` key names — `haiku`
   yielding `medium`, `sonnet` yielding `high`, and `opus` yielding `xhigh`.
   No other rung SHALL be declared on any source, and no source's tier SHALL
   be revised in this change set.
3. The change set SHALL record the per-source translation as a table naming,
   for each of the 23 agent sources, its tier before the change, the rung it
   declares after, and the emission each of the four targets receives, so
   that the translation is auditable without re-running a resolution.
4. No agent source SHALL declare the `reasoning`, `specialization`,
   `context`, `speed`, `modalities` or `locality` axis, and no agent source
   SHALL declare a `tuning:` mapping. A later change MAY declare any of them
   on a source, and SHALL carry evidence for the value it declares.
5. `artifacts/library/agents/harness-curator/AGENT.md` SHALL carry no
   `metadata.model:` mapping after this change set, and SHALL remain the
   tree's witness that a profile-less agent source keeps session-model
   inheritance (requirement 3 of spec 0195).
6. No component source outside `artifacts/core/agents/` SHALL acquire a
   `metadata.model:` mapping in this change set.
7. No component source under `artifacts/core/` or `artifacts/library/` SHALL
   carry a `metadata.claude:` mapping after this change set.
8. A check SHALL reject a component source under `artifacts/core/` or
   `artifacts/library/` that carries, beneath `metadata:`, any key other
   than `provenance` and `model`, naming the file and the offending key. It
   SHALL report clean for a source carrying only those two, for a source
   carrying no `metadata:` block at all, and for every source under
   `artifacts/community/` or `artifacts/org/`.
9. The check of requirement 8 SHALL report clean for a source carrying a
   **top-level** `claude:` section, which remains a legal, build-consumed
   override surface, and its rejection SHALL name the `metadata:` path
   rather than that section.
10. The check of requirement 8 SHALL be a script distinct from
    `scripts/check-agent-profiles.sh`. Requirement 38 of spec 0198 — which
    binds that script to the `metadata.model:` mapping alone and forbids it
    to reject a source on the ground that it carries `metadata.claude.model`
    — SHALL remain in force and unamended, and this change set SHALL require
    no delta of spec 0198.
11. The check of requirement 8 SHALL be hermetic: decidable from the source
    file and the admitted key set alone, without network access, without an
    installed CLI, and without consulting any mapping.
12. The check of requirement 8 SHALL be an authoring-time gate over a
    proposed change. Its rejection SHALL NOT fail a build and SHALL NOT
    become a resolution failure: a source it rejects SHALL still compile and
    SHALL still be resolvable against.
13. The change set SHALL commit the regenerated compiled agent outputs for
    all four targets, and `bash scripts/build-components.sh --target all
    --check` SHALL report zero drift on the committed tree.
14. Each migrated source's compiled Claude Code output SHALL carry, appended
    to the `description` the source declares, the guidance prose naming the
    Claude Code model alias its rung selects, and SHALL carry no `model:`
    frontmatter field.
15. No compiled agent output on any target SHALL carry an `effort:`
    frontmatter field, no source declaring a `reasoning` rung.
16. Each migrated source's compiled Gemini CLI output SHALL carry a `model:`
    frontmatter field naming the offering its rung selects, and SHALL carry
    no guidance prose.
17. Each migrated source's compiled GitHub Copilot CLI output SHALL be
    byte-identical to its content at `723ad8f`.
18. Each migrated source's compiled Antigravity CLI output SHALL carry,
    appended to the `description` the source declares, the guidance prose
    naming the offering its rung selects, and SHALL carry no model
    frontmatter field.
19. The compiled **body** of every agent output on every target SHALL be
    byte-identical to its content at `723ad8f`, and every compiled skill
    output and compiled command output SHALL likewise be byte-identical to
    its content at `723ad8f`.
20. The four compiled outputs of `artifacts/library/agents/harness-curator/AGENT.md`
    SHALL be byte-identical to their content at `723ad8f`, so that
    requirement 26 of spec 0198 keeps a witness in the committed tree.
21. A build over the migrated tree SHALL emit, on its diagnostic stream, one
    guard-withheld note per migrated agent for the Claude Code target and
    one `unsupported-on-cli` drop record per migrated agent for the GitHub
    Copilot CLI target, and no other drop record and no other note. No drop
    record and no note SHALL appear inside any compiled output.
22. Every source this change set modifies SHALL bump its
    `metadata.provenance.version` by a MINOR increment in the same diff, per
    `AGENTS.md` → *Version Bump Convention*, an added profile being an
    additive metadata change.
23. `artifacts/library/agents/harness-curator/AGENT.md` SHALL NOT be
    modified and SHALL NOT bump its version.
24. `bash scripts/check-skill-versions.sh` SHALL pass on the change set, and
    `scripts/check-extension-version-bump.sh` SHALL be unaffected, no
    extension component source being touched.
25. `artifacts/FORMAT.md` SHALL state that `metadata.model:` is the only
    surface on which an agent source declares a model need, and that a
    source's `metadata:` block admits exactly `provenance` and `model` on
    the upstream-owned tiers, naming the check of requirement 8 as the gate.
26. `artifacts/FORMAT.md` SHALL retain a record of `model` and `effort` as
    native Claude Code per-agent frontmatter keys, restated so that they are
    identified as keys a model-mapping resolution directs rather than as
    fields a source's `claude:` section may declare, and SHALL state that a
    source-authored `claude.model` or `claude.effort` is read by no build
    step. Neither key SHALL be deleted from the document, the frontmatter
    surface of `model-mappings/claude.yml` grounding both of its items on a
    citation of that record.
27. `docs/cli-matrix.md` SHALL record that the core agent sources now
    declare capability profiles and what each of the four targets' compiled
    agent outputs consequently carries, and SHALL correct any statement in
    its model-mapping rows that no repository artifact reads a mapping.
28. `docs/agent-team-protocol.md` SHALL state that the guidance prose a
    compiled agent output carries is subordinate to that document's
    *Model compatibility rule* wherever the two disagree, so that a session
    on a non-default model provider is not directed into the silent-failure
    mode that rule exists to prevent.
29. The change set SHALL provide an adopter-facing migration note stating
    how an organization migrates its own agent sources off a CLI-namespaced
    model declaration, and that the organization-level override channel of
    spec 0199 — not an edit to an agent source — is where a fork changes
    which model a declared rung resolves to.
30. The migration note of requirement 29 SHALL state that a fork that
    declares no profile on its own sources and populates no override channel
    file needs to take no action, and that its compiled outputs for its own
    sources are unaffected.
31. The change set SHALL record the result of an audit of every document
    that presents a Claude Code model alias as the way to choose an agent's
    model. Where such a statement exists it SHALL be updated to the profile
    vocabulary; where the audit finds none beyond the surfaces requirements
    25 through 28 name, the change set SHALL record that finding rather than
    leave the audit implicit.
32. No requirement of this spec SHALL be conditioned on the outcome of probe
    C of issue #1113. Every verdict of that probe SHALL be absorbable by a
    change to a mapping file, and no verdict SHALL require any migrated
    source to change.
33. Retiring a target's guidance surface SHALL require no change to any
    migrated source: the sources SHALL declare needs, and the mapping in
    force SHALL decide the surface on which a need is stated.
34. The change set SHALL record that it lands in the nested
    `.claude/agents/<name>/AGENT.md` compiled layout, that seam (g) of
    epic #1100 later moves those files, and that the move regenerates the
    same content at a different path rather than re-deciding any profile.
35. `bash scripts/check-agent-profiles.sh` SHALL report every migrated
    source clean, and SHALL report `harness-curator` clean.
36. The change set SHALL carry a test asserting that the committed compiled
    agent outputs equal what a fresh build produces from the sources and the
    mappings in force — the invariant that replaces requirement 26 of spec
    0198 for the migrated sources.
37. The change set SHALL carry, for at least one source per declared rung, a
    per-target assertion over the four compiled outputs that source produces,
    covering the guidance prose on Claude Code and Antigravity CLI, the
    `model:` field on Gemini CLI, and the unchanged output on GitHub Copilot
    CLI.
38. The change set SHALL carry a mutation test in which a source
    re-introduces a `metadata.claude:` mapping and the check of requirement
    8 rejects it, and one in which a source declares an `intelligence` value
    outside the domain of requirement 6 of spec 0195 and
    `scripts/check-agent-profiles.sh` rejects it. A test suite that passes
    against both mutations SHALL be treated as not exercising the guard.
39. The check of requirement 8 SHALL be declared as its own capability in
    `ci/ci-capabilities.yml`, changeset-gated, watching the check script,
    its test suite, and `artifacts/**`, and SHALL be realized on both
    engines so that `bash scripts/build-ci.sh --check` and the CI-parity
    check pass.
40. The `component-drift` capability SHALL fail on a change that edits a
    migrated source's profile without committing the regenerated compiled
    outputs in the same change.

## Scenarios

**Scenario:** a `sonnet`-tier source is migrated

```text
Given artifacts/core/agents/developer/AGENT.md carries metadata.claude.model
      sonnet on the tree at 723ad8f
When  the migration is applied and bash scripts/build-components.sh --target
      all runs
Then  the source carries metadata.model.intelligence high and no
      metadata.claude mapping
And   .claude/agents/developer/AGENT.md carries the guidance prose naming
      the sonnet model appended to its description, and no model:
      frontmatter field
And   .gemini/agents/developer.md carries model: gemini-3.1-pro-preview
And   .github/agents/developer.md is byte-identical to its content at
      723ad8f
And   .agents/agents/developer/AGENT.md carries the guidance prose naming
      the gemini-3.1-pro-low model appended to its description
```

**Scenario:** the profile-less source is untouched

```text
Given artifacts/library/agents/harness-curator/AGENT.md declares no
      capability profile
When  the migration is applied and the build runs
Then  that source carries no metadata.model mapping and its
      metadata.provenance.version is unchanged
And   its four compiled outputs are byte-identical to their content at
      723ad8f
And   bash scripts/check-agent-profiles.sh reports it clean
```

**Scenario:** the committed tree is derivable from its sources

```text
Given the migrated tree with its regenerated compiled outputs committed
When  bash scripts/build-components.sh --target all --check runs
Then  it reports zero drift
And   every compiled skill output and compiled command output is
      byte-identical to its content at 723ad8f
And   every compiled agent body is byte-identical to its content at 723ad8f
```

**Scenario:** the diagnostic stream carries exactly the migration's drops

```text
Given the migrated tree
When  bash scripts/build-components.sh --target all runs
Then  its diagnostic stream carries one guard-withheld note per migrated
      agent for the Claude Code target
And   one unsupported-on-cli drop record per migrated agent for the GitHub
      Copilot CLI target, naming metadata.model.intelligence
And   no other drop record and no other note
And   no compiled output contains a drop record or a note
```

**Scenario:** a source re-introduces the legacy key

```text
Given a proposed change that adds a metadata.claude mapping back to an agent
      source under artifacts/core/
When  the check of requirement 8 runs over the change
Then  it rejects that source, naming the file and the metadata.claude key
And   bash scripts/check-agent-profiles.sh still reports that same source
      clean, its binding on metadata.model alone being unamended
And   the build still compiles that source and still resolves its profile
```

**Scenario:** an out-of-domain rung is refused

```text
Given a proposed change declaring metadata.model.intelligence: sonnet on an
      agent source
When  bash scripts/check-agent-profiles.sh runs over that source
Then  it reports an error naming the key, the declared value and the
      admitted domain, sonnet being a model alias rather than a rung
```

**Scenario:** a profile is edited without regenerating

```text
Given a change that edits a migrated source's declared intelligence rung
And   the compiled agent outputs are not regenerated in the same change
When  the component-drift capability runs
Then  it fails, naming the compiled outputs that differ from what the
      sources and the mappings in force produce
```

**Scenario:** a fork adopts the change without an override

```text
Given a fork that declares no capability profile on its own agent sources
And   that has populated no organization-level override channel file
When  it synchronizes this change from upstream
Then  its compiled outputs for its own sources are unaffected
And   the adopter-facing migration note tells it that no action is required
```

## Out of scope

- **Re-tiering any agent.** This change set translates each source's
  existing tier and revisits none. A per-agent review of whether an agent's
  work needs a different rung is a separate ticket with its own evidence,
  and would be indistinguishable from a translation error if it rode here.
- **Declaring a `reasoning` rung on any source**, and the consequence
  Decision 2 records — that the Antigravity CLI resolution lands every
  migrated agent on the low-reasoning offering at its rung. Correcting that
  is a change to `model-mappings/antigravity.yml`'s rank order through a
  delta of spec 0197, or an organization's own override through the channel
  of spec 0199; it is not a change to any agent source.
- **Seam (g)** — the flat compiled agent layout. This change set lands in
  the nested layout and seam (g) moves the files afterwards.
- **Probe C of issue #1113** — its execution, and any change conditioned on
  its verdict.
- **The content of any mapping file.** No offering, surface, guidance
  template, projection or guard state changes here. The Claude Code guard
  stays recorded `withheld`, and this change set carries no evidence that
  would move it.
- **Any change to the normative text of specs 0195, 0197, 0198, 0199, or
  spec 0143 delta-01.** Decision 5 exists so that requirement 38 of spec
  0198 needs no delta; the byte-identity of requirement 26 of spec 0198 is
  not amended but ceases to bind the migrated sources by its own conditional
  antecedent.
- **The organization-level override channel's content.** What an
  organization's own mapping declares is that organization's business;
  requirements 29 and 30 document the path and populate nothing.
- **New agents, and any change to a skill source or a command source.** The
  capability profile is an agent-source surface.
- **Adopter-owned tiers.** The check of requirement 8 reports clean for
  `artifacts/community/` and `artifacts/org/`; what an adopter writes
  beneath `metadata:` on its own components is not policed here.

## Open questions

- [GROUNDING:] The change set edits `artifacts/FORMAT.md`'s "Claude Code
  Overrides" table, whose rows `model-mappings/claude.yml` cites by section
  name and line number ("line 103") through the live-verification research
  report of issue #1111. Requirement 26 forbids deleting the record and
  preserves the cited fact, so the citation stays true in substance; the
  line number it names will not survive the edit. Recorded for the reviewer:
  a line-number citation into a living document was fragile before this
  change set and remains so. Repairing the citation would edit a mapping
  file, which `## Out of scope` excludes, and `scripts/check-model-mappings.sh`
  asserts a citation's presence and non-emptiness rather than its target
  (assertions A5 and A16), so nothing fails either way. No closure is owed
  on the logbook issue.
