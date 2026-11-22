# Identify the offender and pick the room

## The offender

The hardest part of a report is attributing it correctly. You are probably running skill X when the friction
shows, but the offender may be skill X itself, another skill or agent you read earlier, a document (`AGENTS.md`,
a rules file), a tool (`gh`, `jq`, an MCP server) or a process step.

Trace back from the contested action to its closest source: that source is the offender, and its repository
belongs in `canonical`. Never name `harness-report`, which only carries out the tagging. If you cannot pinpoint
the offender, leave `canonical` empty and let the evidence carry the trail.

## The room

- `tool`: an MCP tool, CLI or script behaved unexpectedly.
- `prompt`: a skill or agent prompt was misleading or led you astray.
- `format`: an output format broke parsing or mixed concerns.
- `behavior`: an agent did something it should not have, or skipped something it should have done.
- `process`: a documented workflow step is missing or out of date.

Between `prompt` and `behavior`: if the prompt told you to do the wrong thing, it is `prompt`; if you left its
rails on your own, it is `behavior`.
