# Claude Code allowlist: plugins, skills, connectors and MCP

<!-- crewrig-doc: section=reference nav_order=168 published=true title="Claude Code allowlist: plugins, skills, connectors and MCP" -->

The [worker profile](worker-profile.md) cuts what CrewRig can name. What an adopter has installed locally (plugins, user skills, claude.ai-synced skills, connectors, MCP servers) is user-specific, so CrewRig does not commit it. Set the levers below in your own user or local settings, or on the launcher, to keep their listings and tool names out of CrewRig workspaces (ADR-0025 O5; measured effect in [the profile page](worker-profile.md#measured-effect)).

| Lever | Where | Effect | Notes |
|---|---|---|---|
| `skillOverrides: {"<skill>": "off"}` | user settings, or your own `--settings` file | Hides a user, plugin or web skill from the listing (about 2.5k tokens for 19 skills, ADR-0025 P5) | Plugin skills are named `<plugin>:<skill>`. CrewRig's four web skills are already off in the profiles. |
| `syncClaudeAiSkills: false` | `settings.local.json` only | Hides the skills synced from claude.ai | The Claude Code docs say only `settings.local.json` honours it; it worked from `--settings` in P5, but a committed or user-level value may be ignored. |
| `enabledPlugins: {"<plugin>": false}` | user settings | Disables a plugin | **Inconclusive** in the probes: P5 still listed a plugin's skills because it was also installed at project scope. Check every scope. |
| `disableClaudeAiConnectors` | user settings | Hides claude.ai connectors and their deferred tool names | **Not probed.** Verify before relying on it. |
| `--strict-mcp-config --mcp-config '<json>'` | launcher flag | Only the servers you pass are loaded; deferred tool names fall from about 15,000 to 700 characters and server instructions vanish (P6) | Part of the [launch recipe](worker-profile.md#launch-recipe). |
| `skillListingBudgetFraction` | user settings | Shrinks the skill listing | **Removes descriptions** (P6, value 0.002): skills keep only their names and stop self-selecting. Not recommended; hide unrelated skills instead. |

## A local file for workers

Because a plugin or skill name is yours, keep the extras in a file you own and launch with it instead of the committed one. Copy `~/.crewrig/claude-profiles/worker.settings.json`, add your `skillOverrides` and `syncClaudeAiSkills: false`, and pass the copy to `--settings`. Re-copy when setup refreshes the committed file.

## Caveats

- Single runs on one machine; the figures hold for the measured home and differ for yours.
- The deny lists name tools and agents CrewRig does not use. A new harness tool defaults to present until the profile is updated.
