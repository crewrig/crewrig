# MemPalace bundled scripts

<!-- crewrig-doc: published=false -->

<!-- Extracted verbatim from artifacts/core/rules/60-memory.md (formerly lines 154-199 of 60-tools.md). Cross-references to other sections refer to that file. -->

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
