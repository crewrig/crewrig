---
id: "0056"
slug: antigravity-hooks
status: draft
complexity: trivial
interaction-mode: INTERMEDIATE
related-issue: 426
version: 1.0.0
---

# Antigravity CLI transcript hooks

## Intent

Antigravity CLI sessions gain the same lifecycle-event instrumentation already
present for Gemini CLI and Claude Code: a dedicated hooks file in the crewrig
`hooks/` directory that registers callbacks for the four standard lifecycle
events and routes every callback to the shared `hooks/mempalace-transcript.sh`
script, enabling MemPalace transcript capture for Antigravity CLI users without
any change to the existing Gemini or Claude hooks.

## Requirements

1. A file `hooks/antigravity-transcript-hooks.json` SHALL exist in the crewrig
   repository.
2. The hooks file SHALL register callback hooks for the following four lifecycle
   events: `BeforeAgent`, `AfterTool`, `AfterModel`, and `SessionEnd`.
3. Each registered callback SHALL be of `type` `"command"` and SHALL invoke
   `hooks/mempalace-transcript.sh` via a `bash` command.
4. The hooks file SHALL use the environment variable `$PWD` as the project
   directory prefix in every hook command, until an Antigravity CLI-specific
   project directory environment variable is confirmed and a delta-spec updates
   this requirement.
5. The hooks file `hooks/gemini-transcript-hooks.json` SHALL remain unchanged —
   this change MUST introduce no regression to existing Gemini CLI hook behavior.
6. The JSON structure of `hooks/antigravity-transcript-hooks.json` SHALL be
   identical in shape to `hooks/gemini-transcript-hooks.json`, replacing only
   the project directory variable reference (`$GEMINI_PROJECT_DIR` → `$PWD`).

## Scenarios

**Scenario:** Hooks file registers all four lifecycle events

Given `hooks/antigravity-transcript-hooks.json` exists in the repository
When its content is parsed as JSON
Then the top-level `hooks` object SHALL contain exactly the keys `BeforeAgent`,
  `AfterTool`, `AfterModel`, and `SessionEnd`, each mapping to a non-empty array
  of hook entries

**Scenario:** Each hook entry invokes mempalace-transcript.sh via $PWD

Given a hook entry for any of the four lifecycle events in
  `hooks/antigravity-transcript-hooks.json`
When the `command` field of that entry is inspected
Then it SHALL equal `bash $PWD/hooks/mempalace-transcript.sh`

**Scenario:** Gemini hooks file is not modified

Given `hooks/gemini-transcript-hooks.json` exists on `main` with its current
  content
When the implementation PR for this spec is applied
Then `hooks/gemini-transcript-hooks.json` SHALL be byte-for-byte identical to
  its state on `main` before the PR

**Scenario:** Antigravity-specific project dir var is confirmed later

Given a future delta-spec updates R4 to replace `$PWD` with a confirmed
  Antigravity CLI environment variable
When the hooks file is updated per that delta-spec
Then the new variable SHALL appear in all four hook command strings and `$PWD`
  SHALL no longer appear

## Out of scope

- MCP server configuration for Antigravity CLI — tracked separately under
  issue #418 sub-specs.
- Setup script changes to deploy the hooks file to the Antigravity plugin
  directory — tracked separately under issue #418 sub-specs.
- Antigravity workspace layout and plugin directory structure — covered by
  spec 0052.
- Build pipeline changes to include `hooks/antigravity-transcript-hooks.json`
  in built outputs — out of scope for this spec.
- Identification or confirmation of the Antigravity CLI-specific project
  directory environment variable — deferred; captured as an open question
  below and addressed by a future delta-spec when confirmed.

## Open questions

- [USER-PARKED] What is the Antigravity CLI environment variable equivalent to
  `$GEMINI_PROJECT_DIR` (the variable that resolves to the workspace root at
  runtime)? Until confirmed, R4 mandates `$PWD` as a safe fallback. When the
  variable is confirmed (e.g., via `agy env` inspection or documentation), a
  delta-spec SHALL update R4 and R6 accordingly.
