# Extension Development Guide

This document covers the full lifecycle of creating, developing, testing,
and releasing extensions in this monorepo. Extensions work with all four
supported command-line tools — **Gemini CLI**, **Claude Code**, **GitHub
Copilot CLI**, and **Antigravity CLI** — from a single `extension.json`
manifest: Gemini CLI loads the rendered tree in place, and the other three
each build a plugin from it. See
[Extension authoring](docs/extension-authoring.md) for the authoring model
and
[`extension-skeleton/EXTENSION-FORMAT.md`](extension-skeleton/EXTENSION-FORMAT.md)
for the complete manifest specification.

## Creating a New Extension

Always use the scaffolding task. It runs the Node.js floor guard, then
`node scripts/create-extension.ts` (the scaffolder is TypeScript since spec
0258; `scripts/create-extension.ts` remains as a forwarding shim):

```bash
task create-extension NAME=my-extension
# non-interactive: name the components yourself
task create-extension NAME=my-extension -- --components mcp-server,skill
```

No `fzf` is needed. On a terminal the scaffolder prints a numbered list and
reads the components you want (numbers or names, separated by commas or
spaces); with `--components <list>` or `CREWRIG_TEST_FZF_SELECTION` (one
component per line) it asks nothing:

- **mcp-server** — TypeScript MCP server with stdio transport
- **command** — Sample `.toml` slash command
- **skill** — Sample `SKILL.md` agent skill
- **agent** — Sub-agent prompt definition
- **hook** — Lifecycle hook (BeforeTool/AfterTool)
- **theme** — UI theme JSON fragment

The scaffolder will:

1. Copy the base skeleton into `extensions/org/my-extension/`.
2. Inject selected component directories.
3. Merge each selected component's JSON fragment into the manifest by
   presence — every component now works this way (spec 0183 R1), not only
   `mcp-server`/`theme`.
4. Replace every `${SKELETON_NAME}` placeholder in every text-carrying
   file (a NUL-byte predicate, not a content-type heuristic — spec 0183 R3)
   and assert, unconditionally, that none survives in the produced tree.
5. Render the scaffolded tree once to derive its `accepted-gaps.json` from
   the render's own observed gap set (spec 0183 R2) — a scaffold whose
   declarations all map on every target gets no gap file at all.

### Skeleton Structure

The `extension-skeleton/` directory contains the template source. No file
here is named for a specific command-line tool (spec 0183 R9 — enforced by
`node scripts/build-extension.ts --check` over this directory, not only
over extension source trees; run `node scripts/lib/node-floor-guard.js` first, as a
separate command, since the builders need Node.js 24 or later and `js-yaml` comes
from the setup dependency step):

```text
extension-skeleton/
├── base/                                  # Always copied
│   ├── extension.json                     # Unified manifest (all tools; the ONLY manifest — gemini-extension.json is a build output, never committed, spec 0173 delta-01). Declares no subject: a base-only scaffold is a valid extension (spec 0183 R1).
│   ├── CONTEXT.md                         # Agent-facing context source, rendered per target (spec 0181)
│   ├── package.json                       # npm package with MCP SDK dependency
│   ├── tsconfig.json                      # TypeScript ES2022 / Node16
│   ├── README.md                          # Documentation, naming only the files the produced tree actually contains (spec 0183 R5)
│   └── .gitignore                         # node_modules, dist, .env
├── mcp-server/                            # MCP server component
│   ├── src/index.ts                       # Stdio MCP server with sample tool
│   └── mcp-server.json.fragment           # Merged into the manifest's mcpServers field on creation
├── command/
│   ├── commands/sample.md                 # Sample slash command (pivot source; the rendered .toml is a build output, never committed)
│   └── command.json.fragment              # Merged into the manifest's commands field on creation
├── skill/
│   ├── skills/sample-skill/SKILL.md       # Sample agent skill
│   └── skill.json.fragment                # Merged into the manifest's skills field on creation
├── agent/
│   ├── agents/sample-agent/AGENT.md       # Sample sub-agent prompt, Claude Code / Copilot CLI / Antigravity CLI pivot source
│   ├── agents/sample-agent/PROMPT.md      # Same sub-agent, Gemini CLI pivot source (sibling files by design — see EXTENSION-FORMAT.md)
│   └── agent.json.fragment                # Merged into the manifest's agents field on creation
├── hook/
│   ├── hooks/logger.ts                    # Sample PreToolUse hook script (the maps-everywhere event — spec 0179)
│   └── hooks.json.fragment                # Merged into the manifest's hooks field on creation
└── theme/theme.json.fragment              # Merged into the manifest's gemini.themes field on creation
```

