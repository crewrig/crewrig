---
id: "0015"
slug: overlay-starter-templates
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 229
version: 1.0.0
---

# Overlay Starter Templates

## Intent

CrewRig ships two kinds of configuration material for adopting organisations.
First, a set of **starter templates** that an org copies and fills in to
initialise its overlay layer: `crewrig.config.toml.template`,
`config/ORGANIZATION.md.template`, and `config/TOOLS.md.template`. Second, a
**core CrewRig tools rules file** that carries the framework-critical
instructions — the three-tier memory architecture (MemPalace, Sequential
Thinking, Obsidian), the harness engineering loop, and the MCP server
protocol — maintained upstream and deployed directly to the user's CLI rules
directory without org customisation. These two kinds of material are kept
physically separate so that upstream can update the framework rules without
conflicting with the org's own tool preferences, and so that an org's
`config/TOOLS.md` contains only content it genuinely owns. The comment block
in the existing `crewrig.config.toml` is updated to remove the stale
reference to the relocated `community-config/FORMAT.md`.

## Requirements

1. The repository SHALL contain a `crewrig.config.toml.template` file at the
   repository root, classified as `examples` layer. This file is the starting
   point that an adopting organisation copies to `crewrig.config.toml` and
   fills in before running the build pipeline.

2. `crewrig.config.toml.template` SHALL define, at minimum, the following keys
   with placeholder string values and inline comments explaining each field:
   `canonical_repo` (the URL of the upstream repository this fork was created
   from, used for audit trail and license traceability) and `feedback_repo` (the
   URL of the repository where the harness curator SHALL open feedback issues).
   Copying `crewrig.config.toml.template` to `crewrig.config.toml` and replacing
   the placeholder values with valid URLs SHALL be sufficient to produce a green
   `bash scripts/build-components.sh` run.

3. The repository SHALL contain a `config/ORGANIZATION.md.template` file,
   classified as `examples` layer. This file is the starting point that an
   adopting organisation copies to `config/ORGANIZATION.md` and customises.

4. `config/ORGANIZATION.md.template` SHALL contain, at minimum, the following
   sections as a skeleton with commented placeholder content indicating what the
   organisation should write in each section. The file describes WHO the
   organisation IS — its identity and governing context — not HOW it develops
   software (technical standards belong in other files):
   - An identity section: organisation name, sector, and market positioning.
   - A values and principles section: founding values and core principles that
     guide every decision across all functions.
   - An objectives section: the organisation's fundamental goals and the
     underlying philosophy driving them (e.g. commercial, social, humanist).
   - An assets section: the key resources, intellectual property, data, and
     relationships the organisation seeks to protect.
   - A governance section: decision-making structure and authority model.
   - A general rules section: broad organisational rules that apply across all
     professions and functions — thematic principles, not technical details.
   - A regulatory context section: applicable laws, regulations, and compliance
     frameworks the organisation operates under.

5. The repository SHALL contain a core CrewRig tools rules file, classified as
   `core` layer, that carries the upstream-maintained framework instructions for
   every developer working with CrewRig — regardless of their organisation's
   overlay. This file is deployed directly to the user's CLI rules directory; it
   is not a template and is not customised by the adopting organisation.

6. The core CrewRig tools rules file (R5) SHALL contain, at minimum, the
   following framework-critical sections:
   - The three-tier memory architecture: Sequential Thinking (working memory),
     MemPalace (persistent cross-session memory), and Obsidian (second brain,
     optional).
   - The Memory Activation Protocol: session-start sweep, continuous
     persistence during work, and session-end flush.
   - The harness engineering loop: recognition signals, when to tag a friction,
     how to invoke `harness-report`, and the payload schema.
   - The Sequential Thinking working memory protocol.
   - The Obsidian second brain access model (read-free, write requires explicit
     user consent).

7. The repository SHALL contain a `config/TOOLS.md.template` file, classified
   as `examples` layer. This file is the starting point that an adopting
   organisation copies to `config/TOOLS.md` and customises. It SHALL contain
   only org-specific content; framework-critical instructions (covered by R5–R6)
   SHALL NOT appear in this template.

8. `config/TOOLS.md.template` SHALL contain, at minimum, the following sections
   as a skeleton with commented placeholder content indicating what the
   organisation should write in each section:
   - A tooling preferences section (editor, terminal, communication tooling).
   - An MCP server declarations section (which org-specific MCP servers are
     enabled and any restrictions on their use; the framework MCP protocol is
     covered by R6 and SHALL NOT be duplicated here).
   - A workflow preferences section (working rhythms, sprint cadence, on-call,
     deployment frequency).

9. The core CrewRig tools rules file (R5) and the org-specific tools file
   compiled from `config/TOOLS.md` SHALL be deployed as two distinct files in
   the user's CLI rules directories (`~/.claude/rules/`, `~/.gemini/rules/`,
   and the Copilot equivalent), using different priority numbers so that the two
   files coexist without overwriting each other.

10. The comment block at the top of `crewrig.config.toml` SHALL be updated to
    replace the reference to `community-config/FORMAT.md` with
    `artifacts/FORMAT.md`, reflecting the path change introduced by spec 0014.

## Scenarios

**Scenario:** Organisation forks CrewRig and initialises its build configuration

Given a developer at an adopting organisation who has just forked the CrewRig
repository
When they copy `crewrig.config.toml.template` to `crewrig.config.toml` and
replace the `canonical_repo` and `feedback_repo` placeholder values with their
own repository URLs
Then `bash scripts/build-components.sh` exits zero and the built CLI output
directories are populated correctly.

**Scenario:** Upstream updates framework rules without conflicting with org tools

Given a CrewRig upstream update that modifies the core CrewRig tools rules file
(e.g., an update to the MemPalace Memory Activation Protocol)
When the adopting organisation syncs from upstream
Then the core file is updated cleanly because the org has no local modifications
to it — the org's tool preferences remain in their separate `config/TOOLS.md`,
which upstream never touches.

**Scenario:** Organisation customises TOOLS.md without duplicating framework instructions

Given a developer opening `config/TOOLS.md.template` to initialise their org's
tool configuration
When they read the template
Then none of the framework-critical sections (MemPalace, harness loop, MCP
protocol) appear in the template — those are already handled by the core file
deployed at install time — and the template focuses exclusively on org-specific
content.

**Scenario:** Template missing a required build field

Given a `crewrig.config.toml.template` that omits the `feedback_repo` key
When a reviewer cross-checks the template against the fields consumed by
`scripts/build-components.sh`
Then the missing field is visible as a gap and the implementation PR fails
the spec review.

## Out of scope

- The step-by-step adoption guide that walks an organisation through the full
  fork initialisation sequence — covered by sub-spec E1 (issue #231).
- `config/SOUL.md.template` and `config/PROFILE.md.template` — these already
  exist in the repository and are not modified by this sub-spec.
- Creation of the `artifacts/` directory structure — covered by sub-spec B
  (spec 0014, issue #228).
- The dirty-core guard / sync mechanism — covered by sub-spec D (issue #230).
- Assembly verification tooling — covered by sub-spec E2 (issue #232).
- The exact file path and priority number of the core CrewRig tools rules file
  (R5) — these are implementation decisions for the DEV stage. The spec
  mandates the existence, classification, and content of the file, not its
  precise location within the rules directory hierarchy.

## Open questions

(none)
