---
id: "0090"
slug: forge-access-cli-only
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 624
version: 1.0.0
---

# Forge access CLI-only; no framework forge MCP

## Intent

After this change, forge access is uniform and vendor-neutral across all four
supported CLIs: an agent reaches a code forge — GitHub, GitLab, or Gitea —
through that forge's own command-line interface, with authentication handled by
the CLI, and the framework ships no forge MCP server and no forge credential in
any default. An operator setting up any CLI notices that no GitHub personal
access token is requested and that no `github` MCP server is registered, while
native `git` keeps working exactly as before. The framework's core rules, its
shipped configuration defaults, and its reference documentation all tell the
same CLI-first forge-access story instead of contradicting each other, and an
existing adopter is given a clear note explaining how to retire the old MCP
block and token from their own deployment.

## Requirements

1. The shipped Gemini configuration default `config/gemini/settings.json` SHALL
   NOT declare a `github` MCP server; after the change its `mcpServers` object
   SHALL contain only `mempalace` and `sequentialthinking`.
2. The shipped Copilot configuration default
   `config/copilot/mcp-config.json.template` SHALL NOT declare a `github` MCP
   server; after the change its `mcpServers` object SHALL contain only
   `mempalace` and `sequentialthinking`.
3. No shipped configuration default SHALL contain a plaintext forge-access
   credential; in particular, neither `config/gemini/settings.json` nor
   `config/copilot/mcp-config.json.template` SHALL carry an
   `Authorization: Bearer $GITHUB_PAT` header.
4. `config/.env.example` SHALL NOT define `GITHUB_PAT` or any other
   forge-access credential variable. The file SHALL be retained as a core-layer
   file — leaving the `.crewrig/core-paths.txt` manifest unchanged — and SHALL
   document that the framework requires no forge credential by default.
5. This spec SHALL introduce no forge MCP server for any of the four CLIs. The
   Claude Code and Antigravity configurations, which never shipped a forge MCP
   server, are the unchanged reference baseline; the Gemini and Copilot removals
   SHALL bring all four CLIs to that same no-forge-MCP baseline.
6. `artifacts/core/rules/60-tools.md` SHALL direct all forge operations —
   issues, pull/merge requests, branch protection, and releases — through the
   forge's own CLI (`gh` for GitHub, `glab` for GitLab, `tea` for Gitea) with
   authentication delegated to that CLI, and SHALL NOT mandate a forge MCP
   server for those operations.
7. `artifacts/core/rules/60-tools.md` SHALL state that native `git` remains the
   tool for ordinary version control and is unaffected by this policy.
8. The `artifacts/core/rules/60-tools.md` section heading currently reading
   *GitHub MCP Server* SHALL be renamed *Forge Access*, for symmetry with the
   `AGENTS.md` rename in requirement 9; no heading reading *GitHub MCP Server*
   SHALL remain over the CLI-only forge-access content.
9. The `AGENTS.md` *GitHub Access* section SHALL be renamed *Forge Access* and
   rewritten so that GitHub, GitLab, and Gitea are first-class forges, forge
   operations route through `gh` / `glab` / `tea` with authentication delegated
   to the CLI, and no dedicated forge MCP server is asserted.
10. Every reference to the framework's MCP servers in `config/TOOLS.md.template`
    SHALL name only MemPalace and SequentialThinking; GitHub SHALL NOT be listed
    as a framework MCP server.
11. `docs/cli-matrix.md` SHALL be updated so that its MCP-server-configuration
    row no longer lists a GitHub (or any forge) MCP server in the Gemini and
    Copilot cells.
