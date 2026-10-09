# Hello World Extension

Sample extension demonstrating the full extension anatomy: MCP server,
command, skill, and context file. Use it as a reference when building
your own extensions.

## Structure

```text
hello-world/
├── extension.json          # The ONLY manifest — declares the whole cross-CLI
│                           #   surface (spec 0173); every CLI-native file below
│                           #   is produced FROM it, never hand-authored.
├── package.json            # npm package with MCP SDK dependency
├── tsconfig.json           # TypeScript configuration
├── src/index.ts            # MCP server exposing the greet tool
├── commands/hello.md       # /hello slash command — PIVOT SOURCE (author here)
├── skills/greeter/SKILL.md # Greeter skill instructions
├── CONTEXT.md              # Agent-facing context — the ONE neutral source
│                           #   (spec 0181); GEMINI.md, CLAUDE.md, the
│                           #   Copilot context skill and Antigravity's
│                           #   rules/AGENTS.md are all RENDERED from this,
│                           #   never hand-authored — see
│                           #   extension-skeleton/EXTENSION-FORMAT.md's
│                           #   *Context rendering*.
└── README.md               # This file
```

Nothing named after a specific command-line tool is committed here — a file
of that shape is always a build output (spec 0173 requirement 4). Render one
with `bash scripts/build-extension.sh [--target <cli>] hello-world`; `bash
scripts/build-extension.sh --check` fails the build if a generated file is
ever committed, if a fresh render fails, or if the render's output diverges
from the declared set.

## Command rendering (spec 0042, as amended by `specs/0042-extension-pivot-render.delta-01.md` and spec 0173)

The command is authored **once** in the pivot source `commands/hello.md`
(the same format used by `artifacts/` components). Its per-CLI consumed
forms are produced by how each tool loads an extension:

- **Gemini CLI** loads an extension from an installed build tree, so its
  form, `commands/hello.toml`, is an **ephemeral build output** —
  `bash scripts/build-extension.sh --target gemini hello-world` renders it
  into `build/extensions/hello-world/commands/hello.toml`. It is **never**
  committed here; `bash scripts/build-extension.sh --check` fails the build
  if a copy of it ever is.
- **Claude Code, GitHub Copilot CLI, Antigravity CLI** each build an
  ephemeral plugin at install time, rendering the pivot `.md` directly
  (`scripts/build-{claude,copilot,antigravity}-*.sh`). The manifest's
  `commands.convertToSkills` flag means *"render the pivot `.md` into a
  skill"* for whichever of those three targets is being built.

## Delivery (spec 0173 delta-01 requirements 20/21)

The rendered Gemini build tree reaches an adopter through one of three
paths — a versioned release artifact (the default), `bash
scripts/install-extension.sh install hello-world`, or the debugging task
`task link-gemini-extension-build EXT=hello-world` — never through a native
`gemini extensions install` pointed directly at this repository's primary
branch, which is a documented-unsupported path. See
`extension-skeleton/EXTENSION-FORMAT.md` for the full delivery-path
contract.

## Installation

```bash
task install-extension-all EXT=hello-world
# Gemini CLI only:
task install-gemini-extension EXT=hello-world
```
