# Hello World Extension — Copilot Instructions

Context file loaded when this extension is active in GitHub Copilot CLI.

## Available Capabilities

- **`greet` tool**: produces a personalized greeting via MCP.
- **`farewell` tool**: says goodbye to someone by name.
- **`/hello` skill**: shortcut for a quick greeting (compiled from the
  `hello` command — Copilot has no first-class slash-command format, so
  commands ship as user-invocable skills).
- **`/greeter` skill**: guided introduction workflow.

## Reference Value

Use this extension as a template for building new ones. It demonstrates
the standard directory layout, manifest configuration, TypeScript MCP
server, command definition, and skill authoring.
