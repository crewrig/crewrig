# Adoption Guide

This guide walks an organisation through forking CrewRig, initialising the
overlay configuration, running the build pipeline, deploying to CLI rules
directories, and staying in sync with upstream. Follow the steps in order.
No step requires reading script source code — all expected outcomes and
error messages are described inline.

## Prerequisites

Before starting, ensure the following are in place:

- **`git`** — to clone, commit, and interact with branches.
- **`bash`** — version 4 or later; required by all setup and build scripts.
- **A TOML-capable editor** — for editing `crewrig.config.toml`.
  Any plain-text editor works; the TOML syntax used is minimal.
- **Write access to a GitHub repository** — the organisation's fork of
  CrewRig. This repository will serve as the overlay configuration home
  for the organisation.
- **The target CLI tools installed** — Claude Code, Gemini CLI, and/or
  GitHub Copilot CLI, whichever CLIs the organisation uses. The guide
  does not cover installing those tools; treat them as installed before
  proceeding.

## Step 1 — Fork the repository

Create the organisation's GitHub repository from the upstream CrewRig
repository.

1. Navigate to [https://github.com/crewrig/crewrig](https://github.com/crewrig/crewrig).
2. Click **Fork** and select the organisation's GitHub account as the
   destination.
3. Clone the fork locally:

   ```bash
   git clone git@github.com:<YOUR-ORG>/<YOUR-REPO>.git
   cd <YOUR-REPO>
   ```

4. Add the upstream remote so future syncs can pull from it:

   ```bash
   git remote add upstream https://github.com/crewrig/crewrig.git
   ```

The fork is now the organisation's overlay configuration repository. Upstream
changes flow in via `bash scripts/sync-from-upstream.sh` (Step 7); the
organisation's overlay content lives on top and is never touched by the sync.

## Step 2 — Initialise the overlay configuration

Copy the configuration template and replace the placeholder values with the
organisation's own repository URLs.

```bash
cp crewrig.config.toml.template crewrig.config.toml
```

Open `crewrig.config.toml` in a TOML-capable editor. The template ships with
the following placeholders:

```toml
# canonical_repo — the upstream repository this fork traces back to.
# Forks should keep this pointing at the upstream they forked from so
# that the audit trail and license trace remain intact.
# Replace with your own repo URL only if YOUR repo IS the canonical
# upstream for this deployment.
canonical_repo = "https://github.com/<YOUR-ORG>/<YOUR-REPO>"

# feedback_repo — where the harness curator opens friction MRs.
# Override this with your organisation's internal repo so that friction
# issues land on your own tracker rather than the upstream project.
# For most adopting orgs this will differ from canonical_repo.
feedback_repo  = "https://github.com/<YOUR-ORG>/<YOUR-REPO>"
```

Replace both values:

- `canonical_repo` — set to the upstream CrewRig URL
  (`https://github.com/crewrig/crewrig`) so that the audit trail and
  license trace remain intact. Override this only if the organisation's
  fork is itself the canonical upstream for a downstream deployment.
- `feedback_repo` — set to the organisation's own repository URL so that
  friction issues opened by the harness curator land on the organisation's
  tracker, not on the upstream project.

Commit the file:

```bash
git add crewrig.config.toml
git commit -m "chore: initialise crewrig.config.toml for <YOUR-ORG>"
```

## Step 3 — Initialise the organisation identity

Copy the organisation identity template and populate its sections.

```bash
cp config/ORGANIZATION.md.template config/ORGANIZATION.md
```

Open `config/ORGANIZATION.md` and fill in each section. The template
provides guidance comments inside each section. At minimum, complete:

- **Identity** — a 2–4 sentence description of the organisation, its scale,
  and its mission.
- **Values and Principles** — 3–6 core engineering values that guide
  trade-off decisions.
- **Objectives** — the organisation's current strategic engineering
  objectives.
- **Assets** — significant shared platforms, product lines, libraries, or
  data stores that agents should be aware of.
- **Governance** — who owns architectural decisions, how breaking changes
  are communicated, and any approval gates.
- **General Rules** — cross-cutting rules that apply to all engineering
  work regardless of team or stack (e.g., secrets management, language
  convention, data-protection baseline).
- **Regulatory Context** — any compliance or legal constraints relevant
  to engineering (GDPR, PCI-DSS, HIPAA, etc.). If none apply, state so
  explicitly.

Remove all placeholder comments and placeholder text (`[Replace with …]`)
before committing. This file is overlay — owned by the organisation — and
will not be overwritten by upstream syncs.

```bash
git add config/ORGANIZATION.md
git commit -m "chore: initialise config/ORGANIZATION.md for <YOUR-ORG>"
```

## Step 4 — Initialise the tool configuration

Copy the tool configuration template and fill in the organisation-specific
sections.

```bash
cp config/TOOLS.md.template config/TOOLS.md
```

Open `config/TOOLS.md`. This file layers organisation-specific settings
on top of the framework defaults (three-tier memory architecture, MemPalace
protocol, harness loop, Sequential Thinking) that the upstream framework
ships via the core rules file deployed at priority 60. Do **not** duplicate
framework content; use this file only for:

- **Tooling Preferences** — editors, terminal setup, communication
  platforms, and any org-wide CLI tools that are always available.
- **MCP Server Declarations** — MCP servers specific to the organisation's
  integrations (Jira, Confluence, Slack, internal APIs). Framework MCP
  servers (MemPalace, SequentialThinking, GitHub) are already covered by
  the core rules file — do not redeclare them here. If the organisation
  has no additional MCP servers, write "No additional MCP servers beyond
  the framework defaults."
- **Workflow Preferences** — org-wide workflow conventions not already
  captured in `config/ORGANIZATION.md` or team/expertise files. If all
  conventions are already captured elsewhere, write "No additional workflow
  preferences beyond what is described in AGENTS.md."

Remove all placeholder comments before committing.

```bash
git add config/TOOLS.md
git commit -m "chore: initialise config/TOOLS.md for <YOUR-ORG>"
```

## Step 5 — Run the build pipeline

Run the build script to compile all artifact sources into CLI-specific outputs.

```bash
bash scripts/build-components.sh
```

**Expected outcome:** The script exits zero and populates the following
output directories:

```text
.claude/skills/        Claude Code skills
.claude/agents/        Claude Code agents
.gemini/skills/        Gemini CLI skills
.gemini/agents/        Gemini CLI agents
.github/skills/        GitHub Copilot CLI skills
.github/agents/        GitHub Copilot CLI agents
```

**Most-likely error — missing `crewrig.config.toml` or literal placeholders:**
If `crewrig.config.toml` is absent or still contains the literal placeholder
strings `<YOUR-ORG>` / `<YOUR-REPO>`, the script will warn that placeholders
have been left unreplaced and may exit non-zero. Resolution: complete Step 2
before running the build.

The organisation may also author or override components in
`artifacts/community/` and `artifacts/organisation/` — these directories
are the designated sandbox for org-specific skills, agents, commands, hooks,
policies, MCP server configurations, and themes. The build script compiles
those alongside the upstream components. The guide does not cover how to
author new components; see `artifacts/FORMAT.md` for the unified-source
specification.

## Step 6 — Deploy to CLI rules directories

Deploy the built outputs to the user-home CLI rules directories by running
the interactive setup script for each active CLI. These scripts are
interactive: they will prompt for copy vs. symlink mode and confirm before
modifying user-home directories.

### Claude Code

```bash
bash scripts/setup-claude-interactive.sh
```

Deploys to `~/.claude/rules/`. Each context file is installed with its
numeric prefix (e.g., `00-soul.md`, `20-organization.md`) so Claude Code
loads them in priority order.

### Gemini CLI

```bash
bash scripts/setup-gemini-interactive.sh
```

Deploys to `~/.gemini/` directly — there is no `rules/` subdirectory for
Gemini CLI. Files land with numeric prefixes (e.g., `00_SOUL.md`,
`20_ORGANIZATION.md`) in the `~/.gemini/` directory itself. This differs
from Claude Code's `~/.claude/rules/` layout; the setup script handles the
difference automatically.

### GitHub Copilot CLI

```bash
bash scripts/setup-copilot-interactive.sh
```

Deploys to `~/.copilot/instructions/` as `*.instructions.md` files
(e.g., `00-soul.instructions.md`, `20-organization.instructions.md`).
This naming convention is specific to GitHub Copilot CLI and differs from
both Claude Code (plain `.md` files in `~/.claude/rules/`) and Gemini CLI
(numeric-prefix `.md` files in `~/.gemini/`). The setup script handles the
naming automatically.

### Symlink vs. copy mode

Each setup script will ask whether to copy or symlink the files. The default
and recommended mode is **copy**: files are physically deployed to the target
directory and are immune to changes on the source branch. Symlink mode is
available for development workflows where live edits to the repository should
be reflected immediately in the CLI, but it comes with a security disclaimer:
a malicious branch swap would alter the CLI context without an explicit
re-run.

## Step 7 — Sync from upstream

After the organisation's fork is in use, pull future upstream core-layer
changes without touching overlay content.

```bash
bash scripts/sync-from-upstream.sh
```

**Expected outcome:** The script exits zero, updates the core-layer paths
listed in `.crewrig/core-paths.txt` from the `upstream` remote's `main`
branch, and leaves all overlay paths (including `config/ORGANIZATION.md`,
`config/TOOLS.md`, `crewrig.config.toml`, and `artifacts/community/`)
untouched.

**Most-likely error — dirty-core guard:** If at least one core-layer path
has been locally modified, the script will list the offending paths and
exit 1 with a message similar to:

```text
error: the following core-layer paths have local modifications:
  config/SOUL.md
  artifacts/core/skills/developer/SKILL.md
Revert them or promote them to overlay overrides before syncing.
```

Resolution: see [Troubleshooting — dirty-core refusal](#dirty-core-refusal) below.

## Troubleshooting

### `crewrig.config.toml` absent or has empty values

**Cause:** `crewrig.config.toml` does not exist in the repository root, or
the `canonical_repo` / `feedback_repo` fields still contain the literal
placeholder strings `https://github.com/<YOUR-ORG>/<YOUR-REPO>` (or are
empty strings).

**Effect:** `bash scripts/build-components.sh` may warn that substitution
placeholders were left literal and produced unreplaced strings in the built
outputs. The harness curator will open friction issues against the placeholder
URL, which resolves to nothing.

**Resolution:** Follow Step 2. Copy `crewrig.config.toml.template` to
`crewrig.config.toml`, replace both placeholder values with the
organisation's actual GitHub repository URLs, and commit the file before
re-running the build.

### Build exits non-zero due to missing source directory

**Cause:** A source directory expected by `scripts/build-components.sh` is
absent. Common causes: an incomplete migration from a pre-spec-0014 branch,
a branch that predates the `artifacts/` directory restructuring, or a
partially applied upstream sync that left a directory missing.

**Effect:** The script exits non-zero with a message such as:

```text
error: source directory not found: artifacts/core/skills/
```

**Resolution:** Verify that the repository tree matches the current `main`
branch. Run `git status` and `git diff origin/main` to identify missing
files. If the branch predates spec 0014, rebase it onto `main` or re-apply
the migration steps described in `specs/0014-*.md`. After restoring the
missing directories, re-run `bash scripts/build-components.sh`.

### Dirty-core refusal during sync {#dirty-core-refusal}

**Cause:** At least one path listed in `.crewrig/core-paths.txt` has been
locally modified. The sync script enforces a dirty-core guard to prevent
upstream changes from silently overwriting local modifications to core-layer
files.

**Effect:** `bash scripts/sync-from-upstream.sh` exits 1 and lists the
offending paths.

**Resolution:** Choose one of two paths for each offending file:

1. **Revert the modification** — if the change was experimental or
   unintended, restore the file to its committed state:

   ```bash
   git checkout -- <path/to/core-file>
   ```

   Then re-run `bash scripts/sync-from-upstream.sh`.

2. **Promote to an overlay override** — if the change is intentional and
   must survive future upstream syncs, move it to the corresponding
   overlay directory (`artifacts/community/` or `artifacts/organisation/`)
   so the sync does not touch it. Commit the override, then re-run the
   sync. The `.crewrig/core-paths.txt` manifest lists exactly which paths
   are considered core; files outside that list are overlay and are always
   left untouched by the sync.
