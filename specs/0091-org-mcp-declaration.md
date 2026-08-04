---
id: "0091"
slug: org-mcp-declaration
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 631
version: 1.0.0
---

# Org-level MCP server declaration channel

## Intent

An adopting organization can declare and configure the MCP servers it wants
wired into its agents — typically third-party servers reached as a remote
endpoint with an authorization, such as an Atlassian server exposed as an
http-streamable endpoint behind an OAuth2 authorization, and including a
re-added forge server for GitHub, GitLab, or Gitea — through a single org-owned
channel. That channel is a declaration artifact: it maps each server's name to
how the server is reached and authorized, and it does not hold the server's
implementation code. The organization declares a server once and notices it
appear in each CLI's MCP configuration alongside the framework's own servers,
without having edited any upstream-owned file. Its declarations survive a
repeated setup run and are never touched by an upstream synchronization, and any
MCP server an operator had already added by hand keeps working. Upstream ships
the channel empty, carrying only an illustrative starting point and no
operational server or credential, exactly as it ships an example stub for the
org agent rules; a fresh adopter therefore receives no org MCP server until it
populates the channel itself.

## Requirements

1. The framework SHALL provide a single org-owned channel through which an
   adopting organization declares and configures its own MCP servers. The
   channel is a declaration artifact that maps each MCP server's name to its
   transport and endpoint (for example an http-streamable URL, or a stdio
   command) and its authorization (for example an OAuth2 authorization); it
   SHALL NOT hold or require the server's implementation code.
2. The org MCP declaration channel SHALL be a dedicated org-owned file, distinct
   from `artifacts/community/mcp-servers/` — which hosts MCP servers the
   organization itself *develops* (server code) — and SHALL follow the
   root-level `<name>.org.<ext>` ownership convention established by
   `AGENTS.org.md` (spec 0020). The concrete filename and extension MAY be
   settled at the PLAN stage together with the format decision (see *Open
   questions*).
3. The org MCP declaration channel SHALL be classified in the layer boundary
   contract (`docs/layers.md`) and the sync manifest (`.crewrig/core-paths.txt`)
   as org-owned and **excluded** from upstream synchronization, with a
   `docs/layers.md` entry that distinguishes it (org MCP *declarations /
   configuration*) from `artifacts/community/mcp-servers/` (org-*developed*
   server code); upstream synchronization SHALL never modify, delete, restore,
   or refuse to proceed on account of its contents.
4. An organization SHALL be able to declare an MCP server through this channel
   without editing any upstream-owned file.
5. The org-declared MCP servers SHALL be delivered into the native MCP
   configuration of every supported CLI — Claude Code, Gemini CLI, GitHub
   Copilot CLI, and Antigravity CLI — with no silent parity gap. Where a CLI
   cannot receive them through the same mechanism as another, an equivalent
   SHALL deliver them, and any accepted gap SHALL be recorded as gap-acceptance
   evidence per `docs/cli-matrix-maintenance.md`.
