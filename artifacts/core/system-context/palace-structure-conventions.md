# Palace Structure Conventions

Organize knowledge using the palace metaphor:

```text
MemPalace
├── wing: <project-name>                 # One wing per project
│   ├── room: task-handoff               # [TASK:*] cross-tool handoff lane
│   ├── room: architecture-decisions     # ADRs, design choices
│   ├── room: obstacles-and-solutions    # Problems + resolutions
│   └── room: <topic-as-needed>          # Created organically
│
├── wing: wing_<agent-name>              # Per-agent diary (MCP-forced)
│   └── room: diary                      # Reasoning provenance, self-recovery
│
├── wing: <user-name>                    # Personal wing (optional)
│   ├── room: preferences                # Working style, tool preferences
│   └── room: expertise                  # Domains of knowledge
│
└── wing: transcripts                    # Session recordings (if enabled)
    └── room: <project>-<date>-<sid>     # EXCLUDED from default sweep
```

- **Wings**: Top-level grouping. One per project, one per agent (auto-created
  by diary writes), one per user (optional), plus the `transcripts` wing.
- **Rooms**: Topic-based within a wing. Created as needed.
- **Drawers**: Individual content entries within a room.
- **Halls**: Connection types (facts, events, discoveries, preferences).
- **Tunnels**: Cross-wing connections discovered automatically.

## Project name derivation

`<project-name>` is computed once at session start:

1. `git rev-parse --show-toplevel` → basename, if inside a git repo.
2. Otherwise: `basename "$(pwd)"`.

Stable across agents and across machines that clone the same repo at
different paths. Do not use the auto-derived path-based wings produced
by some hooks (e.g., `_users_..._gemini_configuration`); they are
machine-specific and not cross-tool stable.

## Lane mapping — what writes where

| Lane | Write tool | Storage | Visible cross-tool? |
|---|---|---|---|
| **Cross-tool task handoff** | `mempalace_add_drawer` | `wing="<project-name>"`, `room="task-handoff"` | Yes — primary handoff surface |
| **Curated knowledge** | `mempalace_add_drawer` | `wing="<project-name>"`, `room="<topic>"` | Yes |
| **Per-agent diary** | `mempalace_diary_write` | `wing_<agent-name>` (MCP-forced) | No — siloed by design |
| **Raw archive** | hook-driven | `wing="transcripts"` | No — excluded from sweep |

The MCP surface forces this split: only `mempalace_add_drawer` and
`mempalace_update_drawer` accept arbitrary `wing` and `room` parameters.
The diary tools (`mempalace_diary_write` / `mempalace_diary_read`) only
expose `agent_name`, so diary entries always land in `wing_<agent-name>`
and cannot serve as the cross-tool handoff surface.
