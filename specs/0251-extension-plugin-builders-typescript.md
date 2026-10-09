---
id: "0251"
slug: extension-plugin-builders-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1333
version: 1.0.0
---

# Extension and plugin builders in TypeScript

*Sub-spec G1b of the `large`-tier ticket #1231, row G1b of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirement 24, row
G, as reordered by `specs/0215-shell-to-typescript-migration.delta-01.md`),
under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27–38):
this spec-PR and its implementation pull requests target
`release/1231-ts-migration`, "shipped" means merged there, not reached `main`,
and the base ref wherever a protocol names `main` is
`origin/release/1231-ts-migration` (requirement 34). Discharges parent
requirements 8, 13, 14, 17 and 22 for the five scripts of requirement 1, and
applies requirements 2, 6, 9, 19, 21 and 23 to them. Depends on sub-spec G1a,
`specs/0250-component-build-core-typescript.md` (implemented on the release
branch: the entry form, the shim, the YAML reader, the command renderer and the
`windows-latest` job conventions this row reuses), and through it on sub-specs
C1, C2, C3 and A2 (`specs/0243`, `0248`, `0247`, `0240`). It inherits the
behavioural contracts of `specs/0042` (the command renderer), `specs/0063` and
`specs/0065` with their `delta-01` (the Antigravity and Copilot plugin builds),
`specs/0173` with its `delta-01` (the declaration model), `specs/0179` (hooks),
`specs/0180` with `specs/0185` (MCP servers), `specs/0181` (context),
`specs/0183` with its `delta-01` (the retired declaration shape and the
migration tool) and `specs/0201` `delta-01` (flat agents), and preserves them
except for the deviations of requirement 28. Line references are to
`release/1231-ts-migration` at `a81bca7`.*

## Intent

A contributor or an adopter on Windows, macOS or Linux renders an extension for
the four supported CLIs, checks that an extension still renders cleanly and
declares exactly what it ships, builds one CLI's plugin on its own, and converts
an extension written in the retired declaration shape, with the same commands on
the three operating systems and with no POSIX shell, `jq` or `yq` on the
machine. Everything those commands produce stays byte for byte what it is today,
with LF line endings whichever machine produced it, and every flag, every
message a script or a test reads and every exit status stays as it is, except
for the few listed changes, so the install flows that build a plugin on demand,
the release packaging, the scaffolding tool, the extension checks and the CI
jobs that render every extension keep working untouched. A contributor whose
Node.js is too old is told so before anything is written, and one whose machine
lacks the one third-party package the renderers need is told which package and
how to restore it.

## Requirements

1. **Entry points and decomposition.** Five TypeScript entries SHALL replace the
   behaviour of five shell scripts, each at the path of its shell predecessor
   with `.sh` changed to `.ts` (parent requirement 9, spec 0240 requirement 11),
   runnable as a direct `node` command line and written to the conventions of
   parent requirement 2 (erasable syntax, strict typing, every value entering
   from a file, the environment, a subprocess or the command line typed
   `unknown` and narrowed before use):
   `scripts/build-extension.ts` (747 lines of shell), `scripts/build-claude-plugin.ts`
   (287), `scripts/build-copilot-plugin.ts` (253),
   `scripts/build-antigravity-extension.ts` (247) and
   `scripts/migrate-extension.ts` (192). The Bash libraries
   `scripts/lib/extension-manifest.sh` (428 lines) and
   `scripts/lib/extension-hooks.sh` (375) SHALL gain TypeScript twins, and
   `scripts/lib/render-context.sh` (511) SHALL be replaced by a TypeScript module
   and deleted (requirement 25). No TypeScript file this ticket adds SHALL exceed
   the 300-line warning threshold, so the work is decomposed, one concern per
   file, into modules under `scripts/lib/extension/` covering at least: the
   manifest accessors and the declaration-shape guard; the per-CLI key, hook, MCP
   shape, MCP token and MCP name validators; the hook translator (vocabulary,
   resolution, gaps, per-target emission); the MCP delivery gate and root-token
   rewrite; the context renderer; extension resolution and discovery; the Gemini
   tree render; the delegation to the three plugin renderers; the `--check` arms;
   the gap record; the per-CLI plugin emitters; the order-preserving JSON reader
   and writer of requirement 12; the legacy-shape conversion. The plan names the
   files. The build reuses the modules of spec 0250 (`scripts/lib/render-command.ts`,
   `scripts/lib/yaml-text.ts`, `scripts/lib/require-dependency.ts`,
   `scripts/lib/paths.ts`, `scripts/lib/glob-engine.ts`, `scripts/lib/line-endings.ts`,
   `scripts/lib/tmp-file.ts`) and redefines none of their primitives; where one
   needs a new export, the export is added and its existing behaviour is untouched.

