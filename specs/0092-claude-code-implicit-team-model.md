---
id: "0092"
slug: claude-code-implicit-team-model
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 596
version: 1.0.0
---

# Realign the team protocol on Claude Code's single implicit team model

## Intent

After this change, the agent team protocol describes Claude Code's actual
team model as the primary mechanism, instead of mandating a team-creation
capability the harness does not expose. An agent reading the protocol on
Claude Code finds coordination instructions it can follow without
improvising an equivalent; a REVIEW audit no longer raises a false process
violation for failing to use an unavailable capability; and the guidance for
a CLI that offers no multi-agent surface at all remains present so cross-CLI
parity still holds. No substantive protocol rule other than the
team-creation and team-teardown mechanism changes.

## Requirements

1. `AGENTS.md` → *Agent Team Protocol* SHALL NOT present `TeamCreate` as a
   mandatory tool on Claude Code. The "Mandatory tools on Claude Code CLI"
   bullet SHALL be rewritten so the mandated coordination primitives are only
   those the Claude Code harness actually exposes (`Agent` with an explicit
   `subagent_type`, `TaskCreate`, and `SendMessage`).
2. `AGENTS.md` and `docs/agent-team-protocol.md` SHALL describe the Claude
   Code team model as a single implicit session team, in which specialist
   work is delegated through the `Agent` tool, tracked through `TaskCreate`,
   and coordinated through `SendMessage`, with no explicit team-creation or
   team-deletion step.
3. The `docs/agent-team-protocol.md` section currently headed *On Claude Code
   CLI (team support available)* SHALL be retitled and rewritten so the
   single-implicit-team mechanism is the **primary** documented path for
   Claude Code — not a fallback framed as belonging to another CLI.
4. `docs/agent-team-protocol.md` SHALL retain distinct guidance for a CLI
   that exposes no multi-agent surface at all (the sequential-spawn path,
   e.g. Gemini CLI), and SHALL NOT describe that guidance as the Claude Code
   fallback, so cross-CLI parity guidance is preserved.
5. The *Team Shutdown* section of `docs/agent-team-protocol.md` SHALL NOT
   mandate a `TeamDelete` two-phase teardown as a step every Claude Code
   ticket must perform. It SHALL be rewritten so the primary path reflects
   that the implicit session team has no team record to delete, while
   preserving the meaningful teammate-conclusion courtesy (ensuring spawned
   agents have reported before the orchestrator moves on) and retaining
   explicit `TeamDelete` guidance only as conditional on a harness that
   genuinely exposes team primitives.
6. *Team Communication → Rule 1* of `docs/agent-team-protocol.md` (currently
   "spawned via `TeamCreate` / `TaskCreate`") SHALL be reworded so it no
   longer presupposes a `TeamCreate` spawn and instead references the actual
   spawn mechanism.
7. `docs/adr/0010-spec-plan-review-lifecycle.md` → *Parity implications* SHALL
   be corrected so it no longer asserts that Claude Code's `TeamCreate` team
   primitives make the routing engine "directly expressible"; it SHALL
   reflect the single-implicit-team model actually available.
8. `artifacts/core/agents/pr-reviewer/AGENT.md` SHALL NOT describe a
   "TeamCreate context" as a distinct invocation mode. Its dual-mode language
   (direct invocation vs. team-lead addressable) SHALL be rephrased to
   reference a `team-lead` being addressable within the implicit session team
   without implying an explicit `TeamCreate` step. Because this file is a
   shipped agent source, the change SHALL bump its
   `metadata.provenance.version` and the built outputs SHALL be regenerated
   via `scripts/build-components.sh` in the same change set.
9. The change set SHALL consult and, where the team-primitive story is
   recorded, update `docs/cli-matrix.md`, because the change touches the CLI
   Matrix Maintenance trigger surface (`AGENTS.md` and `artifacts/**`).
10. The rewrite SHALL preserve the substance of every protocol rule other
    than the team-creation and team-teardown mechanism: the solo-work
    prohibition, the issue-anchored team mandate, worktree isolation, the
    complexity tiers, the team templates, the verified-claim rule, the
    model-compatibility rule, and the non-mechanism parts of Team
    Communication SHALL remain unchanged in substance.

## Scenarios

**Scenario:** Agent finds followable coordination instructions on Claude Code

Given the rewritten *Agent Team Protocol* in `AGENTS.md` and
`docs/agent-team-protocol.md`
When an agent running on the current Claude Code harness reads the mandated
coordination primitives
Then it is directed to `Agent` (with an explicit `subagent_type`),
`TaskCreate`, and `SendMessage`, and encounters no mandate to call a
`TeamCreate` tool the harness does not expose

**Scenario:** REVIEW audit no longer flags a false process violation

Given a ticket whose DEV stage was staffed through direct `Agent` spawns
coordinated by `SendMessage` with `TaskCreate` tracking
When a REVIEW pass audits the session against the rewritten team protocol
Then it raises no `tech`-class process violation for the absence of a
`TeamCreate` call

**Scenario:** pr-reviewer dual-mode language no longer names a TeamCreate context

Given the rewritten `artifacts/core/agents/pr-reviewer/AGENT.md`
When the agent reads how to report its verdict under both invocation modes
Then it still handles both a direct invocation and an addressable `team-lead`,
and finds no wording that presents a "TeamCreate context" as a distinct mode

**Scenario:** Partial rewrite that leaves a stale mandate is rejected

Given a candidate change that removes the `TeamCreate` mandate from `AGENTS.md`
but leaves the *On Claude Code CLI (team support available)* mandate intact in
`docs/agent-team-protocol.md`
When the change is reviewed against this spec
Then it is rejected because the two surfaces no longer tell one story

**Scenario:** Deleting the sequential-spawn parity guidance is rejected

Given a candidate change that removes the guidance for a CLI with no
multi-agent surface
When the change is reviewed against this spec
Then it is rejected because cross-CLI parity guidance must be preserved
(requirement 4)

**Scenario:** Rewriting an unrelated protocol rule is rejected

Given a candidate change that also alters the solo-work prohibition or the
worktree-isolation rule
When the change is reviewed against this spec
Then it is rejected because only the team-creation and team-teardown mechanism
is in scope (requirement 10)

## Out of scope

- Editing the frozen normative content of `specs/0025-harden-agent-team-protocol.md`
  or `specs/0034-review-agent-direct-invocation-tolerance.md`; their content is
  immutable once merged (delta-spec convention). Any reconciliation is carried
  by this spec's narrative, or by a delta-spec if the REVIEW loop demands it.
- Any runtime or harness change to add, restore, or auto-detect a `TeamCreate`
  capability; this spec is documentation-and-agent-source only.
- Regenerating built outputs beyond those required by the
  `artifacts/core/agents/pr-reviewer/AGENT.md` edit.
- Changing the DEV-stage team templates, the complexity tiers, or the REVIEW
  routing engine.
- The `Agent` tool's own schema and the harness-level `team_name` deprecation
  (upstream, outside this repository's control).

## Open questions

- None — resolved 2026-07-22 at spec validation. Purge vs. conditional stub
  for explicit team primitives: this spec keeps a short conditional note that
  `TeamCreate` / `TeamDelete` apply only on a harness that genuinely exposes
  them (requirements 3–5), rather than purging every mention, so that
  Gemini/Copilot parity framing and any future team-capable harness remain
  covered. The **conditional stub** is retained, as reflected in the
  requirements.
