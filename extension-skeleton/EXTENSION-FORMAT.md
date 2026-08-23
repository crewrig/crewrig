# Unified Extension Manifest — `extension.json`

This document specifies the generic declaration model for extensions in this
monorepo (spec 0173, as amended by
`specs/0173-extension-declaration-model.delta-01.md`). A single
`extension.json` per extension is the extension's **only** hand-authored
manifest: every declaration subject — commands, skills, agents, hooks, MCP
servers, context — lives in a generic top-level section, declared exactly
once, and every CLI-native file a specific command-line tool consumes is
**produced from that single declaration** by `scripts/build-extension.sh`.

## Format

`extension.json` files are **standard JSON** (not JSONC). Comments appear
only in this specification document for clarity. Actual files must be
valid JSON compatible with `jq`.

## The render-at-publication model — read this before the schema

**A file inside an extension source tree whose name designates a specific
command-line tool is always a build output, never a hand-authored source**
(requirement 4). Concretely: `gemini-extension.json`, `claude-extension.json`,
`copilot-extension.json`, `antigravity-extension.json`, and
`.github/copilot/extension.json` (the exact list is committed data,
`scripts/lib/extension-generated-class.json`, `manifest_class`) — and a
per-CLI-designated file rendered from a `commands/` pivot (`commands/*.toml`
today) — **SHALL NOT be committed on the primary branch, for any
command-line tool.** `bash scripts/build-extension.sh --check` fails the
build the moment one is, naming the offending file, and points at the
delivery paths below rather than at regenerating and committing it.

**Where the rendered files actually go.** `bash scripts/build-extension.sh
[--target {gemini,claude,copilot,antigravity,all}]` writes every output into
a build directory outside the committed source tree:

- **Gemini CLI** (the tool that loads an extension in place) gets the
  **complete installable tree** — the verbatim source tree plus every
  rendered file — in `build/extensions/<name>/`.
- **Claude Code, GitHub Copilot CLI, Antigravity CLI** (tools that build a
  plugin) keep their existing ephemeral output roots
  (`dist-claude-plugin/<name>/`, `dist-copilot-plugin/<name>/`,
  `dist-antigravity-plugin/<name>/`) — unchanged by this model.

Both roots are gitignored (`.gitignore:16-18,52,55`) and neither is ever
committed.