2. **Named dependencies (parent requirement 8).** After delta-01 the builders are
   step (b) of the strangler order and setup, install and manage are step (c), so
   the five scripts invoke no ahead-of-step clause. Three shared pieces belong to
   later steps, and migrate in this row for one reason and no other: they are
   dependencies of the step (b) scripts. The dependent scripts are the four
   builders; the dependencies are the twins of `extension-manifest.sh` (its other
   consumers `scripts/check-extension-*.sh` are step (e), row I1, and
   `scripts/install-extension.sh` and `scripts/install-claude-plugin.sh` are step
   (c), row F2), of `extension-hooks.sh` (its other consumers
   `scripts/check-extension-hook-{map,tokens}.sh`,
   `scripts/release-package-extension.sh` and `scripts/probe-extension-hooks.sh` are
   rows I1, G2 and J3) and of two pure helpers
   of `scripts/lib/common.sh`, `org_mcp_to_native` and `MCP_RESERVED_NAMES`, which
   the manifest library sources (their other consumers
   `scripts/setup-{gemini,copilot,antigravity}-interactive.sh` and
   `scripts/lib/gemini-settings.sh` are rows F1, F2 and J4). The three shell
   libraries stay byte for byte except for comment lines (requirement 25); the
   existence of these dependencies SHALL NOT be cited as precedent for their other
   consumers. Rows F1 and F2 depend on this one because the install entry points
   run the three plugin builders directly. The row assignment of
   `scripts/migrate-extension.sh` is the architect decomposition's: it reads the
   same legacy-shape enumeration as the builders' shape guard, and its Bash suite
   renders through `build-extension.sh`.

3. **Neutral MCP translator module.** The twins of `org_mcp_to_native` and
   `MCP_RESERVED_NAMES` SHALL live in `scripts/lib/org-mcp.ts`, outside
   `scripts/lib/extension/`, as a small stable API of pure functions that perform
   no input or output, because rows F1 and F2 import it later (the three setup
   scripts and `scripts/lib/gemini-settings.sh` call the shell original). The
   module SHALL translate a neutral `mcpServers` object into the native object of
   a CLI (`gemini`, `copilot`, `antigravity`, `claude`) exactly as the shell does:
   a value that is not an object reads as the empty object; a missing transport
   reads as `stdio`; `command` is always present for a stdio server (null when
   absent) and `args`, `env`, `cwd` and `timeout` follow in that order when
   present and truthy; `copilot` adds `type: "stdio"` last; a remote server is
   `{type, url}` plus `headers` and `timeout` for `claude` and `copilot`,
   `{serverUrl}` for `antigravity`, `{httpUrl}` for an `http` transport and
   `{url}` otherwise for `gemini`, each followed by `headers` and `timeout` when
   present and truthy. `scripts/setup-*` and `common.sh` are not edited here.
   The `org_mcp_to_native` cases of `scripts/tests/test-setup-org-mcp.sh` SHALL
   gain `node:test` cases against the module, added beside the unchanged Bash
   suite, which stays and keeps its assertions.

4. **Entry form, floor and silence.** Each of the five entries SHALL use the
   entry form of spec 0243 requirement 5 as spec 0250 requirement 3 applies it
   (no top-level `import` or `export`, the `warning` listeners removed as the
   first statement, the module graph loaded with `import()`), so that
   `node scripts/<entry>.ts` writes no Node.js warning to standard error on any
   Node.js 24 release with no flag and no environment variable on the command
   line; the plan SHALL verify the form passes the toolchain gates of spec 0238.
   As user-facing entry points (parent requirement 4) they SHALL be documented
   behind the floor-guard step — `node scripts/lib/node-floor-guard.js`, then the
   entry — and SHALL leave the filesystem unmodified on a Node.js below the floor
   (the shims of requirement 24 run the floor guard first). `js-yaml` SHALL be
   loaded only after every answer that needs no YAML has been given, through
   `loadDependency` (spec 0240 requirement 7), and a machine without it SHALL
   receive the missing-dependency diagnostic of spec 0240 requirement 7 with exit
   1 (requirement 28(a)).

5. **Command-line contract.**
   `scripts/build-extension.ts` SHALL accept `--check`, `--target <cli>`
   (`gemini`, `claude`, `copilot`, `antigravity` or `all`, default `all`) and any
   number of extension arguments, an argument being any word that is neither of
   the two flags, so an unrecognised flag is looked up as an extension and
   reported as one (`Error: extension directory or name '<arg>' not found.`,
   exit 1). Any other `--target` value SHALL exit 2 with `Error: --target must be
   one of gemini, claude, copilot, antigravity, all (got '<value>').` on standard
   error, and `--target` in final position SHALL exit 1 with an `Error:` line
   (requirement 28(b)). `scripts/build-claude-plugin.ts`,
   `scripts/build-copilot-plugin.ts` and `scripts/build-antigravity-extension.ts`
   SHALL accept `<extension-dir-or-name> [output-dir]`, further arguments ignored,
   and with no argument SHALL print a usage line naming the script and exit 1.
   `scripts/migrate-extension.ts` SHALL accept `<extension-dir-or-name>` with the
   same usage rule. The repository root SHALL be the physical parent of the
   directory holding the entry file, derived from the entry's own location and
   never by searching upward for a `.git` entry, so that a copy of `scripts/` in a
   throwaway tree builds that tree. A throwaway tree that renders anything needs a
   `.git` entry, the root `package.json` and a real copy of the production closure
   of `js-yaml` under `node_modules` (spec 0250 requirement 4).

