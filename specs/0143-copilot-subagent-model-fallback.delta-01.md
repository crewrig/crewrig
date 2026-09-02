---
id: "0143"
slug: copilot-subagent-model-fallback
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1101
version: 2.0.0
---

# Copilot subagent model fallback — delta 01

Requalifies the model-emission prohibition of spec 0143 as the **unmapped
fallback rule**, so that a resolved, CLI-agnostic model declaration may direct
an emission without contradicting a merged specification. Authored for
issue #1101, the blocking precondition of epic #1100 (CLI-agnostic model
declaration for subagents): no implementation ticket of that epic may land
while requirements 1 and 2 of spec 0143 stand as a universal prohibition.

`MAJOR` bump. Requirements 1 through 4 are modified, and the shape of the
contract they carry changes: the absence of a `model:` field in a compiled agent
output stops being an unconditional invariant and becomes the outcome of one
condition — that no model-mapping resolution applies. A conformance check
written against version 1.0.0 asserts the unconditional form, and is therefore
wrong under this version from the moment a mapping exists.

Nothing observable changes with this delta. It is normative text only: no build
script, no compiled output and no continuous-integration guard is touched here,
and requirement 7 below pins that the current, mapping-less tree keeps producing
exactly what it produces today.

**Surface, not file pattern.** Where the meaning is the output surface, the text
below names the directory — `.claude/agents/` — rather than a file pattern
within it. Copilot CLI reads that directory, so a later change to the per-file
layout of the compiled outputs under it requires no delta of this delta.

Requirement numbering continues the parent's sequence, which ends at
requirement 5 — per the precedent of
`specs/0112-spec-id-reservation.delta-01.md`.

**Vocabulary.** A **model-mapping resolution** is the outcome, for one agent and
one CLI, of resolving that agent's declared capability profile against the
mapping in force for that CLI. The spec family of epic #1100 defines the profile
axes, the mapping files, the org-level override channel and the resolution
rules; this delta neither defines nor presumes them. It states only what the
build and its guards SHALL do once such a resolution exists, and what they SHALL
do while none does.

## ADDED

1. **R6.** Session-model inheritance SHALL be the fallback path of the compiled
   agent outputs — the outcome for every agent and CLI to which no model-mapping
   resolution applies — and SHALL NOT be read as a prohibition on emitting the
   declination that an applicable resolution directs.
2. **R7.** While no model-mapping resolution applies to any agent on any
   supported CLI, the compiled agent outputs SHALL carry no `model:` frontmatter
   field, and the checks of requirement 4 SHALL pass unchanged on the committed
   repository tree.
3. **R8.** A specification that enables `model:` emission into the
   `.claude/agents/` output surface SHALL first establish that Copilot CLI
   subagents on BYOK/Ollama providers are not re-exposed to the silent routing
   failure of `github/copilot-cli#4437`. Two paths are permitted: a condition on
   the Claude Code output surface that withholds the emission while a Copilot CLI
   reader may consume it, or evidence that the upstream defect is fixed. Absent
   either path, emission into that surface SHALL remain prohibited. This
   requirement constrains the `.claude/agents/` surface alone, whatever per-file
   layout the compiled outputs under it adopt.

### The shared-read hazard behind requirement 8

Per the parent's own `## Intent`, Copilot CLI inspects `.claude/agents` — Claude
Code's output surface, not its own. The consequence outlives the parent's
prohibition: while `github/copilot-cli#4437` is unfixed, a `model:` field
emitted anywhere under `.claude/agents/` is read by Copilot CLI and routes its
subagents to a model a BYOK/Ollama provider does not serve, silently, regardless
of what `.github/agents/` carries. A per-CLI mapping is therefore not by itself
sufficient protection: the Claude Code surface is shared, so a Claude-only
mapping entry still reaches Copilot CLI. The hazard attaches to the directory
Copilot CLI reads, not to any file name within it, which is why requirement 8
names the surface. Requirement 8 exists so that the mapping spec family cannot
enable emission into that surface without confronting the hazard first.

### Out of scope additions

- The capability-profile vocabulary, the per-CLI mapping files, the org-level
  override channel, and the build's resolution of them — the spec family of
  epic #1100.
- Any change to `scripts/build-components.sh`, to the committed agent outputs,
  or to the continuous-integration guards: this delta ships normative text only.

### Added scenarios

**Scenario:** a resolution directs a declination

```text
Given a model-mapping resolution applies to one agent on one supported CLI
When  bash scripts/build-components.sh runs
Then  that agent's compiled output for that CLI carries the declination the
      resolution names
And   the compiled output of every agent and CLI to which no resolution applies
      carries no model: frontmatter field
```

