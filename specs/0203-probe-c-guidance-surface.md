---
id: "0203"
slug: probe-c-guidance-surface
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1113
version: 1.0.0
---

# Probe C — guidance-surface prose vs Copilot reader, effort: frontmatter, and orchestrator guidance reliability

Authored for issue #1113, following the content gate v2 direction of spec 0197
(issue #1111). Spec 0197 introduces an orchestrator-guidance surface where model
and reasoning requirements are communicated via prose in an agent's compiled
`description` field. That specification rests on two empirical assumptions that
remain unverified in the end-to-end harness: first, that model-naming prose and
non-`model` frontmatter keys (such as `effort:`) do not trigger silent routing
failures in GitHub Copilot CLI's bring-your-own-key agent reader; second, that
orchestrators for Claude Code and Antigravity CLI reliably honor guidance-borne
model and effort requests when spawning agents.

This specification qualifies the end-to-end test apparatus for Probe C, defining
four test cells, their observable spawn signals, and machine-readable verdict
reporting.

## Intent

The test harness provides an automated, reproducible end-to-end probe that
determines whether prose in an agent's description or non-model frontmatter keys
disturb agent readers on bring-your-own-key deployments, and measures how
reliably orchestrators honor model and reasoning requests declared in guidance
prose. The probe executes four distinct test cells across supported
command-line interfaces, reports machine-readable verdicts grounded in
transcript spawn-result markers, and publishes its findings to verify or
falsify foundational model-mapping assumptions.

## Requirements

1. The end-to-end test suite SHALL include a dedicated scenario for probe C
   (`07-guidance-surface`) registered in the scenario configuration.
2. Probe C SHALL define exactly four distinct test cells (C1, C2, C3, and C4),
   each addressing a specific target command-line interface and guidance
   hypothesis.
3. Cell C1 SHALL evaluate GitHub Copilot CLI against a workspace containing an
   agent declaration whose `description` requests a model not served by the
   active provider, with no `model:` frontmatter field.
4. Cell C2 SHALL evaluate GitHub Copilot CLI against a workspace containing an
   agent declaration with an `effort:` frontmatter key and no `model:`
   frontmatter field, whose `description` requests a model not served by the
   active provider.
5. Cell C3 SHALL evaluate Claude Code against an agent declaration whose
   `description` requests a specific model and effort level alongside a control
   agent lacking guidance requests.
6. Cell C4 SHALL evaluate Antigravity CLI against an agent declaration whose
   `description` requests a specific model identifier supported by that
   interface.
7. Each cell run SHALL generate and inject independent nonces into both the
   top-level session prompt (session-liveness baseline) and the target agent's
   instructions.
8. Each cell's observation SHALL derive subagent spawning, execution, and model
   selection from verifiable CLI-generated transcript spawn-result markers
   rather than agent-authored files or raw standard output text.
9. Each cell SHALL resolve to exactly one verdict value drawn from the closed
   vocabulary: `HONOURED`, `IGNORED`, `DISTURBED`, or `INDETERMINATE`.
10. Cell C1 SHALL resolve to `IGNORED` when the subagent spawns and responds
    with the expected nonce without disturbance, `DISTURBED` when the subagent
    fails to spawn or fails silently, and `INDETERMINATE` when session liveness
    fails or preconditions are unmet.
11. Cell C2 SHALL resolve to `IGNORED` when the subagent spawns and responds
    with the expected nonce despite the `effort:` frontmatter key, `DISTURBED`
    when the frontmatter key prevents execution, and `INDETERMINATE` when
    session liveness fails.
12. Cells C3 and C4 SHALL resolve to `HONOURED` when the transcript spawn
    marker demonstrates the requested model was selected, `IGNORED` when the
    default or session model was selected instead of the requested model,
    `DISTURBED` when the guidance instruction causes execution failure, and
    `INDETERMINATE` when execution observations are inconclusive.
13. The scenario SHALL emit a structured machine-readable `verdict.json`
    containing the probe name, run identifier, timestamp, and an array
    recording each cell's target, question, outcome, and supporting observables.
14. The probe verdict publishing utility SHALL format and publish the
    machine-readable verdict as a structured comment on the related logbook
    issue.
15. The scenario SHALL skip gracefully with exit code 78 and an explanatory
    message when a target's required execution dependencies or provider
    credentials are not configured in the host environment.
16. Structural and resolver tests SHALL verify the integrity of the scenario
    files, syntax cleanliness, resolver logic, and publication formatting
    hermetically without invoking external services or Docker containers.

## Scenarios

**Scenario:** Successful evaluation of inert guidance prose under Copilot BYOK (Cell C1)

Given a configured GitHub Copilot CLI session backed by a BYOK provider
And   an agent declaration whose description names a model not served by that provider
When  the scenario executes cell C1
Then  the transcript contains a successful subagent spawn marker carrying the target nonce
And   the cell outcome resolves to `IGNORED` indicating prose guidance is inert.

**Scenario:** Detection of prose disturbance under Copilot BYOK (Cell C1)

Given a configured GitHub Copilot CLI session backed by a BYOK provider
And   an agent declaration whose description names a model not served by that provider
When  the subagent fails to respond or produces a failure marker
Then  the cell outcome resolves to `DISTURBED` indicating model-naming prose misdirects routing.

**Scenario:** Detection of honored orchestrator guidance under Claude Code (Cell C3)

Given a configured Claude Code session
And   an agent declaration whose description requests a specific model and effort
When  the scenario executes cell C3
Then  the subagent spawn marker identifies the requested model label
And   the cell outcome resolves to `HONOURED`.

**Scenario:** Graceful skip when target prerequisites are unconfigured

Given an environment lacking provider credentials or target CLI configuration
When  probe C executes
Then  the scenario exits with status 78
And   emits a skip line to the TAP report recording the missing prerequisite.

## Out of scope

- Modifying the text of spec 0197 or amending its recorded assumptions prior to
  published probe verdicts.
- Changes to the build or code emission logic of seam (d).
- Introducing dedicated container base images or new Docker infrastructure for
  Antigravity CLI.
- Automatically transitioning or modifying model mappings based on probe
  findings.

## Open questions

- None.
