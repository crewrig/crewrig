---
id: "0127"
slug: copilot-subagent-model-guard
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 834
version: 2.0.0
---

# Copilot subagent model guard (delta-01)

## ADDED

- The documentation SHALL state that the root cause is the default
  subagent-model routing (Copilot flight `copilot_cli_gpt_5_4_for_subagents`),
  which routes repo-level subagents to a model the BYOK/Ollama provider does
  not serve when no explicit `model:` is passed to the `task` tool — NOT the
  `model:` field of `.claude/agents/*/AGENT.md`, which is inert for subagent
  spawns.

## MODIFIED

- Original R5: "`docs/cli-matrix.md` SHALL document the limitation — Copilot
  CLI honors the `model:` field of `.claude/agents/*/AGENT.md`, breaking
  subagent spawns on providers that do not serve that model — and the
  workaround — pass `model: <session-model>` explicitly to the `task` tool, or
  strip the `model:` line locally — with a link to `github/copilot-cli#4437`."

  Replacement: "`docs/cli-matrix.md` SHALL document the limitation — Copilot
  CLI silently fails to spawn repo-level subagents on BYOK/Ollama sessions
  when no explicit `model:` is passed to the `task` tool, because the default
  subagent-model routing targets a model the provider does not serve — and the
  workaround — pass `model: <session-model>` explicitly to the `task` tool —
  with a link to `github/copilot-cli#4437`."

- Original R6: "The documentation SHALL state that the guard and the doc note
  are to be removed once `github/copilot-cli#4437` is merged."

  Replacement: "The documentation SHALL state that the doc note is to be
  removed once `github/copilot-cli#4437` is merged."

## REMOVED

- Original R1: "The repository SHALL ship a guard script at
  `scripts/check-copilot-subagent-model.sh` that scans the built
  `.claude/agents/*/AGENT.md` files for a `model:` field."

- Original R2: "When the guard detects a `model:` field in any
  `.claude/agents/*/AGENT.md`, it SHALL emit a non-blocking warning naming the
  file, the upstream issue `github/copilot-cli#4437`, and the documented
  workaround."

- Original R3: "The guard SHALL exit with status 0 whether or not it detects
  the condition, so it never blocks a build or a pull request."

- Original R4: "The guard SHALL be wired into the existing CI `check-components`
  job as a non-blocking step."

- Original scenario "Guard warns on a model-bearing agent tree": the guard
  script no longer exists, so the scenario is void.

- Original scenario "Guard is silent on a clean tree": the guard script no
  longer exists, so the scenario is void.

- Original scenario "Guard does not block a legitimate Claude agent PR": the
  guard script no longer exists, so the scenario is void.
