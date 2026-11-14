# Memory Protocol

The orchestrator memory protocol, moved verbatim from `60-tools.md`; the Claude Code worker profile excludes this file.

## Memory Architecture — Three-Tier Model

The agent operates with three memory tiers, each with a distinct role,
access model, and persistence strategy.

### Tier 1: Working Memory — Sequential Thinking

**Role**: Real-time reasoning engine for complex, multi-step tasks.

- **Scope**: Current session only (ephemeral).
- **When to use**: Complex reasoning, multi-step planning, design decisions,
  task decomposition, evaluation of alternatives.
- **Persistence obligation**: Any plan or reasoning that spans multiple
  sessions MUST be persisted to Tier 2 (MemPalace) before the session ends.

### Tier 2: Agent Memory — MemPalace

**Role**: Persistent memory that survives across sessions and across CLI
tools. The agent's long-term knowledge store.

- **Scope**: All sessions, all tools (Gemini CLI, Claude Code, etc.).
- **Read**: Free — always search MemPalace before starting work.
- **Write**: Free — persist everything learned, decided, and encountered.

### Tier 3: Second Brain — Obsidian (Optional)

**Role**: The user's personal knowledge base. A curated library of notes,
references, ideas, and domain knowledge.

- **Scope**: User-controlled. Available only if an Obsidian MCP server is
  present.
- **Read**: Free — browse and search the vault for context.
- **Write**: User-controlled only — MUST ask the user before writing.
  Never write without explicit consent.

---

## MemPalace — Agent Memory Protocol

MemPalace is the unified persistent memory system, replacing the former
Knowledge Graph Memory and Deep Memory servers. It provides palace-based
storage, a temporal knowledge graph, semantic search, and an agent diary.

> **MCP-only access from the agent prompt.** Every MemPalace operation
> in this document (`mempalace_status`, `mempalace_search`,
> `mempalace_add_drawer`, `mempalace_update_drawer`, `mempalace_diary_*`,
> `mempalace_kg_*`, etc.) invoked **directly from an agent's reasoning
> loop** is an **MCP tool call** routed through the registered
> `mempalace` MCP server. **Never** invoke a `mempalace …` shell command
> ad-hoc via the Bash tool. The `mempalace` CLI binary on `$PATH` exists
> for human admin tasks (`init`, `migrate`, debug); calling it
> opportunistically from an agent bypasses the MCP server's session
> context, file locking, audit trail, and protocol negotiation, and
> produces drawers the rest of the agent network cannot see. If a
> procedure cannot be expressed via the MCP tools listed in *MCP Tools
> Reference*, ask the user — do not reach for the CLI as a workaround.
>
> **Carve-out for bundled skill/agent scripts.** A versioned,
> source-controlled script may use the MemPalace Python library (never the
> shell CLI) when MCP alone is infeasible. Conditions and the *Stdout hazard*:
> `docs/mempalace-bundled-scripts.md`.

### Palace Structure Conventions

