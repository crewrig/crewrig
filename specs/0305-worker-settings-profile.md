---
id: "0305"
slug: worker-settings-profile
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1988
version: 1.0.0
---

# Claude Code worker settings profile

## Intent

A Claude Code worker session started for CrewRig work carries a much smaller fixed context than today, because CrewRig ships a committed worker settings profile and a coordinator counterpart, deploys both to a stable per-user location without touching any file the user owns, and documents the launch recipe, including how an Orca worker receives it, and the local allowlist an adopter sets on top. The first API call of a fresh worker falls from 73,071 tokens to at most 40,000 (ADR-0025, O2 and O5; follow-ups F1 and F6, issues #1988 and #1993). The other CLIs are explicitly recorded as not receiving an equivalent in this change.

## Requirements

1. CrewRig SHALL commit two Claude Code settings files, `worker.settings.json` and `coordinator.settings.json`, in a new core source directory `artifacts/core/claude-profiles/`. Both MUST be valid JSON; each new core path SHALL be listed once in `docs/layers.md` and once in `.crewrig/core-paths.txt`.
2. Setup SHALL deploy the whole directory to `~/.crewrig/claude-profiles/` for Claude Code only, through the same link-or-copy mechanism that deploys `artifacts/core/system-context` to `~/.crewrig/system-context`. When the destination already exists, setup SHALL refresh it in place rather than fail.
3. Setup MUST NOT create, modify or delete any file under `~/.claude/` for this feature, and MUST NOT change `~/.claude/settings.json`. Applying a profile SHALL happen only when a launcher passes it explicitly (R9).
4. The worker profile SHALL set `permissions.deny` to include `Artifact`, `Workflow`, `ScheduleWakeup`, and `Agent(<name>)` for each of the 11 web and SEO agents of `artifacts/core/agents/`. Every denied agent name MUST match an agent that exists in that tree.
5. The worker profile SHALL set `claudeMdExcludes` so that the personal rules `00-soul`, `10-level`, `30-profile`, `50-team` and `40-expertise` are not loaded, using patterns that do not depend on a particular home directory. The excluded rules MUST be absent from a fresh worker session on any user home; the project `CLAUDE.md` and `AGENTS.md` MUST remain loaded.
6. The worker profile SHALL set `disableBundledSkills: true` and `skillOverrides` to `off` for the four web skills `astro`, `copywriting`, `frontend` and `web-tester`. It MUST NOT name any user-specific plugin, skill or connector, and MUST NOT set `syncClaudeAiSkills` (user-local; see R10).
7. The coordinator profile SHALL deny neither `Workflow` nor `Artifact`, SHALL NOT deny any tool the coordinator uses to spawn or publish, SHALL NOT set `claudeMdExcludes` for the personal rules, SHALL NOT set `disableBundledSkills` (with `Workflow` kept it inflates the `Workflow` definition by about 17,000 characters, ADR-0025 P3), and SHALL keep the project-level listing cuts of R4 (web-agent denies) and R6 (web-skill overrides). The coordinator profile SHALL be self-explanatory: a reader of `docs/worker-profile.md` MUST find the rationale for each difference from the worker profile.
8. Strict MCP SHALL be a launcher flag recipe, not a settings key: `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`. Neither profile SHALL attempt to express it.
9. `docs/worker-profile.md` SHALL document the launch recipe, `claude --settings ~/.crewrig/claude-profiles/worker.settings.json --strict-mcp-config --mcp-config '{"mcpServers":{}}'`, the coordinator variant, and how an Orca worker receives a profile. It SHALL state the verified finding that `orca orchestration worker-start` has no flag for extra CLI arguments or environment, and that Orca's per-agent launch options are the global settings `agentDefaultArgs.<agent>` and `agentDefaultEnv.<agent>` (currently `claude` = `--dangerously-skip-permissions`), which apply to every Claude tab including interactive ones. It SHALL name the alternative of reusing a terminal with `--terminal <handle>` in which the coordinator started `claude --settings ...` by hand, and SHALL state which option is safest (the hand-started terminal, because it leaves interactive tabs unaffected). CrewRig SHALL change no Orca configuration.
10. `docs/claude-allowlist.md` SHALL document what an adopter sets locally to keep listings and MCP tool names out of CrewRig workspaces: plugin names, `syncClaudeAiSkills` (honoured only from `settings.local.json`), `disableClaudeAiConnectors` (marked not probed), `--strict-mcp-config`, and `skillOverrides`. It SHALL state the ADR-0025 O5 caveats: `enabledPlugins: false` was inconclusive in the probes, and `skillListingBudgetFraction` removes skill descriptions. Both docs SHALL carry the repository's docs-index frontmatter and `docs/index.json` SHALL be regenerated.
11. Acceptance, checked at implementation time and recorded on issue #1988 (not a CI test): with the committed worker profile and the R8 flags, the first-call input of a fresh `claude -p` worker session SHALL be at most 40,000 tokens (baseline 73,071), measured by the ADR-0025 appendix method. When the measurement exceeds 40,000 the result SHALL be recorded as is and the target SHALL NOT be claimed.
12. A new `docs/cli-matrix/rows/` row, with `docs/cli-matrix.md` rebuilt, SHALL record this surface: Claude Code deployed; Copilot CLI, Gemini CLI and Antigravity CLI given no equivalent in this change, each with ADR-0025 *CLI parity* evidence. Copilot: `--no-custom-instructions` is all-or-nothing (49.0k to 22.6k, C2). Gemini: `GEMINI_CLI_SYSTEM_SETTINGS_PATH` read in source only, not probed, probe refused with `IneligibleTierError`. Antigravity: `agy --settings` appears in `--help`, not verified, login required.
13. An automated node test SHALL assert that both JSON files parse and contain the required keys; that the worker deny list is a superset of `Artifact`, `Workflow` and `ScheduleWakeup` while the coordinator denies neither `Workflow` nor `Artifact`; that every `Agent(<name>)` deny names an existing agent; and that the setup descriptor deploys the directory for Claude Code only. The golden declaration fixture SHALL be updated accordingly.

## Scenarios

### Happy path

- **Given** a user home with the personal rules installed and a repository checkout,
- **When** Claude Code setup runs,
- **Then** `~/.crewrig/claude-profiles/worker.settings.json` and `coordinator.settings.json` exist, and `~/.claude/settings.json` and every other file under `~/.claude/` are byte-identical to before.

### Happy path (worker launch)

- **Given** the deployed profiles,
- **When** a coordinator starts `claude -p` with `--settings ~/.crewrig/claude-profiles/worker.settings.json --strict-mcp-config --mcp-config '{"mcpServers":{}}'`,
- **Then** the personal rules are not in the session context, `Artifact`, `Workflow` and `ScheduleWakeup` are unavailable, the first-call input is at most 40,000 tokens, and the project `AGENTS.md` is still loaded.

### Happy path (coordinator launch)

- **Given** the deployed profiles,
- **When** a coordinator starts Claude Code with the coordinator profile,
- **Then** `Workflow` and `Artifact` are available and the personal rules are loaded.

### Failure path

- **Given** an agent in `artifacts/core/agents/` is renamed or removed while `worker.settings.json` still denies `Agent(<old name>)`,
- **When** the node test runs,
- **Then** it fails and names the stale denied agent.

### Failure path (other CLIs)

- **Given** setup is run for Copilot CLI, Gemini CLI or Antigravity CLI,
- **When** it completes,
- **Then** `~/.crewrig/claude-profiles/` is not deployed on their behalf, and the cli-matrix row records the gap with its evidence instead of leaving it silent.

## Out of scope

- `omitClaudeMd` on agents and the conventions fragments (#1989), the split of `60-tools.md` (#1990), the probe task (#1994).
- Any Orca configuration change, including `agentDefaultArgs` and `agentDefaultEnv`, and any edit of a user-home file.
- Equivalent profiles for Copilot CLI, Gemini CLI or Antigravity CLI, and the subagent 30,000-token target.
- Moving web agents or skills to the `library` tier, and `skillListingBudgetFraction`.

## Open questions

- [AUTO-PARKED] Should the coordinator profile deny `ScheduleWakeup`? R7 keeps every tool the coordinator may use available, so it denies none until an owner confirms the coordinator never schedules wakeups.
- [AUTO-PARKED] The pre-reservation id check reported the id as not secured (`unsecured-id: true`); a maintainer secures id 0305 before merge.
