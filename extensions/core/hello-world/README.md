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
├── commands/hello.toml     # /hello slash command
├── skills/greeter/SKILL.md # Greeter skill instructions
├── GEMINI.md               # Agent context when extension is loaded
└── README.md               # This file
```

## Installation

```bash
task install-extension EXT=hello-world
```
