---
id: "0063"
slug: antigravity-extension-formalism
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 470
version: 1.0.0
---

# Antigravity extension formalism

## Intent

Extensions in crewrig can be built and installed for Antigravity CLI using the
same manifest-driven workflow that already exists for Claude Code and Gemini
CLI. The `extension.json` schema gains an `antigravity:` section, dedicated
build and install scripts produce a valid Antigravity plugin directory from
any extension source, and the two legacy scripts that misrepresent workspace
artifacts as plugin sources are removed.

## Requirements

R1. `extension.json` SHALL accept an optional top-level `antigravity` object
    with the following optional fields: `pluginName` (string), `contextFileName`
    (string), and `hooks` (object following the `hooks/antigravity-transcript-hooks.json`
    schema).

R2. `extension-skeleton/base/extension.json` SHALL include an `antigravity`
    section with placeholder values for `pluginName` and `contextFileName`.

R3. `scripts/build-antigravity-extension.sh` SHALL accept an extension name or
    an extension directory path as its first argument and an optional output
    directory as its second argument.

R4. `scripts/build-antigravity-extension.sh` SHALL resolve a bare name to its
    source directory by searching `extensions/core/`, `extensions/library/`,
    and `extensions/org/` in that order, and SHALL error on a duplicate name
    across tiers.

R5. `scripts/build-antigravity-extension.sh` SHALL read `extension.json` for
    metadata (name, version, description); when `extension.json` is absent it
    SHALL fall back to `gemini-extension.json`.

R6. `scripts/build-antigravity-extension.sh` SHALL write its output to
    `dist-antigravity-plugin/<name>/` by default when no output directory
    is specified.

R7. `scripts/build-antigravity-extension.sh` SHALL generate a `plugin.json`
    at the root of the output directory containing at minimum `name`, `version`,
    and `description`, where `name` is the value of `antigravity.pluginName`
    if present and non-empty, otherwise the extension name from the manifest.

R8. `scripts/build-antigravity-extension.sh` SHALL copy the skills directory
    when `components.skills.enabled` is `true`.

R9. `scripts/build-antigravity-extension.sh` SHALL copy the agents directory
    when `components.agents.enabled` is `true`.

R10. `scripts/build-antigravity-extension.sh` SHALL render commands as skills
     (one `SKILL.md` per command) when `components.commands.convertToSkills` is
     `true`, using the same pivot logic as `build-claude-plugin.sh`.

R11. `scripts/build-antigravity-extension.sh` SHALL copy a context file named
     by `antigravity.contextFileName` to the output root when that field is
     present and the file exists in the extension source directory.

R12. `scripts/build-antigravity-extension.sh` SHALL copy MCP server artifacts
     (`dist/` and `package.json`) when the `mcpServers` field is present in
     the manifest.

R13. `scripts/build-antigravity-extension.sh` SHALL generate a `hooks.json`
     at the output root when `antigravity.hooks` is defined and non-empty.

R14. `scripts/install-antigravity-extension.sh` SHALL accept an extension name,
     invoke `build-antigravity-extension.sh` into a temporary output directory,
     and then invoke `agy plugin install <output-dir>`.

R15. `scripts/build-antigravity-plugin.sh` and `scripts/install-antigravity-plugin.sh`
     (introduced by spec 0057, patched by spec 0062) SHALL be removed from the
     repository.

R16. `docs/cli-matrix.md` row 13 (extension build) and row 14 (extension
     install) SHALL be updated to reflect Antigravity CLI support via the new
     scripts.

R17. `docs/cli-matrix.md` row 17 (per-CLI extension manifest) SHALL note the
     `antigravity:` section in `extension.json`.

## Scenarios

**Scenario:** build a named extension for Antigravity

Given an extension named `hello-world` exists under `extensions/core/`
  and its `extension.json` declares `components.skills.enabled: true`
When  `scripts/build-antigravity-extension.sh hello-world` is executed
Then  `dist-antigravity-plugin/hello-world/plugin.json` is generated with
      `name`, `version`, and `description` populated from the manifest,
      and `dist-antigravity-plugin/hello-world/skills/` contains the
      extension's skill files.

**Scenario:** pluginName override

Given an extension whose `extension.json` contains
      `"antigravity": {"pluginName": "hw-agy"}` under the `antigravity` key
When  `scripts/build-antigravity-extension.sh hello-world` is executed
Then  `plugin.json` at the output root contains `"name": "hw-agy"`.

**Scenario:** install an extension via Antigravity CLI

Given `agy` is available on PATH
  and `hello-world` resolves to a valid extension source directory
When  `scripts/install-antigravity-extension.sh hello-world` is executed
Then  the script calls `build-antigravity-extension.sh` into a temp directory
      and subsequently calls `agy plugin install <temp-dir>`.

**Scenario:** hooks.json generated from antigravity.hooks

Given an extension with `"antigravity": {"hooks": {"postMessage": [...]}}` defined
When  `scripts/build-antigravity-extension.sh <extension>` is executed
Then  `hooks.json` is written to the output root with the content of
      `antigravity.hooks`.

**Scenario:** commands converted to skills

Given an extension with `components.commands.convertToSkills: true`
  and a `commands/greet.md` source file
When  `scripts/build-antigravity-extension.sh <extension>` is executed
Then  `skills/greet/SKILL.md` is present in the output directory.

**Scenario:** duplicate extension name across tiers

Given an extension named `conflict` exists in both `extensions/core/`
  and `extensions/library/`
When  `scripts/build-antigravity-extension.sh conflict` is called
Then  the script exits with a non-zero status and prints an error message
      naming the duplicate.

**Scenario:** extension name not found

Given no extension named `nonexistent` exists under any tier
When  `scripts/build-antigravity-extension.sh nonexistent` is called
Then  the script exits with a non-zero status and prints a not-found error.

**Scenario:** extension.json absent, gemini-extension.json present

Given an extension directory containing `gemini-extension.json` but no `extension.json`
When  `scripts/build-antigravity-extension.sh <extension>` is executed
Then  `name`, `version`, and `description` in `plugin.json` are read from
      `gemini-extension.json`.

## Out of scope

- Changes to the Gemini or Claude Code extension build pipelines.
- Validation of `agy` binary version or feature parity between Antigravity CLI
  versions.
- Introducing a new complexity tier or manifest schema version mechanism; the
  `extension.json` schema evolves in-place.
- Migrating existing extensions to add an `antigravity:` section; each
  extension is updated independently by its author.
- The `scripts/build-components.sh` orchestrator; it is not updated as part of
  this spec and continues to invoke the legacy Antigravity scripts until a
  follow-on spec removes the dependency.
- The `extension-skeleton` new-extension generator script; updating the
  skeleton's `extension.json` is sufficient.

## Open questions

- None.