**Scenario:** emission into the Claude Code surface without the Copilot guard

```text
Given a specification enables model: emission into the .claude/agents/ surface
And   it neither withholds that emission from a Copilot CLI reader nor carries
      evidence that github/copilot-cli#4437 is fixed
When  that specification is reviewed
Then  the review records a violation of requirement 8
And   the specification is not approved
```

## MODIFIED

1. **Requirement 1 is replaced** so that the prohibition binds the *origin* of
   the emitted value rather than its existence.

   - Original R1:

     > **R1.** `scripts/build-components.sh` SHALL NOT emit hardcoded `model:`
     > frontmatter fields into compiled `.claude/agents/*/AGENT.md` output files.

   - Replacement R1:

     > **R1.** `scripts/build-components.sh` SHALL NOT emit into a compiled
     > agent output under `.claude/agents/` a `model:` frontmatter field whose
     > value originates anywhere other than a model-mapping resolution for Claude
     > Code. Where no such resolution applies to an agent, that agent's compiled
     > output SHALL carry no `model:` field at all.

2. **Requirement 2 is replaced** so that dynamic inheritance is stated as the
   unmapped outcome rather than the only admissible outcome.

   - Original R2:

     > **R2.** Compiled agent outputs across `.claude/agents/`,
     > `.github/agents/`, `.gemini/agents/`, and `.agents/agents/` SHALL allow
     > subagents to inherit the active session model dynamically.

   - Replacement R2:

     > **R2.** Compiled agent outputs across `.claude/agents/`,
     > `.github/agents/`, `.gemini/agents/`, and `.agents/agents/` SHALL allow
     > subagents to inherit the active session model dynamically wherever no
     > model-mapping resolution applies to the agent and the CLI in question.
     > Where a resolution does apply, that agent's compiled output for that CLI
     > SHALL carry the declination the resolution names; dynamic inheritance
     > SHALL remain the outcome everywhere else.

3. **Requirement 3 is replaced** because its tail clause (*without `model:`
   fields*) carries the same universal prohibition as requirement 1. Left
   untouched, it would make the parent internally contradictory the moment
   requirement 1 admits a directed emission, and would force the mapping spec
   family to open a second delta on this spec for one clause.

   - Original R3:

     > **R3.** `scripts/build-components.sh` SHALL regenerate all committed
     > `.claude/agents/*/AGENT.md` files in the repository tree without `model:`
     > fields.

   - Replacement R3:

     > **R3.** `scripts/build-components.sh` SHALL regenerate all committed
     > agent outputs under `.claude/agents/` in the repository tree so that each
     > carries exactly the `model:` field its applicable model-mapping resolution
     > directs, and no `model:` field where no resolution applies to it.

4. **Requirement 4 is replaced** so that the guard asserts conformance to what
   the mapping directs, and reduces to today's assertion when nothing directs
   anything.

   - Original R4:

     > **R4.** `scripts/check-components.sh` and CI validation checks SHALL
     > verify that compiled agent outputs match sources and carry no hardcoded
     > `model:` fields.

   - Replacement R4:

     > **R4.** `scripts/check-components.sh` and CI validation checks SHALL
     > verify that compiled agent outputs match what their sources and the
     > applicable model-mapping resolution together direct. Where no resolution
     > applies, that verification SHALL reduce to asserting that the outputs
     > carry no `model:` field — the assertion in force today.

5. **The scenario "compiled agent files carry no hardcoded model field" is
   replaced**, because its `Then` is a universal claim that the requalified
   requirement 1 no longer supports. One `Given` clause is added; nothing else
   changes.

   - Original scenario:

     ```text
     Given agent sources in artifacts/core/agents/
     When  bash scripts/build-components.sh runs
     Then  no generated .claude/agents/*/AGENT.md file contains a model:
           frontmatter field
     And   subagent spawns under Copilot CLI on BYOK/Ollama inherit the session
           model without error
     ```

   - Replacement scenario:

     ```text
     Given agent sources in artifacts/core/agents/
     And   no model-mapping resolution applies to those agents on Claude Code
     When  bash scripts/build-components.sh runs
     Then  no generated .claude/agents/*/AGENT.md file contains a model:
           frontmatter field
     And   subagent spawns under Copilot CLI on BYOK/Ollama inherit the session
           model without error
     ```

Requirement 5 of the parent is **UNCHANGED** and remains in force: it records a
one-off documentation update that the parent's implementation already
discharged, not a standing constraint on emission. The parent's second scenario
("drift check passes on regenerated agent outputs") is **UNCHANGED** — it
asserts zero drift between sources and outputs, which is indifferent to what the
outputs carry. Both `## Out of scope` bullets of the parent are **UNCHANGED**.

## REMOVED

None.
