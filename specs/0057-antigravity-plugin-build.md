---
id: "0057"
slug: antigravity-plugin-build
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 427
version: 1.0.0
---

# Spec 0057 — Antigravity plugin build

## Intent

crewrig gains a pair of scripts that package its compiled components into an
Antigravity CLI plugin and install that plugin into the user's Antigravity CLI
profile. A developer who has run the crewrig build pipeline can, with a single
command, produce an installable plugin directory and register it with the `agy`
binary, making crewrig's skills, agents, and commands available to every
Antigravity CLI session without workspace-level setup.

## Requirements

1. A `scripts/build-antigravity-plugin.sh` script SHALL exist that assembles
   crewrig's compiled components from `dist/` into a self-contained plugin
   directory, including a `plugin.json` manifest at the plugin root.

2. The `plugin.json` manifest produced by `scripts/build-antigravity-plugin.sh`
   SHALL contain the required `name` field with the value `crewrig`, and MAY
   include the optional `version` and `description` fields populated from the
   crewrig release metadata.

3. `scripts/build-antigravity-plugin.sh` SHALL copy compiled `skills/`,
   `agents/`, and `commands/` subdirectories from `dist/` into the plugin
   directory, and SHALL copy `hooks/antigravity-transcript-hooks.json` as
   `hooks.json` inside the plugin directory when the source file exists.

4. The plugin directory produced by `scripts/build-antigravity-plugin.sh`
   SHALL be valid when checked with `agy plugin validate`, exiting zero with no
   error output, on any system where the `agy` binary meets the minimum required
   version.

5. A `scripts/install-antigravity-plugin.sh` script SHALL exist that invokes
   `agy plugin install <plugin-dir>` to register the packaged plugin, causing
   the Antigravity CLI to copy the plugin contents into
   `~/.gemini/config/plugins/crewrig/`.

6. `scripts/install-antigravity-plugin.sh` SHALL invoke
   `scripts/build-antigravity-plugin.sh` before calling `agy plugin install`,
   so that a single command both builds and installs the current plugin state.

7. `scripts/install-antigravity-plugin.sh` SHALL verify that the `agy` binary
   is present in `$PATH` before attempting any build or installation step, and
   SHALL exit with a non-zero status code and a human-readable diagnostic
   message if the binary is absent.

8. `Taskfile.yml` SHALL include a `build-antigravity-plugin` task that invokes
   `scripts/build-antigravity-plugin.sh` and an `install-antigravity-plugin`
   task that invokes `scripts/install-antigravity-plugin.sh`, following the
   `<cli>-`-prefixed naming convention established by the existing
   `build-claude-plugin` and `install-claude-plugin` tasks.

9. `scripts/build-extension-pivot.sh` SHALL remain unchanged; the
   package/install loading model of Antigravity CLI (Outcome B) does not
   require pivot rendering, and sub-spec F explicitly excludes modifications to
   that script.

## Scenarios

**Scenario:** Successful plugin build and install

Given a developer has run the crewrig build pipeline so that `dist/` contains
compiled skills, agents, and commands, and the `agy` binary is present in
`$PATH`
When they run `bash scripts/install-antigravity-plugin.sh`
Then the script builds a plugin directory containing `plugin.json` with
`name: crewrig`, copies the compiled components, invokes
`agy plugin install <plugin-dir>`, and the plugin appears in the Antigravity
CLI profile under `~/.gemini/config/plugins/crewrig/`

**Scenario:** Plugin directory passes agy validation

Given `scripts/build-antigravity-plugin.sh` has completed without error
When `agy plugin validate <plugin-dir>` is run against the produced directory
Then the command exits with status zero and prints no error output

**Scenario:** Install aborts when agy binary is absent

Given the `agy` binary is not present in `$PATH`
When a developer runs `bash scripts/install-antigravity-plugin.sh`
Then the script exits with a non-zero status code before modifying any file,
and prints a human-readable message naming the missing binary and pointing to
installation instructions

**Scenario:** build-extension-pivot.sh is unaffected

Given the crewrig repository with sub-spec F merged on `main`
When a developer inspects `scripts/build-extension-pivot.sh`
Then the file is byte-for-byte identical to its state before sub-spec F
landed, confirming that the Antigravity plugin build path does not modify the
pivot render script

## Out of scope

- Extension commands for Gemini CLI or Claude Code; this spec qualifies only
  the Antigravity CLI plugin build and install path.
- Modifications to `scripts/build-extension-pivot.sh`; the pivot render model
  is not needed for the Antigravity package/install loading model (Outcome B
  confirmed).
- Antigravity CLI workspace layout (`.agents/` directory and entry-point files)
  — owned by sub-spec A (spec 0052).
- The `scripts/setup-antigravity-interactive.sh` setup script — owned by
  sub-spec C (spec 0054).
- Transcript hook file authoring (`hooks/antigravity-transcript-hooks.json`)
  — owned by sub-spec E (spec 0056); this spec only copies the hook file into
  the plugin directory when the source exists.
- Validation of the plugin against a live Antigravity CLI session; R4 scopes
  validation to `agy plugin validate` (static check), not to a running session.
- Publishing the plugin to a remote Antigravity CLI marketplace or registry.
- CI pipeline changes to build or validate the Antigravity plugin — owned by
  sub-spec G.

## Open questions

- [USER-PARKED] **Minimum agy version for `agy plugin validate`.** The exact
  minimum `agy` version that supports the `plugin validate` subcommand is not
  confirmed in accessible public documentation. R4 and R7 assume the subcommand
  is available on the same minimum version already established by spec 0051.
  The implementation PR SHALL verify the minimum version requirement and update
  R7's diagnostic message accordingly if a version guard is needed beyond
  binary-presence detection.
- [USER-PARKED] **mcpServers in plugin.json.** Whether `mcpServers` is a
  supported top-level key in the Antigravity CLI `plugin.json` manifest (as
  listed in OQ1 facts) is not end-to-end verified. If confirmed, R3 SHALL be
  amended via delta-spec to include MCP server registration inside the plugin
  directory. If absent, the setup script (sub-spec C) remains the sole MCP
  registration path.
