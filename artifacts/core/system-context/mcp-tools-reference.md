# MCP Tools Reference

MemPalace's MCP tool surface is pinned to the installed **v3.3.5**
(supported range `>=3.3.3,<3.4` per
`scripts/setup-claude-interactive.sh:177-178`). Every claim below was
re-verified live against that installed version during issue #416 —
not carried forward from an earlier, unverified pass. Tools used by
the cross-tool handoff protocol are highlighted in **bold**.

| Category | Tools |
|----------|-------|
| **Palace read** | **`mempalace_status`**, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_list_drawers`, `mempalace_get_drawer`, `mempalace_get_taxonomy`, **`mempalace_search`**, `mempalace_check_duplicate`, `mempalace_get_aaak_spec` |
| **Palace write** | **`mempalace_add_drawer`**, **`mempalace_update_drawer`**, `mempalace_delete_drawer` |
| **Knowledge Graph** | **`mempalace_kg_query`**, `mempalace_kg_add`, `mempalace_kg_invalidate`, `mempalace_kg_timeline`, `mempalace_kg_stats` |
| **Navigation** | `mempalace_traverse`, `mempalace_find_tunnels`, `mempalace_graph_stats`, `mempalace_create_tunnel`, `mempalace_delete_tunnel`, `mempalace_follow_tunnels`, `mempalace_list_tunnels` |
| **Agent Diary** | `mempalace_diary_write`, **`mempalace_diary_read`** |
| **Maintenance** | `mempalace_sync`, `mempalace_reconnect`, `mempalace_hook_settings`, `mempalace_memories_filed_away` |

Notable facts (installed v3.3.5) that shape the protocol above:

- `mempalace_add_drawer` and `mempalace_update_drawer` accept arbitrary
  `wing` and `room` — the only MCP write paths that do. The handoff
  lane is built on these.
- `mempalace_diary_write` and `mempalace_diary_read` both accept an
  explicit `wing` argument — this corrects the prior "only accepts
  `agent_name`" claim, which was false on the live surface. Confirmed
  live during issue #416 (three independent probes across PLAN and its
  cold review): an explicit `wing` on `mempalace_diary_write`
  determines the wing the entry is stored under, and an explicit
  `wing` on `mempalace_diary_read` restricts the read to that wing — a
  matching explicit `wing` finds the entry, a different explicit
  `wing` finds nothing. `scripts/setup-claude-interactive.sh:174-178`
  already documents that v3.3.3 introduced the `wing` parameter on
  diary tools; this note aligns the reference with that fact instead
  of contradicting it. What the tool falls back to when `wing` is
  **omitted** remains unresolved: the parameter description states it
  reads from `wing_{agent_name}`, but the same probes found an
  omitted-`wing` read still surfaces the entry even when
  `wing_{agent_name}` holds zero drawers. The real fallback mechanism
  is not conclusively established — do not assume a specific one.
  Diaries stay out of the cross-tool handoff lane regardless of this
  open question; that separation rests on the project's deliberate
  lane-mapping convention (see *Lane mapping* in
  `palace-structure-conventions.md`), not on the now-corrected
  capability claim.
- `mempalace_get_aaak_spec` returns a genuine, implemented
  compressed-memory-format specification — not an inert or placeholder
  tool.
- `mempalace_search` returns BM25-hybrid (60 % vector + 40 % keyword)
  results since v3.3.0. The keyword share is real but does not
  overcome volumetric imbalance from the `transcripts` wing — always
  scope by `wing` and `room` for the handoff lookup.