6. **Extension resolution and discovery.** An extension argument that names an
   existing directory SHALL be used as given, made absolute; otherwise it SHALL
   be looked up as a bare name under `extensions/core/`, `extensions/library/`
   and `extensions/org/`, in that order, and found in two tiers SHALL exit 1 with
   `Error: extension '<arg>' exists in multiple tiers; names must be unique.`,
   found in none with `Error: extension directory or name '<arg>' not found.`.
   With no extension argument, `build-extension` SHALL process every directory
   `extensions/{core,library,org}/*/` that holds an `extension.json` at its root,
   tiers in that order and directories in code-unit order (requirement 28(l)). The
   plugin builders and the migration tool SHALL resolve their argument the same
   way. The three error lines of the plugin builders go to standard output, as
   today; those of `build-extension` and of the migration tool to standard error.

7. **Order of operations and exit codes.** `build-extension` SHALL proceed in this
   order, and a refusal at one step SHALL occur before the effects of every later
   step: arguments and the `--target` check; the availability of the YAML library
   (requirement 4); extension resolution; then, per extension, validation
   (requirement 9), the banner, and the renders. In build mode the first
   extension whose manifest fails validation SHALL stop the run with exit 1 and no
   closing `Done.` line (the shell's errexit, pinned by the differential test of
   requirement 22). In `--check` mode every extension and the scaffold container
   are checked and the exit status is 1 when any arm failed, 0 otherwise. Plugin
   builders SHALL exit 1 on a missing manifest, on a declaration-shape failure and
   on a context render failure, and 0 otherwise. Every scratch file and scratch
   directory SHALL be removed on every exit path, failures included.

8. **Manifest accessors and shape guard.** A manifest is `extension.json` at the
   extension root, read as JSON. A subject (`commands`, `skills`, `agents`,
   `hooks`, `mcpServers`, `context`) is present when its key exists and its value
   is not null (the legacy `components.*.enabled` fallback stays gone). A
   subject's `location` and options are read with the defaults of the shell
   accessors and used as written, concatenated to the extension directory with no
   separator inserted, exactly as the plugin builders do, so a `location` without
   a trailing slash matches nothing there (and `build-extension`, which strips
   one trailing slash, still finds it): that asymmetry is preserved. A manifest
   that carries the retired `components` object or any retired per-CLI key
   enumerated by `scripts/lib/extension-legacy-shape.json` SHALL fail with one
   `VALIDATION-ERROR: <manifest> — declares the retired '…'` line per form, naming
   `scripts/migrate-extension.sh` and `docs/adoption-guide.md` exactly as today
   (the script path in that message stays `.sh`, which stays as the shim). A
   missing or malformed enumeration file SHALL fail closed with
   `VALIDATION-ERROR: <manifest> — legacy-shape enumeration not found at <path>
   (spec 0183 R12)`. A field read as text (`name`, `version`, `description`,
   `.claude.author.name`, `.context.source` and the like) SHALL render as `jq -r`
   rendered it: a string verbatim, an absent or null value as `null` (or the
   shell's stated default), a number or a boolean as its JSON text.

9. **Validation.** `build-extension` and the three plugin builders' shared
   validator SHALL report, in this order and with the exact text of
   `scripts/lib/extension-manifest.sh` and `scripts/lib/extension-hooks.sh`, one
   `VALIDATION-ERROR: <manifest> — …` line per offence on standard error:
   the shape guard of requirement 8; every key of a per-CLI section (`gemini`,
   `claude`, `copilot`, `antigravity`) that is not a `key` row of
   `scripts/lib/extension-percli-keys.json`; every hook entry (a missing `id`, an
   `id` outside `^[A-Za-z0-9._-]+$`, a missing or unknown `event`, a missing
   `command`, an unknown matcher class, a matcher on an event that accepts none, a
   `hooks` section that is not an array); the MCP section (not an object; a
   transport outside `stdio`, `http`, `sse`; a missing `command` or `url`; a key
   outside the transport's admissible set); the MCP token rule (in `command`,
   `args` and `cwd` the only admissible `${…}` token is `${extensionRoot}`; in
   `env` and `headers` values the five known path tokens are refused and any other
   token is admissible); and the framework-reserved names (an empty reserved set
   fails closed). A failing extension SHALL print `FAIL: <ext_dir> — manifest
   validation failed (see VALIDATION-ERROR lines above)` and no `Building
   extension:` line.

10. **Hook translation.** The closed vocabulary SHALL be the shell's: events
    `PreToolUse` and `UserPromptSubmit`, matcher class `shell`, the target-event
    table (`claude` identity; `gemini` `BeforeTool` and `BeforeAgent`; `copilot`
    `preToolUse` and `userPromptSubmitted`; `antigravity` `PreToolUse` only), and
    the per-target constants of `scripts/lib/extension-targets.json`, read from that
    file and never restated. The extension-root token `${extensionRoot}` SHALL be
    replaced everywhere in a command by the target's own root token, and for a
    target whose root token is null (Antigravity) removed together with one
    following `/`, then bare. An entry without a counterpart on the target is
    omitted from the render and reported as a gap
    (`Warning: hook '<id>' declares event '<event>', which has no counterpart on
    target '<target>'`, or the matcher variant, on standard error, and a record on
    the gap channel of requirement 13); an event that accepts no matcher emits no
    matcher key; an omitted matcher on a matcher-accepting event takes the
    target's match-all form. A hook file SHALL be written only when at least one
    entry maps, at the target's `hookFile`, with the four envelopes of the shell
    (grouped by event for `claude` and `gemini`, the named-hook map keyed
    `<name>-hooks` for `antigravity`, the flat `{version: 1, disableAllHooks:
    false, hooks}` form for `copilot`), each entry's keys in the shell's order.
    The translator SHALL expose its closed event set as `ext_hooks_known_events`
    does, for the check scripts that enumerate it.

11. **MCP delivery.** Each plugin renderer SHALL read the target's `mcpDelivery`
    column once and, when it is true, translate the neutral `mcpServers` through
    the module of requirement 3, rewrite `${extensionRoot}` in every string leaf to
    the target's root token for `gemini`, `claude` and `copilot` (and leave it
    unresolved for Antigravity, whose installer resolves it), and write
    `.mcp.json` (`claude`, `copilot`) or `mcp_config.json` (`antigravity`) as
    `{mcpServers: …}` when the translation is not the empty object; in that case
    the extension's `dist/` directory and `package.json` are copied beside it when
    they exist, with the `Copied:` lines of the shell. When the column is not true
    and the manifest declares servers, the renderer SHALL print `Warning:
    extension declares mcpServers, which has no expressible delivery on target
    '<target>' — recorded as an observed gap by the parent render` on standard
    error, and `build-extension` SHALL record the gap with the reason
    `no resolvable path form for this target's MCP delivery (see
    docs/cli-matrix.md)` and print its own `Warning: extension '<name>' declares
    mcpServers, …` line.

