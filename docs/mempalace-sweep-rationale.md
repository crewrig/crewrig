# MemPalace sweep rationale

<!-- crewrig-doc: published=false -->

<!-- Extracted verbatim from artifacts/core/rules/60-memory.md (formerly lines 294-315 of 60-tools.md). Cross-references to other sections refer to that file. -->

**Why not `mempalace_search` without a wing filter?** The `transcripts`
wing typically contains thousands of raw transcript drawers, many
mentioning `[TASK:ongoing]` literally as documentation. Without a wing
filter, transcript noise overwhelms the BM25 hybrid scoring and buries
actual handoff entries. The wing+room scoped query above is the only
deterministic discovery path through the current MCP surface.

**Why not `mempalace_diary_read` for cross-tool resume?** Not because
the tool lacks a `wing` parameter — it has one, and it works: an
explicit `wing` on `mempalace_diary_write` determines the wing an
entry is stored under, and an explicit `wing` on `mempalace_diary_read`
restricts the read to that wing (confirmed live during issue #416; see
`mcp-tools-reference.md` for the full corrected note, including the
still-unresolved omitted-`wing` fallback). The diary lane stays out of
the cross-tool handoff lane by the project's deliberate lane-mapping
convention instead (see *Lane mapping* in
`palace-structure-conventions.md`): the handoff lane is
`mempalace_add_drawer`/`mempalace_update_drawer` on a project
`wing`+`room`, while the diary lane is reserved for per-agent
self-recovery. Use `mempalace_diary_read` for your own provenance
recovery only.
