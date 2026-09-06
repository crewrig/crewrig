# Adoption Guide

<!-- crewrig-doc: section=adoption nav_order=10 published=true title="Adoption guide" -->

This guide walks an organization through forking CrewRig, initializing the
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
- **Write access to a Git repository** — the organization's copy of
  CrewRig, hosted on any Git platform (GitHub, GitLab, Gitea, or a
  self-hosted instance). The repository may be public or private and
  will serve as the overlay configuration home for the organization.
- **The target CLI tools installed** — Gemini CLI, Claude Code,
  GitHub Copilot CLI, and/or Antigravity CLI, whichever CLIs the
  organization uses. The guide does not cover installing those tools;
  treat them as installed before proceeding.

## Step 1 — Set up the organization repository

Create a repository on any Git hosting platform (GitHub, GitLab, Gitea,
Bitbucket, or a self-hosted instance) to serve as the organization's overlay
configuration home. The repository may be public or private.

1. Clone the upstream CrewRig repository and push it to the organization's Git
   host. On GitHub you may use the **Fork** button as a shortcut; on any other
   host, or when you want a private repository, clone and re-push manually:

   ```bash
   git clone https://github.com/crewrig/crewrig.git <YOUR-REPO>
   cd <YOUR-REPO>
   git remote rename origin upstream
   git remote add origin <YOUR-GIT-HOST>/<YOUR-ORG>/<YOUR-REPO>.git
   git push -u origin main
   ```

   > **Note — release automation stays inert on your fork.** The release
   > workflow (`.github/workflows/release-monorepo.yml` — the sole release
   > path; the second, tag-triggered `.github/workflows/release-extension.yml`
   > is removed, spec 0183 R23) is reserved for the canonical
   > `crewrig/crewrig` repository. On your fork, pushing to `main` is
   > expected to leave it inert — no release run, no red run on the Actions
   > tab. If you see one fail instead, see
   > [Release workflow fails with "Could not resolve to an issue or pull
   > request"](#release-workflow-inert-on-fork) in Troubleshooting.

   If you used the GitHub Fork button, clone your fork and skip the push above:

   ```bash
   git clone git@github.com:<YOUR-ORG>/<YOUR-REPO>.git
   cd <YOUR-REPO>
   git remote add upstream https://github.com/crewrig/crewrig.git
   ```

2. Verify that both remotes are present:

   ```bash
   git remote -v
   # origin   <YOUR-GIT-HOST>/<YOUR-ORG>/<YOUR-REPO>.git (fetch)
   # upstream https://github.com/crewrig/crewrig.git (fetch)
   ```

The sync script (`bash scripts/sync-from-upstream.sh`, Step 7) reads the
upstream URL directly from `crewrig.config.toml → canonical_repo` — it does
not rely on a named git remote. The `upstream` remote shown above is optional;
retain it only if you want to run manual git operations such as `git log
upstream/main`. Upstream changes flow in via the sync script; the
organization's overlay content lives on top and is never touched by the sync.

## Step 2 — Initialize the overlay configuration

Copy the configuration template and replace the placeholder values with the
organization's own repository URLs.

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
  license trace remain intact. Override this only if the organization's
  fork is itself the canonical upstream for a downstream deployment.
- `feedback_repo` — set to the URL of the organization's own repository
  (on any Git hosting platform — GitHub, GitLab, Gitea, etc.) so that
  friction issues opened by the harness curator land on the organization's
  tracker, not on the upstream project.

> **`feedback_repo` governs adopter-owned tiers only.** It redirects
> feedback for the components *your* fork authors (`artifacts/community`,
> `artifacts/org`, `extensions/org`). It has **no effect** on upstream-owned
> components (`artifacts/core`, `artifacts/library`, `extensions/core`,
> `extensions/library`): frictions on those always route to `canonical_repo`,
> so overriding `feedback_repo` does **not** capture feedback on components you
> did not author — that feedback keeps flowing upstream where the components are
> maintained. This is by design (spec 0030) and enforced by
> `scripts/check-feedback-routing.sh`. See
> [`artifacts/FORMAT.md`](../artifacts/FORMAT.md) → *Provenance & Forks*.

Commit the file:

```bash
git add crewrig.config.toml
git commit -m "⚙️ Initialise crewrig.config.toml for <YOUR-ORG>"
```

## Step 3 — Initialize the organization identity

Copy the organization identity template and populate its sections.

```bash
cp config/ORGANIZATION.md.template config/ORGANIZATION.md
```

Open `config/ORGANIZATION.md` and fill in each section. The template
provides guidance comments inside each section. At minimum, complete:

- **Identity** — a 2–4 sentence description of the organization, its scale,
  and its mission.
- **Values and Principles** — 3–6 core engineering values that guide
  trade-off decisions.
- **Objectives** — the organization's current strategic engineering
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
before committing. This file is overlay — owned by the organization — and
will not be overwritten by upstream syncs.

```bash
git add config/ORGANIZATION.md
git commit -m "⚙️ Initialise config/ORGANIZATION.md for <YOUR-ORG>"
```

## Step 4 — Initialize the tool configuration

Copy the tool configuration template and fill in the organization-specific
sections.

```bash
cp config/TOOLS.md.template config/TOOLS.md
```

Open `config/TOOLS.md`. This file layers organization-specific settings
on top of the framework defaults (three-tier memory architecture, MemPalace
protocol, harness loop, Sequential Thinking) that the upstream framework
ships via the core rules file deployed at priority 60. Do **not** duplicate
framework content; use this file only for:

- **Tooling Preferences** — editors, terminal setup, communication
  platforms, and any org-wide CLI tools that are always available.
- **MCP Server Declarations** — MCP servers specific to the organization's
  integrations (Jira, Confluence, Slack, internal APIs). Framework MCP
  servers (MemPalace, SequentialThinking, GitHub) are already covered by
  the core rules file — do not redeclare them here. If the organization
  has no additional MCP servers, write "No additional MCP servers beyond
  the framework defaults."
- **Workflow Preferences** — org-wide workflow conventions not already
  captured in `config/ORGANIZATION.md` or team/expertise files. If all
  conventions are already captured elsewhere, write "No additional workflow
  preferences beyond what is described in AGENTS.md."

Remove all placeholder comments before committing.

```bash
git add config/TOOLS.md
git commit -m "⚙️ Initialise config/TOOLS.md for <YOUR-ORG>"
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
.agents/skills/        Antigravity CLI skills
.agents/agents/        Antigravity CLI agents
```

Commit the built outputs so the repository always contains up-to-date CLI
component files and the next collaborator does not need to re-run the build
from scratch:

```bash
git add .claude/skills .claude/agents \
        .gemini/skills .gemini/agents \
        .github/skills .github/agents \
        .agents/skills .agents/agents
git commit -m "⚙️ Build CLI components for <YOUR-ORG>"
```

**Most-likely symptom — unreplaced placeholders in built outputs:**
If `crewrig.config.toml` is absent or still contains the literal placeholder
strings `<YOUR-ORG>` / `<YOUR-REPO>`, the script exits zero but the built
outputs will contain unreplaced placeholder values (e.g. skills referencing
`https://github.com/<YOUR-ORG>/<YOUR-REPO>` literally). When config is absent
the script warns on stderr; when config contains placeholder values no warning
is emitted. Resolution: complete Step 2 before running the build.

The organization may also author or override components in
`artifacts/community/` and `artifacts/org/` — these directories
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

### Antigravity CLI

```bash
bash scripts/setup-antigravity-interactive.sh
```

Deploys context to `~/.gemini/config/AGENTS.md` and MCP server configurations
to `~/.gemini/config/mcp_config.json`. The setup script concatenates the
numbered-priority context files into a single `AGENTS.md` file and registers
the configured MCP servers automatically. Requires the `agy` binary on your
PATH.

### Symlink vs. copy mode

Each setup script will ask whether to copy or symlink the files. The default
and recommended mode is **copy**: files are physically deployed to the target
directory and are immune to changes on the source branch. Symlink mode is
available for development workflows where live edits to the repository should
be reflected immediately in the CLI, but it comes with a security disclaimer:
a malicious branch swap would alter the CLI context without an explicit
re-run.

## Step 7 — Sync from upstream

After the organization's fork is in use, pull future upstream core-layer
changes without touching overlay content.

```bash
bash scripts/sync-from-upstream.sh
```

**Expected outcome:** The script exits zero, updates the core-layer paths
listed in `.crewrig/core-paths.txt` from the URL set in
`crewrig.config.toml → canonical_repo`, and leaves all overlay paths
(including `config/ORGANIZATION.md`,
`config/TOOLS.md`, `crewrig.config.toml`, and `artifacts/community/`)
untouched.

**Most-likely error — dirty-core guard:** If at least one core-layer file
has been locally modified, the script will list the offending **files** — never
the directory containing them — and exit 1 with a message similar to:

```text
Error: the following core-layer paths have local modifications:
  scripts/sync-from-upstream.sh
  artifacts/core/skills/developer/SKILL.md
Revert these changes before running sync, or promote them to overlay overrides.

Restore ONLY the files listed above, one path at a time:
  git checkout <your-ref> -- <path listed above>
Never restore the containing directory. A directory-level checkout also
reverts every file upstream added or changed in it, silently.
```

Both example paths are *members* of directory entries in
`.crewrig/core-paths.txt` (`scripts` and `artifacts/core`). The guard names the
member rather than the entry precisely so that the restoration below can be
targeted: told `scripts`, an adopter restores `scripts`.

Resolution: see [Troubleshooting — dirty-core refusal](#dirty-core-refusal) below.

### `--preserve-history` (spec 0086)

By default the sync above neither stages nor commits anything — it is always
your call what to do with the updated working tree. Pass `--preserve-history`
when you additionally want the specific upstream commit that was fetched to
become a real ancestor of your current branch, so `git log`, `git merge-base`,
and `git bisect` surface the upstream lineage directly instead of losing it to
a plain file restore.

```bash
bash scripts/sync-from-upstream.sh --preserve-history
```

This flag is opt-in and per-invocation only — it is never enabled implicitly
by `crewrig.config.toml`, an environment variable, or any other mechanism.

**Expected outcome:** The script performs the same policy-aware restore as an
ordinary sync (file content is byte-identical either way), then creates a
single additional commit on your current branch whose second parent is the
fetched `FETCH_HEAD` commit. If `FETCH_HEAD` is already an ancestor of your
branch tip (e.g. you already ran `--preserve-history` since upstream last
advanced), the flag is a no-op: no commit is created and the script exits
zero.

**Most-likely error — shallow-clone refusal:** `--preserve-history` requires a
full clone; a shallow clone cannot safely host the two-parent commit's
ancestry claims. The script exits 1 before doing anything else:

```text
Error: --preserve-history requires a full (non-shallow) clone.
Remove the shallow limitation (e.g. 'git fetch --unshallow') or omit --preserve-history.
```

Resolution: run `git fetch --unshallow` (or re-clone without `--depth`), or
drop the flag and run an ordinary sync.

**Most-likely error — unrelated uncommitted change:** The provenance commit
refuses to sweep in changes outside the paths governed by
`.crewrig/core-paths.txt` and `.crewrig/.synced-markers/`. Governed means
every `strict`, `adopt-on-edit`, or `regenerable` manifest entry, minus any
`excluded` entry nested under it — `excluded` entries themselves (org paths
such as `specs/org`, `docs/org`, `AGENTS.org.md`, and the org-owned
`model-mappings/*.org.yml` override channel) are never part of this governed
set, so an unrelated edit under one of them still aborts the graft commit
exactly like any other unrelated change. The restore still
runs and its output stays in your working tree, but the script exits 1
without committing:

```text
Error: --preserve-history refuses to commit — uncommitted change(s) outside the governed paths:
  notes/scratch.md
Commit, stash, or revert these changes (outside .crewrig/core-paths.txt and .crewrig/.synced-markers/), or omit --preserve-history.
```

Resolution: commit, stash, or revert the listed path(s), then re-run
`--preserve-history`.

### Example catalogs — adopt-on-edit (spec 0021)

`config/expertise/`, `config/teams/`, and `config/level/` carry the
**adopt-on-edit** sync policy at directory granularity. The sync reconciles
each directory member-by-member, so the catalogs stay current by default
while remaining yours to shape:

- **Untouched files keep updating.** A role, team, or level file you have not
  modified is refreshed from upstream on each sync.
- **New examples arrive automatically.** When upstream publishes a new
  example (e.g. a new role under `config/expertise/`), the sync adds it —
  provided that path has never existed in your clone's history.
- **Customizing a file freezes it.** The moment you edit one of these files
  (committed or in the working tree), that single path is preserved
  permanently and never overwritten by a later sync.
- **Deleting a file keeps it deleted.** If you `git rm` and commit a file you
  do not want, the sync honors your decision and will not re-create it —
  even if upstream later changes the upstream copy.
- **You may add your own files.** Create new role and team files with the
  guided `init-expertise` and `init-team` skills (run `/init-expertise` or
  `/init-team`). A file you author has no upstream counterpart, so it is
  yours from the start and never touched by the sync. The guided flow refuses
  to silently overwrite an existing file of the same name.

> **Note — full clone required.** The add/delete reconciliation reads your
> clone's git history (`git rev-list HEAD`) to tell "you deleted this" from
> "this never existed here". On a **shallow** clone that history is truncated,
> so the sync refuses to reconcile these directories (it warns and leaves them
> untouched rather than risk re-adding a file you deleted). Run the sync from a
> full, non-shallow clone.

## Migrating an extension off the retired declaration shape (spec 0183)

**If you own no extension in this repository or in a fork of it, this
section does not apply to you** — skip to *Troubleshooting* below. For the
current extension authoring model, see
[Extension authoring](extension-authoring.md).

Spec 0183 retires, with no compatibility window, the legacy
`components.<subject>.enabled` declaration shape and five per-CLI keys
(`claude.skills`, `claude.agents`, `claude.rules`, `copilot.pluginName`,
`antigravity.pluginName`). This is a clean break, not a deprecation: every
entry point that reads an extension manifest (the three plugin builders,
the Claude install script, the manifest-version guard, and the render
itself) fails loudly on a manifest declaring the retired shape — there is
no dual-shape read and no fallback through a tool-specific manifest.

**What breaks.** An extension whose `extension.json` still declares
`components.<subject>.enabled`, or any of the five retired per-CLI keys,
stops building, installing, and passing `bash scripts/build-extension.sh
--check` from the moment this change lands. The failure names the retired
form it found and points here.

**What converts it.** Run:

```sh
task migrate-extension EXT=<your-extension-name>
```

(equivalently, `bash scripts/migrate-extension.sh <path-or-name>`). The
tool converts an enabled `components.<subject>` entry into the equivalent
generic top-level `<subject>` section, drops a disabled entry with nothing
added, deletes the `components` object outright, drops the five retired
per-CLI keys along with any per-CLI section they leave empty, and
de-commits any committed generated-output-class file the source tree still
carries. It works on a temporary copy and replaces your extension's tree
only on full success; a tree it cannot fully convert is left untouched and
the failure names what it could not convert. A tree already in the current
shape is reported as already migrated, and the tool writes nothing.

**When the break lands.** This repository carries no framework version
stream — there are no framework tags, no `VERSION` file, and the root
`package.json` version has never moved since the initial commit — so the
sync boundary an adopter running `scripts/sync-from-upstream.sh` should use
is the change itself, not a framework version number: **2026-08-25, spec
0183, the implementation pull request for issue #1008** (crewrig/crewrig).
For anyone consuming the reference extension (`extensions/core/hello-world`)
rather than the framework directly, its published artifact form changes
starting with the first `hello-world` major release published after this
change — check that release's own asset for confirmation rather than
assuming a specific version number here.

## Troubleshooting

### `crewrig.config.toml` absent or has empty values

**Cause:** `crewrig.config.toml` does not exist in the repository root, or
the `canonical_repo` / `feedback_repo` fields still contain the literal
placeholder strings `https://github.com/<YOUR-ORG>/<YOUR-REPO>` (or are
empty strings).

**Effect — `bash scripts/build-components.sh`:** Exits zero in both cases.
When config is absent, the script warns on stderr that placeholders will be
left literal. When config contains the placeholder URL, the script passes
validation silently and emits no warning. In both cases the built outputs
contain unreplaced values (skills and agents reference the placeholder URL
literally). The harness curator will open friction issues against the
placeholder URL, which resolves to nothing.

**Effect — `bash scripts/sync-from-upstream.sh`:** Exits 1 and prints
an error when `canonical_repo` is absent or empty:

```text
Error: canonical_repo is not set in crewrig.config.toml
Set canonical_repo to the upstream repository URL before running sync.
```

**Resolution:** Follow Step 2. Copy `crewrig.config.toml.template` to
`crewrig.config.toml`, replace both placeholder values with the
organization's actual Git repository URLs, and commit the file before
re-running either script.

### Build output directories are empty or partially populated

**Cause:** A source directory expected by `scripts/build-components.sh` is
absent. Common causes: an incomplete migration from a pre-spec-0014 branch,
a branch that predates the `artifacts/` directory restructuring, or a
partially applied upstream sync that left a directory missing.

**Effect:** The script exits zero but the output directories (`.claude/skills/`,
`.gemini/skills/`, etc.) are empty or partially populated. Missing source
directories are silently skipped — no error message is emitted.

**Resolution:** Verify that the repository tree matches the current `main`
branch. Run `git status` and `git diff origin/main` to identify missing
files. If the branch predates spec 0014, rebase it onto `main` or re-apply
the migration steps described in `specs/0014-*.md`. After restoring the
missing directories, re-run `bash scripts/build-components.sh`.

### Dirty-core refusal during sync {#dirty-core-refusal}

**Cause:** At least one **file** governed by `.crewrig/core-paths.txt` has been
locally modified — either because it is listed there itself, or because it sits
inside a directory that is. The sync script enforces a dirty-core guard to
prevent upstream changes from silently overwriting local modifications to
core-layer files.

**Effect:** `bash scripts/sync-from-upstream.sh` exits 1 and lists the
offending **files**, each at its full path. A directory listed in the manifest
is never itself reported: what you see is what you modified.

**Resolution:** Choose one of two paths for each offending file:

1. **Revert the modification** — if the change was experimental or
   unintended, restore that file, and only that file, to its committed state:

   ```bash
   git checkout -- <path/to/core-file>
   ```

   **Restore file by file, never the containing directory.** A directory-level
   checkout — `git checkout -- scripts` — also reverts every file upstream
   added or changed inside it, with no message and no error. That is how an
   adopter loses a new upstream guard and discovers it later through unrelated
   test failures; it is why the guard lists files rather than directories.

   Then re-run `bash scripts/sync-from-upstream.sh`.

2. **Promote to an overlay override** — if the change is intentional and
   must survive future upstream syncs, move it to the corresponding
   overlay directory (`artifacts/community/` or `artifacts/org/`)
   so the sync does not touch it. Commit the override, then re-run the
   sync. The `.crewrig/core-paths.txt` manifest lists exactly which paths
   are considered core; files outside that list are overlay and are always
   left untouched by the sync.

### Release workflow fails with "Could not resolve to an issue or pull request" {#release-workflow-inert-on-fork}

**Cause:** The fork synced from an upstream commit predating this ticket's
canonical-repository guard, so its `release-monorepo.yml` still lacks the
`if: github.repository == 'crewrig/crewrig'` condition. A fork synced from
an even older commit may also still carry `release-extension.yml` — removed
upstream (spec 0183 R23: it published a non-conforming, source-only
archive) — which never carried the guard at all.

**Effect:** "Analyze & Release (Monorepo)" (or, on a stale fork,
"Release Extension") fails with the quoted symptom — a red run on the
fork's Actions tab, caused by the release tooling resolving a pull-request
or issue reference that belongs to the upstream `crewrig/crewrig`
repository, not the fork.

**Resolution:** Choose one of two paths:

1. **Sync to pick up the fix** — run `bash scripts/sync-from-upstream.sh`
   to pull in the canonical-repository guard and, on a stale fork, the
   removal of `release-extension.yml`; commit the result, and push. The
   next push leaves the workflow inert on the fork instead of failing.
2. **Disable the workflow pre-emptively** — if release automation is never
   wanted on this fork, disable `release-monorepo.yml` (and, on a
   not-yet-synced fork, `release-extension.yml`) from the fork's Actions
   tab, or remove or override the workflow file, before the next
   triggering push.
