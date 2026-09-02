---
id: "0194"
slug: e2e-copilot-auth-and-probes
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1103
version: 1.0.0
---

# e2e Copilot workstation authentication and agent-surface probes

Authored for issue #1103, the blocking precondition of issue #1101 and its
pull request. The maintainer decided at the spec 0143 delta-01 content gate
(2026-09-02) that the status of the upstream defect `github/copilot-cli#4437`
must be adjudicated by a live probe before that delta merges: requirement 8 of
the delta admits `model:` emission into the `.claude/agents/` surface only on
one of two paths, and one of them is *evidence that the upstream defect is
fixed*. This spec qualifies the apparatus that produces such evidence. Its
second probe grounds the compiled-layout seam of epic #1100, which cites it by
name.

**Vocabulary.** *Probe A* is the scenario that adjudicates the upstream defect.
*Probe B* is the scenario that determines which repository agent-declaration
surfaces and per-file layouts each CLI actually consumes. A *verdict* is a
dated, machine-readable record of what one probe run observed, together with
the versions it observed it against. The *harness* is the end-to-end layer of
`tests/e2e/` and `docker/e2e/`. A *workstation credential* is a Copilot
credential that the developer's own Copilot installation already holds, as
opposed to a personal access token minted for a dedicated test account.

The requirements below run as one list: 1 through 7 qualify the workstation
credential, 8 through 11 probe A, 12 through 15 probe B, and 16 through 20 the
harness discipline both probes share.

**Complexity tier — `standard`, not `small`.** Issue #1103 expected `small`;
the spec's own content does not support it, on three counts. First, the
credential design admits two materially different paths — headless device-flow
persistence, or passthrough of the workstation's existing credential — and
requirements 1 through 7 deliberately leave the choice to the PLAN stage, which
is exactly the architect's seat that the `small` team composition omits. Second,
the deliverable *is* test infrastructure whose verdicts two other specification
families will cite; a harness whose own coverage is unexamined would let a
wrong verdict propagate, and `small` omits the tester. Third, the change spans
the credential scripts, the runner's readiness decision, the run configuration,
two new scenario surfaces, the hermetic tests that guard them, one architecture
decision record and two documentation surfaces — well past the single-team,
no-review-of-design shape `small` describes. Requirements 19 and 20 exist
because a hermetic test in this layer enumerates its subjects explicitly and
therefore passes vacuously on a subject nobody added to it.

## Intent

A maintainer running the end-to-end harness on their own workstation can
exercise GitHub Copilot CLI with the Copilot credential that workstation
already holds, and can obtain two dated, machine-readable facts that the
repository today asserts on documentation and a months-old diagnosis alone:
whether the silent subagent-routing failure tracked upstream as
`github/copilot-cli#4437` is still present, and which repository
agent-declaration surfaces and per-file layouts each supported CLI actually
consumes. Each fact lands as a recorded verdict naming the versions it was
observed against, so that the specifications depending on it cite an
observation rather than an assumption.

## Requirements

1. The harness SHALL admit, as the Copilot CLI credential for a scenario run, a
   credential originating from the developer workstation's own Copilot
   installation. Where neither that credential nor any credential path the
   harness already recognises is available, the harness SHALL report the
   affected pair as skipped with a diagnostic naming the command that
   establishes a credential — never as a failure, and never as a silent pass.
2. The harness's Copilot authentication-readiness decision SHALL treat a
   persisted workstation credential as a ready state, alongside the
   environment-variable token paths and the Ollama Cloud keypair path it
   already treats as ready. Where such a credential is present but the CLI
   rejects it, the readiness decision SHALL still report ready and the
   rejection SHALL surface as the scenario's own failure, so that an unusable
   credential is never reported as an unconfigured one.
3. The Copilot credential passthrough SHALL be declared in the harness's
   per-CLI run configuration, so that every scenario authenticating that CLI
   inherits it rather than each scenario declaring its own. A scenario that
   authenticates no CLI SHALL remain runnable under that declaration.
4. No credential material SHALL be committed to the repository, baked into any
   end-to-end image layer, or written anywhere inside the repository working
   tree by any harness command. The single admissible persistence location
   SHALL be the per-developer host directory the harness already owns for
   credentials.
5. Every directory and file the harness persists under that host directory
   SHALL end each harness command at the owner-only mode invariant already
   asserted for the other CLIs — `0700` for directories, `0600` for files. The
   invariant SHALL hold after a scenario run that writes into the credential
   bundle, not only after the command that establishes the credential.
6. The harness's documentation and run-configuration surfaces SHALL describe
   the Copilot credential paths in force. Neither surface SHALL assert that the
   Copilot path persists no on-disk credential, nor that every scenario mount
   of a credential bundle is read-only, while either statement is false of the
   harness as shipped.
7. The architecture decision record that deferred headless Copilot credential
   persistence SHALL record what became of that deferral — the surface
   realised, or the path adopted in its place — so that a later reader is not
   left with a deferral no longer describing the harness. That record SHALL
   state the disposition of the tracking issue rather than presume it; issue
   #77 stays open until its owner decides otherwise.