Every occurrence of `${SKELETON_NAME}` in these files is replaced with your
extension name during scaffolding.

### After Scaffolding

```bash
cd extensions/org/my-extension
npm install
```

## Development Workflow

### Link Mode

During development, use symlinks so changes take effect immediately
without reinstalling:

**Gemini CLI:**

```bash
task link-extensions
```

Start a Gemini session and your extension is loaded. Edit source files,
rebuild with `npm run build`, and restart Gemini to pick up changes.

**Claude Code:**

```bash
task build-claude-plugin EXT=my-extension
claude --plugin-dir extensions/org/my-extension/dist-claude-plugin/my-extension
```

The `--plugin-dir` flag loads the plugin directly for development.
Run `/reload-plugins` after changes to pick up updates without
restarting.

### Testing Locally

```bash
# Build the extension
cd extensions/org/my-extension
npm run build

# Verify the MCP server starts
node dist/index.js
# (Ctrl+C to stop — it runs on stdio)
```

### Plugin Build Contract

`scripts/build-claude-plugin.ts` (behind the forwarding shim `build-claude-plugin.ts`) propagates `dist/` and `package.json` into the plugin output directory because the declared MCP command typically points inside it (`${extensionRoot}/dist/index.js` — the one neutral path token, spec 0180), and Node requires both to load an ESM MCP server at runtime. The generated `.mcp.json` carries `${CLAUDE_PLUGIN_ROOT}` (the neutral token rewritten to Claude's own spelling), which Claude Code itself resolves when it LOADS the installed plugin — not a render-time (build-time) resolution baked into the file (spec 0180 R8).

Implications for contributors:

- `dist/` must be rebuildable from source via `npm run build` (`tsconfig.json` and `src/` must be committed; `dist/` is in `.gitignore`)
- `package.json` must declare `"type": "module"` for ESM resolution (confirmed: this is the value in `extension-skeleton/base/package.json`)
- Do not commit `dist/` inside the extension directory; the build script regenerates it

Rebuild reminder:

```bash
cd extensions/org/my-extension
npm run build
task build-claude-plugin EXT=my-extension
```

## Installing a Claude Code Plugin

Claude Code does not auto-discover plugins placed under `~/.claude/plugins/`. Plugins must be declared in a marketplace and installed via the CLI before Claude Code can load them.

`scripts/install-claude-plugin.ts` handles this in four steps:

1. Calls the Claude plugin builder (`scripts/build-claude-plugin.ts`, through the shim `build-claude-plugin.ts`) → produces `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/<name>/` (a shared home outside the working tree, so multiple extensions coexist and installs survive branch switches)
2. Generates `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/.claude-plugin/marketplace.json` with a marketplace named `<repo-basename>-local` (e.g. `crewrig-local`). This is a SHARED manifest: each installed extension is upserted by name, so it accumulates every extension installed under that config root
3. Runs `claude plugin marketplace add ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace --scope user`
4. Runs `claude plugin install <name>@<marketplace-name> --scope user`

Install via the task wrapper:

```bash
task install-claude-plugin EXT=my-extension
```

Verify the installation:

```bash
claude plugin list
```

Running `/<skill-name>` inside a Claude Code session also confirms that a skill from the plugin is accessible.

For iterative development, prefer the `--plugin-dir` flag documented in the [Link Mode](#link-mode) section — it skips the marketplace step.

## Taskfile layout

Task 3.54 or later is required: the root includes the domain files with the
`flatten:` option, so CI and local runs share one Task version. Every Taskfile declares
`version: '3.54'`, so an older Task fails loudly (`Schema version (3.54.0) is
greater than the current version of Task`) instead of silently renaming the
flattened tasks (spec 0278).

The root `Taskfile.yml` holds only the `default` task, the global vars and the
`includes`. Every other task lives in one domain file under `taskfiles/`, split
by area and never by CLI so the four CLIs stay side by side:

| File | Holds |
|---|---|
| `setup.yml` | `setup-<cli>-interactive`, `install-mempalace`, `install-deps`, `import-*-history`, Playwright MCP setup |
| `mempalace.yml` | `mempalace:*` daemon lifecycle and diagnostics |
| `usage.yml` | `usage:*` usage-ledger tasks and dashboard |
| `extensions.yml` | `install-*`, `link-*`, `unlink-*`, packaging, extension scaffolding and plugin builds |
| `components.yml` | `build-components*`, `check-components`, `test-components` |
| `lint.yml` | markdown and TypeScript lint, typecheck, format, ratchet, host safety |
| `spec.yml` | `spec:*` spec lint, status derivation and viewer |
| `governance.yml` | `check-*` governance checks, `skill:check`, `ticket-pickup` |
| `tests.yml` | runtime-foundations, ticket-pickup and spec test suites, `timing-budget` |
| `harness.yml` | `harness-curate`, `test-harness-curate`, `prune-transcripts` |
| `e2e.yml` | `e2e:*` Docker images, auth flow and runner |
| `cli-matrix.yml` | `cli-matrix:*` build, check and row viewer |
| `ci.yml` | `ci:pre-push` and `ci:hooks-*` (spec 0279), plus the includes of the `ci/` group files |
| `ci/<group>.yml` | the `ci:<id>` tasks, one per CI capability, split by stage group: `gate`, `modules`, `governance`, `extensions`, `integration`, `windows`, `windows-b` (spec 0278 delta-01) |

Prefixed groups (`mempalace:`, `usage:`, `e2e:`, `spec:`, `cli-matrix:`) are
include namespaces; every other file is flattened, so its tasks keep their
unprefixed global names.

**Adding a task.** Put it in the domain file that matches its area. A new file
must be added to the root `includes` (flattened unless it is a namespace) and
declare `version: '3.54'`. A new `ci:<id>` task goes in the `taskfiles/ci/<group>.yml`
file of its stage group, each file staying within 200 lines; a new group file is
included from `taskfiles/ci.yml` as `{ taskfile: ./ci/<group>.yml, flatten: true, dir: .. }`.
The `dir: ..` is mandatory there (without it the group's tasks would run from
`taskfiles/`) and is the only `dir:` the guard accepts; never write `dir:` in a
`ci/` file or on a task. Inside a `ci/` file an unanchored `- task: x` resolves to
`ci:x`, so call other files colon-anchored (`:lint-markdown`).

**Referencing tasks.**

- Inside a namespaced file, `deps:` entries and `- task:` calls are
  namespace-relative (`build:base`, not `e2e:build:base`); a leading `:`
  anchors at the root namespace (`:install-deps`).
- Inside a flattened file, use the full global name.
- A shell `task <name>` inside a `cmd:` text always uses the full global name.

**Working directory and variables.** Every task runs from the repository root,
including when `task` is started from a subdirectory. Build repository paths
with `{{.REPO_DIR}}`, never `{{.TASKFILE_DIR}}`: in an included file
`TASKFILE_DIR` is the `taskfiles/` directory. `REPO_DIR` derives from
`{{.PWD}}`, so run `task` from the repository directory, or set `PWD`
instead. A command-line override of a root var, such as
`task REPO_DIR=/x <task>`, only reaches root tasks, not tasks of included
files.

**Guard.** `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
scripts/check-taskfile-tree.ts` checks that every `taskfiles/*.yml` file is
included, the root holds only `default`, the version string is uniform, no
included file builds a repository path from `TASKFILE_DIR`, every `deps:` and
`- task:` reference resolves, and the loader sees the same names as
`task --list-all --json`. CI runs it; #1763 adds the matching Task entry,
`ci:check-taskfile-tree`.

## Pre-push guard

An opt-in native git hook runs the fast tier of the CI checks on your
changeset before `git push` sends it. It is off until you enable it, once per
clone, and it never replaces CI:

```sh
task ci:hooks-install     # local git config only: core.hooksPath = .githooks
task ci:hooks-status
task ci:hooks-uninstall
```

`git push --no-verify` skips it. It needs Node 24 and Task 3.54, and a
worktree needs `node_modules` (`task lint-bootstrap`). Selection, the 60 s
budget, worktrees and how to add a `ci:<id>` task:
[`docs/pre-push-guard.md`](docs/pre-push-guard.md).

## TypeScript toolchain and ratchet

New code is TypeScript, run directly from its `.ts` source by Node's
built-in type stripping (Node ≥ 24), with no build step. Spec 0238 adds
two blocking CI jobs, `ratchet` and `lint-typescript`, on both CI engines.
The Taskfile runs exactly the commands CI runs:

| Task | What it checks |
|---|---|
| `task ratchet` | shell / JavaScript / Python footprint ratchet (no `npm ci` needed) |
| `task lint-ts` | every TypeScript check below, in one run |
| `task typecheck-ts` | `tsc` strict type-check (`tsconfig.json`) |
| `task erasable-ts` | no `enum`, runtime `namespace`, parameter property, decorator or `import =` |
| `task oxlint-ts` | Oxlint type-aware: no `any`, no `@ts-ignore`/`@ts-nocheck`, justified `@ts-expect-error` only, no unsafe `any` flow; files over 300 lines warn without failing |
| `task format-ts` | Oxfmt check mode on `*.ts` and on the JavaScript admitted by `ci/js-exceptions.txt` |
| `task format-ts:fix` | rewrite every tracked `*.ts` with Oxfmt (local convenience) |

Run `task lint-bootstrap` once to install the toolchain. The four built
trees (`.claude/`, `.gemini/`, `.github/`, `.agents/`) are excluded from
every check.

**JavaScript formatting scope (spec 0266 R16).** `oxfmt --check` covers every
tracked `*.js`, `*.mjs` or `*.cjs` file listed in `ci/js-exceptions.txt` (today
the Node.js floor guard). The rule is: formatted unless the third-party tool
that consumes the file defines its own formatting; no admitted file is
excluded. The legacy files in `ci/js-baseline.txt` are not formatted, because
each leaves the tree when its migration row lands. After editing an admitted
file, run `node_modules/.bin/oxfmt --write <that file>` with the literal path.

**The ratchet.** `ci/shell-allowlist.txt` and `ci/js-baseline.txt` list the
shell and JavaScript files tracked when spec 0238 landed. They are
generated and can only shrink:

- Adding a shell script (`*.sh`, or any file with a `bash`/`sh` shebang)
  or a JavaScript file fails CI. Write TypeScript instead.
- When a PR migrates or deletes a listed file, delete its line in the same
  PR. A stale line fails CI. `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ratchet.ts --write`
  regenerates both lists and never adds an entry.
- A new JavaScript file is admitted only as the Node.js floor guard or as a
  configuration file a third-party tool requires in JavaScript. Add it to
  `ci/js-exceptions.txt` as `<path><TAB><node-floor-guard|tool-config> <NNNN> <reason>`,
  where `NNNN` is the spec that names and justifies the file.
- An added Python file must import the `mempalace` library.

**Why `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`.** The root
`package.json` has no `"type"` field, because most baseline JavaScript is
CommonJS. Node therefore detects each `.ts` entry point as ESM by syntax
and prints that warning. Every entry point passes the flag. For the same
reason `tsconfig.json` uses `module: preserve` with
`moduleResolution: bundler` rather than `nodenext`.

**Dependency notes.**

- The root pins `@types/node` `^24` while `extensions/core/hello-world`
  keeps `^22.15.0`. That is deliberate: the root `tsc` resolves the root
  copy, the workspace build its own. Do not "align" them in a Renovate PR.
- `extension-skeleton/mcp-server/src/index.ts` type-checks against
  `@modelcontextprotocol/sdk` only because the `hello-world` workspace's
  copy is hoisted. If that workspace drops the SDK, the skeleton stops
  type-checking.
- Oxfmt is pre-1.0 and pinned exactly. A Renovate PR that bumps it must run
  `task format-ts:fix` in the same PR.

## Node.js floor and production dependencies

Spec 0240 (sub-spec A2 of the shell-to-TypeScript migration) sets the
runtime foundations every migrated script builds on.

**Node.js floor.** CrewRig needs Node.js 24 or later.
`scripts/lib/node-floor-guard.js` checks it: below 24 it prints one line
naming the detected version, the floor and <https://nodejs.org/en/download>,
and exits 1; otherwise it exits 0 silently. It is plain ES5 CommonJS so it
runs on releases that cannot strip types, and it is the one JavaScript file
admitted through `ci/js-exceptions.txt` as `node-floor-guard`. The four
setup entries (`scripts/setup-<cli>-interactive.ts`, spec 0256) run on it: `task
setup-<cli>-interactive` runs the guard as a separate step,
then the entry, and fails closed below 24 before anything is written.

**Production dependencies.** The four `scripts/setup-*-interactive.ts`
entries (reached through their `.sh` shims) run
`npm ci --omit=dev --workspaces=false` right after the spec 0084 TLS offer,
with the CA variables of that offer in npm's environment. The step is gated on
the `package-lock.json` hash:

- It runs only when `package-lock.json` changed since the last successful
  run, or `node_modules/` is missing. Otherwise setup prints
  `Production dependencies: skipped — package-lock.json unchanged ...`.
- When it runs, `npm ci` **deletes `node_modules/`** first, so the dev
  toolchain is gone afterwards. Re-run `task lint-bootstrap` before
  `task lint-ts`.
- `task lint-bootstrap` does not invalidate the record, so the next setup
  run does not wipe the toolchain again.
- The record is `.crewrig-state/production-deps.sha256` (git-ignored, one
  per checkout or worktree). Delete it to force a re-install.
- On failure setup aborts with npm's own diagnostic and removes
  `node_modules/`, so no partial tree looks usable.

Load a production dependency through `loadDependency` in
`scripts/lib/require-dependency.ts`. A declared but missing package then
raises a "re-run setup" diagnostic instead of a raw module-resolution
error. That bar only covers callers of `loadDependency`: never import an
overlap package (installed only because a root `devDependencies` entry is
also a workspace dependency) statically.

**Shared modules (R11 layout).** A migrated script keeps its shell path
with `.sh` changed to `.ts`. A new shared module that replaces no single
script lives under `scripts/lib/`, is named after its concern, and stays
under 300 lines. Use the existing ones rather than re-deriving the logic:
`paths.ts` (join, real path, repository root), `line-endings.ts` (LF
normalisation), `tmp-file.ts` (owner-only temporary file, atomic publish)
and `require-dependency.ts`.

**Checks.** `task test-runtime-foundations` runs the CI suites.
`task timing-budget -- --runs <N> --budget-ms <M> -- <script>` times a
script the way the `windows-node-floor-guard` job does. The step fails when
more than `--tolerate <K>` runs exceed the budget (default 1 from 5 runs up, 0
below; `--tolerate 0` is strict), when any run exceeds 3 x the budget, or when an
exit status differs from `--expect-exit`; tolerated runs print with the label
`tolerated`. Recalibrate a budget from at least 5 green `windows-latest` runs as
`max(3 x S, 300 ms)` rounded up to the next 50 ms, where S is the largest
second-worst run, never above the carrier spec's cap (spec 0264).

## Branching Strategy

- Create a feature branch from `main`: `feat/my-extension`
- Open a Pull Request targeting `main`.
- Merging into `main` triggers the automated release pipeline.

## Versioning with Gitmoji

Semantic Release analyzes commit messages using Gitmoji to determine
version bumps automatically:

| Gitmoji | Meaning | Release |
|---------|---------|---------|
| `:boom:` | Breaking change | **MAJOR** |
| `:sparkles:` | New feature | **MINOR** |
| `:bug:` | Bug fix | **PATCH** |
| `:ambulance:` | Critical hotfix | **PATCH** |
| `:lock:` | Security fix | **PATCH** |
| `:zap:` | Performance improvement | **PATCH** |

Commits that do not match any rule (e.g., `:memo:`, `:wrench:`) do not
trigger a release.

### How It Works

1. A commit lands on `main` touching files in `extensions/org/my-extension/`.
2. The `release-monorepo` workflow detects the change.
3. `semantic-release-monorepo` scopes the analysis to that extension only.
4. `semantic-release-gitmoji` determines the version bump from the emoji.
5. A tag `my-extension-vX.Y.Z` is created.
6. `scripts/release-package-extension.ts` (reached through the forwarding
   shim `scripts/release-package-extension.ts`) renders the extension
   (`--target gemini`), asserts the built manifest's version matches the
   release version, and archives the rendered tree — `package.json` and
   `extension.json` (never `gemini-extension.json`, a build output that is
   never committed) are written to the release version first. A GitHub
   Release is published with that archive as its single asset (spec 0183;
   the published artifact serves the in-place tool, Gemini CLI, alone —
   Claude Code, Copilot CLI and Antigravity CLI reach an adopter through
   their own local render-and-install paths, unaffected by this release).
7. A CHANGELOG.md is committed back into the extension directory.

Other extensions in the monorepo are not affected.

## Packaging

To manually package an extension without releasing:

```bash
# Single extension
task package-extension EXT=my-extension

# All extensions
task package
```

Both delegate to `scripts/release-package-extension.ts` (Node.js 24 floor,
behind `node scripts/lib/node-floor-guard.js`; the `.sh` name is a forwarding
shim), packaging the
extension's own currently-committed version — the same artifact shape a
real release publishes (a rendered, installable tree, not a source-only
tarball). The archive is written to `dist/release/<name>/`.

## Extension Anatomy

```text
extensions/org/my-extension/
├── extension.json          # The ONLY manifest — renders every CLI's file (spec 0173).
│                           #   gemini-extension.json is a build output; never committed.
├── package.json            # npm package (dependencies, build script)
├── tsconfig.json           # TypeScript configuration
├── CONTEXT.md              # Agent-facing context source, rendered per target (spec 0181) — GEMINI.md/CLAUDE.md/rules/AGENTS.md/the Copilot skill are all build outputs, never committed
├── README.md               # Documentation
├── src/                    # MCP server source (TypeScript)
│   └── index.ts
├── commands/                # Slash command pivot sources (.md); the rendered .toml is a build output
├── skills/                 # Agent skill directories (SKILL.md)
├── agents/                 # Sub-agent prompts — AGENT.md (Claude Code / Copilot CLI / Antigravity CLI pivot) and PROMPT.md (Gemini CLI pivot) as siblings, per component
└── hooks/                  # Lifecycle hooks (handler scripts; the rendered hooks.json is a build output)
```

Not all directories are required — include only what your extension needs.

## Session Transcript Activation

Transcripts are disabled by default. Enable them by answering yes to the session-recording question of the CLI's setup script (for example `node scripts/setup-claude-interactive.ts`, after `node scripts/lib/node-floor-guard.js` as a separate step). Setup wires the hook `hooks/mempalace-transcript.ts` by the in-repo absolute path of the checkout that ran it, as `node "<abs>/hooks/mempalace-transcript.ts" claude-code`, from `hooks/claude-transcript-hooks.json` (events: `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd`). The hook needs Node.js 24 or later when it fires, and no `jq` or `curl` (spec 0247).

That direct form records without any variable: the registration is the consent. Set `MEMPALACE_TRANSCRIPT_ENABLED` to a non-empty value other than `1` (for example `0`) to switch recording off without re-running setup. The legacy argument-less form, reached through the forwarding shim the retired `hooks/mempalace-transcript.sh`, still records only when `MEMPALACE_TRANSCRIPT_ENABLED=1`.

What is recorded:

- `UserPromptSubmit` → `[USER] <raw prompt text>`
- `PostToolUse` → `[TOOL] <tool-name>: <command/path/pattern>`
- `Stop` → `[AGENT] Session turn completed`
- `SessionEnd` → `[SESSION] SessionEnd: <source>`

Each entry is stored as a drawer in `wing="transcripts"`, `room="<project-name>-<YYYY-MM-DD>-<session-id[:8]>"`. Content is capped at 4,000 characters per drawer. The `transcripts` wing is excluded from default MemPalace semantic searches — see [`config/TOOLS.md`](config/TOOLS.md) (Memory Activation Protocol section) for the rationale.

Every tool call and every prompt generates a drawer. Long sessions accumulate hundreds of drawers. Use the prune task to manage retention:

```bash
# Dry-run: shows what would be deleted (default retention: 30 days)
task prune-transcripts

# Apply deletion
task prune-transcripts -- --apply

# Filter by project, custom retention
task prune-transcripts -- --project my-extension --days 14 --apply
```

**Privacy:** Transcripts contain raw user prompts. Do not enable `MEMPALACE_TRANSCRIPT_ENABLED=1` on a shared MemPalace instance without evaluating data exposure for all users sharing that instance.
