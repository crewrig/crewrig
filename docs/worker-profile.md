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
- **W2.** `claudeMdExcludes` drops the personal rules `00-soul`, `10-level`, `30-profile`, `40-expertise` and `50-team`, and the orchestrator memory protocol `60-memory` (spec 0308; the obligations that bind a worker stay in `60-tools.md`, section *Memory obligations that bind every agent*), through the home-independent patterns `**/rules/<name>.md`. The project `CLAUDE.md`, `AGENTS.md` and `60-tools.md` stay loaded; the coordinator profile excludes none of them. Caveat: the pattern also matches a rule of the same name in a project `.claude/rules/`.
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

## How a launched worker receives a profile

- Pass the profile with `--settings <profile>` plus the strict MCP flags at launch, as in the recipe above.
- A launcher that offers launch options applies them either per worker or globally.
- A launcher-wide default applies to every agent it launches, the coordinator included, so interactive and coordinator sessions would be slim too. Pass the coordinator profile by hand, or run the coordinator outside those sessions, so it keeps `Workflow` and `Artifact`.
- Reusing a session started by hand with the flags is the safest option: it leaves other sessions unaffected.
- The launcher is not configured by CrewRig.

## Measured effect

Method: ADR-0025 appendix (`claude -p --output-format json`, first-call input read from the transcript), Claude Code 2.1.323, `claude-sonnet-5-5`, from a CrewRig worktree on one user's home (the author's, which carries personal skills, a plugin and claude.ai-synced skills). Single runs.

| Run | First-call input |
|---|---|
| Baseline, no settings (ADR-0025) | 73,071 |
| Committed worker profile + strict-MCP flags, nothing local | 41,548 |
| Same, plus the adopter-local allowlist of [the allowlist page](claude-allowlist.md) | 37,433 |

The committed file alone leaves that home's own skills, a plugin and the claude.ai-synced skills in the listing, and **misses the 40,000 target by 1.5k on this home**. The target holds only when those are hidden locally, as in the third row (37,433). A run on a home carrying only CrewRig's own files was **not made**, so the committed profile alone is not claimed to meet the target elsewhere.

## CLI parity

Claude Code only. Copilot, Gemini and Antigravity get no equivalent in this change; the evidence is in cli-matrix row 46 and ADR-0025 *CLI parity*.