12. **JSON reading and writing.** Every JSON file the scripts write SHALL be
    byte-identical to what `jq` wrote: two-space indentation, one key or element
    per line, `[]` and `{}` for empty containers, the keys of every object in the
    order they were written (integer-like keys included, which a plain object
    would reorder), the string escapes of `jq` (`\"`, `\\`, `\b`, `\f`, `\n`,
    `\r`, `\t`, every other control character and U+007F as lowercase `\u00xx`, no
    other character escaped, `/` not escaped, non-ASCII written as itself), a
    final line feed, and a duplicate key resolved to its last value at the position
    of its first. The `-c` compact form of the shell's intermediate records is an
    internal matter. A manifest or a descriptor that is not valid JSON SHALL fail
    with a one-line `Error:` naming the file, exit 1 or the stage's own status
    (requirement 28(c)). A number is written as JavaScript writes the value it
    parses to (requirement 28(d)).

13. **Gap record.** `build-extension` SHALL keep one gap channel per extension, in
    memory, one record per observed gap in emission order (targets in the order
    `gemini`, `claude`, `copilot`, `antigravity`; per target the hook gaps in
    declaration order, then for the plugin targets the MCP gap), each a record of
    `subject`, `target` and, for a hook gap, `hook`, `event`, `part` (`event` or
    `matcher`) and `reason`, keys in that order. The record SHALL be written to
    `build/gaps/<name>/observed-gaps.json` as a JSON array (requirement 12) only
    when all four targets were rendered, and never when a single target was; an
    empty record is the file `[]`. The record's key for comparison is `subject@target`,
    extended by `@hook@event@part` for a hook gap.

14. **Gemini render.** For a Gemini render `build-extension` SHALL replace
    `build/extensions/<name>/` with a complete installable tree: a verbatim copy of
    the extension source (dotfiles included, symbolic links reproduced as links,
    the executable bit of a file kept where the system has one) from which every
    member of the generated-output class of
    `scripts/lib/extension-generated-class.json` and any `.releaserc.json` have
    been removed; then `gemini-extension.json` (`name`, `version`, `description`,
    then `contextFileName` when the manifest declares a context source,
    `mcpServers` when the translation is non-empty and `themes` from
    `.gemini.themes` when non-empty); then the rendered context file; then
    `commands/<name>.toml` for each command source whose `name` is present (a
    source without one prints `Warning: <source> missing 'name' field, skipping`
    on standard error), rendered by the command renderer of spec 0250; then the
    hook file of requirement 10. The lines `Rendered: build/extensions/<name>/<file>`,
    indented by two spaces, SHALL be printed as today. A render failure of any one file SHALL leave the
    run going, mark the extension failed and print no output for that file.