**The rendered Gemini tree reaches an adopter through exactly one of three
paths** (requirement 20 — see *Delivery paths* below): a versioned release
artifact (default, S5/#1008), `bash scripts/install-extension.sh install
<name>` (this repository's own script), or `task
link-gemini-extension-build EXT=<name>` (a documented **debugging** path,
not an install path). A native `gemini extensions install` pointed directly
at this repository's primary branch is a **documented-unsupported** path
(requirement 21) — nothing generated is there for it to find.

**One interim carve-out.** A committed, hand-authored file of the
CLI-designated shape whose subject this spec does not yet generalize (the
hook, MCP-server, and context vocabularies — sub-specs S2/S3/S4) stays
admissible until that subject's sub-spec lands, mirroring the interim the
per-CLI-key irreducibility rule below already grants. Today that carve-out
covers exactly the four hand-authored context files of the reference
extension — `CLAUDE.md`, `GEMINI.md`, `copilot-instructions.md`,
`.geminiignore` — and their skeleton equivalents; `--check` does not charge
them, because none is a `manifest_class` or `generated_globs` member in the
first place. Their subject is sub-spec S4 (context declarations, issue
#1007); once S4 lands, requirement 4 binds them like any other CLI-named
file.

## Complete Schema

```jsonc
{
  // ============================================================
  // UNIVERSAL METADATA (required)
  // Used by all tools. These fields are mandatory.
  // ============================================================

  // Unique identifier for the extension. Must be kebab-case.
  // Used in file paths, npm package name, and tool registrations.
  // For Claude Code: also the plugin namespace (skills become /name:skill).
  "name": "hello-world",

  // Semantic version (X.Y.Z). This is the render's OWN version source
  // (requirement 11 as amended) — package.json, where the extension ships
  // one, is the authoritative declaration scripts/check-extension-manifest-
  // version.sh asserts extension.json agrees with; the two are independent
  // inputs on purpose, so the built manifest's version assertion is
  // non-vacuous.
  "version": "0.1.0",

  // Human-readable summary. Displayed in extension listings and help.
  "description": "Demonstration extension showcasing MCP tools, commands, skills, and context.",

  // ============================================================
  // MCP SERVERS (optional) — a generic declaration subject (requirement 1)
  // Shared MCP server definitions. Both tools use the same MCP SDK
  // and stdio transport, so this section is 100% universal.
  //
  // Each key is a server name (convention: "default" for single-server
  // extensions). Values define how to launch the server process.
  //
  // Variable substitution:
  //   ${extensionPath} — resolved at install time to the absolute path
  //                      of the installed extension/plugin directory. This
  //                      is the ONE form Gemini CLI demonstrably resolves
  //                      when loading an extension from an installed build
  //                      tree — see tests/gemini-extension-path-form.md for
  //                      the recorded evidence (requirement 14). The render
  //                      passes whatever form is declared through verbatim;
  //                      declaring the bare form ships the bare form.
  // ============================================================
  "mcpServers": {
    "default": {
      // Executable to run. Typically "node" for TypeScript MCP servers,
      // "python3" for Python-based servers.
      "command": "node",

      // Arguments passed to the command. The first argument is usually
      // the compiled entry point.
      "args": ["${extensionPath}/dist/index.js"],

      // Environment variables injected when spawning the server process.
      // Supports ${VAR} interpolation from the user's shell environment.
      // Optional — omit if the server needs no extra env.
      "env": {
        "NODE_ENV": "production"
      }
    }
  },

  // ============================================================
  // DECLARATION SUBJECTS (optional, generic top-level sections)
  //
  // Enablement follows presence (requirement 5): there is NO enabled
  // toggle. A subject is on because its top-level section is present, off
  // because it is absent — an extension declaring no subject at all
  // remains valid and renders only its per-CLI manifests. Subject-scoped
  // options live inside the subject's own section, never in a separate
  // "components" block (the legacy components.<subject>.enabled shape
  // below is a READ-ONLY fallback for not-yet-migrated extensions, per the
  // Migration note at the end of this section — it MUST NOT be used in new
  // authoring).
  // ============================================================

  // Slash commands.
  // Gemini: rendered to build/extensions/<name>/commands/*.toml.
  // Claude Code / Copilot CLI / Antigravity CLI: if convertToSkills is
  //   true, the pivot commands/*.md is rendered into a skill in the built
  //   plugin.
  "commands": {
    "location": "commands/",
    "convertToSkills": true
  },

  // Agent skills. SKILL.md files with YAML frontmatter.
  // Gemini: copied as-is into the build tree.
  // Claude Code / Copilot CLI / Antigravity CLI: copied into the built
  //   plugin's skills/ directory.
  "skills": {
    "location": "skills/"
  },

  // Sub-agent definitions. Markdown prompt files.
  // Gemini: PROMPT.md files (no frontmatter), copied as-is.
  // Claude Code: AGENT.md files (with frontmatter), copied into the built
  //   plugin per the claude.agents glob (see below).
  "agents": {
    "location": "agents/"
  },

  // Lifecycle hooks. NOT YET GENERALIZED — the hook declaration vocabulary
  // is sub-spec S2 (issue #1005). Declaring this section today is
  // spec-legal (requirement 1 names hooks as a subject unconditionally) but
  // has no renderer yet on any target: `bash scripts/build-extension.sh`
  // records it as a gap (see *Unmappable-declaration policy* below) rather
  // than silently ignoring or failing on it.
  "hooks": {},

  // ============================================================
  // GEMINI CLI (optional, per-CLI section)
  // Admissible keys are the ones that pass the irreducibility test
  // (requirement 3) — see *Per-CLI key irreducibility* below. Ignored by
  // every other command-line tool.
  // ============================================================
  "gemini": {

    // Context file loaded by Gemini CLI when this extension is active.
    // Must be a file at the extension root. deferred:S4 — the context
    // declaration vocabulary generalizes this key with sub-spec S4.
    "contextFileName": "GEMINI.md",

    // UI themes for Gemini CLI. cli-only-concept — no other supported tool
    // has a themes concept.
    "themes": [
      {
        // Theme identifier. Convention: <extension-name>-<variant>.
        "name": "hello-world-dark",

        // Color palette. Minimum: primary, secondary, background, foreground.
        "colors": {
          "primary": "#00adb5",
          "secondary": "#ff2e63",
          "background": "#222831",
          "foreground": "#eeeeee"
        }
      }
    ],

    // Inline Gemini hook definitions. deferred:S2.
    "hooks": []
  },

  // ============================================================
  // CLAUDE CODE (optional, per-CLI section)
  // ============================================================
  "claude": {

    // Author metadata for the generated plugin manifest. cli-only-concept.
    "author": {
      "name": "Your Name"
    },

    // Context file loaded when plugin is active. deferred:S4.
    "contextFileName": "CLAUDE.md",

    // Glob patterns for skill directories to include in the plugin.
    // deferred:S5 — full skeleton/reference migration.
    "skills": ["skills/*/SKILL.md"],

    // Glob patterns for agent definitions to include (default:
    // agents/*/AGENT.md when empty — issue #600). deferred:S5.
    "agents": [],

    // Additional rule files to include with the plugin. deferred:S5.
    "rules": [],

    // Plugin-level hooks in Claude Code format. deferred:S2.
    "hooks": {},

    // Default allowed-tools applied to skills from this extension
    // when they don't define their own. cli-only-concept.
    "defaultAllowedTools": ["Read", "Write", "Edit", "Bash"],

    // Plugin-level settings applied when plugin is enabled. cli-only-concept.
    "settings": {},

    // LSP server configurations for code intelligence. cli-only-concept.
    "lsp": {},

    // Directory of executables to add to the Bash tool's PATH. cli-only-concept.
    "bin": null
  }

  // ============================================================
  // FUTURE TOOLS (extensible)
  // Additional per-CLI sections follow the same pattern:
  //   "codex": { ... }, "cursor": { ... }
  // Every key inside a per-CLI section MUST pass the irreducibility test
  // (requirement 3) before it may exist — see below.
  // ============================================================
}
```

## Per-CLI key irreducibility (requirements 2/3)

A per-CLI section carries only keys that fail to generalize: the concept
exists on that one command-line tool alone (`cli-only-concept`), or the
value cannot yet be derived because its generalizing sub-spec has not landed
(`deferred:S<n>`). `scripts/lib/extension-percli-keys.json` is the committed
allowlist — one row per admissible key, each with a `reason` and an
`evidence` pointer — and a key absent from that table is rejected as a
manifest validation error (fail-closed, requirement 3). `deferred:S<n>` is a
scheduled retirement, not a permanent exemption: requirement 4's per-CLI
"deferred subject" carve-out above and this table's `deferred:S<n>` rows
bind together — once the named sub-spec lands, both a committed file of
that subject's shape and a per-CLI key belonging to it stop being
admissible. Two keys — `copilot.pluginName` and `antigravity.pluginName` —
are `deferred:S5` **and** already known reducible (both are derivable from
`.name`); they stay admissible until sub-spec S5 does the reduction, because
`create-extension.sh`'s own scaffolder ships them verbatim today and a hard
rejection would fail `--check` on the scaffolder's own output.

## Field Reference

### Universal (required)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Extension ID (kebab-case). Plugin namespace for Claude Code. |
| `version` | string | Semantic version (X.Y.Z) — the render's own version source (requirement 11) |
| `description` | string | Human-readable summary |

### MCP Servers (optional, generic subject)

| Field | Type | Description |
|-------|------|-------------|
| `mcpServers` | object | MCP server definitions (shared across tools) |
| `mcpServers[name].command` | string | Executable name |
| `mcpServers[name].args` | string[] | Arguments. Supports `${extensionPath}` |
| `mcpServers[name].env` | object | Env vars. Supports `${VAR}` interpolation |

### Declaration subjects (optional, generic top-level sections)

Presence is enablement (requirement 5) — there is no `enabled` field.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.location` | string | `commands/` | Directory path |
| `commands.convertToSkills` | boolean | `false` | Render pivot `.md` → skill for plugin-building targets |
| `skills.location` | string | `skills/` | Directory path |
| `agents.location` | string | `agents/` | Directory path |
| `hooks` | object | — | Not yet generalized (sub-spec S2, issue #1005); declaring it records a gap, per *Unmappable-declaration policy* |

### Gemini CLI (optional, per-CLI section)

| Field | Type | `reason` | Description |
|-------|------|----------|-------------|
| `gemini.contextFileName` | string | `deferred:S4` | Context file loaded when extension is active |
| `gemini.themes` | array | `cli-only-concept` | UI theme definitions |
| `gemini.themes[].name` | string | — | Theme identifier |
| `gemini.themes[].colors` | object | — | Color palette |
| `gemini.hooks` | array | `deferred:S2` | Inline hook definitions |

### Claude Code (optional, per-CLI section)

| Field | Type | `reason` | Description |
|-------|------|----------|-------------|
| `claude.author` | object | `cli-only-concept` | Plugin author → `plugin.json` |
| `claude.contextFileName` | string | `deferred:S4` | Context file for the plugin |
| `claude.skills` | string[] | `deferred:S5` | Glob patterns for skill directories |
| `claude.agents` | string[] | `deferred:S5` | Glob patterns for agent files (default `agents/*/AGENT.md`) |
| `claude.rules` | string[] | `deferred:S5` | Rule files for the plugin |
| `claude.hooks` | object | `deferred:S2` | Claude Code hook definitions → `hooks/hooks.json` |
| `claude.defaultAllowedTools` | string[] | `cli-only-concept` | Default tool permissions for skills |
| `claude.settings` | object | `cli-only-concept` | Plugin settings → `settings.json` |
| `claude.lsp` | object | `cli-only-concept` | LSP server config → `.lsp.json` |
| `claude.bin` | string | `cli-only-concept` | Executables directory → `bin/` |

### Copilot CLI and Antigravity CLI (optional, per-CLI sections)

| Field | Type | `reason` | Description |
|-------|------|----------|-------------|
| `copilot.pluginName` | string | `deferred:S5` (reducible) | Overrides `.name` in the built `plugin.json` |
| `copilot.hooks` | object | `deferred:S2` | Copilot hook definitions → `hooks.json` |
| `antigravity.pluginName` | string | `deferred:S5` (reducible) | Overrides `.name` in the built `plugin.json` |
| `antigravity.contextFileName` | string | `deferred:S4` | Context file copied into the built plugin |
| `antigravity.hooks` | object | `deferred:S2` | Antigravity hook definitions → `hooks.json` |

## Unmappable-declaration policy (requirements 8, 12, 13)

The render distinguishes a **manifest validation error** (a malformed
declaration, or an inadmissible per-CLI key — fails the build) from an
**unmappable declaration** (a well-formed declaration with no expressible
counterpart on a declared target — never fails the build). An unmappable
declaration:

1. Produces a build **warning** on stderr; the render still exits 0
   (requirement 12 — never silent, never a build failure).
2. Is recorded in the extension's **observed** gap set, a build output at
   `build/gaps/<name>/observed-gaps.json` — never committed.

The durable side of the policy is a **hand-authored, committed declaration**
of the gaps an extension's maintainers have accepted:
`extensions/<tier>/<name>/accepted-gaps.json`, one entry per accepted
`{subject, target}` pair. **Absence means the empty set** — an extension
whose declarations all map cleanly (like `hello-world`) ships no such file
at all. `bash scripts/build-extension.sh --check` compares the observed set
against the declared one and fails, naming the offender, on either mismatch:
a gap observed but not declared (`GAP-UNDECLARED`), or a gap declared but no
longer observed (`GAP-STALE`). This is what keeps the gap inventory
reviewable in a diff rather than ephemeral in a render's stderr, at the cost
the delta spec names plainly: a legitimately unmappable declaration must be
acknowledged twice — the render observes it, and a human records it — and
`--check` stays red until the record lands.

## Delivery paths (requirements 20, 21, 22)

The render emits, into `build/extensions/<name>/`, a tree "complete enough
to be installed or packaged with no second render" (requirement 22) — so
publication is a packaging step, not a build step. An adopter reaches that
tree through exactly one of three paths:

1. **A versioned release artifact** carrying the rendered tree — the
   default operating mode for an install. The publication mechanics
   themselves are sub-spec S5's (issue #1008); this spec stops at the
   complete tree in the build directory.
2. **`bash scripts/install-extension.sh install <name>`** — this
   repository's own script, which renders and then copies (or, in `link`
   mode, symlinks) the build directory into `$GEMINI_HOME/extensions/<name>`.
3. **`task link-gemini-extension-build EXT=<name>`** — a dedicated,
   documented **debugging** path pointed at the build directory. It is not
   an install path.

A native `gemini extensions install` command pointed directly at this
project's primary branch is **documented as unsupported** (requirement 21):
nothing generated lives there for the tool to find. The evidence for this
posture is the 2026-08-23 maintainer decision recorded on issue #725.

## Install-Time Transformation

### Gemini CLI: build tree, not a hand-maintained sibling

```
extension.json ──render──> build/extensions/<name>/ (complete installable tree)
                          ├── gemini-extension.json   # Built (six fields, below)
                          ├── GEMINI.md               # Context file (copied verbatim)
                          ├── dist/                   # MCP server (copied verbatim, when built)
                          ├── commands/                # pivot .md (copied) + rendered .toml
                          ├── skills/                 # SKILL.md files (copied verbatim)
                          ├── agents/                 # PROMPT.md files (copied verbatim)
                          └── (every other source file, copied verbatim)
```

The built `gemini-extension.json` carries exactly six fields —`name`,
`version`, `description`, `contextFileName` (from `gemini.contextFileName`),
`mcpServers`, `themes` (from `gemini.themes`) — omitting any whose declared
value is empty, so `hello-world` (no themes) renders no `themes` key. Its
`.version` is asserted, non-vacuously, to equal the extension's
authoritative version declaration (requirement 11) by `--check`'s
`VERSION-DRIFT` arm.

### Claude Code, Copilot CLI, Antigravity CLI: unchanged plugin build

```
extension.json ──render──> dist-{claude,copilot,antigravity}-plugin/<name>/
                          ├── plugin manifest          # Generated
                          ├── .mcp.json (Claude only)   # Generated, ${extensionPath} resolved
                          ├── context file              # Copied, when declared
                          ├── skills/ agents/            # Copied / rendered from pivots
                          └── hooks (Claude/Copilot/Antigravity format)
```

This half of the render is unchanged by the render-at-publication model —
these three targets already built an ephemeral plugin; only the Gemini
in-place target moved off a committed sibling.

## Hook Systems

Gemini CLI and Claude Code have fundamentally different hook architectures.
See the migration plan (issue #30, section 5.4) for the complete comparison.
The hook declaration vocabulary itself is not yet generalized — sub-spec S2
(issue #1005) owns it; today `gemini.hooks` / `claude.hooks` /
`copilot.hooks` / `antigravity.hooks` remain per-CLI, `deferred:S2` keys.

## Backward Compatibility

This section is retained deliberately rather than excised: the fallback
chain it documents is exactly what `scripts/lib/extension-manifest.sh`'s
accessors (`ext_subject_present` / `ext_subject_location` /
`ext_subject_option`) still honor for a not-yet-migrated extension, and what
the three plugin builders and `scripts/build-extension.sh` still read
through. It is the interim spec 0173's *Out of scope* grants until sub-spec
S5 (issue #1008) removes the dual-shape fallback in a full skeleton and
reference-extension migration.

Install scripts and the render support both shapes:
1. If a generic top-level subject section (`commands`, `skills`, `agents`,
   ...) is present → use it (the current, generic shape above).
2. Else fall back to reading `components.<subject>.enabled` /
   `components.<subject>.<option>` (the legacy shape) — the same
   `components.*` block requirement 5 says the generic schema itself SHALL
   NOT carry, kept readable only for extensions that have not migrated yet.
3. `extension.json` → `gemini-extension.json` fallback for a manifest a
   plugin builder cannot otherwise locate (`build-claude-plugin.sh:52-55`
   and its siblings) stays as dead code for now: it can never fire in
   practice, since `gemini-extension.json` is never committed, but its
   removal is sub-spec S5's clean-break work, not this spec's.
4. `create-extension.sh` generates `extension.json` for new extensions —
   the ONLY manifest it writes; see *Fragment Merging* below.

## Fragment Merging

The scaffolding system (`create-extension.sh`) merges JSON fragments into
`extension.json` — the single generic root manifest — during extension
creation:

- `mcp-server.json.fragment` → `mcpServers` field
- `theme.json.fragment` → `gemini.themes` field
- Merge tool: `jq -s '.[0] * .[1]'`, applied to `extension.json`
- The fragment is deleted after the merge.

Before spec 0173, this merged into **both** `extension.json` and
`gemini-extension.json` to keep the two lockstep (spec 0044). That second
target no longer exists — `gemini-extension.json` is a build output, never
committed — so the merge now has exactly one manifest to update; the
double-write was retargeted to the single manifest in the same change that
removed the skeleton's committed `gemini-extension.json` (issue #1004).
