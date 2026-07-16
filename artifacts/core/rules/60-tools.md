# Tools and MCP Server Guidelines

Prefer integrated MCP tools over ad-hoc alternatives unless the user
explicitly directs otherwise.

---

## Retrieving the system-context store

Several reference-heavy subsections below have been moved into a committed
store, installed to `~/.crewrig/system-context/` (source of truth:
`artifacts/core/system-context/`). This keeps the home-installed file small
enough for every supported CLI to load in full, while the moved rules stay
reliably reachable on demand.

Every stub that points into the store resolves with this deterministic
protocol — the same path selection every session:

1. **Direct file read — the default, always-available path.** Read
   `~/.crewrig/system-context/<file>.md` with your file-reading tool. This path
   needs no running service and is attempted first on every CLI.
2. **MemPalace — optional enhancement.** If the direct read is unavailable and
   MemPalace is configured, retrieve the same content with `mempalace_search`
   (the Session Start sweep mirrors each store file into a drawer verbatim).
   The bytes are identical to the direct read.
3. **Explicit signal — never silent.** If neither path can serve a needed store
   file, STOP and tell the user which section is unreachable. Never proceed as
   if the content were absent.

The selected path is observable (the direct read is always tried first) and the
store content is byte-identical regardless of which path serves it.

---

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

## GitHub MCP Server

The GitHub MCP server MUST be used as a priority for all GitHub interactions,
except for native `git` commands.

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
> **Carve-out for bundled skill/agent scripts.** A skill or agent may
> ship a versioned, source-controlled script that walks MemPalace
> directly (e.g. via `from mempalace import …`) when the workload would
> be infeasible through MCP alone — for instance, batch-reading
> thousands of drawers, which a per-call MCP loop turns into a runtime
> and token disaster. Such a script is allowed when **all** of these
> hold:
>
> 1. It is checked into the repository alongside the skill/agent that
>    invokes it (auditability replaces the per-call audit trail).
> 2. It uses the MemPalace **Python library**, not the shell CLI binary,
>    so it inherits the same locking and schema guarantees as the MCP
>    server.
> 3. It is **read-mostly**; any write path must justify why MCP
>    `mempalace_add_drawer` / `mempalace_update_drawer` cannot be used
>    instead, in a comment at the call site.
> 4. The agent that invokes the script remains the agent of record —
>    the script is a sub-tool, not a substitute for the agent's MemPalace
>    discipline (Memory Activation Protocol still applies at session
>    start).
>
> The Harness Curator (`artifacts/library/skills/harness-curator/`) is
> the canonical user of this carve-out: it batch-reads the
> `harness-friction` wing, which a per-drawer MCP loop would turn into
> a multi-thousand-call traversal.
>
> **Stdout hazard.** `mempalace.mcp_server` swaps `sys.stdout` at import
> time to protect its own JSON-RPC channel from accidental pollution.
> Any bundled script that imports from it AND needs to write structured
> output to its own stdout (e.g. to be piped to another tool) must dup
> fd 1 **before** the import — even when the import is function-local,
> route every later print through the duped handle to be safe:
>
> ```python
> import os, sys
> _REAL_STDOUT = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
> # ... later, inside a function ...
> from mempalace.mcp_server import tool_get_drawer  # safe: stdout already duped
> # ... write JSON through _REAL_STDOUT, not sys.stdout
> ```
>
> `closefd=False` is required so the duped fd survives interpreter
> shutdown; without it, fd 1 closes at GC and any late `atexit` write
> breaks. The Harness Curator's `curate.py` is the reference
> implementation.

### Palace Structure Conventions

