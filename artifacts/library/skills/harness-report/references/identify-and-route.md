# Identify the offender and pick the room

## 1. Pause and identify the offender

The trickiest part of friction reporting is **getting the attribution
right**. You are likely operating under some skill X when the friction
manifests, but the *offender* might be:

- Skill X itself (its prompt led you astray).
- A *different* skill or agent you read earlier in the session.
- A document (`AGENTS.md`, a `config/*.md` file).
- A tool (`gh`, `jq`, `yq`, an MCP server).
- A process step in `config/TOOLS.md` or similar.

Before composing the payload, ask yourself: *what specifically led to
the contested action?* Trace the chain backwards from the action to
its closest source. That source is the offender, and its URL or path
belongs in `canonical:` — **never the path to this `harness-report`
skill**, which is just the orchestrator.

If you genuinely cannot pinpoint the offender, leave `canonical:`
empty and let `evidence:` carry the trail. A routing failure (caught
by the Curator at consumption time) is better than a wrong-target MR.

## 2. Pick the room

One of the 5 fixed categories per `config/TOOLS.md`:

- `tool` — an MCP tool, CLI, or script behaved unexpectedly.
- `prompt` — a skill/agent prompt was misleading or led you astray.
- `format` — an output format broke parsing or mixed concerns.
- `behavior` — an agent did something it should not have, or skipped
  something it should have done.
- `process` — a documented workflow step is missing or out of date.

When in doubt between `prompt` and `behavior`: ask whether the prompt
*told* you to do the wrong thing (→ `prompt`) or whether you went off
the prompt's rails on your own (→ `behavior`).
