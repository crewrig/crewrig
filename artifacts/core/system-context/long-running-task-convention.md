# Long-Running Task Convention

Cross-tool tasks live as **drawers** in the handoff lane
(`wing="<project-name>"`, `room="task-handoff"`), NOT as diary entries.
The drawer `content` field carries a structured plain-text payload.

Starting a task — `mempalace_add_drawer`:

```text
[TASK:ongoing] <task-id> | <brief-description>

writer_agent: <agent-name>
handoff_key: <task-id>
visible_to: ["*"]
status: <phase/step description>
next: <what to do next>
blocked: <if blocked, why>
context: <key facts needed to resume>
```

Resuming a task — `mempalace_update_drawer` on the existing drawer
(preserves `drawer_id` and KG links). The new content replaces the old.
**The checkpoint write is mandatory the moment a `[TASK:ongoing]` drawer
is found at session start (see *Session Start* step 6) — it is not
something to defer until "real work" begins.**

```text
[TASK:checkpoint] <task-id> | <brief-description>

writer_agent: <agent-name>
handoff_key: <task-id>
visible_to: ["*"]
resumed_from: <previous drawer_id>
progress: <what was accomplished since last checkpoint>
status: <current phase/step>
next: <what to do next>
context: <updated facts>
```

Completing a task — `mempalace_update_drawer`:

```text
[TASK:done] <task-id> | <brief-description>

writer_agent: <agent-name>
handoff_key: <task-id>
visible_to: ["*"]
outcome: <result summary>
lessons: <what was learned>
```

## Field semantics

- `writer_agent` — agent identifier (e.g., `claude-code`, `gemini-cli`).
  Closes the "guess the previous writer" failure mode by making
  provenance explicit on every entry.
- `handoff_key` — deterministic anchor. Matches the `<task-id>` in the
  title line; useful for cross-referencing across drawer revisions or
  related tasks.
- `visible_to` — visibility allowlist. `["*"]` is the global default
  (visible to every agent). `["<agent>"]` restricts to a specific agent.
  `["<a>", "<b>"]` scopes to multiple agents. Reading agents apply the
  filter **client-side**: ignore any entry whose `visible_to` does not
  contain `*` and does not contain the reading agent's name. Honor
  system; no platform-level enforcement.

To resume work across sessions, the cross-tool sweep at session start
hits `room="task-handoff"` directly — see *Memory Activation Protocol →
Session Start*.
