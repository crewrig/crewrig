# Identify the offender and pick the room

## The offender

The hardest part of a report is attributing it correctly. You are probably running skill X when the friction
shows, but the offender may be skill X itself, another skill or agent you read earlier, a document (`AGENTS.md`,
a rules file), a tool (`gh`, `jq`, an MCP server) or a process step.

Trace back from the contested action to its closest source: that source is the offender, and its repository
belongs in `canonical`. Never name `harness-report`, which only carries out the tagging. If you cannot pinpoint
the offender, leave `canonical` empty and let the evidence carry the trail.

### Provenance of the offender

Run `node scripts/friction.ts resolve <offender path>` and pass its flags to `build`. Marker first, then the
nearest `crewrig-provenance.json`, then the nearest `extension.json` with its sibling `package.json`; a nearer
source wins and a farther one only fills missing fields. For a hook or an MCP server add `--hook <id>` or
`--server <name>`: the output carries the evidence entry `hook:<extension>/<id>` (or `server:`) that names the
pair. When `resolve` exits `1`, nothing identifies the offender: leave `canonical` empty.

## The room

- `tool`: an MCP tool, CLI or script behaved unexpectedly.
- `prompt`: a skill or agent prompt was misleading or led you astray.
- `format`: an output format broke parsing or mixed concerns.
- `behavior`: an agent did something it should not have, or skipped something it should have done.
- `process`: a documented workflow step is missing or out of date.

Between `prompt` and `behavior`: if the prompt told you to do the wrong thing, it is `prompt`; if you left its
rails on your own, it is `behavior`.
