# Claude Code worker settings profile and launch recipe

<!-- crewrig-doc: section=reference nav_order=167 published=true title="Claude Code worker settings profile and launch recipe" -->

A CrewRig worker (or subagent) session on Claude Code starts every API call from a fixed context of about 73,000 tokens. Two committed settings files cut it, and a launch flag set applies them. This page is the recipe; the design and the measurements are in [ADR-0025](adr/0025-slim-the-fixed-context-of-worker-and-subagent-sessions.md) and spec 0305.

## What ships

Setup (`setup-claude-interactive.ts`) deploys `artifacts/core/claude-profiles/` to `~/.crewrig/claude-profiles/`. It writes nothing under `~/.claude/` for this feature and does not touch `~/.claude/settings.json`: a profile applies only when a launcher passes it.

| File | Use |
|---|---|
| `worker.settings.json` | Workers and their subagents |
| `coordinator.settings.json` | A session that spawns workers or publishes artifacts |

### Worker profile (ADR-0025 W1, W2, W3, W5)

- **W1.** `permissions.deny` lists `Artifact`, `Workflow` and `ScheduleWakeup`: three tool definitions (16.1k tokens) no worker calls.
- **W2.** `claudeMdExcludes` drops the personal rules `00-soul`, `10-level`, `30-profile`, `40-expertise` and `50-team` through the home-independent patterns `**/rules/<name>.md`. The project `CLAUDE.md`, `AGENTS.md` and `60-tools.md` stay loaded. Caveat: the pattern also matches a rule of the same name in a project `.claude/rules/`.
- **W3 (project part).** `Agent(<name>)` denies for the 11 web and SEO agents, and `skillOverrides` `off` for `astro`, `copywriting`, `frontend` and `web-tester`. No user plugin, skill or connector is named: those are local, see [the allowlist](claude-allowlist.md).
- **W5.** `disableBundledSkills: true`.

### Coordinator profile: the differences and why

| Difference | Reason |
|---|---|
| No deny of `Workflow` and `Artifact` | The coordinator spawns workers with `Workflow` and publishes with `Artifact`. |
| `ScheduleWakeup` not denied | The coordinator is the session that self-paces; an owner may still deny it locally. |
| No `claudeMdExcludes` | The coordinator is the owner's working session and keeps the personal rules. |
| No `disableBundledSkills` | With `Workflow` kept, it inflates the `Workflow` definition by about 17,000 characters (ADR-0025, P3). |
| Web-agent denies and web-skill overrides kept | They are listing cuts unrelated to CrewRig work, valid for any session. |

## Launch recipe

```sh
claude --settings ~/.crewrig/claude-profiles/worker.settings.json \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

The coordinator variant replaces the file with `coordinator.settings.json`. Strict MCP is a launcher flag, not a settings key (W4): with the empty `--mcp-config`, no MCP tool name or server instruction enters the context. A worker that needs a server passes it in that `--mcp-config` instead of the empty object. MemPalace is not needed: a worker skips the session-start sweep.

## How an Orca worker receives a profile

Read-only investigation of Orca 1.4.258, nothing changed in Orca:

- `orca orchestration worker-start` has **no flag for extra CLI arguments or environment** (`--agent`, `--model`, `--effort` are the only launch options).
- Orca's per-agent launch options are the **global** settings `agentDefaultArgs.<agent>` and `agentDefaultEnv.<agent>`, set in Orca's settings. They apply to **every** Claude agent Orca launches: workers, the coordinator and interactive tabs alike. (On the authoring machine `claude` carries `--dangerously-skip-permissions`; that is a local value, not a default.) Adding `--settings ...` there would also apply the worker profile to the coordinator, which then loses `Workflow` and `Artifact`.
- **Safest option:** reuse a terminal. Start `claude --settings ~/.crewrig/claude-profiles/worker.settings.json --strict-mcp-config --mcp-config '{"mcpServers":{}}'` by hand in a terminal, then dispatch with `orca orchestration worker-start --terminal <handle> --worktree <selector>`. Only that terminal carries the profile; interactive tabs are unaffected.
- Second option, if every Orca-launched Claude agent should be slim: put the flags in `agentDefaultArgs.claude`, and run the coordinator outside Orca-launched tabs or with `coordinator.settings.json` passed by hand.

## Measured effect

Method: ADR-0025 appendix (`claude -p --output-format json`, first-call input read from the transcript), Claude Code 2.1.x, `claude-sonnet-5-5`, from a CrewRig worktree on the owner's home.

| Run | First-call input |
|---|---|
| Baseline, no settings (ADR-0025) | 73,071 |
| Committed worker profile + strict-MCP flags, nothing local | 41,548 |
| Same, plus the adopter-local allowlist of [the allowlist page](claude-allowlist.md) | 37,433 |

The committed file alone leaves the owner's own skills, a plugin and the claude.ai-synced skills in the listing; the target (at most 40,000) is met once those are hidden locally.

## CLI parity

Claude Code only. Copilot, Gemini and Antigravity get no equivalent in this change; the evidence is in cli-matrix row 46 and ADR-0025 *CLI parity*.