8. The harness SHALL carry a scenario replaying the documented reproduction of
   `github/copilot-cli#4437`: a Copilot CLI session served by a
   bring-your-own-key provider, a repository agent declaration carrying a
   model hint, and a subagent spawned through that session's task tool. Where
   any precondition of the reproduction cannot be established, the scenario
   SHALL report skipped with a diagnostic naming the missing precondition, and
   SHALL record no verdict.
9. That scenario SHALL record a machine-readable verdict whose value is exactly
   one of `BUG-PRESENT`, `BUG-ABSENT` or `INDETERMINATE`, together with the
   Copilot CLI version, the provider and model exercised, and the instant of
   the run. A run that executes but yields no discriminating observation SHALL
   be recorded as `INDETERMINATE`; an absent record SHALL never stand for an
   absent defect.
10. The scenario of requirement 8 SHALL be runnable on the Copilot credential
    paths that exist before requirements 1 through 7 are realised — the
    environment-variable token path and the Ollama Cloud keypair path.
    Requirements 1 through 7 SHALL NOT be a precondition of that scenario.
    Where the workstation credential path is available, the scenario SHALL be
    runnable on it as well.
11. The verdict of requirement 9 SHALL be published where its consumers read
    it: as a comment on the issue this spec qualifies, and cited from the
    Copilot subagent-routing gap note of `docs/cli-matrix.md` and from spec
    0143's audit trail. A `BUG-PRESENT` verdict SHALL leave that note in force
    and re-date it to the run observed; a `BUG-ABSENT` verdict SHALL discharge
    it; an `INDETERMINATE` verdict SHALL leave it in force and record why the
    run did not discriminate.

12. The harness SHALL carry a scenario determining, for each CLI it covers,
    whether that CLI's agent reader consumes a repository agent declaration
    placed under the `.claude/agents/` surface. The scenario SHALL cover at
    least GitHub Copilot CLI and Claude Code. A CLI for which the
    determination cannot be made SHALL be recorded as indeterminate for that
    cell, never omitted from the record.
13. That scenario SHALL determine, for each CLI it covers, whether the nested
    per-file layout `.claude/agents/<name>/AGENT.md` and the flat per-file
    layout `.claude/agents/<name>.md` are each consumed, and SHALL record every
    pairing of CLI and layout independently. A CLI consuming both layouts and a
    CLI consuming neither SHALL each be an admissible recorded outcome.
14. Every outcome recorded under requirements 12 and 13 SHALL be
    machine-readable and SHALL carry the observable that distinguished consumed
    from not consumed, the CLI version exercised, and the instant of the run.
    An outcome asserted without its distinguishing observable SHALL NOT be
    recorded.
15. The outcomes of requirements 12 and 13 SHALL be published where their
    consumers read them: as a comment on the issue this spec qualifies, and
    cited from the row-4 agent-layout confirmation gap of `docs/cli-matrix.md`
    and from the compiled-layout seam of epic #1100. Where an outcome
    contradicts an assertion a merged repository document already carries, the
    record SHALL name the contradicted assertion rather than resolve it
    silently.

16. Both scenarios SHALL be discoverable and runnable through the harness's
    existing scenario mechanism and SHALL report through its existing result
    format, so that each appears in the harness's parity matrix alongside the
    scenarios already present and can be run in isolation.
17. Neither scenario's verdict SHALL depend on the repository's committed
    compiled agent outputs; each SHALL establish the agent declarations its
    reproduction needs within its own run fixture. A scenario finding a fixture
    it needs absent SHALL report skipped rather than record a verdict.
18. Each scenario SHALL be re-runnable, and a re-run SHALL add a new dated
    record rather than replace the previous one, so that every verdict stays
    attributable to the run producing it.
19. The structural conformance of both scenarios, and of the changed
    authentication-readiness decision, SHALL be covered by tests running
    without Docker, without a credential and without provider quota, in the
    continuous-integration job already guarding the harness's structure. A
    property observable only in a live run SHALL be left out of those tests
    rather than asserted vacuously.
20. The hermetic test pairing each harness scenario with its row in
    `docs/cli-matrix.md` SHALL enumerate the scenarios this spec adds. A
    scenario absent from that enumeration SHALL count as uncovered, not as
    passing.

## Scenarios

**Scenario:** a workstation credential authenticates a Copilot scenario run

```text
Given the developer's workstation holds a Copilot credential
And   no personal access token is exported in the shell running the harness
When  the harness runs a Copilot scenario
Then  the harness reports the pair as ready rather than skipped
And   the Copilot CLI inside the container authenticates
```

**Scenario:** no Copilot credential of any kind is available

```text
Given the workstation holds no Copilot credential
And   no personal access token and no Ollama Cloud keypair are available
When  the harness runs a Copilot scenario
Then  the harness reports the pair as skipped
And   the diagnostic names the command that establishes a credential
And   the run is not reported as a failure and not reported as a pass
```

