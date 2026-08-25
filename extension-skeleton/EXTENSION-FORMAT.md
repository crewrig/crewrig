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

**The interim has ended.** Sub-specs S2 (hooks, spec 0179, issue #1005), S3
(MCP servers, spec 0180, issue #1006) and S4 (context, spec 0181, issue #1007)
have all landed, so no subject any longer carries the file-level carve-out
this section used to grant. Every CLI-designated file — including
the reference extension's former hand-authored `CLAUDE.md`, `GEMINI.md`,
`copilot-instructions.md` and `.geminiignore` — is now produced from the
single `extension.json` declaration and binds to requirement 4 like any
other generated-output-class member.

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
  // MCP SERVERS (optional) — a generic declaration subject (spec 0180,
  // issue #1006). Declare each server ONCE, in the SAME neutral vocabulary
  // the org-level channel of spec 0091 already uses (requirement 2) — the
  // shared translator (scripts/lib/common.sh's org_mcp_to_native) derives
  // every target's native shape from this one declaration (requirement 3).
  // No per-CLI top-level section may carry an MCP server key (requirement 3);
  // declaring one there is a manifest validation error.
  //
  // Each key is a server name (convention: "default" for single-server
  // extensions), except the FRAMEWORK-RESERVED names `mempalace` and
  // `sequentialthinking` (requirement 12) — declaring a server under either
  // is a manifest validation error naming the extension and the reserved
  // name.
  //
  // Vocabulary (requirement 1 — a non-conforming declaration is a hard
  // build failure, never a silent transformation, per requirement 5's clean
  // break):
  //   transport  "stdio" | "http" | "sse". Absent means "stdio".
  //   stdio      command (required, non-empty), args (optional), env (optional)
  //   http/sse   url (required, non-empty), headers (optional)
  // No other key is admissible on either shape — `cwd`, `timeout`, `trust`,
  // `description`, `includeTools` and `excludeTools` are refused with a
  // VALIDATION-ERROR naming the key, even though some of these are
  // documented, extension-supported Gemini CLI fields (see the tracked
  // follow-up issue linked from docs/cli-matrix.md's MCP row for the
  // rationale and the two vendor citations behind it).
  //
  // The ONE neutral path token (requirement 6): ${extensionRoot} — a
  // command or arg pointing inside the extension's own installed directory
  // names ONLY this token, never a target-specific one. Each target
  // resolves it through its OWN named party and moment (requirement 7),
  // pinned by live evidence (requirement 9,
  // docs/runbooks/extension-mcp-token-probe.md) — never assumed:
  //   Gemini        rewritten to ${extensionPath} at RENDER time; gemini-cli
  //                 itself resolves that token when it LOADS the extension
  //                 from the installed tree.
  //   Claude Code   rewritten to ${CLAUDE_PLUGIN_ROOT} at RENDER time;
  //                 Claude Code itself resolves that token when it LOADS
  //                 the installed plugin.
  //   Copilot CLI   rewritten to ${COPILOT_PLUGIN_ROOT} at RENDER time;
  //                 Copilot resolves that token — and defaults a plugin
  //                 server's `cwd` to its own plugin root — when it SPAWNS
  //                 the server (confirmed live: all three candidate forms
  //                 spawn correctly).
  //   Antigravity   LEFT UNRESOLVED at render time — a relative
  //                 command/args does NOT resolve against the plugin
  //                 directory when Antigravity spawns a plugin's MCP server
  //                 (confirmed live: it silently fails, no error surfaced).
  //                 scripts/install-antigravity-extension.sh's POST-INSTALL
  //                 step rewrites it, once the real installed directory is
  //                 knowable — never a render-time absolute path
  //                 (requirement 8).
  //
  // Requirement 14 (server code layout): an extension that ships its own MCP
  // server implementation keeps its SOURCE under one source directory
  // (`src/` below) and its EXECUTABLE OUTPUT under one build-output
  // directory (`dist/` below), both at the extension root — a declared
  // `command`/`args` names the build output, never a source file. An
  // extension that declares only servers it does not itself implement
  // carries neither directory. Compiling the source is the extension's own
  // build step, out of scope for this render (requirement 16 only requires
  // that whatever build output IS present travels with the declaration).
  // ============================================================
  "mcpServers": {
    "default": {
      // Executable to run. Typically "node" for TypeScript MCP servers,
      // "python3" for Python-based servers.
      "command": "node",

      // Arguments passed to the command. The first argument is usually
      // the compiled entry point, inside the build-output directory.
      "args": ["${extensionRoot}/dist/index.js"],

      // Environment variables injected when spawning the server process.
      // Arbitrary ${VAR} interpolation is admissible here EXCEPT the five
      // known path tokens (${extensionRoot} included) — a path token has
      // no path to resolve against inside an env value.
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

  // Agent-facing context (spec 0181, issue #1007). A SINGLE
  // command-line-tool-neutral Markdown source, reached through this
  // generic `context` section — see *Context rendering* below for the
  // render-variable vocabulary. An extension declaring no `context` section
  // produces no context output on any target (R1) — this section is
  // entirely optional.
  "context": {
    "source": "CONTEXT.md"
  },

  // Lifecycle hooks (spec 0179, issue #1005). An ARRAY of entries, each
  // carrying a stable `id`, exactly one neutral `event` (from the closed
  // set documented in docs/extension-hook-events.md), one `command`, and
  // optionally a neutral tool-class `matcher`, a `timeLimit` (seconds —
  // the canonical unit; converted per target, or omitted where a target's
  // own unit is ungrounded), and a human `description`. Translated for
  // every supported target by the shared render (scripts/build-extension.sh
  // via scripts/lib/extension-hooks.sh) — no per-CLI hook key exists any
  // more. A hook whose event has no counterpart on a declared target
  // produces a build warning and an entry in the observed gap set rather
  // than an approximation (see *Unmappable-declaration policy* below).
  "hooks": [
    {
      "id": "logger",
      "event": "PreToolUse",
      "matcher": "shell",
      "command": "bash ${extensionRoot}/hooks/logger.sh"
    }
  ],

  // ============================================================
  // GEMINI CLI (optional, per-CLI section)
  // Admissible keys are the ones that pass the irreducibility test
  // (requirement 3) — see *Per-CLI key irreducibility* below. Ignored by
  // every other command-line tool.
  // ============================================================
  "gemini": {

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
    ]
  },

  // ============================================================
  // CLAUDE CODE (optional, per-CLI section)
  // ============================================================
  "claude": {

    // Author metadata for the generated plugin manifest. cli-only-concept.
    "author": {
      "name": "Your Name"
    },

    // Glob patterns for skill directories to include in the plugin.
    // deferred:S5 — full skeleton/reference migration.
    "skills": ["skills/*/SKILL.md"],

    // Glob patterns for agent definitions to include (default:
    // agents/*/AGENT.md when empty — issue #600). deferred:S5.
    "agents": [],

    // Additional rule files to include with the plugin. deferred:S5.
    "rules": [],

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

### MCP Servers (optional, generic subject, spec 0180)

| Field | Type | Description |
|-------|------|-------------|
| `mcpServers` | object | MCP server definitions, one per-CLI translation for all four tools (requirement 2/3). Name must not be a framework-reserved name (`mempalace`, `sequentialthinking` — requirement 12) |
| `mcpServers[name].transport` | string | `"stdio"` (default) \| `"http"` \| `"sse"` |
| `mcpServers[name].command` | string | Executable name (stdio only, required, non-empty) |
| `mcpServers[name].args` | string[] | Arguments (stdio only). Supports the ONE neutral path token, `${extensionRoot}` (requirement 6) — no other `${...}` token is admissible here |
| `mcpServers[name].env` | object | Env vars (stdio only). Arbitrary `${VAR}` interpolation admissible, EXCEPT the five known path tokens |
| `mcpServers[name].url` | string | Endpoint (http/sse only, required, non-empty) |
| `mcpServers[name].headers` | object | HTTP headers (http/sse only). Same token rule as `env` |

No other key is admissible on either shape (`cwd`, `timeout`, `trust`, `description`, `includeTools`, `excludeTools` all refused — see the MCP comment block above for the tracked follow-up).

### Declaration subjects (optional, generic top-level sections)

Presence is enablement (requirement 5) — there is no `enabled` field.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.location` | string | `commands/` | Directory path |
| `commands.convertToSkills` | boolean | `false` | Render pivot `.md` → skill for plugin-building targets |
| `skills.location` | string | `skills/` | Directory path |
| `agents.location` | string | `agents/` | Directory path |
| `context.source` | string | — | Path (relative to the extension root) of the single neutral context source (spec 0181) — see *Context rendering* below |
| `hooks` | array | — | Lifecycle hook entries, translated for every target (spec 0179) — see [`docs/extension-hook-events.md`](../docs/extension-hook-events.md) for the closed event/matcher vocabulary and *Unmappable-declaration policy* below for the gap contract |

### Gemini CLI (optional, per-CLI section)

| Field | Type | `reason` | Description |
|-------|------|----------|-------------|
| `gemini.themes` | array | `cli-only-concept` | UI theme definitions |
| `gemini.themes[].name` | string | — | Theme identifier |
| `gemini.themes[].colors` | object | — | Color palette |

### Claude Code (optional, per-CLI section)

| Field | Type | `reason` | Description |
|-------|------|----------|-------------|
| `claude.author` | object | `cli-only-concept` | Plugin author → `plugin.json` |
| `claude.skills` | string[] | `deferred:S5` | Glob patterns for skill directories |
| `claude.agents` | string[] | `deferred:S5` | Glob patterns for agent files (default `agents/*/AGENT.md`) |
| `claude.rules` | string[] | `deferred:S5` | Rule files for the plugin |
| `claude.defaultAllowedTools` | string[] | `cli-only-concept` | Default tool permissions for skills |
| `claude.settings` | object | `cli-only-concept` | Plugin settings → `settings.json` |
| `claude.lsp` | object | `cli-only-concept` | LSP server config → `.lsp.json` |
| `claude.bin` | string | `cli-only-concept` | Executables directory → `bin/` |

### Copilot CLI and Antigravity CLI (optional, per-CLI sections)

| Field | Type | `reason` | Description |
|-------|------|----------|-------------|
| `copilot.pluginName` | string | `deferred:S5` (reducible) | Overrides `.name` in the built `plugin.json` |
| `antigravity.pluginName` | string | `deferred:S5` (reducible) | Overrides `.name` in the built `plugin.json` |

## Context rendering (spec 0181, issue #1007)

An extension declares its agent-facing context exactly **once**, in one
command-line-tool-neutral Markdown source named by `context.source` — never
a per-CLI file, and never a per-CLI key naming one. The shared render
(`scripts/lib/render-context.sh`, called by `scripts/build-extension.sh` and
each of the three plugin builders — the three `install-*-plugin.sh` scripts
invoke the builders directly, bypassing `build-extension.sh`) turns that one
source into one output per target, resolving a small render-variable
vocabulary against `scripts/lib/extension-targets.json`'s own knowledge of
each target and the extension's own declared commands/skills. An extension
declaring no `context` section produces no context output on any target
(R1) and stays valid.

**Delivery per target** — the render's own knowledge, never authored:

| Target | Delivered as | Location |
|---|---|---|
| Gemini CLI | `GEMINI.md`, in the rendered installable tree | `build/extensions/<name>/GEMINI.md` |
| Claude Code | `CLAUDE.md`, in the built plugin | `dist-claude-plugin/<name>/CLAUDE.md` |
| GitHub Copilot CLI | a user-invocable skill — the same surface the build already uses for commands, pinned by live evidence (`tests/extension-context-delivery-evidence.md`) since the CLI's plugin surface carries no context/instructions concept of its own | `dist-copilot-plugin/<name>/skills/<name>-context/SKILL.md` |
| Antigravity CLI | a plugin rule file, pinned by live evidence the same way | `dist-antigravity-plugin/<name>/rules/AGENTS.md` |

Two author-facing name reservations follow from the table above: a
`skills/*-context/` directory under a built Copilot/Antigravity plugin, and
the root-anchored `rules/AGENTS.md` path (Antigravity). Neither is available
to an extension author for any other purpose.

**Render-variable vocabulary — six members:**

| Member | Resolves to |
|---|---|
| `${TOOL}` | the target's display name |
| `${EXTENSION}` | the extension's own `.name` |
| `${COMMAND:<name>}` | the target's invocation reference for a **declared** command |
| `${SKILL:<name>}` | the target's invocation reference for a **declared** skill |
| `${ONLY:<t>[,<t>…]}` … `${ENDONLY}` | span kept only on the named targets |
| `${EXCEPT:<t>[,<t>…]}` … `${ENDEXCEPT}` | span kept on every target **except** those named |

A reference to an undeclared command/skill fails the render (R5) — the
permitted path is to declare the entry, never a hand-written literal.
`${COMMAND:x}` / `${SKILL:x}` resolve against `extension-targets.json`'s
`commandRef` / `skillRef` columns, per-target templates using `{ext}` / `{name}`
placeholders — an author never restates a namespace or invocation form (R4).

**Pass order — `(b)` `(a)` `(c)` `(d)` `(e)`, mask first.** `(b)` replaces
every literal `$${` with a reserved sentinel byte (an author writes
`$${ONLY:copilot}` to get the literal text `${ONLY:copilot}` in every
render — the render fails up front if the source already contains that
reserved byte); `(a)` resolves `${ONLY:...}` / `${EXCEPT:...}` spans; `(c)`
substitutes `${TOOL}` / `${EXTENSION}`; `(d)` resolves `${COMMAND:x}` /
`${SKILL:x}` against the declared entry set only; `(e)` unmasks the
sentinel back to `${`.

**Span semantics — five rules.** (1) Markers may appear anywhere on a line
and a span may cross lines. (2) Splice: a **dropped** span is removed from
the first byte of its opener through the last byte of its closer inclusive,
newlines included, so the text before and after joins into one output
line. (3) A source line lying wholly inside a dropped span emits nothing.
(4) A **kept** span has only its two marker tokens removed, with a removal
sentinel written at both sites (so a kept `${ONLY:...}` alone on its own
line does not leak a blank line). (5) After the pass, a whitespace-only
line carrying a removal sentinel is deleted with its newline; an
already-blank source line has no sentinel and survives. Nesting is
forbidden — any opener encountered while a span is open is `NESTED-BLOCK`
by construction, containment and crossing pairs alike.

**Diagnostics — eight, every one non-zero, naming file and line:**
`UNKNOWN-TARGET`, `EMPTY-TARGET-LIST`, `SPAN-KEPT-NOWHERE`,
`UNCLOSED-BLOCK`, `STRAY-BLOCK-END`, `MISMATCHED-BLOCK-END`,
`NESTED-BLOCK`, `UNRESOLVED-REFERENCE`. A surviving `${IDENT}` /
`${IDENT:arg}` whose `IDENT` has the ALL-CAPS shape of a vocabulary token
but matches none **warns**, never fails — the accepted residual of R4's
verbatim-passthrough guarantee (a hard error here would also claim a
legitimate literal like `${extensionPath}`).

**Two substitution layers.** `scripts/create-extension.sh` resolves
`${SKELETON_NAME}` at **scaffold** time with a blind text substitution over
every skeleton file, before `render_context` ever runs at **render** time
on the already-substituted file — `${SKELETON_NAME}` is therefore the one
row of the near-miss warning's committed known-external allow-list. The
base skeleton's own `CONTEXT.md` references `${TOOL}` and `${EXTENSION}`
only, deliberately: components are opt-in at scaffold time, and a
`${COMMAND:...}`/`${SKILL:...}` reference there would fail the render of
every base-only scaffold.

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
`extensions/<tier>/<name>/accepted-gaps.json`, one entry per accepted gap.
**Absence means the empty set** — an extension whose declarations all map
cleanly ships no such file at all. `bash scripts/build-extension.sh --check`
compares the observed set against the declared one and fails, naming the
offender, on either mismatch: a gap observed but not declared
(`GAP-UNDECLARED`), or a gap declared but no longer observed (`GAP-STALE`).
This is what keeps the gap inventory reviewable in a diff rather than
ephemeral in a render's stderr, at the cost the delta spec names plainly: a
legitimately unmappable declaration must be acknowledged twice — the render
observes it, and a human records it — and `--check` stays red until the
record lands.

**Granularity.** Every gap entry carries `subject` and `target`; a gap on
the `hooks` subject (spec 0179 R14) additionally carries `hook` (the
declaring entry's identifier), `event` (the neutral event it declared), and
`part` — `"event"` when the neutral event itself has no counterpart on the
target, `"matcher"` when the event maps but the declared matcher class does
not. These three extra fields are what let two hooks that differ only in
their neutral event produce distinguishable gap entries rather than
colliding on one `hooks@<target>` key — see `hello-world`'s own
`accepted-gaps.json` for a worked example (its `prompt-logger` hook has no
counterpart on the Antigravity CLI). The `context` subject — whose own
sub-spec has not landed — keeps using the coarser `{subject, target}` shape
these extra fields are absent from.

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
                          ├── GEMINI.md               # Context file, RENDERED from CONTEXT.md
                          │                            #   (spec 0181), when a context source is
                          │                            #   declared — never copied verbatim
                          ├── dist/                   # MCP server (copied verbatim, when built)
                          ├── commands/                # pivot .md (copied) + rendered .toml
                          ├── skills/                 # SKILL.md files (copied verbatim)
                          ├── agents/                 # PROMPT.md files (copied verbatim)
                          ├── hooks/hooks.json         # Built from the generic `hooks` section
                          │                            #   (spec 0179), when at least one hook maps
                          │                            #   on Gemini; the hooks/ handler tree itself
                          │                            #   is copied verbatim like any other file
                          └── (every other source file, copied verbatim)
```

The built `gemini-extension.json` carries exactly six fields —`name`,
`version`, `description`, `contextFileName` (spec 0181 R9: the render's own
knowledge of its target — `scripts/lib/extension-targets.json`'s
`contextOutput` column — present only when a `context` source is declared;
never authored), `mcpServers`, `themes` (from `gemini.themes`) — omitting
any whose declared value is empty, so `hello-world` (no themes) renders no
`themes` key. Its
`.version` is asserted, non-vacuously, to equal the extension's
authoritative version declaration (requirement 11) by `--check`'s
`VERSION-DRIFT` arm.

### Claude Code, Copilot CLI, Antigravity CLI: unchanged plugin build

```
extension.json ──render──> dist-{claude,copilot,antigravity}-plugin/<name>/
                          ├── plugin manifest          # Generated
                          ├── .mcp.json (Claude, Copilot)   # Generated,
                          │                                #   ${CLAUDE_PLUGIN_ROOT} /
                          │                                #   ${COPILOT_PLUGIN_ROOT} resolved
                          ├── mcp_config.json (Antigravity) # Generated, ${extensionRoot} LEFT
                          │                                #   UNRESOLVED — see
                          │                                #   scripts/install-antigravity-extension.sh
                          ├── dist/ (when mcpServers present)  # Copied — requirement 16, the
                          │                                    #   build output travels with
                          │                                    #   the declaration that names it
                          ├── CLAUDE.md (Claude)             # RENDERED from CONTEXT.md (spec 0181),
                          │   skills/<name>-context/           when declared — never copied. See
                          │     SKILL.md (Copilot)              *Context rendering* above for the
                          │   rules/AGENTS.md (Antigravity)     per-target delivery location table.
                          ├── skills/ agents/            # Copied / rendered from pivots
                          ├── hooks/hooks.json OR hooks.json  # Built from the generic `hooks`
                          │                                    #   section (spec 0179) — file
                          │                                    #   name and shape per target,
                          │                                    #   see docs/extension-hook-events.md
                          └── hooks/<handler files>      # Copied by the per-CLI builder itself
```

This half of the render is unchanged by the render-at-publication model —
these three targets already built an ephemeral plugin; only the Gemini
in-place target moved off a committed sibling. Antigravity's MCP delivery
needs one MORE step beyond the render: `scripts/install-antigravity-extension.sh`
rewrites `${extensionRoot}` to the real installed absolute path AFTER
`agy plugin install` places the plugin (spec 0180 R7's "named resolver,
named moment") — a `dist-antigravity-plugin/<name>/mcp_config.json` sitting
in the build output still carries the unresolved neutral token; that is not
a defect, it is what Option A depends on.

## Hook Systems

Gemini CLI, Claude Code, GitHub Copilot CLI and the Antigravity CLI each have
their own hook file, structural shape, matcher form, time-limit unit and
extension-root token form — and none of that surfaces in `extension.json`.
An extension declares each hook exactly ONCE, in the generic `hooks` section
above (spec 0179, issue #1005): a stable identifier, a neutral lifecycle
event drawn from a closed, evidence-backed set, one command, and optionally
a neutral tool-class matcher, a time limit in seconds, and a description.
There is exactly one declaration site — no per-CLI `hooks` key exists on
any of the four per-CLI sections, and declaring one is a manifest validation
error.

The shared translator (`scripts/lib/extension-hooks.sh`, invoked by
`scripts/build-extension.sh`) renders every declared hook into each target's
own native shape. Where a declared event or matcher class has no counterpart
on a target, the render emits a build warning and records the gap rather
than approximating it — see *Unmappable-declaration policy* below. The full
per-target correspondence — which neutral event maps to which target event,
the hook file, the matcher form, the time unit and the extension-root
token — is the normative, evidence-backed
[`docs/extension-hook-events.md`](../docs/extension-hook-events.md), kept
honest against the translator by `scripts/check-extension-hook-map.sh`.

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