6. Delivering org-declared servers into a CLI's MCP configuration SHALL merge
   them with the declarations already present rather than overwrite the
   configuration; every pre-existing declaration the org channel does not name
   SHALL survive with its settings unchanged, consistent with the
   merge-not-overwrite behaviour of spec 0089 (issue #616).
7. The org-declared servers SHALL remain present after a repeated setup run and
   SHALL be preserved across an upstream synchronization, so that the org
   channel is the durable source of the organization's MCP declarations.
8. The org MCP declaration channel SHALL be able to declare a forge MCP server
   (GitHub, GitLab, or Gitea), so that an organization wanting a forge MCP after
   the CLI-first baseline of spec 0090 re-adds it through this channel and not
   by editing an upstream-owned default.
9. Upstream SHALL ship the channel in an empty or illustrative state that
   declares no operational MCP server and carries no forge credential or other
   secret, mirroring the example stub shipped for `AGENTS.org.md`; a fresh
   adopter SHALL receive no org-declared MCP server until it populates the
   channel.
10. The reserved framework-managed MCP server names defined by spec 0089
    (`mempalace`, `sequentialthinking`) SHALL retain their framework-managed
    semantics; the org channel SHALL NOT displace a framework-managed server
    under a reserved name — on a reserved-name collision the framework-managed
    configuration wins, and the org declaration SHALL NOT be applied silently in
    its place.
11. When an org-declared server's name collides, under a non-reserved name, with
    a pre-existing operator-added declaration in a CLI's MCP configuration, the
    org-declared configuration SHALL take precedence and the resolution SHALL
    NOT be silent — a warning SHALL name the affected server, consistent with
    the collision-warning discipline of spec 0089.
12. The change set SHALL document how an organization re-adds a forge MCP server
    through this channel, anchored to the *Forge Access* guidance established by
    spec 0090 and ADR-0015, and SHALL update `docs/cli-matrix.md` to record how
    each CLI receives org-declared MCP servers.
13. A regression test SHALL assert, for each supported CLI, that a populated org
    channel results in the org-declared server being present in that CLI's MCP
    configuration after setup while a pre-existing operator-added server survives
    unchanged.

## Scenarios

**Scenario:** An org-declared third-party server reaches every CLI

Given an organization has declared, through the org MCP declaration channel, an
`atlassian` MCP server reached as an http-streamable endpoint behind an OAuth2
authorization
When the operator runs the setup script for each supported CLI — Claude Code,
Gemini, Copilot, and Antigravity
Then each CLI's MCP configuration contains the `atlassian` server alongside the
framework-managed `mempalace` and `sequentialthinking` servers, with no CLI left
without it

**Scenario:** An organization re-adds a forge MCP through the channel

Given the CLI-first baseline of spec 0090, under which no forge MCP ships in any
default
And an organization that declares a `github` forge MCP server through the org
MCP declaration channel
When the operator runs setup for each supported CLI
Then each CLI's MCP configuration contains the org-declared `github` server, and
no upstream-owned default was edited to achieve it

**Scenario:** Org declarations survive a repeated setup run and an upstream sync

Given an organization whose org MCP declaration channel declares a `confluence`
server that is already present in a CLI's MCP configuration from a prior run
When the operator re-runs that CLI's setup script and then runs an upstream
synchronization
Then the `confluence` server is still present in the CLI's MCP configuration
after the re-run, and the org MCP declaration channel is left untouched by the
synchronization

**Scenario:** A hand-added operator server survives org delivery

Given a CLI's MCP configuration that already contains an operator-added
`acme-tools` server under a non-reserved name the org channel does not declare
When the operator runs setup and the org-declared servers are delivered into
that configuration
Then `acme-tools` is still present with its command, arguments, and environment
unchanged, in addition to the org-declared servers

**Scenario:** The org channel cannot displace a framework-reserved server

Given an org MCP declaration channel that declares a server under the reserved
name `mempalace`
When the operator runs setup and selects the framework-managed MemPalace server
Then the framework-managed `mempalace` configuration is the one written, the org
channel's `mempalace` declaration is not applied silently in its place, and the
collision is surfaced rather than resolved silently

**Scenario:** A silent parity gap is rejected

Given a candidate implementation that delivers org-declared MCP servers into the
Gemini, Copilot, and Antigravity configurations but not into the Claude Code
configuration
When the change is reviewed against this spec
Then it is rejected because the delivery is not symmetric across all four
supported CLIs and no gap-acceptance evidence justifies the omission

**Scenario:** Upstream ships no operational org server by default

Given a fresh adopter who has cloned the framework and not populated the org MCP
declaration channel
When the operator runs setup for any supported CLI
Then no org-declared MCP server is registered, only the framework-managed
servers the operator selected, and the shipped channel carries no forge
credential or other secret

## Out of scope

- Hosting or developing MCP server *implementation code*, which is the concern
  of `artifacts/community/mcp-servers/`; this channel declares and configures
  how servers are reached and authorized, it does not contain their
  implementation.
- The concrete on-disk **format and physical layout** of the channel — whether a
  single CLI-agnostic manifest translated into each CLI's native shape, or
  per-CLI declaration files, and the resulting concrete filename and extension.
  This is a HOW decision for the PLAN stage; ADR-0015 records a recommendation
  (a single CLI-agnostic manifest) but does not bind the format.
- The merge-not-overwrite setup-script behaviour itself (spec 0089, issue #616);
  it is a hard prerequisite for this channel's durability, not defined here.
- The CLI-first forge baseline and the removal of the shipped `github` MCP block
  (spec 0090, issue #624); this spec documents re-adding a forge MCP, it does
  not redo the removal.
- User-scoped personal MCP servers an individual adds outside the framework
  (e.g. `claude mcp add --scope user`) — the ADR-0015 user layer.
- Introducing new framework-managed MCP servers, or changing the set of reserved
  framework names (`mempalace`, `sequentialthinking`).
- Validating, health-checking, deduplicating, or normalizing org-declared
  servers — they are delivered as declared, never audited.
- Managing, encrypting, or otherwise securing any credential or authorization an
  organization places in its own MCP declaration; the framework ships the
  channel empty and the organization owns whatever secrets it later adds.
- Reconciling or propagating declarations across CLIs — an org server delivered
  to one CLI is not copied into another CLI's configuration by this spec.

## Open questions

- Manifest format and concrete filename (HOW — deferred to PLAN). Requirements 1
  and 2 fix that the channel is a dedicated org-owned declaration file following
  the `<name>.org.<ext>` convention of `AGENTS.org.md`; the physical format
  (one CLI-agnostic manifest translated per-CLI vs per-CLI files) and the
  resulting concrete filename and extension are left to PLAN. ADR-0015
  recommends a single CLI-agnostic manifest; a working name consistent with that
  recommendation and the `AGENTS.org.md` pattern is a root-level
  `mcp-servers.org.json`. To be settled at PLAN, not in this spec.
- [GROUNDING:] No illustrative org-MCP declaration file ships today, and
  `artifacts/community/mcp-servers/` (org-developed server code, a different
  concern) contains only a `.gitkeep`. Requirement 9 mandates an
  empty/illustrative starting point. Back-fill responsibility: the
  implementation PR for this spec SHALL create the illustrative org MCP
  declaration stub — at the dedicated org-owned location of requirement 2 — in
  the same diff.