> **Moved to the system-context store** — `~/.crewrig/system-context/palace-structure-conventions.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of this file (direct read by default; MemPalace optional; explicit signal if neither serves it).

### Memory Activation Protocol

Follow this protocol at every session:

#### 1. Session Start — Deterministic status-first sweep

Before starting any work, perform an ordered sweep designed to be
deterministic — independent of BM25 weights, cosine thresholds, or
semantic similarity heuristics:

1. **Compute `<project-name>`** (see *Project name derivation* above).

2. **`mempalace_status`** — enumerate the wings present. Note the
   exclusion list: any wing whose name starts with `transcripts` is
   high-volume raw archive and is EXCLUDED from semantic searches.

3. **Cross-tool handoff lookup** — the primary resume mechanism:

   ```text
   mempalace_search(
     query="[TASK:ongoing]",
     wing="<project-name>",
     room="task-handoff"
   )
   ```

   Wing+room scoped, immune to transcripts noise, signal-dense by
   design. This is the canonical cross-tool task discovery path.

   Apply the `visible_to` filter client-side: ignore any returned entry
   whose `visible_to` field contains neither `*` nor your agent name.

4. **Per-agent provenance** — your own reasoning trace, not
   cross-tool discovery: `mempalace_diary_read(agent_name="<your-name>",
   last_n=N)`. Used only to recover your own recent thought process.

5. **Knowledge Graph** — `mempalace_kg_query` for facts about the
   current project.

6. **If step 3 returned a `[TASK:ongoing]` drawer for this project**
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

**Optional — System-context store mirror (MemPalace only).** An opportunistic
enhancement layered on the six-step sweep above, not a required part of it: when
`mempalace_status` reports the service reachable, mirror each
`~/.crewrig/system-context/*.md` file into a drawer (`wing="system-context"`,
`room="store"`) via `mempalace_add_drawer` / `mempalace_update_drawer` with the
file's verbatim bytes, when the drawer is missing or stale. This backs the
MemPalace path of the store retrieval protocol (see *Retrieving the
system-context store*). When MemPalace is absent, skip silently — the direct
file read remains the default and no rule becomes unreachable.

**Wake-up budget (bounded).** The session-start sweep above has a largely
bounded, documented cost — bounded by construction for every core step
except `mempalace_status`, the one global, unscoped call (see the
*Overflow rule* below). It is denominated in **bytes** — the unit an
agent can verify directly (`wc -c`) — with `~4 bytes/token` stated as an
approximation (the true ratio varies by tokenizer and content).

| Sweep component | Payload | ≈ tokens (@ ~4 B/tok) | Cap |
|---|---|---|---|
| Core sweep (the six numbered steps): `mempalace_status` + scoped `[TASK:ongoing]` search + `diary_read(last_n≤5)` + one `kg_query` + conditional checkpoint write | documented estimate (see issue #415) | — | ~8 KB (~2,000 tok) |
| Optional store mirror: the 5 × `~/.crewrig/system-context/*.md` files, verbatim | 12,339 B | ~3,085 | ~16 KB (~4,000 tok) |
| **Total wake-up (with mirror)** | | | **~24 KB (~6,000 tok)** |

**Overflow rule.** If the budget would be exceeded, shed the optional
store-mirror step first — its direct-file-read fallback (see *Retrieving
the system-context store*) stays always-available, so shedding it leaves
no rule unreachable. Never shed a core numbered step: the six steps are
the deterministic resume path, and all but one are scoped by construction
(the `[TASK:ongoing]` lookup is wing+room-filtered, `diary_read` is
bounded by `last_n`, the `kg_query` is a single-entity lookup). The
exception is `mempalace_status` (the sweep's first call): it is **global
and unscoped** — the MCP surface exposes no scoping parameter — so its
payload grows with the palace's total wing/room count, dominated by the
`transcripts` archive, and in a mature multi-project install can alone
approach or exceed the ~8 KB core cap (observed ~18–20 KB against the
authoring palace; see issue #415). Its recourse is structural, not a
smaller payload: `status` is read **once** — to enumerate the wings and
note which (the `transcripts` archive) to exclude from the scoped steps
that follow — then discarded, not retained verbatim or re-requested, so
its transient read size is not a sustained context cost. Treat it as
**best-effort**, not a figure the ~8 KB cap can guarantee.

**Staleness.** The optional store-mirror step uses
`mempalace_check_duplicate` (or a stored content hash) to skip drawers
already mirrored verbatim, so it does not re-read and re-write every
drawer each session.

**Layered wake-up is not an agent action.** MemPalace's native layered
wake-up (`L0–L3` / `MemoryStack.wake_up()`, exposed on the CLI as
`wake-up`) is **not** reachable from an agent's reasoning loop: it is
absent from the MCP tool surface and is therefore forbidden by the
**MCP-only access from the agent prompt** guard at the head of this
MemPalace section. This deterministic sweep (the six numbered steps plus
the optional store-mirror step) is its bounded substitute — the
conceptual target it stands in for is MemPalace's `L0+L1` ≈ 600–900
tokens (see issue #415 and `docs/cli-matrix.md` row 7g).

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

Before ending:

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

> **Moved to the system-context store** — `~/.crewrig/system-context/long-running-task-convention.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of this file (direct read by default; MemPalace optional; explicit signal if neither serves it).

### Knowledge Graph Conventions

- **Temporal facts**: Use validity windows (`valid_from` / `valid_to`)
  for facts that change over time.
- **Contradiction detection**: The KG detects conflicting facts. When
  flagged, investigate and invalidate the outdated fact.
- **Entity naming**: Use descriptive names. Disambiguate with parentheses
  when needed: `React (Library)` vs `React (Concept)`.

### MCP Tools Reference

> **Moved to the system-context store** — `~/.crewrig/system-context/mcp-tools-reference.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of this file (direct read by default; MemPalace optional; explicit signal if neither serves it).

---

## Friction Reporting — Harness Feedback Loop

The crew you operate within is not static. When an agent hits a sharp
edge during real work — a poorly-worded prompt, a tool that does the
wrong thing, an output format that breaks downstream parsing — that
signal must reach the maintainers of the agent system itself.
Otherwise the same friction repeats forever.

This section defines the **fire-and-forget tagging protocol**: agents
tag frictions as they happen, never blocking the work in progress and
never waiting for a synchronous acknowledgment. A separate Curator
agent (out of scope for this section) reads the tags on demand and
proposes feedback MRs against the canonical/feedback repos declared
in each component's `provenance:` block.

### When to tag

Tag a friction whenever a **recognition signal** fires (next section).
Do not pause the user's task longer than the tag itself. The cost of
one tag is negligible; the cost of an un-reported friction that bites
the next agent is much higher.

If unsure whether something qualifies — tag it. Curation will discard
noise; silent friction is the failure mode to avoid.

### Recognition signals

These are the canonical signals that **must** trigger a tag. They are
listed here, not duplicated across every skill, so the contract has
one source of truth.

1. **User pushback.** The user contests, corrects, or reverts the
   action you just took, or reformulates the same intent because your
   previous response was misaligned.
2. **Sibling-skill workaround.** You find yourself contorting around
   a constraint set by another skill or agent — not by the user's
   request.
3. **Tool surprise (second time).** A tool produced surprising or
   inconsistent behavior for the second time in the same session.
   First time is bad luck; second time is a pattern.
4. **Process gap.** A documented workflow step turned out to be
   missing, ambiguous, contradictory, or out of date.
5. **Safeguard friction.** A rule or guard blocked a legitimate
   action and forced a workaround you had to explain explicitly to
   the user.

When any signal fires, **tag the friction before resuming work** —
not "consider tagging", not "when convenient". The fire-and-forget
property qualifies the *transport* (no ack expected); it does not
make the trigger optional.

### How to tag — the `harness-report` skill

The operational procedure (identifying the offender, picking the
room, filling the payload) lives in
`artifacts/library/skills/harness-report/SKILL.md`. Any skill or
agent that needs to tag a friction must invoke `harness-report`
rather than re-implementing the protocol inline. This keeps the
contract single-sourced and lets future improvements (richer
`evidence:` format, new recognition signals, etc.) propagate without
editing every skill body.

### Where to write

> **Moved to the system-context store** — `~/.crewrig/system-context/friction-reporting-reference.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of this file (direct read by default; MemPalace optional; explicit signal if neither serves it).

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

> **Moved to the system-context store** — `~/.crewrig/system-context/obsidian-protocol.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of this file (direct read by default; MemPalace optional; explicit signal if neither serves it).

---

## Memory Activation Summary

| Tier | System | Scope | Read | Write | Persistence |
|------|--------|-------|------|-------|-------------|
| 1 | Sequential Thinking | Session | Session | Session | Must flush to Tier 2 |
| 2 | MemPalace | All sessions, all tools | Free | Free | Automatic |
| 3 | Obsidian | User vault | Free | User consent | User-managed |

---

## Scannable Recap Format

When composing a situation recap, status update, or progress message directed
at the user, apply this structure:

1. **Decision or outcome first.** Open with one short sentence that stands
   alone. A user who reads only that sentence must understand what happened or
   what was decided.
2. **Detail as tight bullets.** Push supporting information into bullets — one
   idea per bullet. Never stack parentheticals inside a bullet. Cap at one
   em-dash per sentence.
3. **Cap prose paragraphs at two sentences.** When a summary requires more
   than two sentences, convert the extra content into bullets.

### Anti-patterns to avoid

- **Stacked parentheticals** — `"The merge (which resolved the conflict in X
  (introduced by Y)) succeeded"` — the nested aside buries the outcome.
- **Multiple em-dashes in one sentence** — `"CI failed — lint-specs — see
  below"` — use a bullet list instead.
- **Stacked consecutive emphasis** — `"**step 1** … **step 2** … **step 3**"`
  in the same sentence — emphasis loses meaning when over-used.
- **Buried decision** — opening with context before stating the outcome forces
  the user to read to the end before knowing what happened.

### Scope

This rule applies to ephemeral user-facing prose — situation recaps, stage
transitions, progress updates, and logbook-comment summaries. It does NOT
apply to repository-bound artifacts (commit messages, PR bodies, spec files,
plan comments) or to skill-contracted output formats (e.g., the `pr-reviewer`
verdict block — that format is a protocol contract, not a recap).

---

## Idiomatic French

When the user's preferred language is French, produce all agent-authored prose
directed at the user — chat messages, progress updates, plan summaries, logbook
comments — in idiomatic French. Avoid direct calques of English software-
engineering jargon.

### Calque catalog

Use the idiomatic French equivalent on the right; avoid the English calque on
the left.

| English calque (avoid) | Idiomatic French (use) |
|---|---|
| gate / user gate | point de validation |
| build (noun/verb) | construction / compilation / construire |
| install (noun/verb) | installation / installer |
| scope (noun) | portée |
| merge (noun/verb) | fusion / fusionner |
| opt-in | activation à la demande |
| tier | palier |
| worktree | espace de travail |
| spec-PR | PR de spécification |
| lint / linter (noun) | analyse statique / vérificateur stylistique |
| commit (noun) | validation |
| spawner / shipper / merger / amender (anglicized -er verbs) | describe the action in French (*instancier*, *livrer*, *fusionner*, *corriger*…) |

The catalog is non-exhaustive. When in doubt, prefer the longer idiomatic
phrasing over the calque — verbosity in the target language costs less than
the cognitive friction of franglais.

### Translation boundary

The following items MUST NOT be translated, regardless of the active
interaction language. Present them in their original form, typically within
backtick spans:

- Code identifiers, variable names, function names, field names
- File paths and directory names
- CLI tool names and commands
- GitHub label values and frontmatter field names
- Literal skill, agent, and role names (e.g., `spec-author`, `team-lead`,
  `pr-reviewer`, `iter:1`)
- Proper nouns (product names, organization names)

### Scope

This rule applies to ephemeral user-facing prose only. Content written into
the repository or posted on GitHub (commit messages, PR bodies, spec files,
issue comments) follows the English-only project-content rule in `AGENTS.md`
and is **not** subject to this section.
