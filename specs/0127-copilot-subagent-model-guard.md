---
id: "0127"
slug: copilot-subagent-model-guard
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 834
version: 1.0.0
---

# Copilot subagent model guard

## Intent

A user running Copilot CLI on a BYOK/Ollama provider will no longer be
surprised by silently failing repo-level subagents: the limitation is
documented with a workaround, and a non-blocking guard warns when the
triggering condition is present and points to the upstream fix.

## Requirements

1. The repository SHALL ship a guard script at
   `scripts/check-copilot-subagent-model.sh` that scans the built
   `.claude/agents/*/AGENT.md` files for a `model:` field.
2. When the guard detects a `model:` field in any
   `.claude/agents/*/AGENT.md`, it SHALL emit a non-blocking warning
   naming the file, the upstream issue `github/copilot-cli#4437`, and
   the documented workaround.
3. The guard SHALL exit with status 0 whether or not it detects the
   condition, so it never blocks a build or a pull request.
4. The guard SHALL be wired into the existing CI `check-components` job
   as a non-blocking step.
5. `docs/cli-matrix.md` SHALL document the limitation — Copilot CLI
   honors the `model:` field of `.claude/agents/*/AGENT.md`, breaking
   subagent spawns on providers that do not serve that model — and the
   workaround — pass `model: <session-model>` explicitly to the `task`
   tool, or strip the `model:` line locally — with a link to
   `github/copilot-cli#4437`.
6. The documentation SHALL state that the guard and the doc note are to
   be removed once `github/copilot-cli#4437` is merged.

## Scenarios

**Scenario:** Guard warns on a model-bearing agent tree

Given a checkout whose `.claude/agents/developer/AGENT.md` carries
`model: sonnet`
When  the guard script runs
Then  it emits a warning naming the file and pointing to
      `github/copilot-cli#4437`, and exits 0.

**Scenario:** Guard is silent on a clean tree

Given a checkout whose `.claude/agents/*/AGENT.md` files carry no
`model:` field
When  the guard script runs
Then  it emits no warning and exits 0.

**Scenario:** Guard does not block a legitimate Claude agent PR

Given a pull request that adds a `model:` field to a Claude Code agent
When  CI runs the guard
Then  CI still passes (the guard exits 0) and the warning is visible in
      the log.

## Out of scope

- Any change to the build or emission of `model:` in
  `.claude/agents/*/AGENT.md` or `.github/agents/*.md`.
- Any change to Claude Code behavior or to the source
  `artifacts/core/agents/*/AGENT.md` metadata.
- The upstream fix itself in `github/copilot-cli`.
- Any blocking enforcement of the condition.

## Open questions

None — all questions raised during the interview were resolved.
