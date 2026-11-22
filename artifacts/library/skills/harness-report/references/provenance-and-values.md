# Provenance of the offender and the values to choose

## Resolve

`resolve` takes the path of the offender (a skill, agent, hook script or MCP server file), follows symlinks to
the real path, and prints ready flags for `build`. It reads, in order: the offender's own marker (for a file
under a skill's `scripts/`, the owning skill's `SKILL.md` marker), the nearest `crewrig-provenance.json`, then
the nearest `extension.json` with its sibling `package.json`. A nearer source wins and a farther one only fills
missing fields; the `source:` line says which contributed.

For a hook or an MCP server add `--hook <id>` or `--server <name>`: the output carries the evidence entry
`hook:<extension>/<id>` (or `server:`) that names the pair. Exit `1` means nothing identified the offender:
leave `canonical` empty, never route on a guess.

## Choosing the values

- `writer_agent` is your own identifier (`claude-code`, `gemini-cli`). Evidence needs at least a file path
  and a line; a commit hash in front survives the file moving.
- `canonical` is the offender's repository root, `https://github.com/<owner>/<repo>`, never a file URL: the
  curator routes the issue by stripping the host, so a `/blob/` URL breaks the route. The file path goes in
  evidence. Leave it empty if you cannot name the offender; a routing failure beats a wrong target.
- `feedback` is the maintainer-declared intake repository; the curator routes to it before `canonical`.
  `package`, `extension` and `version` come from `resolve`; never invent them.
- `severity` defaults to `med`. `high` is for blockers and forces the curator to promote the friction
  without a second report.
- `subcategory` bundles frictions of one cause into one issue; `suggestion` helps the curator weigh the cluster.