> **Moved to the system-context store** — `~/.crewrig/system-context/palace-structure-conventions.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of 60-tools.md (direct read by default; MemPalace optional; explicit signal if neither serves it).

### Memory Activation Protocol

Follow this protocol at every session. Subagents skip the sweep (see
*Subagents* below).

#### 1. Session Start — Deterministic orchestrator-only sweep

Before any work, the orchestrator (the session that owns the ticket, or an
agent the user started directly) performs this ordered, deterministic sweep:

**Memory unavailable — say so, never skip silently.** If no `mempalace_*`
tool is available — neither directly callable nor discoverable through the
host CLI's deferred-tool search — or if the sweep's first MemPalace call
fails because the server cannot be reached, tell the user explicitly, before
any task work, that shared memory is unavailable for this session and that
the handoff lookup, the checkpoint, and the final flush will not happen, and
point at `task mempalace:status`. Never skip silently or act as if it had run.
A deferred tool counts as available: load it and run the sweep. Once you have
signalled, continue unless the user says otherwise. This binds the orchestrator only and mirrors the *Explicit signal — never silent* step of *Retrieving the
system-context store*.

1. **Compute `<project-name>`** (see *Project name derivation* above).

2. **Cross-tool handoff lookup** — the primary resume mechanism:

   ```text
   mempalace_search(
     query="[TASK:ongoing]",
     wing="<project-name>",
     room="task-handoff"
   )
   ```

   Wing+room scoped, immune to transcripts noise; the canonical task
   discovery path.

   Apply the `visible_to` filter client-side: ignore any returned entry
   whose `visible_to` field contains neither `*` nor your agent name.

3. **Per-agent provenance** — your own reasoning trace, not
   cross-tool discovery: `mempalace_diary_read(agent_name="<your-name>",
   last_n=N)`. Used only to recover your own recent thought process.

4. **Knowledge Graph** — `mempalace_kg_query` for facts about the
   current project.

5. **If step 2 returned a `[TASK:ongoing]` drawer for this project**
   (i.e., a sibling agent's open work or a previous session of yours):
   **immediately persist a `[TASK:checkpoint]` payload to that drawer
   via `mempalace_update_drawer` BEFORE doing any actual task work.**
   The checkpoint:

   - Marks the resumption point with the current timestamp.
   - Updates `writer_agent` to your own agent name.
   - Records `resumed_from` (the previous drawer revision) and an
     initial `progress` field describing the state you found.
   - Preserves the `drawer_id` and `handoff_key` (use
     `mempalace_update_drawer`, not `mempalace_add_drawer`).

   **This step is mandatory, not optional.** Skipping it breaks the
   audit trail of who-resumed-when and leaves siblings unable to detect
   that the task has been picked up. Treat the checkpoint write as part
   of the recovery itself, not as a chore to do "after the work".

   **Also record the session's usage declaration** before any task work
   begins (spec 0208 R3): run the floor guard `node scripts/lib/node-floor-guard.js`,
   then `node scripts/usage-task.ts set --task-key <handoff_key> --channel
   protocol`;
   `handoff_key` is the bare decimal ticket number, identical across every CLI.

**Why not an unscoped search or a diary read for resume?** Rationale:
`docs/mempalace-sweep-rationale.md`. The steps above are normative.

**Optional — System-context store mirror (MemPalace only).** An opportunistic
enhancement layered on the sweep above, not a required part of it: attempted
only after the first scoped sweep call has succeeded, mirror each
`~/.crewrig/system-context/*.md` file into a drawer (`wing="system-context"`,
`room="store"`) via `mempalace_add_drawer` / `mempalace_update_drawer` with the
file's verbatim bytes, when the drawer is missing or stale. This backs the
MemPalace path of the store retrieval protocol (see *Retrieving the
system-context store*). Otherwise skip silently — the direct
file read remains the default and no rule becomes unreachable.

**Subagents.** No sweep call. A non-seat subagent MAY make one
`mempalace_get_drawer` call with the `handoff_key` and drawer id its brief
carries; a seated pass gets neither. Rules: `AGENTS.md` → *Session Bootstrap*.

**Wake-up budget.** The optional store-mirror step is shed first when the
budget would be exceeded and is never a core sweep step. Layered wake-up is
not an agent action. Figures: `docs/mempalace-wakeup-budget.md`.

#### 2. During Work — Continuous Persistence

As you work, persist continuously:

- **Cross-tool task progress** → `mempalace_add_drawer` to
  `wing="<project-name>"`, `room="task-handoff"` with a `[TASK:ongoing]`
  or `[TASK:checkpoint]` payload (see *Long-Running Task Convention*
  for the exact schema).
- **Significant decisions** → drawer in the relevant project room
  (e.g., `architecture-decisions`).
- **Obstacles + resolutions** → drawer in `obstacles-and-solutions`.
- **Facts and relationships** → Knowledge Graph with validity window.
- **Per-agent reasoning trace** → `mempalace_diary_write` (your own
  diary, for self-recovery — not cross-tool handoff).

#### 3. Session End — Final Flush

Orchestrator only, before ending (a subagent reports its outcome instead):

- **Update the cross-tool handoff drawer** in
  `wing="<project-name>", room="task-handoff"`:
  - If work continues: ensure a `[TASK:ongoing]` drawer reflects the
    latest state. Prefer `mempalace_update_drawer` on the existing
    drawer (preserves the `drawer_id` and KG references); fall back to
    `mempalace_add_drawer` if you do not have the prior drawer_id.
  - If work is complete: replace the payload with `[TASK:done]` via
    `mempalace_update_drawer`.
- **Write a per-agent diary entry** summarizing the session
  (`mempalace_diary_write`) — self-recovery aid, not cross-tool.
- **Flush** any un-persisted Sequential Thinking state to MemPalace.

### Long-Running Task Convention

> **Moved to the system-context store** — `~/.crewrig/system-context/long-running-task-convention.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of 60-tools.md (direct read by default; MemPalace optional; explicit signal if neither serves it).

### Knowledge Graph Conventions

- **Temporal facts**: Use validity windows (`valid_from` / `valid_to`)
  for facts that change over time.
- **Half-open intervals (MemPalace 3.6.0)**: A point-in-time (`as_of`)
  query treats a fact's window as the half-open interval
  `[valid_from, valid_to)` — the upper bound is *strict*, so a fact whose
  `valid_to` equals the query instant has already ended and is excluded at
  that instant. This lets a fact and its successor share a single boundary
  instant without an as-of query returning both.
- **Contradiction detection**: The KG detects conflicting facts. When
  flagged, investigate and invalidate the outdated fact. MemPalace 3.6.0
  also exposes `mempalace_kg_supersede`, an atomic close-and-replace
  primitive that closes the old fact and opens the new one at one shared
  boundary instant — available but not prescribed; the invalidate-then-add
  convention above remains the default.
- **Entity naming**: Use descriptive names. Disambiguate with parentheses
  when needed: `React (Library)` vs `React (Concept)`.

### MCP Tools Reference

> **Moved to the system-context store** — `~/.crewrig/system-context/mcp-tools-reference.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of 60-tools.md (direct read by default; MemPalace optional; explicit signal if neither serves it).

---

## Sequential Thinking — Working Memory Protocol

Sequential Thinking is the working memory used for structuring complex
reasoning and problem-solving in real-time.

### When to Use

- Complex tasks requiring structured evaluation of alternatives.
- Multi-step planning before implementation.
- Design decisions where trade-offs need explicit analysis.
- Any reasoning that benefits from step-by-step decomposition.

### Modus Operandi

1. **Initialize**: Start a thinking sequence with a clear objective.
2. **Iterative Refinement**:
   - Step 1: Define the core problem and constraints.
   - Step 2: List potential solutions or paths.
   - Step 3: Evaluate each path (pros/cons).
   - Step 4: Select and execute the best path.
3. **Branching**: If a path fails, backtrack and try an alternative.
4. **Finalization**: Summarize the reasoning and persist the outcome to
   MemPalace — drawer in the relevant project room, plus a
   `[TASK:ongoing]` drawer in the handoff lane if work continues across
   sessions.

### Persistence Obligation

Sequential Thinking is ephemeral — it lives only within the current
session. Before ending a session:

- If work continues, write or update the cross-tool handoff drawer
  (`mempalace_add_drawer` / `mempalace_update_drawer` on
  `wing="<project-name>"`, `room="task-handoff"`) with a
  `[TASK:ongoing]` payload reflecting the current plan state.
- Record key decisions and reasoning as drawers in the relevant project
  room.
- Record discovered facts in the Knowledge Graph.
- Optionally write a per-agent diary entry (`mempalace_diary_write`)
  for self-recovery — distinct from the cross-tool handoff drawer.

---

## Second Brain — Obsidian Protocol

> **Moved to the system-context store** — `~/.crewrig/system-context/obsidian-protocol.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of 60-tools.md (direct read by default; MemPalace optional; explicit signal if neither serves it).

---

## Memory Activation Summary

| Tier | System | Scope | Read | Write | Persistence |
|------|--------|-------|------|-------|-------------|
| 1 | Sequential Thinking | Session | Session | Session | Must flush to Tier 2 |
| 2 | MemPalace | All sessions, all tools | Free | Free | Automatic |
| 3 | Obsidian | User vault | Free | User consent | User-managed |

---
