# MCP Tools Reference

MemPalace exposes the following tool categories (v3.3.x). Tools used by
the cross-tool handoff protocol are highlighted in **bold**.

| Category | Tools |
|----------|-------|
| **Palace read** | **`mempalace_status`**, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_list_drawers`, `mempalace_get_drawer`, `mempalace_get_taxonomy`, **`mempalace_search`**, `mempalace_check_duplicate`, `mempalace_get_aaak_spec` |
| **Palace write** | **`mempalace_add_drawer`**, **`mempalace_update_drawer`**, `mempalace_delete_drawer` |
| **Knowledge Graph** | **`mempalace_kg_query`**, `mempalace_kg_add`, `mempalace_kg_invalidate`, `mempalace_kg_timeline`, `mempalace_kg_stats` |
| **Navigation** | `mempalace_traverse`, `mempalace_find_tunnels`, `mempalace_graph_stats` |
| **Agent Diary** | `mempalace_diary_write`, **`mempalace_diary_read`** |

Notable v3.3.x facts that shape the protocol above:

- `mempalace_add_drawer` and `mempalace_update_drawer` accept arbitrary
  `wing` and `room` — the only MCP write paths that do. The handoff
  lane is built on these.
- `mempalace_diary_write` and `mempalace_diary_read` only accept
  `agent_name`, not `wing` (despite the v3.3.3 changelog note about an
  internal `wing` parameter). Diaries are MCP-level per-agent silos.
- `mempalace_search` returns BM25-hybrid (60 % vector + 40 % keyword)
  results since v3.3.0. The keyword share is real but does not
  overcome volumetric imbalance from the `transcripts` wing — always
  scope by `wing` and `room` for the handoff lookup.
