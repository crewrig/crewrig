---
id: "0065"
slug: copilot-plugin-build
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 481
version: 1.0.0
---

# Copilot CLI plugin build & install

## Intent

Extensions in CrewRig can be built and installed for GitHub Copilot CLI
using the same manifest-driven workflow that already exists for Claude
Code and Antigravity CLI. The `extension.json` schema gains an optional
`copilot:` section, dedicated build and install scripts produce a valid
Copilot plugin directory from any extension source, the CLI Matrix GAP
entries for rows 13 and 14 are corrected from "by design" to implemented,
and the related parity-gap lines in the matrix summary are removed.

## Requirements

R1. `extension.json` SHALL accept an optional top-level `copilot` object
    with the following optional fields: `pluginName` (string override for
    the installed plugin name; defaults to the manifest `name` field) and
    `hooks` (object — Copilot hook schema).

R2. `extension-skeleton/base/extension.json` SHALL include a `copilot`
    section with a placeholder `pluginName` value, parallel to the
    existing `antigravity` section.

R3. A script `scripts/build-copilot-plugin.sh` SHALL accept an extension
    directory or bare extension name as its first argument and an optional
    output directory as its second, resolve the extension source across
    `extensions/core/`, `extensions/library/`, `extensions/org/`, and
    emit a Copilot CLI plugin directory containing:

    - `plugin.json` at the output root with `name`, `version`, and
      `description` fields derived from the manifest (using
      `copilot.pluginName` when present and non-empty, falling back to
      `name`).
    - A `skills/` subtree in `skills/<name>/SKILL.md` form, copied from
      the extension source when `components.skills.enabled` is `true`.
    - Pivot commands rendered as `skills/<cmd>/SKILL.md` entries when
      `components.commands.convertToSkills` is `true` (same render path
      as `build-claude-plugin.sh`, using `scripts/lib/render-command.sh`).
    - An `agents/` subtree in `agents/<name>.agent.md` flat-file form
      (i.e., each `agents/<name>/AGENT.md` source directory is flattened
      to `agents/<name>.agent.md` in the output) when
      `components.agents.enabled` is `true`.
    - A `hooks.json` at the output root generated from `copilot.hooks`
      when that field is non-empty.

R4. The default output directory for `build-copilot-plugin.sh` SHALL be
    `dist-copilot-plugin/<name>/` relative to the repository root,
    mirroring the `dist-antigravity-plugin/<name>/` convention of
    `build-antigravity-extension.sh`.

R5. A script `scripts/install-copilot-plugin.sh` SHALL accept a bare
    extension name, resolve it across the extension tier directories,
    build the plugin into `dist-copilot-plugin/<name>/` by invoking
    `build-copilot-plugin.sh`, and install the result by invoking
    `copilot plugin install <output-dir>`.

R6. `docs/cli-matrix.md` SHALL be updated in the same diff as the
    scripts to reflect the new state of the Copilot CLI column for the
    following rows:
    - **Row 5b** (extension command render): update the Copilot entry from
      `[GAP] by design` to ✅ noting that `build-copilot-plugin.sh`
      renders command pivots as skills when `convertToSkills` is `true`
      (same pattern as Claude and Antigravity).
    - **Row 5c** (extension skill/agent provenance carrier): update the
      Copilot entry from `[GAP] by design` to ✅ noting that
      `build-copilot-plugin.sh` copies the in-place extension
      `skills/<name>/SKILL.md` bytes unchanged (the HTML-comment
      provenance carrier from spec 0043 is preserved).
    - **Row 13** (plugin build script): update from `[GAP] by design` to
      ✅ `scripts/build-copilot-plugin.sh`.
    - **Row 14** (plugin install script): update from `[GAP] by design`
      to ✅ `scripts/install-copilot-plugin.sh`.
    - **Row 16** (Taskfile entries): add `build-copilot-plugin` and
      `install-copilot-plugin` to the Copilot cell.
    - **Row 17** (per-CLI extension manifest): replace the `[GAP-soft]`
      Copilot entry with a note that `extension.json` `copilot:` section
      is now the per-CLI manifest convention (analogous to `antigravity:`),
      and add a reference to this spec.
    - **Row 20** (`.gitignore` carve-outs): update the Copilot entry to
      note the addition of `dist-copilot-plugin/`.
    - **Parity gaps section**: remove the two Copilot-specific plugin GAP
      lines (`[GAP] Plugin / extension build & install` and `[GAP]
      Extension command/agent surface for Copilot`); the `[GAP-soft]` for
      the per-extension Copilot manifest is resolved by R2.

R7. `Taskfile.yml` SHALL gain two new Copilot tasks: `build-copilot-plugin`
    (invokes `scripts/build-copilot-plugin.sh`) and `install-copilot-plugin`
    (invokes `scripts/install-copilot-plugin.sh`), parallel to the
    existing `build-antigravity-extension` and `install-antigravity-extension`
    tasks.

R8. `.gitignore` SHALL gain a `dist-copilot-plugin/` entry, mirroring the
    existing `dist-antigravity-*/` carve-out.

## Scenarios

### S1 — Build produces a valid plugin directory

Given an extension with skills and agents enabled in its `extension.json`,  
When `bash scripts/build-copilot-plugin.sh <ext-name>` is invoked,  
Then `dist-copilot-plugin/<ext-name>/plugin.json` exists and contains
`name`, `version`, and `description` fields, `dist-copilot-plugin/<ext-name>/skills/`
contains one subdirectory per skill with a `SKILL.md` file, and
`dist-copilot-plugin/<ext-name>/agents/` contains one flat `<name>.agent.md`
file per agent (not a subdirectory).

### S2 — Agent directory flattening

Given an extension with an agent at `agents/my-agent/AGENT.md`,  
When `build-copilot-plugin.sh` is invoked,  
Then the output contains `agents/my-agent.agent.md` (flat file) and no
`agents/my-agent/` subdirectory.

### S3 — Command pivots rendered as skills when convertToSkills is true

Given an extension with `components.commands.convertToSkills: true` and a
pivot source `commands/my-cmd.md`,  
When `build-copilot-plugin.sh` is invoked,  
Then `dist-copilot-plugin/<ext-name>/skills/my-cmd/SKILL.md` is created
from the pivot source body.

### S4 — pluginName override applied

Given an extension with `copilot.pluginName: "crewrig-copilot-ext"` in
`extension.json`,  
When `build-copilot-plugin.sh` is invoked,  
Then `dist-copilot-plugin/<ext-name>/plugin.json` contains
`"name": "crewrig-copilot-ext"`.

### S5 — Install script invokes copilot plugin install

Given the `copilot` binary is on `$PATH` and an extension exists in
`extensions/`,  
When `bash scripts/install-copilot-plugin.sh <ext-name>` is invoked,  
Then the script builds the plugin and calls
`copilot plugin install dist-copilot-plugin/<ext-name>/` without error.

## Out of scope

- Marketplace distribution (`copilot plugin marketplace add`) — direct
  local path install is the only delivery mechanism in scope.
- Updating `extensions/core/hello-world/` with a Copilot example — the
  hello-world extension may be updated in a follow-up.
- e2e test coverage for `build-copilot-plugin.sh` / `install-copilot-plugin.sh`
  — same gap-acceptance position as the existing Copilot CLI e2e rows in the
  CLI Matrix (rows 21–25).
- Resolving the `[GAP-confirmation]` on row 4 (repo-level Copilot agent
  layout) — that follow-up remains open.

## Open questions

None.
