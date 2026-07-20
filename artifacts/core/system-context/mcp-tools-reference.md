# MCP Tools Reference

MemPalace's MCP tool surface is pinned to the supported range `>=3.6.0,<3.7`
(the single source of truth is `scripts/lib/common.sh`;
`MEMPALACE_MIN_VERSION` / `MEMPALACE_MAX_VERSION_EXCLUSIVE`). The tool inventory
below was verified live against a **MemPalace 3.6.0** server — the e2e sidecar
image built from `docker/e2e/mempalace.Dockerfile` — during issue #566, not
carried forward from an earlier pass. Tools used by the cross-tool handoff
protocol are highlighted in **bold**.

MemPalace 3.6.0 exposes **36** MCP tools (30 on the previous 3.3.x line plus the
six additive tools marked *(3.6.0)* below).

| Category | Tools |
|----------|-------|
| **Palace read** | **`mempalace_status`**, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_list_drawers` (now accepts `since`/`before` date filters, *3.6.0*), `mempalace_get_drawer`, `mempalace_get_taxonomy`, **`mempalace_search`** (now accepts a `source_file` filter, *3.6.0*), `mempalace_check_duplicate`, `mempalace_get_aaak_spec` |
| **Palace write** | **`mempalace_add_drawer`**, **`mempalace_update_drawer`**, `mempalace_delete_drawer`, `mempalace_checkpoint` *(3.6.0)*, `mempalace_delete_by_source` *(3.6.0)*, `mempalace_mine` *(3.6.0)* |
| **Knowledge Graph** | **`mempalace_kg_query`**, `mempalace_kg_add`, `mempalace_kg_invalidate`, `mempalace_kg_supersede` *(3.6.0)*, `mempalace_kg_timeline`, `mempalace_kg_stats` |
| **Navigation** | `mempalace_traverse`, `mempalace_find_tunnels`, `mempalace_graph_stats`, `mempalace_create_tunnel`, `mempalace_delete_tunnel`, `mempalace_follow_tunnels`, `mempalace_list_tunnels`, `mempalace_list_hallways` *(3.6.0)*, `mempalace_delete_hallway` *(3.6.0)* |
| **Agent Diary** | `mempalace_diary_write`, **`mempalace_diary_read`** |
| **Maintenance** | `mempalace_sync`, `mempalace_reconnect`, `mempalace_hook_settings`, `mempalace_memories_filed_away` |

Notable facts (MemPalace 3.6.0) that shape the protocol above:

- `mempalace_add_drawer` and `mempalace_update_drawer` accept arbitrary
  `wing` and `room` — the only MCP write paths that do. The handoff
  lane is built on these.
- `mempalace_diary_write` and `mempalace_diary_read` both accept an
  explicit `wing` argument — an explicit `wing` on `mempalace_diary_write`
  determines the wing the entry is stored under, and an explicit
  `wing` on `mempalace_diary_read` restricts the read to that wing: a
  matching explicit `wing` finds the entry, a different explicit `wing`
  finds nothing (verified live during issue #416 and confirmed still
  present on 3.6.0). The pin rationale in `scripts/lib/common.sh` records
  that the `wing` parameter on the diary tools is one of the capabilities
  the framework relies on across the 3.3.x→3.6.x transition. What the tool
  falls back to when `wing` is **omitted** remains unresolved: the
  parameter description states it reads from `wing_{agent_name}`, but the
  same probes found an omitted-`wing` read still surfaces the entry even
  when `wing_{agent_name}` holds zero drawers. The real fallback mechanism
  is not conclusively established — do not assume a specific one.
  Diaries stay out of the cross-tool handoff lane regardless of this
  open question; that separation rests on the project's deliberate
  lane-mapping convention (see *Lane mapping* in
  `palace-structure-conventions.md`), not on a capability claim.
- `mempalace_get_aaak_spec` returns a genuine, implemented
  compressed-memory-format specification — not an inert or placeholder
  tool.
- `mempalace_search` returns BM25-hybrid (60 % vector + 40 % keyword)
  results. The keyword share is real but does not overcome volumetric
  imbalance from the `transcripts` wing — always scope by `wing` and
  `room` for the handoff lookup.

Knowledge-graph temporal semantics (MemPalace 3.6.0):

- Point-in-time (`as_of`) queries treat a fact's validity window as the
  **half-open interval `[valid_from, valid_to)`**: the upper bound is
  *strict* (`valid_to > as_of`), so a fact whose `valid_to` equals the query
  instant has already ended and is **excluded** at that instant. This is
  what lets a fact and its successor share a single boundary instant without
  an as-of query returning both. (Date-only `valid_to` still expands to the
  end of that day, so a standalone date-only fact stays valid through its
  whole final day.)
- `mempalace_kg_supersede` (*3.6.0*) is the atomic close-and-replace
  primitive for this boundary behaviour: it closes
  `(subject, predicate, old_object)` and opens
  `(subject, predicate, new_object)` at one shared instant, so a
  point-in-time query at the boundary returns only the new value.

Tools added in MemPalace 3.6.0 — `mempalace_checkpoint`,
`mempalace_delete_by_source`, `mempalace_kg_supersede`, `mempalace_mine`,
`mempalace_list_hallways`, `mempalace_delete_hallway`, and the new
`source_file` (search) and `since`/`before` (list-drawers) filters — are
listed here as **available on the 3.6.0 surface but are not wired into any
cross-tool protocol step**. The Memory Activation Protocol and the handoff
lane continue to use only the tools they used on the 3.3.x line; adopting any
3.6.0-added tool as a protocol step is a separate, deliberate follow-up.
