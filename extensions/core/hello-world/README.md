# Hello World Extension

Sample extension demonstrating the full extension anatomy: MCP server,
command, skill, and context file. Use it as a reference when building
your own extensions.

## Structure

```text
hello-world/
├── gemini-extension.json   # Extension manifest
├── package.json            # npm package with MCP SDK dependency
├── tsconfig.json           # TypeScript configuration
├── src/index.ts            # MCP server exposing the greet tool
├── commands/hello.md       # /hello slash command — PIVOT SOURCE (author here)
├── commands/hello.toml     # Generated Gemini consumed form (DO NOT hand-edit)
├── skills/greeter/SKILL.md # Greeter skill instructions
├── GEMINI.md               # Agent context when extension is loaded
└── README.md               # This file
```

## Command rendering (spec 0042)

The command is authored **once** in the pivot source `commands/hello.md`
(the same format used by `artifacts/` components). Its per-CLI consumed
forms are produced by how each tool loads an extension:

- **Gemini CLI** loads the extension in place, so its form
  `commands/hello.toml` is a **committed, generated sibling** of the
  pivot `.md`. Regenerate it with
  `bash scripts/build-extension-pivot.sh hello-world` and commit the
  result; never hand-edit it. A CI drift gate
  (`build-extension-pivot.sh --check`) fails if the committed `.toml`
  diverges from a fresh render of the `.md`.
- **Claude Code** builds a plugin at install time, so its form is
  rendered **ephemerally** by `scripts/build-claude-plugin.sh`, which
  reads the pivot `.md` directly. The `extension.json`
  `components.commands.convertToSkills` flag is kept by name; post-flip
  it means *"render the pivot `.md` into a Claude skill"*, **not**
  *"convert the `.toml` into a skill"* (a rename is deferred to spec
  0044).

## Installation

```bash
task install-extension EXT=hello-world
```