**Scenario:** a harness command must not leave credential material behind

```text
Given a harness command that persists a Copilot credential has just run
When  the repository working tree and the built end-to-end images are inspected
Then  no credential material is present in either
And   every directory of the persisted bundle is mode 0700
And   every file of the persisted bundle is mode 0600
```

**Scenario:** the credential bundle keeps its mode invariant after a run

```text
Given a scenario run that writes into the persisted Copilot credential bundle
When  the run completes
Then  every directory of the bundle is mode 0700
And   every file of the bundle is mode 0600
```

**Scenario:** probe A records a verdict on the upstream defect

```text
Given a Copilot CLI session served by a bring-your-own-key provider
And   a repository agent declaration carrying a model hint
When  probe A spawns a subagent through the session's task tool
Then  probe A records a verdict of BUG-PRESENT or BUG-ABSENT
And   the record names the Copilot CLI version, the provider, the model
      and the instant of the run
```

**Scenario:** probe A runs on the credential paths that already exist

```text
Given a checkout in which requirements 1 through 7 are not yet realised
And   a personal access token exported in the shell running the harness
When  probe A runs
Then  probe A is not skipped for want of a workstation credential
And   probe A records a verdict
```

**Scenario:** a precondition of probe A cannot be established

```text
Given probe A cannot establish its bring-your-own-key provider
When  probe A runs
Then  probe A reports skipped and names the missing precondition
And   probe A records no verdict
And   no reader can mistake the outcome for BUG-ABSENT
```

**Scenario:** probe B records every pairing of CLI and layout

```text
Given probe B covers GitHub Copilot CLI and Claude Code
And   an agent declaration is available in the nested layout and in the flat
      layout
When  probe B runs
Then  probe B records one outcome per pairing of CLI and layout
And   each outcome carries the observable that distinguished consumed from
      not consumed, the CLI version and the instant of the run
```

**Scenario:** probe B cannot discriminate one cell

```text
Given probe B runs and one CLI produces no observable that distinguishes
      consumed from not consumed
When  probe B records its outcomes
Then  that cell is recorded as indeterminate
And   the cell is not omitted from the record
```

**Scenario:** a probe outcome contradicts a merged repository assertion

```text
Given a merged repository document asserts that a CLI reads the
      .claude/agents/ surface
And   probe B observes that the CLI does not read it
When  probe B publishes its outcomes
Then  the record names the contradicted assertion and the document carrying it
And   the contradiction is not resolved silently in this spec's own diff
```

**Scenario:** a probe ships outside the hermetic enumeration

```text
Given a probe scenario is added to the harness
And   the hermetic parity test does not enumerate that scenario's key
When  the continuous-integration job for the harness runs
Then  the probe counts as uncovered rather than as passing
```

## Out of scope

- Any repair of, or workaround for, the upstream defect tracked as
  `github/copilot-cli#4437`. This spec produces a fact; the consequences of
  that fact belong to the specifications consuming it.
- The flat-layout migration itself — the compiled-layout seam of epic #1100.
  Probe B grounds that seam's impact analysis and does not perform it.
- Any change to `scripts/build-components.sh`, to the committed compiled agent
  outputs, or to the drift guards checking them.
- Any change to the normative text of spec 0143 or of its delta-01. This spec
  supplies the evidence that the delta's requirement 8 admits; it does not
  amend either document.
- Restoring a previously removed credential passthrough. No such mechanism was
  ever removed — the repository's history carries no removal — so requirements
  1 through 7 complete and generalise the surface that ADR 0002 Decision 4
  deferred, rather than restore anything.
- Headless device-flow credential persistence — the surface that ADR 0002
  Decision 4 deferred to issue #77. The maintainer confirmed at the content
  gate of 2026-09-02 that it stays out of scope: requirements 1 through 7 are
  satisfied by the Copilot credential the developer's workstation already
  holds, and issue #77 stays open until its owner decides otherwise.
- Deliberately widening the Claude Code or Gemini CLI credential surfaces.
  Both already have a working credential path; they change here only where a
  mechanism the Copilot path needs also serves them.
- Determining whether Gemini CLI or Antigravity CLI consumes the
  `.claude/agents/` surface. Neither is a consumer of the epic's
  compiled-layout seam; requirement 12 says "at least", leaving room for a
  later widening without a delta.
- Running either probe in continuous integration. Both need a real credential
  and real provider quota, which the continuous-integration environment does
  not hold; requirements 19 and 20 cover their structure there, not their
  execution.

## Open questions

None. The one grounding question raised at authoring — that a
workstation-credential passthrough already partially exists, against the
premise under which deliverable 1 was decided — was closed by the maintainer
at the content gate on 2026-09-02, on the completion-and-generalisation scope:
requirements 1 through 7 stand as authored. The written closure is the comment
of that date on the issue #1103 logbook (comment 5505910382).
