---
id: "0093"
slug: worktree-subagent-cwd-guard
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 599
version: 1.0.0
---

# Harden worktree isolation against sub-agent cwd drift and stray-file cleanup

## Intent

After this change, a sub-agent spawned to work inside a ticket's worktree
verifies, before it writes anything, that its own working directory
actually resolves inside that worktree — so its file-mutating calls land
where the brief said they would instead of silently drifting onto the
main repository checkout. When a file is nonetheless discovered sitting on
the main checkout looking misplaced from a worktree-scoped ticket, nobody
on the team deletes it on sight; it is flagged for the orchestrator to
adjudicate, because a sibling agent's own in-flight write may be
transiting through that same path. A user or reviewer reading the
Worktree Isolation guidance finds both expectations stated as explicit,
followable steps rather than left implicit in the existing "treat the
main directory as read-only" instruction.

## Requirements

1. This spec SHALL declare `complexity: standard`, not `small`, because
   the change modifies `docs/agent-team-protocol.md` itself — an
   established protocol document that `AGENTS.md` → *Agent Team
   Protocol* refers every team to. `docs/agent-team-protocol.md` →
   *Standard Team Templates → Template 2* already mandates inserting
   `architect` as a DEV-stage step whenever "the documentation change
   modifies an established protocol, convention, or contract," and that
   conditional clause SHALL fire for this ticket's own implementation.
   The `small`-tier team composition in `docs/agent-team-protocol.md` →
   *Team sizing by complexity* explicitly excludes `architect` ("No
   `architect` — the spec is its own architectural input"), which would
   suppress that mandatory review for a change to the protocol document
   itself; `standard` is therefore the only tier that does not
   contradict the existing Template 2 clause.
2. `docs/agent-team-protocol.md` → *Worktree Isolation* SHALL require
   that every sub-agent spawned with a brief that targets a worktree
   path (i.e., the spawn's `Agent` prompt names `.worktrees/<ticket-id>/`
   as the working location) verify, before issuing its first `Write`,
   `Edit`, or file-mutating `Bash` call, that its own working directory
   resolves inside that worktree.
3. The verification step mandated by Requirement 2 SHALL be phrased as
   an explicit, actionable instruction that can be embedded verbatim in
   a spawned sub-agent's brief — an instruction to `cd` into the named
   worktree and confirm the resolved path before mutating any file —
   not a restatement of the general "treat the main directory as
   read-only" expectation already present in the section.
4. `docs/agent-team-protocol.md` SHALL state that the cwd-verification
   step applies to every specialist role (`developer`, `tester`,
   `doc-writer`, `architect`, or any other spawned specialist) whenever
   its brief targets a worktree path — the obligation attaches to the
   brief's target, not to the role.
5. `docs/agent-team-protocol.md` → *Worktree Isolation* (or an adjacent
   subsection it introduces) SHALL state that discovering a file
   written to the main repository checkout instead of the intended
   worktree — whether the discoverer is the orchestrator or a sibling
   sub-agent — SHALL NOT trigger deletion of that file.
6. The same section SHALL state the reason for Requirement 5's
   prohibition: a file present on the main checkout may be a sibling
   agent's own in-flight write transiting through that path, and its
   provenance cannot be presumed from location alone.
7. `docs/agent-team-protocol.md` SHALL state the remediation path for a
   discovered stray file: the discoverer flags it to the orchestrator
   (or `team-lead`) for adjudication, and the file is relocated into the
   correct worktree path only after its provenance is confirmed — never
   relocated or deleted unilaterally by the discoverer.
8. The rewrite SHALL be scoped to `docs/agent-team-protocol.md` →
   *Worktree Isolation*, touching `AGENTS.md`'s *Agent Team Protocol*
   summary bullet only if needed to keep the two surfaces consistent
   with each other. It SHALL NOT alter the *Solo work prohibition*, the
   *Standard Team Templates*, the *Team sizing by complexity* table, the
   *Team Communication* rules, or the *Team Shutdown* section beyond
   what Requirement 7's remediation path requires.
9. This spec SHALL NOT request, imply, or describe any change to the
   Claude Code harness's `Agent`, `Write`, `Edit`, or `Bash` tool
   implementations. The remediation this spec qualifies is
   documentation-only, because this repository does not control harness
   tool behavior.

## Scenarios

**Scenario:** Sub-agent verifies cwd before writing into its worktree

Given a sub-agent spawned with a brief that names `.worktrees/599-spec/`
as its working location
When the sub-agent runs the mandated cwd-verification step before its
first `Write` call
Then it confirms the resolved working directory is inside
`.worktrees/599-spec/`, and the write lands at the intended worktree
path

**Scenario:** cwd check catches a would-be misroute before it happens

Given a sub-agent whose session's working directory defaulted to the
main repository checkout instead of the worktree named in its brief
When the sub-agent runs the mandated cwd-verification step before
issuing its first `Write` call
Then it detects the mismatch, changes into the correct worktree,
re-verifies the resolved path, and only then proceeds — so no file is
written to the main checkout

**Scenario:** A stray file discovered on the main checkout is flagged,
not deleted

Given an orchestrator or a sibling sub-agent discovers a file, under the
main repository checkout, that appears to have been misrouted from a
worktree-scoped ticket
When the discovery is handled per the rewritten *Worktree Isolation*
guidance
Then the file is not deleted; it is flagged to the orchestrator for
adjudication, and is relocated into the correct worktree location only
after its provenance is confirmed

**Scenario:** A rewrite that still allows automatic cleanup of
"misplaced" files is rejected

Given a candidate change to *Worktree Isolation* that adds the
cwd-verification instruction from Requirement 2 but also instructs the
orchestrator (or any sub-agent) to delete any file it finds outside the
ticket's own worktree
When the change is reviewed against this spec
Then it is rejected, because Requirement 5 prohibits blind deletion of a
discovered stray file regardless of how confident the discoverer is that
the file is misplaced

## Out of scope

- Any harness-level or tool-level fix to how Claude Code's `Agent`,
  `Write`, `Edit`, or `Bash` tools resolve working directories for a
  spawned sub-agent — that surface belongs to Anthropic, not to this
  repository.
- Any change to the *Solo work prohibition*, the *Standard Team
  Templates*, the *Team sizing by complexity* table, the *Team
  Communication* rules, or the *Team Shutdown* section, beyond the
  minimal cross-reference consistency touch permitted by Requirement 8.
- Any code, script, lint rule, or pre-commit hook that automates the
  cwd-verification step. The remediation mandated here is a documented,
  human/agent-followed instruction embedded in a spawned sub-agent's
  brief — not tooling that enforces it mechanically.
- Defining the exact `SendMessage` payload schema used to flag a
  discovered stray file — left to the implementer's judgment within the
  existing *Team Communication* conventions in
  `docs/agent-team-protocol.md`.
- Retroactive cleanup of any stray file already present on `main` from a
  prior worktree-isolation incident (e.g. the spec 0050 DEV session
  referenced in issue #599) — this spec qualifies the go-forward
  protocol, not a one-time remediation pass.

## Open questions

- None — this is a scoped, narrow addition to one existing section of
  one documentation file; no ambiguity was identified that the
  Requirements and Out of scope sections above do not already resolve.