15. **Plugin delegation.** For each of the three plugin targets `build-extension`
    SHALL run the target's plugin renderer in-process for the extension, with that
    renderer's standard output sent to standard error, and then emit the hook file
    into the renderer's output root, which is the default of the renderer
    (`<extension>/dist-claude-plugin/<name>`, `<repo>/dist-copilot-plugin/<name>`,
    `<repo>/dist-antigravity-plugin/<name>`), then the gap decision of requirement
    11, in that order; a failing renderer marks the extension failed without
    stopping the later targets. The three plugin entries SHALL remain runnable on
    their own with the same behaviour (the install scripts run them directly), and
    their output root SHALL be emptied and recreated before each build.

16. **Context renderer.** The renderer SHALL reproduce the five passes of
    `scripts/lib/render-context.sh` in the order mask, spans, tool and extension
    names, references, unmask: the literal `$${` masked (a source already holding
    U+0001 fails with `ERROR: <source> — source already contains a reserved control
    byte (U+0001); cannot render`); `${ONLY:…}…${ENDONLY}` and
    `${EXCEPT:…}…${ENDEXCEPT}` spans resolved by the five span rules of the shell
    (markers anywhere and spans across lines, a dropped span removed from its
    opener's first character to its closer's last so the text around joins, a kept
    span losing only its two markers while a removal sentinel (U+0002) is left at
    both sites, a line that is whitespace-only (space, tab or carriage return) and
    carries a sentinel deleted with its line feed, nesting forbidden); `${TOOL}`
    and `${EXTENSION}` replaced; `${COMMAND:x}` and `${SKILL:x}` resolved against
    the declared entries only (commands from the `name` of each `*.md` under the
    commands location, skills from the directory names under the skills location)
    through the descriptor's `commandRef` and `skillRef` templates; the mask
    undone. The eight diagnostics (`UNKNOWN-TARGET`, `EMPTY-TARGET-LIST`,
    `SPAN-KEPT-NOWHERE`, `UNCLOSED-BLOCK`, `STRAY-BLOCK-END`,
    `MISMATCHED-BLOCK-END`, `NESTED-BLOCK`, `UNRESOLVED-REFERENCE`) SHALL print the
    shell's text with the source and the one-based line of the marker on standard
    error, every unresolved reference being named, and fail the render with no
    output file. A surviving `${IDENT}` or `${IDENT:arg}` whose identifier matches
    `^[A-Z][A-Z_]*$` and is neither in the vocabulary nor `SKELETON_NAME` SHALL
    produce the near-miss `Warning: <source>:<line> — '<token>' has the shape of a
    vocabulary token but matches none; passed through verbatim` and not fail. The
    source's trailing line feeds SHALL be preserved. A source holding U+0003 is a
    listed deviation (requirement 28(e)).

17. **Context delivery.** A context source declared and present SHALL be rendered
    for each target into the target's own `contextOutput` of the descriptor
    (`GEMINI.md`, `CLAUDE.md`, `rules/AGENTS.md`, `skills/<name>-context/SKILL.md`),
    written only when the render succeeds, so a failure leaves no file (stray or
    empty) for any target; `claude` and `antigravity` print `Rendered: <path>`
    indented by two spaces and on failure `Error: rendering context for target '<target>' failed` and
    exit 1; `copilot` wraps the body in the five-line frontmatter of the shell
    (`name: <name>-context`, the fixed description, `user-invocable: true`), an
    empty line and the body followed by one line feed.

18. **Plugin contents.** Each plugin renderer SHALL write, in this order and with
    the progress lines of the shell: the banner lines (`Building <CLI> plugin:
    <name> v<version>`, then `Source:` and `Output:` indented by two spaces); the manifest file (`claude`:
    `.claude-plugin/plugin.json` with `name`, `description`, `version`,
    `author.name` from `.claude.author.name` or `Unknown`; `copilot` and
    `antigravity`: `plugin.json` with `name`, `version`, `description`); the MCP
    file (requirement 11); the context file (requirement 17); the skills, each
    directory under the skills location copied whole to `skills/<name>`; the
    commands rendered to skills when `commands.convertToSkills` is true and the
    directory exists (`skills/<name>/SKILL.md` made of `---`, `name`,
    `description` in double quotes with no escaping, `user-invocable: true`, for
    `claude` an `allowed-tools:` list from `.claude.defaultAllowedTools` when it is
    non-empty, `---`, an empty line, the body as the command renderer extracts it
    with its trailing line feeds removed and one added; a command whose `name` is
    absent or null is named by its file's basename); the agents (`claude`: each
    nested `AGENT.md` or flat `*.md` as `agents/<name>.md`, a nested directory
    without `AGENT.md` skipped, sibling files never copied; `copilot`:
    `agents/<name>.agent.md` from each nested `AGENT.md`; `antigravity`: each agent
    directory copied whole); the extension's `hooks/` directory copied whole when
    the manifest declares at least one hook and the directory exists; and for
    `claude` alone `settings.json` from `.claude.settings`, `.lsp.json` from
    `.claude.lsp` (each only when not empty) and `bin/` copied from the directory
    `.claude.bin` names. The final lines (`Plugin built: <dir>`, then the CLI's
    own follow-up line) SHALL be printed as today.

