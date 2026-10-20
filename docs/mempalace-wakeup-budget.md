# MemPalace wake-up budget

<!-- crewrig-doc: published=false -->

<!-- Originally extracted from artifacts/core/rules/60-tools.md. Cross-references to other sections refer to that file. -->

**Wake-up budget (bounded).** The session-start sweep above is run by the
orchestrator only and has a bounded, documented cost — every core step is
scoped by construction, and no unscoped enumeration call is part of it (see
the *Overflow rule* below). It is denominated in **bytes** — the unit an
agent can verify directly (`wc -c`) — with `~4 bytes/token` stated as an
approximation (the true ratio varies by tokenizer and content).

| Sweep component | Payload | ≈ tokens (@ ~4 B/tok) | Cap |
|---|---|---|---|
| Core sweep (the five numbered steps): scoped `[TASK:ongoing]` search + `diary_read(last_n≤5)` + one `kg_query` + conditional checkpoint write | documented estimate (see issue #415) | — | ~8 KB (~2,000 tok) |
| Optional store mirror: the 5 × `~/.crewrig/system-context/*.md` files, verbatim | 16,319 B | ~4,079 | ~16 KB (~4,000 tok) |
| **Total wake-up (with mirror)** | | | **~24 KB (~6,000 tok)** |

**Overflow rule.** If the budget would be exceeded, shed the optional
store-mirror step first — its direct-file-read fallback (see *Retrieving
the system-context store*) stays always-available, so shedding it leaves
no rule unreachable. Never shed a core numbered step: the five steps are
the deterministic resume path, and every one is scoped by construction
(the `[TASK:ongoing]` lookup is wing+room-filtered, `diary_read` is
bounded by `last_n`, the `kg_query` is a single-entity lookup). The
former `mempalace_status` call was removed from the sweep (spec 0271): it is
global and unscoped, and its payload (about 21 KB against the authoring
palace) dwarfed the ~8 KB core cap, while `mempalace_list_wings` returns the
same wing map in about 1.1 KB; the project wing is known, so no enumeration is
needed.

**Staleness.** The optional store-mirror step uses
`mempalace_check_duplicate` (or a stored content hash) to skip drawers
already mirrored verbatim, so it does not re-read and re-write every
drawer each session.

**Layered wake-up is not an agent action.** MemPalace's native layered
wake-up (`L0–L3` / `MemoryStack.wake_up()`, exposed on the CLI as
`wake-up`) is **not** reachable from an agent's reasoning loop: it is
absent from the MCP tool surface and is therefore forbidden by the
**MCP-only access from the agent prompt** guard at the head of this
MemPalace section. This deterministic sweep (the five numbered steps plus
the optional store-mirror step) is its bounded substitute — the
conceptual target it stands in for is MemPalace's `L0+L1` ≈ 600–900
tokens (see issue #415 and `docs/cli-matrix.md` row 7g).