12. The change set SHALL ship an existing-adopter migration note, provided as a
    dedicated section within this spec (see *Migration note* below) and anchored
    to the ADR-0015 *Existing adopters — migration note, not active cleanup*
    paragraph. The note SHALL document that an operator removes the `github` MCP
    block and the `$GITHUB_PAT` value from their already-deployed configuration,
    and SHALL state that no setup script performs this removal automatically,
    consistent with the merge-not-overwrite behaviour of spec 0089 (issue #616).
    The migration note SHALL NOT be delivered as a new `CHANGELOG.md` nor as a
    new `docs/` page.

## Scenarios

**Scenario:** Shipped Gemini and Copilot defaults no longer register a forge MCP

Given the framework's shipped Gemini and Copilot MCP configuration defaults
after this change
When an operator inspects `config/gemini/settings.json` and
`config/copilot/mcp-config.json.template`
Then neither declares a `github` MCP server, and each `mcpServers` object
contains only `mempalace` and `sequentialthinking`

**Scenario:** No forge credential ships in any default

Given the framework's shipped configuration and example environment files after
this change
When an operator searches the shipped defaults for `GITHUB_PAT`
Then `config/.env.example` defines no `GITHUB_PAT`, and no configuration default
carries an `Authorization: Bearer $GITHUB_PAT` header

**Scenario:** Core rules and AGENTS.md tell one CLI-first forge story

Given the rewritten `artifacts/core/rules/60-tools.md` and `AGENTS.md`, whose
forge-access sections are both now headed *Forge Access*
When an agent reads the forge-access guidance
Then it is directed to use `gh` / `glab` / `tea` with authentication delegated
to the CLI, is told that native `git` is unchanged, finds no requirement to use
a forge MCP server, and encounters no stale *GitHub MCP Server* heading

**Scenario:** Existing adopter finds the migration note

Given an existing adopter whose already-deployed configuration still contains a
`github` MCP block and a `$GITHUB_PAT` value
When they consult the migration note shipped with this change
Then they find explicit steps to remove the block and the token from their own
deployment, and a statement that no setup script performs this cleanup for them

**Scenario:** Asymmetric removal is rejected

Given a candidate change that removes the `github` block from
`config/gemini/settings.json` but leaves it in
`config/copilot/mcp-config.json.template`
When the change is reviewed against this spec
Then it is rejected because the removal is not symmetric across the two CLIs
that shipped the forge MCP

**Scenario:** Active cleanup of a deployed config is rejected

Given a candidate change that makes a setup script delete a pre-existing
`github` block from an adopter's already-deployed configuration
When the change is reviewed against this spec
Then it is rejected because active cleanup contradicts the merge-not-overwrite
semantics of spec 0089, and this spec mandates a migration note rather than
automated scrubbing

## Out of scope

- The org-level MCP declaration mechanism (proposed spec 0091, issue #617) —
  the single org-owned channel that lets an adopting organization re-add a forge
  MCP server and have it merged into each CLI's native config.
- The merge-not-overwrite setup-script behaviour itself (spec 0089, issue #616);
  it is a hard prerequisite for the org-MCP mechanism, not part of this spec.
- Any active or automated removal of a `github` MCP block or `$GITHUB_PAT` from
  an adopter's already-deployed configuration; the migration path here is
  documentation only.
- Any change to the MemPalace or SequentialThinking MCP servers, or to how the
  setup scripts register them.
- Any change to native `git` usage or to the project's branching conventions.
- Building or maintaining a forge-agnostic MCP shim spanning GitHub, GitLab, and
  Gitea (the rejected ADR-0015 alternative i).
- User-scoped personal MCP servers that an individual adds outside the framework
  (e.g. `claude mcp add --scope user`).

## Open questions

- None — resolved 2026-07-22. The migration-note location (a dedicated section
  within this spec, anchored to ADR-0015, with no `CHANGELOG.md` and no new
  `docs/` page) is captured in requirement 12 and the *Migration note* section
  below; the `artifacts/core/rules/60-tools.md` heading rename (*GitHub MCP
  Server* → *Forge Access*) is captured in requirement 8.

## Migration note

This section is the existing-adopter migration note mandated by requirement 12;
it complements the ADR-0015 *Existing adopters — migration note, not active
cleanup* paragraph. It applies only to an operator who deployed a CrewRig
configuration before this change and therefore still has a forge MCP block on
disk.

The change alters the framework's shipped defaults for new setups only. It does
not rewrite an adopter's already-deployed `~/.gemini/settings.json` or
`~/.copilot/mcp-config.json`: those files are adopter-owned overlay (per
`docs/layers.md`), and no setup script edits them automatically. Automated
scrubbing is deliberately excluded — it would contradict the merge-not-overwrite
semantics of spec 0089 (issue #616), under which the setup scripts preserve
every non-framework `mcpServers` entry, a leftover `github` block included.

Consequently, an adopter who wants the old forge MCP gone removes, from their
own deployment, the `github` entry under `mcpServers` and the `GITHUB_PAT` value
from their environment file. After removal, forge access follows the CLI-first
policy in the renamed *Forge Access* rules (`gh` / `glab` / `tea`, with
authentication delegated to the CLI); native `git` is unaffected. The concrete
per-CLI removal steps are a DEV/PLAN concern and are not fixed by this spec.
