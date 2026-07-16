---
id: "0070"
slug: mempalace-tool-surface-drift
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 416
version: 1.0.0
---

# Correct MemPalace tool-surface drift in the diary, tool-inventory, and AAAK documentation

## Intent

An agent that reads the MemPalace tool-surface documentation for the agent
diary's `wing` parameter, the full inventory of MCP tools the installed
MemPalace version exposes, or the AAAK compressed-memory format finds a
factually accurate account of what that installed version actually does,
instead of the stale or incomplete claims currently recorded.

## Requirements

1. `artifacts/core/system-context/mcp-tools-reference.md` SHALL list every
   MCP tool exposed by the installed MemPalace MCP server, adding the eight
   tools confirmed present but currently missing from the table
   (`create_tunnel`, `delete_tunnel`, `follow_tunnels`, `list_tunnels`,
   `sync`, `reconnect`, `hook_settings`, `memories_filed_away`); the
   existing `mempalace_traverse` entry name SHALL be retained as-is, since
   it matches the live tool surface.
2. The claim that `mempalace_diary_write` and `mempalace_diary_read` accept
   only an `agent_name` parameter and not a `wing` parameter SHALL be
   removed from both `artifacts/core/rules/60-tools.md` and
   `artifacts/core/system-context/mcp-tools-reference.md`.
3. The documentation SHALL state, as verified behavior, that an explicit
   `wing` argument to `mempalace_diary_write` determines the wing a diary
   entry is stored under, and that an explicit `wing` argument to
   `mempalace_diary_read` restricts the read to entries stored under that
   wing.
4. The documentation SHALL NOT introduce a new, unverified claim about
   which wing `mempalace_diary_read` searches when its `wing` argument is
   omitted; any aspect of that default behavior not confirmed during this
   change SHALL be recorded as unresolved rather than asserted.
5. Any restated rationale for keeping the agent diary out of the
   cross-tool handoff lane (the lane reserved for
   `mempalace_add_drawer`/`mempalace_update_drawer` on a project wing and
   room) SHALL rest on the project's deliberate lane-mapping convention,
   not on the removed false capability claim.
6. `artifacts/core/system-context/mcp-tools-reference.md` SHALL record
   that `mempalace_get_aaak_spec` returns a genuine, implemented
   compressed-memory-format specification, not an inert or placeholder
   tool.
7. Every corrected claim SHALL be pinned to the MemPalace version against
   which it was verified.

## Scenarios

**Scenario:** Agent verifies wing-scoped diary storage and read-back.

Given the installed MemPalace MCP server exposes `mempalace_diary_write`
and `mempalace_diary_read` with an optional `wing` parameter
When an agent writes a diary entry with an explicit `wing` override and
then reads it back specifying that same explicit `wing`
Then the entry is found under the specified wing
And the corrected documentation in `mcp-tools-reference.md` and
`60-tools.md` describes this behavior instead of the removed
"only accepts `agent_name`" claim.

**Scenario:** Agent looks up a tool missing from the pre-correction table.

Given the pre-correction tool-reference table omits `mempalace_sync`,
`mempalace_hook_settings`, and the other six confirmed-present tools
When an agent consults `artifacts/core/system-context/mcp-tools-reference.md`
to decide whether a sync, tunnel, hook-settings, or filed-away-memories
action is reachable through MCP
Then the agent cannot find the tool in the reference and either avoids the
action or falls back to an ad-hoc workaround
And after the correction, the same lookup surfaces the tool under its
category, closing the gap.

**Scenario:** Agent reads a diary with a mismatched explicit wing.

Given a diary entry was written with an explicit `wing` argument
When an agent calls `mempalace_diary_read` for the same `agent_name` but
with a different, unrelated explicit `wing` argument
Then no entries are returned
And the corrected documentation's wing-scoping claim holds under this
negative case rather than overclaiming that `wing` has no real effect.

## Out of scope

- Adopting the AAAK compressed-memory format as a mandated diary-writing
  convention. This change documents that the format is genuine, not that
  agents must use it.
- Adopting wing-scoped diary writes and reads as a cross-tool handoff
  mechanism. The existing lane-mapping design — handoff via
  `mempalace_add_drawer`/`mempalace_update_drawer` on a project wing and
  room, diaries reserved for per-agent self-recovery — is not revisited.
- Regenerating or introducing a build output for either corrected file.
  `scripts/build-components.sh` processes only the `skills/`, `agents/`,
  and `commands/` sources; it never touches `rules/` or `system-context/`
  sources. Both corrected files are deployed to `~/.crewrig/` (or the
  equivalent per-CLI destination) via a direct `install_dir` copy in each
  CLI's setup script, not compiled — no build-output correction applies.
- The layered wake-up token budget and the MCP-vs-CLI parity gap for
  MemPalace's native `L0`–`L3` wake-up — already addressed by spec 0069,
  whose own scope explicitly defers this ticket's findings to issue #416.
- Any change to `docs/cli-matrix.md`, the Long-Running Task Convention,
  the Palace Structure Conventions, or any other system-context store
  file not named in `## Requirements`.
- Renaming the `mempalace_traverse` table entry on the strength of the
  original ticket's claimed mismatch with a tool named `traverse_graph`.
  The live tool surface exposes `mempalace_traverse` under that exact
  name, matching current documentation; no such tool named `traverse_graph`
  was found on the installed MCP surface.

## Open questions

- The exact fallback `mempalace_diary_read` uses when `wing` is omitted
  does not match its own parameter description ("uses
  `wing_{agent_name}`"). A live probe performed while authoring this spec
  wrote a diary entry with `agent_name="spec-0070-probe"` and an explicit
  `wing="crewrig-spec-0070-wing-probe"`; `mempalace_list_wings` and
  `mempalace_list_drawers` confirmed the entry landed only in that wing
  and that `wing_spec-0070-probe` was never created (zero drawers).
  Reading with the matching explicit `wing` found the entry; reading with
  a different, unrelated explicit `wing` found nothing (Scenario 3
  above). But reading with `wing` omitted entirely also found the entry
  — even though the tool's own default (`wing_{agent_name}`) held no
  drawers. This means the omitted-`wing` read path is not literally
  "search `wing_{agent_name}`" as documented; the real fallback (e.g. an
  agent-name-keyed lookup spanning wings) is not conclusively established
  by a single probe. PLAN/DEV SHALL re-verify this specific path before
  finalizing the corrected wording (per R4) — the correction SHALL ship
  with whatever is confirmed at that point, not with this spec's
  provisional read of the evidence.