19. **`--check` arms.** `build-extension --check` SHALL run, for each extension, the
    five arms of the shell in order with their exact lines (`OK   <ARM> …` and
    `FAIL <ARM> <name> — …`, each indented by two spaces): COMMITTED (a member of the generated-output class
    anywhere in the source tree, or a file with a path segment that, after one
    optional leading dot and lowercasing, begins with a supported CLI's name; a
    file in both prints once, under the class message); RENDER-FAIL (a fresh
    `--target all` render whose log is printed indented by nine spaces on failure,
    ending the extension's arms); MISSING and UNDECLARED (the Gemini tree's
    generated-class members against the declared output set); GAP-UNDECLARED and
    GAP-STALE (the observed gaps against `accepted-gaps.json`, absent meaning
    empty); VERSION-DRIFT (the built manifest's version against `package.json`'s
    when the extension has one, `extension.json`'s otherwise). Once per run it SHALL
    check the name axis of `extension-skeleton/` alone. It SHALL end with
    `FAILED: <n> extension(s) failed one or more --check arms.` and exit 1, or
    `OK: every extension carries no committed generated output, renders cleanly, and
    matches its declared set.` and exit 0, and SHALL remove every
    `extensions/*/*/dist-*-plugin` directory on every exit path of the check and on
    no other path.

20. **Migration tool.** `migrate-extension` SHALL detect the same forms as the shape
    guard, plus every committed member of the generated-output class (the literal
    `manifest_class` paths, then each `generated_globs` pattern matched against the
    extension tree), and when none is present print `Already migrated: <dir>
    carries none of the retired declaration forms.` and write nothing. Otherwise it
    SHALL convert a temporary copy and replace the source tree only on full success:
    each enabled `components.<subject>` entry becomes the top-level subject minus
    `enabled`, a disabled or absent entry is dropped, an enabled entry colliding with
    an existing top-level section is listed as unconverted and fails the run with
    `Error: <dir> could not be fully converted; the source tree was left unchanged.`
    and one line per reason, `- <reason>` indented by two spaces,, the `components` object deleted, each retired
    per-CLI key dropped and each per-CLI section left empty deleted, the
    generated-class files removed. The manifest it rewrites SHALL be written as
    requirement 12 states. The replacement SHALL empty the source directory and copy
    the converted tree back with its modes and symbolic links, and the summary lines
    (`Migrated: <dir>`, then one `- …` line per form found, indented by two spaces) SHALL be printed as
    today.

21. **Line endings, paths and case (parent requirement 22).** Every file a script
    writes SHALL have LF line endings whichever machine wrote it. A manifest, a
    command source and a context source with CRLF line endings, and one beginning
    with a byte-order mark, SHALL be read as if LF and without the mark. Every path
    SHALL be built with platform-aware path handling and written to a message with
    the platform separator only where the shell wrote an absolute path; a path inside
    the output files (a relative path, a root token) SHALL use `/`. No script SHALL
    depend on two paths differing only by letter case. Files SHALL be written
    with the system's default permissions (requirement 28(f)).

22. **Parity proof (parent requirements 13, 14, 17, 22).** The pull request that
    ships the TypeScript entries SHALL carry: a Linux differential test running the
    unchanged shell scripts and the TypeScript entries over the real extension and a
    fixture matrix and comparing exit status, standard output, standard error
    (temporary names normalised) and the produced trees byte for byte, each expected
    difference tagged with the letter of requirement 28 so that an unlisted
    difference fails; a committed golden tree, generated by the shell oracle with a
    documented one-command procedure, which a Linux test keeps equal to the shell's
    output until the shell is retired and which the TypeScript output SHALL equal on
    Linux, macOS and Windows; a conformance test (Linux only, retired with the
    libraries) comparing the TypeScript twins of the validators, the hook translator
    and the MCP delivery with the sourced shell libraries over the same fixtures; unit
    suites for the context renderer (every span rule, every diagnostic, the
    near-miss rule), the JSON writer and the translator module; and a `windows-latest`
    job (requirement 23). The fixture matrix SHALL cover at least: every subject; MCP
    servers of each transport for each target; every hook event with and without a
    matcher, each gap; every context construct; commands converted to skills with
    default tools; nested and flat agents; a `.releaserc.json` and a generated-class
    stray in a source; each `--check` arm failing and passing; a legacy-shape tree
    for the migration tool, converted, already migrated and conflicting.

23. **`windows-latest` job.** A job running on `windows-latest` from PowerShell
    SHALL, after the production dependency install and the floor guard, run each of
    the five entries against the fixtures and the real extension and assert: the
    golden tree equality for `--target all`; `--check` exit 0 and its closing line;
    each plugin entry's tree against the golden tree; the migration tool's result
    tree and its second run reporting `Already migrated`; the failure statuses of an
    invalid manifest and of a context diagnostic; and that no written file holds a
    carriage return. It SHALL print the elapsed time of each step (parent requirement
    15 does not gate on it). A mismatch that is not a path or separator artefact stops
    the work and is a `spec`-class finding. The job and its capability follow the
    conventions of spec 0250 requirement 24 (`portability: specific` with the
    evidence block, mirrored by hand in `.github/workflows/build.yml`, then the CI
    file regenerated).

24. **Shims (parent requirement 9).** Each of the five shell scripts SHALL be reduced
    to a forwarding shim on the model of the shim spec 0250 requirement 22 describes:
    with no `node` on the path, one `Error:` line naming `node` and 24 and exit 1;
    otherwise the floor guard, then `exec node` of the sibling `.ts` with the
    arguments forwarded, standard input untouched. Each shim SHALL stay on
    `ci/shell-allowlist.txt` where it is today. A test SHALL prove the shim with no
    `node` and with a `node` below the floor, writing no file.

25. **Library retirement and preservation.** `scripts/lib/render-context.sh` SHALL be
    deleted in the pull request that installs the shims, together with its allowlist
    entry and every path list that names it, because its only consumers are the four
    builders. `scripts/lib/extension-manifest.sh`, `scripts/lib/extension-hooks.sh` and
    `scripts/lib/common.sh` SHALL be untouched but for comment lines: their other
    consumers are later rows, which retire them (I1, J3 and J4 respectively). The
    descriptors `scripts/lib/extension-{targets,percli-keys,generated-class,legacy-shape}.json`
    SHALL stay the single source both implementations read.

26. **Oracle (parent requirement 13).** No pull request SHALL both migrate a script
    and edit a Bash assertion of its tests. The Bash suites that exercise the five
    scripts or the libraries they replace — at authoring `test-build-extension.sh`,
    `test-build-claude-plugin-agents-glob.sh`, `test-extension-render-conformance.sh`,
    `test-extension-mcp-manifest.sh`, `test-migrate-extension.sh`,
    `test-check-extension-hook-tokens.sh`, `test-check-extension-hook-map.sh`,
    `test-install-claude-plugin-marketplace.sh`, `test-install-extension-all.sh`,
    `test-release-package-extension.sh` and `test-create-extension-combinations.sh`;
    the plan fixes the exact list by a call-trace — SHALL pass unchanged through the
    shims on Linux and macOS, except for edits made while the shell is untouched, in a
    preparatory pull request, that let a suite stage the dependencies of the
    TypeScript entries (a `.git` entry, the root `package.json`, a real copy of the
    production closure of `js-yaml`) and accept either form of an invocation it
    asserts on. That preparatory pull request SHALL leave every script and library of
    requirement 1 byte-identical (an empty diff, asserted in its description), and
    SHALL merge before the pull request that installs the shims. Any suite that cannot
    pass unchanged against a shim SHALL be named in the plan with the bounded edit it
    receives in the same preparatory pull request.

27. **Ratchet, toolchain and CI.** No file outside the permitted languages SHALL be
    added; `ci/shell-allowlist.txt` shrinks by the `render-context.sh` entry and
    gains nothing. Every new file SHALL satisfy the checks of spec 0238 and the
    300-line warning. The CI capabilities that execute a script of requirement 1
    (at authoring `extension-render` and the capabilities that call the install,
    release and create scripts) SHALL declare Node.js 24 and the production
    dependency install before their first call, the `paths:` of each SHALL name the
    TypeScript entries and modules beside the shell, and a new portable capability
    SHALL run the TypeScript suites of requirement 22; each is mirrored by hand in
    `.github/workflows/build.yml` and `.gitlab-ci.yml` is regenerated. The
    `windows-build-components` job and every existing job SHALL stay green.

28. **Listed deviations (parent requirement 14).** The observable contract changes
    only as follows, each deviation being tagged in the differential test:
    (a) a machine without `js-yaml` exits 1 with the missing-dependency diagnostic
    where the shell exited 2 with `Error: jq is required` or `Error: yq is required`
    (jq and yq are no longer prerequisites, and a machine without them works);
    (b) `--target` without a value prints an `Error:` line with exit 1 where bash
    printed its own `${2:?…}` message with its script path and line;
    (c) a manifest or descriptor that is not valid JSON prints a one-line `Error:`
    naming the file where `jq` printed its parse error;
    (d) a number is written as JavaScript writes its value, so a literal that `jq`
    1.8 preserved in a non-canonical form (a trailing `.0`, an exponent, more than
    53 bits of integer) is written in its shortest form;
    (e) a context source holding U+0003 fails with `ERROR: <source> — source already
    contains a reserved control byte (U+0003); cannot render` where the shell's
    `awk` silently dropped the text after it;
    (f) files are written with the system's default permissions where the context
    file moved from a `mktemp` file kept the mode `0600`;
    (g) every list of files is processed in code-unit order, which equals the
    shell's under the `C` locale and, for names without upper-case letters or
    punctuation, under any locale;
    (h) an absolute path printed in a message is the platform's physical form where
    the shell printed the logical form of `pwd`, when the two differ;
    (i) a usage line has no script path and line prefix.
    Letters (j) onward are reserved for the deviations the plan's differential test
    discovers and a `delta-01` of this spec records.

## Scenarios

**Scenario:** The real extension renders identically on three systems

Given the checkout of the release branch on Windows, macOS and Linux, each with
Node.js 24 and the production dependencies, and no `jq` or `yq`
When `node scripts/build-extension.ts --target all hello-world` runs
Then `build/extensions/hello-world/`, the three plugin directories and
`build/gaps/hello-world/observed-gaps.json` equal the committed golden tree byte
for byte, no file holds a carriage return, and the exit status is 0.

**Scenario:** The check passes on the repository and names a stray

Given the repository and an extension whose source tree commits a
`gemini-extension.json`
When `node scripts/build-extension.ts --check` runs
Then the clean extension prints its five `OK` arms, the other prints `FAIL
COMMITTED <name> — gemini-extension.json is a member of the generated-output class
…`, the run prints `FAILED: 1 extension(s) failed one or more --check arms.` and
exits 1, and no `dist-*-plugin` directory remains under `extensions/`.

**Scenario:** One CLI's plugin is built on its own

Given an extension declaring one stdio server, two hooks, a context source and an
agent
When `node scripts/build-claude-plugin.ts <extension> <out>` runs
Then `<out>` holds `.claude-plugin/plugin.json`, `.mcp.json` with the server's
`${CLAUDE_PLUGIN_ROOT}` path, `CLAUDE.md`, `agents/<name>.md` and `hooks/`, and the
output equals the tree the shell wrote.

**Scenario:** A hook without a counterpart is a gap, not a failure

Given an extension declaring a `UserPromptSubmit` hook
When `build-extension --target all` runs
Then the build succeeds, prints `Warning: hook '<id>' declares event
'UserPromptSubmit', which has no counterpart on target 'antigravity'` on standard
error, writes no Antigravity `hooks.json`, and records the gap in
`observed-gaps.json`.

**Scenario:** A context diagnostic leaves no output

Given a context source holding `${ONLY:copilot}` with no close
When any renderer renders it
Then `UNCLOSED-BLOCK: <source>:<line> - ONLY span opened here has no matching close
before end of file` is printed, the run fails, and no context file exists for any
target.

**Scenario:** An old-shape extension is migrated, once

Given an extension with a `components` object, a retired per-CLI key and a committed
`CLAUDE.md`
When `node scripts/migrate-extension.ts <extension>` runs twice
Then the first run converts the manifest, drops the key, removes the file and prints
the `Migrated:` summary; the converted tree passes `--check`; the second run prints
`Already migrated:` and writes nothing; a tree whose enabled subject collides with an
existing section is left byte-unchanged and the run exits 1.

**Scenario:** An invalid manifest stops the build

Given an extension whose hook declares an unknown event
When `build-extension` runs in build mode
Then `VALIDATION-ERROR: <manifest> — hooks[0] (id '…') declares event '…', outside the
admissible set {PreToolUse, UserPromptSubmit}` and `FAIL: <dir> — manifest validation
failed …` are printed, nothing is rendered for it, there is no `Done.` line, and the
exit status is 1.

**Scenario:** A too-old Node.js changes nothing

Given Node.js 20 on the path
When the shim of any of the five scripts runs
Then one line names Node.js 24 as the floor, the exit status is 1 and no file is
written.

**Scenario:** The Bash oracle passes through the shims

Given the shims installed
When the suites of requirement 26 run on Linux and macOS
Then every assertion passes unchanged.

## Out of scope

- The install and manage entry points that run the plugin builders
  (`scripts/install-*.sh`, `scripts/manage-*-component.sh`, `scripts/lib/extension-install.sh`,
  `scripts/link-extensions.sh`): row F2.
- The extension checks (`scripts/check-extension-*.sh`) and the retirement of
  `scripts/lib/extension-manifest.sh`: row I1; of `scripts/lib/extension-hooks.sh`:
  row J3 with its last consumer, `scripts/probe-extension-hooks.sh`.
- Packaging and release (`scripts/package-extension*.sh`, `scripts/release-package-extension.sh`,
  `scripts/monorepo-release.sh`): row G2. Scaffolding (`scripts/create-extension.sh`) and the
  scripts bundled in `extension-skeleton/` and `extensions/`: row H.
- Migrating any Bash test, including `scripts/tests/test-setup-org-mcp.sh`: step (e). The
  `node:test` cases of requirement 3 are added beside it.
- Editing `scripts/lib/common.sh` and the setup scripts that call `org_mcp_to_native`: rows F1
  and J4.
- Any change to the extension manifest schema, to the four descriptors' content, to the
  hook vocabulary, to a supported CLI's plugin layout, or the addition of a fifth target.
- A Windows run of the Bash oracle (parent requirement 17 asks for a non-POSIX proof of the
  TypeScript scripts only), and a latency budget (a build is not a CLI integration point).
- Reproducing the shell's locale-dependent file order (requirement 28(g)) and its
  `awk` truncation at U+0003 (requirement 28(e)).

## Open questions

- None.
