---
id: "0250"
slug: component-build-core-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1332
version: 1.0.0
---

# Component build core in TypeScript

*Sub-spec G1a of the `large`-tier ticket #1231, row G1a of the architect
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
requirements 8 (the named dependency of requirement 2 below), 13, 14, 17 and 22
for `scripts/build-components.sh`, and applies requirements 2, 6, 9, 19 and 23
to it. Depends on sub-spec C2, `specs/0248-worktree-git-guard-typescript.md`
(the forwarding-shim shape and the `windows-latest` job conventions), on sub-spec
C3, `specs/0247-mempalace-transcript-hook-typescript.md` (the same conventions,
as last applied), on sub-spec C1, `specs/0243-usage-capture-hooks-typescript.md`
(the entry form of its requirement 5) and on sub-spec A2,
`specs/0240-runtime-foundations-shared-ts-modules.md` with its `delta-01` (the
shared modules, the missing-dependency primitive, the Node.js floor guard and the
`windows-latest` template); C2 and C3 are `implemented` on the release branch.
It inherits the behavioural contracts of `specs/0019` and
`docs/adr/0011-artifact-build-install-scope.md` (tier routing),
`specs/0042` (the command renderer), `specs/0119` (the installed-name collision
pre-pass), `specs/0125` (`--list-output-dirs`), `specs/0198` (model resolution,
`--resolve`, `--diagnostics`) and `specs/0199` (the organisation override merge,
`MAPPING_MERGE_DIR`, the merge counter), and preserves them except for the
deviations listed in requirement 33. It reuses the shared modules of spec 0240
and redefines none of their primitives. Line references are to
`release/1231-ts-migration` at `3b64acb`.*

## Intent

A contributor on Windows, macOS or Linux regenerates every built component for
the four supported CLIs, and checks that the committed outputs still match their
sources, with one command that behaves the same on the three operating systems
and needs neither a POSIX shell nor `yq`. The generated trees under `.claude/`,
`.gemini/`, `.github/` and `.agents/` stay byte-for-byte what they are today, with
LF line endings whichever machine produced them, and a source file checked out
with CRLF line endings builds the same output. Every flag, every message a script
or a test reads, and every exit status of the build stays as it is, except for the
few listed changes, so the setup and install flows that rebuild components on
demand, the per-component install commands, the organisation-level model-mapping
override and the drift gate keep working untouched. A contributor who runs the
check on a machine that lacks the build's one third-party package is told which
package is missing and how to restore it, and a contributor whose Node.js is too
old is told so before anything is written.

## Requirements

1. **Entry point and decomposition.** `scripts/build-components.ts` SHALL replace
   the behaviour of `scripts/build-components.sh` (1,139 lines), at the path of its
   shell predecessor with `.sh` changed to `.ts` (parent requirement 9, spec 0240
   requirement 11), runnable as a direct `node` command line, written to the
   conventions of parent requirement 2 (erasable syntax, strict typing, every value
   entering from a file, the environment, a subprocess or the command line typed
   `unknown` and narrowed before use). No TypeScript file this ticket adds SHALL
   exceed the 300-line warning threshold, so the script is decomposed, one concern
   per file, into modules under `scripts/lib/build-components/` covering at least:
   argument parsing; `crewrig.config.toml` reading, placeholder resolution and the
   `canonical_repo` validation; frontmatter and body extraction with field access;
   the provenance block, the Gemini provenance comment and the splice; the
   per-CLI emitters for skills, for commands and for agents; tier discovery,
   output routing and the check-versus-write decision; and skill resource
   propagation. The plan names the files.

2. **Named dependency (parent requirement 8).** After delta-01 the build is step
   (b) of the strangler order and setup, install and manage are step (c), so this
   row sits in its own step and invokes no ahead-of-step clause for the build
   itself. Two libraries the build sources do belong to later steps, and their
   slices migrate in this row for one reason and no other: they are dependencies
   of `scripts/build-components.sh`, a step (b) script. The dependent script is
   `scripts/build-components.sh`; the dependencies are the collision pre-pass of
   `scripts/lib/component-resolve.sh` (its other consumers, the four
   `scripts/manage-*-component.sh` scripts, are step (c), row F2) and the closure
   of `resolve_agent` in `scripts/lib/model-resolve.sh` (its other consumers,
   `scripts/check-model-mappings.sh` and the Bash suites, are step (e), rows I2
   and J). `scripts/lib/render-command.sh` is a step (b) library shared with the
   extension and plugin builders (row G1b) and migrates here complete. A TypeScript
   build cannot keep sourcing these libraries, because parent requirement 23
   forbids a migrated script from spawning a POSIX-only tool and parent
   requirements 5 and 17 forbid a POSIX shell as a prerequisite and as a proof
   environment. The existence of this dependency SHALL NOT be cited as precedent
   for the other consumers of the three libraries, which are later rows. Rows F1
   and F2 depend on this one because every setup and manage script calls the build.

3. **Entry form, floor and silence.** The entry file SHALL use the entry form of
   spec 0243 requirement 5, reused and not redefined (no top-level `import` or
   `export`, the `warning` listeners removed as the first statement), so that
   `node scripts/build-components.ts` writes no Node.js warning to standard error
   on any Node.js 24 release with no flag and no environment variable on the
   command line; the plan SHALL verify the form passes the toolchain gates of spec
   0238. As a user-facing entry point (parent requirement 4) it SHALL be documented
   behind the floor-guard step the way `docs/ticket-ownership.md` documents
   `ticket-pickup` — `node scripts/lib/node-floor-guard.js`, then `node
   scripts/build-components.ts` — and SHALL leave the filesystem unmodified on a
   Node.js below the floor (the shim of requirement 22 and the Taskfile tasks of
   requirement 31 run the floor guard first).

4. **Command-line contract.** The entry SHALL accept `--target <cli>` (`gemini`,
   `claude`, `copilot`, `antigravity` or `all`, default `all`; any other value
   selects no CLI, so a build prints its progress lines and writes nothing, as
   today), `--tier <name>` (repeatable; an unknown name matches nothing),
   `--check`, `--list-output-dirs`, `--resolve <source> <target>` and
   `--diagnostics <path>`, and the environment variables `REPO_DIR`,
   `MAPPING_MERGE_DIR` and `TMPDIR`. An unrecognised argument SHALL be ignored,
   one argument at a time, and a value-taking flag in final position (and
   `--resolve` with fewer than two values) SHALL exit 1 with an `Error:` line on
   standard error. `REPO_DIR` SHALL default to the physical parent of the
   directory that holds the entry file, derived from the entry file's own location
   and never by searching upward for a `.git` entry, so that a copy of `scripts/`
   in a throwaway tree builds that tree (requirement 26 lists the suites that do
   this). Loading `js-yaml` goes through `loadDependency` (spec 0240 requirement
   7), which walks up from its own file to a `.git` entry and accepts a package
   only when its real path lies under that root's `node_modules`
   (`scripts/lib/require-dependency.ts`, `scripts/lib/paths.ts`). A throwaway tree
   that builds more than `--list-output-dirs` therefore SHALL carry a `.git` entry,
   the root `package.json` and a real copy, never a symbolic link, of the
   production closure of `js-yaml` under `node_modules`; the entry needs none of
   the three to answer `--list-output-dirs` or to print the floor diagnostic.

5. **`--list-output-dirs` (spec 0125).** This flag SHALL answer before anything
   else is read: with no `crewrig.config.toml`, no `artifacts/` directory, no
   `node_modules` and no YAML library on the machine it SHALL print the declared
   output directories and exit 0. The set SHALL be, for each tier (default `core`
   alone, otherwise each `--tier` value) and each target (`gemini`:
   `.gemini/skills`, `.gemini/commands`, `.gemini/agents`; `claude`:
   `.claude/skills`, `.claude/agents`; `copilot` or `github`: `.github/skills`,
   `.github/agents`; `antigravity`: `.agents/skills`, `.agents/agents`), prefixed
   `dist/<tier>/` for every tier except `core`, printed one per line, unique, in
   code-unit order. That order equals the shell's under the C locale and for the
   default `core` tier under any locale, and is a listed deviation otherwise
   (requirement 33(l)). A target that selects no CLI (`--target nope`) prints one
   empty line and exits 0, as the shell does, whose `printf '%s\n'` over an empty
   list prints a newline; that is preserved. A test SHALL prove the flag runs where the YAML library
   cannot be loaded.

6. **`--resolve` and `--diagnostics` (spec 0198 requirements 6 and 34).**
   `--resolve <source> <target>` SHALL run before the configuration is read and
   before the `canonical_repo` validation, write no compiled output, read the
   agent name from the source's frontmatter, resolve the pair, and print, in this
   order and each only when non-empty, `offering: <id>`, `native: <value>`, one
   `fm: <line>` per directed frontmatter line, `prose: <text>`, and send every
   diagnostic line to standard error, then remove the merge root the library
   derived (requirement 20) and exit 0. When `--diagnostics <path>` is also given,
   `--resolve` SHALL truncate the file first and every diagnostic line SHALL be
   appended to it as well as written to standard error. A build (without
   `--resolve`) SHALL append to the file and never truncate it. A source that
   cannot be read SHALL exit 2 (the shell's incidental awk status, preserved).

7. **Configuration, placeholders and `canonical_repo`.** The build SHALL read
   `crewrig.config.toml` at `REPO_DIR` line by line: split at the first `=`; the
   key is the text before it with every whitespace character removed, skipped when
   empty or beginning with `#`; the value is the text after it with leading
   whitespace and one optional leading double quote removed, then the first match,
   searched left to right, of an optional double quote immediately followed by
   whitespace through the end of the line removed (the text `abc"` plus one space
   becomes `abc`; the text `abc`, one space and a quote becomes `abc` plus one
   space, because whitespace before the quote is kept); a repeated key
   keeps its last value; a last line with no line terminator is not read, as the
   shell's `read` loop does not read it. LF and CRLF files SHALL both parse. A missing file SHALL write
   `Warning: <path> not found — placeholders will be left literal.` to standard
   error and continue. A key whose upper-cased form is not a valid identifier
   (`[A-Za-z_][A-Za-z0-9_]*`, which a TOML table header and a hyphenated key are
   not) SHALL exit 1 with an `Error:` naming the line, as the shell aborted on it,
   with status 1 or 2 according to the character (requirement 33(i)). Every
   `${KEY}` placeholder, `KEY` being the upper-cased key, SHALL be replaced in the
   generated text, all occurrences, literally (no character of a value is special),
   one key after another in file order, so a value that itself contains a later
   key's placeholder is substituted by that key.
   When `canonical_repo` is non-empty and does not match
   `^https://<host>/<owner>/<repo>/?$` (no whitespace, no further path segment, no
   other scheme), the build SHALL exit 1 before any standard output with
   `Error: canonical_repo in crewrig.config.toml is malformed: '<value>'` and
   `Expected: https://<host>/<owner>/<repo> (no deeper path, no file:// scheme)`
   on standard error.

8. **Order of operations and exit codes.** The build SHALL proceed in this order,
   and a refusal at one step SHALL occur before the effects of every later step:
   arguments; `--list-output-dirs`; availability of the YAML library (requirement
   24: exit 1 with the missing-dependency diagnostic of spec 0240 requirement 7,
   replacing the shell's `Error: yq is required`); `--resolve`; configuration and
   the `canonical_repo` validation; the banner on standard output (a rule line, the
   title, the target and mode lines, a rule line and an empty line); creation of
   the `--check` staging root; the installed-name collision pre-pass (requirement 17), over every tier and all four CLIs whatever `--tier`
   and `--target` say, in build and in `--check`, before any file is written; the
   tier loop; the drift verdict. A collision SHALL write the pre-pass reports
   followed by `FAILED: two components would be installed under one name into one
   landing zone.` and two continuation lines indented by eight spaces
   (`Rename one of them, or move one to a tier with a different landing zone.`
   and `See artifacts/FORMAT.md -> Validation Rules.`) to standard error and
   exit 1. The exit statuses SHALL be 0 (success, or `--check` clean), 1 (validator,
   collision, drift, usage, missing dependency) and 2 (requirement 6). The staging root and the merge root the library derived
   SHALL be removed on every exit path, failures included.

9. **Tiers, routing and check versus write (ADR-0011).** The build SHALL compile
   every subdirectory of `<REPO_DIR>/artifacts/` (a symbolic link to a directory
   counts as a directory; names beginning with `.` and plain files are ignored; an
   absent `artifacts/` yields zero tiers, exit 0), in code-unit order, narrowed by
   `--tier`. Within a tier it SHALL process `skills/*/SKILL.md`, then
   `commands/*.md`, then `agents/*/AGENT.md`, each in code-unit order, with the
   same directory-link rule at the skill and agent level (the assembly suite links
   two components into a throwaway root). The output root SHALL be `REPO_DIR` for
   `core`, `REPO_DIR/dist/<tier>` for every other tier in a build, and a throwaway
   staging root for every other tier in `--check`, where those tiers are compiled
   and discarded, never compared. In `--check` only `core` outputs SHALL be
   compared; a missing file SHALL print `DRIFT: <file> does not exist (expected
   from source)` and a differing one `DRIFT: <file> differs from source` on
   standard output. A build SHALL print `Generated: <file>`, indented by two spaces, for each
   file it writes and `Building skill|command|agent: <name>` for each component,
   and the progress lines `--- Tier: <tier> (output root: <root>) ---`, the banner
   and `Done.` or `OK: All generated files match source.` SHALL be as today,
   because suites filter on them. A source whose `name` is absent SHALL print `Warning:
   <source> missing 'name' field, skipping` on standard output and be skipped
   (requirement 33(f)).

10. **Frontmatter and body extraction.** The frontmatter of a source SHALL be the
    lines between line 1, when it is exactly `---`, and the next line that is
    exactly `---` (every line to the end of the file when none follows); when line
    1 is not `---` there is no frontmatter and every field reads as absent. The
    body SHALL be every line after the second line, counted from the start of the
    file, that is exactly `---`, so a bare `---` inside a fenced block of the body
    belongs to the body and never to the frontmatter. A file with CRLF line
    endings, and one that begins with a UTF-8 byte-order mark, SHALL be read as if
    LF and without the mark (parent requirement 22; requirement 33(e)). A
    frontmatter that does not parse SHALL read as having no field, so the source
    is reported by the `name` warning of requirement 9 as the shell reported it.

11. **YAML contract (parent requirement 23).** YAML SHALL be read with `js-yaml`
    and no `yq` or other POSIX tool SHALL be spawned. The library SHALL be loaded
    only through `loadDependency` of `scripts/lib/require-dependency.ts`, and the
    schema SHALL be pinned explicitly and never be the library default (which
    resolves timestamps and merge keys). The build SHALL render every scalar it
    reads as the text `yq -r` printed in the shell's own queries, never as the
    parsed value:
    - plain, quoted and block scalars (literal and folded, every chomping
      indicator) give the text YAML defines, then every trailing line feed removed,
      as the shell's command substitution removed it, and the shell's own
      comparisons (`-z`, `= "null"`) apply to the rendered text unchanged;
    - numbers, booleans and null spellings keep the characters written: `1.0`
      stays `1.0`, `007`, `0x1F`, `1e3`, `True`, `~` and `null` likewise;
    - a plain read of an absent key renders `null`, of an empty value renders the
      empty text;
    - a read written `// ""` (the provenance `version`, `canonical` and
      `feedback`) renders the empty text for an absent key, a null in any
      spelling, `false` and the empty string, and the written text otherwise,
      `0` included;
    - an array read yields its elements in order, each rendered as a scalar; a
      read of `has(<key>)` is true when the key is present, whatever its value.

    The plan chooses the mechanism that meets this (for example reading the
    frontmatter for its structure and for its written text separately). A corpus
    test SHALL read every field the build reads — `name`, `description`,
    `license`, `compatibility`, `claude.allowed-tools`, `claude.user-invocable`,
    `claude.disable-model-invocation`, `claude.context`, `claude.agent`,
    `antigravity.enable_write_tools`, `antigravity.enable_mcp_tools`,
    `antigravity.enable_subagent_tools`, `metadata.provenance.*` and
    `metadata.model.*` — from every tier source under `artifacts/`, `tests/fixtures/`
    and `scripts/tests/fixtures/agent-profiles/` with both `yq` and the build's
    reader, on Linux, and fail on any difference; and a fixture corpus SHALL cover
    the awkward shapes, at least a number-like and a boolean-like value, a null
    spelling, an empty value, a quoted number, each block-scalar chomping, a folded
    scalar with a blank line, a multi-line plain and quoted scalar, a colon followed by a space inside
    a quoted scalar, a long line, a non-string sequence item, CRLF and a byte-order
    mark. At authoring, 47 sources (45 skill and agent sources and 2 commands; 14
    use a block scalar and 29 a quoted description) were read for 20 fields with
    `yq` v4.54.1 and `js-yaml` 4.3.0 under both the core and the failsafe schema,
    with no difference. The test is Linux-only, spawns `yq` on purpose, and retires
    with the last yq-based suite.

12. **Provenance.** A source carries provenance when its `metadata` is a mapping
    that has the key `provenance`. The block spliced into a Markdown output SHALL
    be `metadata:`, then `provenance:` indented by two spaces, then, for every
    entry of the source's provenance in document order, `<key>: "<value>"` indented
    by four spaces, with the value rendered as a scalar (a null renders empty, a double quote
    inside a value is not escaped). A provenance entry whose value is a mapping or a sequence SHALL exit 1 naming
    the source (requirement 33(g)). The block SHALL be inserted before the second
    line of the output that is exactly `---`, and not at all when the output has
    fewer than two (so a command rendered to TOML would receive it at its second
    `---` line, if any, exactly as today; no source on `main` carries provenance on
    a command). The Gemini agent comment SHALL be `<!-- crewrig-provenance:
    version="<v>" canonical="<c>" feedback="<f>" -->` and the TOML comment
    `# crewrig-provenance: version="<v>" canonical="<c>" feedback="<f>"`, each field
    rendered by the `// ""` rule of requirement 11, each comment empty when there is
    no provenance. Placeholders SHALL be resolved after the splice, so a
    `${CANONICAL_REPO}` inside a provenance value is resolved.

13. **Emission rules.** For each component and each selected CLI the build SHALL
    write exactly the file the shell wrote, with the lines of its frontmatter in
    this order, each line present only as stated:
    - *Skills* (all four CLIs, `<out>/<cli-root>/skills/<name>/SKILL.md`; the
      Gemini, Copilot and Antigravity files share one shape): `name: <name>`,
      `description: "<description>"`, `license: <license>` when its rendered text
      is neither empty nor `null`, `compatibility: "<compatibility>"` likewise;
      Claude Code adds, after those, `allowed-tools:` with one `- <tool>` line,
      indented by two spaces, per element of `claude.allowed-tools` when there is one, then
      `user-invocable`, `disable-model-invocation`, `context` and `agent`, each
      from its `claude.*` key and present only when its rendered text is neither
      empty nor `null`. The file is `---`, the frontmatter, `---`, an empty line,
      the body. In tier `core` only, `../../../../docs/` and `../../../../specs/`
      in the body are rewritten to `../../../docs/` and `../../../specs/`, all
      occurrences. The provenance block is spliced into every skill file.
    - *Commands*: Gemini CLI `.gemini/commands/<name>.toml` from the command
      renderer of requirement 18; Claude Code `.claude/skills/<name>/SKILL.md`
      from the same renderer; Copilot CLI `.github/skills/<name>/SKILL.md` with
      `name`, `description` and the `allowed-tools:` list; Antigravity CLI
      `.agents/skills/<name>/SKILL.md` with `name` and `description`; the body is
      never link-rewritten, the provenance block is spliced into every file, and no
      resources are propagated.
    - *Agents*, each after resolving the agent's capability profile for that CLI
      (requirement 19) and writing its diagnostic lines to standard error and to
      `--diagnostics`, and with `description` equal to the description followed by
      one space and the resolved prose when there is prose: Gemini CLI
      `.gemini/agents/<name>.md` with `name`, `description` and the directed
      frontmatter lines, then `---`, the Gemini provenance comment line (an empty
      line when none), the body, and no splice; Claude Code
      `.claude/agents/<name>.md` with `name`, `description`, `license`,
      `compatibility` and the directed lines; Copilot CLI `.github/agents/<name>.md`
      with `name`, `description` and the directed lines; Antigravity CLI
      `.agents/agents/<name>/AGENT.md` with `name`, `description`, `license`,
      `compatibility`, `enable_write_tools`, `enable_mcp_tools`,
      `enable_subagent_tools` and the directed lines, where each `enable_*` line is
      present when `antigravity.<key>` is present with a rendered text that is
      neither empty nor `null`, and `enable_write_tools` falls back to `true` when
      that does not hold and `claude.allowed-tools` has an element equal to `Bash`.
      The Claude Code, Copilot CLI and Antigravity CLI agent files are `---`, the
      frontmatter, `---`, an empty line, the body, with the provenance block
      spliced in.

14. **Output bytes (parent requirement 22).** The text of every generated file
    SHALL be the assembled text with every trailing line feed removed and exactly
    one line feed appended, with LF line endings whatever the host and whatever
    the line endings of the sources, no byte-order mark, UTF-8 throughout. The
    expected bytes of a `--check` comparison SHALL be the same bytes and the
    comparison SHALL be exact. The committed `.claude/`, `.gemini/`, `.github/` and
    `.agents/` trees SHALL be reproduced byte for byte, proven on Linux by the
    drift job and on `windows-latest` by requirement 28, which writes a build into
    a throwaway root and compares every produced file with the committed tree.
    Line-ending normalisation SHALL reuse `toLf` of `scripts/lib/line-endings.ts`.

15. **Skill resources.** For each skill the build SHALL propagate the regular
    files under the skill's `scripts/`, `references/` and `assets/` folders (in
    that order, files in code-unit order of their relative path, dotfiles
    included) to the same relative path under the skill's output directory, for
    each selected CLI. A file ending in `.md` SHALL have `../../../../../docs/` and
    `../../../../../specs/` rewritten to `../../../../docs/` and
    `../../../../specs/`, all occurrences, and every other byte left alone; any
    other file SHALL be copied byte for byte and never line-ending-normalised. A
    symbolic link inside a resource folder SHALL be neither followed nor copied. In
    `--check`, a `core` resource that is missing or differs in bytes SHALL be
    reported as in requirement 9. On macOS and Linux a resource whose source has an
    execute bit SHALL leave its copy with the execute bits `chmod +x` grants under
    the process umask, an existing copy's other mode bits SHALL be kept and no bit
    SHALL ever be cleared; on Windows this is a no-op, and `--check` never compared
    modes on any system.

16. **Modes and temporary roots.** Generated files SHALL be created with the mode
    the shell's redirection gave them (umask-governed on macOS and Linux, not
    owner-only), so the publish helpers of `scripts/lib/tmp-file.ts`, which create
    owner-only files, SHALL NOT be the writer of a generated file unless the mode is
    then restored; a rewritten file keeps its existing mode. The `--check` staging
    root SHALL be a directory created under the platform temporary directory with a
    collision-free name, owner-only where the platform honours it, and removed on
    every exit path. `scripts/lib/tmp-file.ts` has no directory helper, so any
    shared one the plan adds SHALL be a new module under `scripts/lib/` (spec 0240
    requirement 11).

17. **Collision pre-pass (spec 0119 requirement 13).** A TypeScript twin of
    `installed_targets`, `report_installed_name_collisions`, `report_collision` and
    their private helpers SHALL live at `scripts/lib/component-resolve.ts`, so row
    F2 extends the same module, and SHALL carry nothing else of the shell library
    (`resolve_component_in_roots`, `enumerate_components_in_roots`,
    `report_unresolved`, `component_set_*`, `component_read_lines`,
    `ensure_overlay_tiers_fresh` and the install drivers stay Bash until F2). It
    SHALL emit the records `<tier-class>`, `<install-target>`, `<tier>`, `<kind>`
    per target exactly as the shell does, tiers in code-unit order and, within a
    tier, skills, commands, agents, policies, hooks, themes and mcp-servers, keyed
    on `(tier-class, install-target)` and never on the name alone. A component's
    name SHALL be read by the shell's line-based rule and not by the YAML read of
    requirement 11: the first line of the leading frontmatter that begins with `name:`
    (a line `---` possibly followed by blanks opens and closes it), the text after
    the colon and its blanks, then one trailing and one leading double quote removed,
    then one trailing and one leading single quote removed, carriage returns and
    trailing whitespace removed, the directory or file name when empty. Duplicate
    targets SHALL be reported in code-unit order (the shell's `sort` under the C
    locale), the name shown being the target's base name without a `mcpServers.` or
    `settings.themes.` prefix and without a `.md`, `.toml` or `.json` suffix, each
    through `report_collision`'s two-line header
    `Refusing '<name>': one installed name is claimed by more than one component.`
    and `Every source presenting it, in no significant order:` and one line per
    source in record order, indented by two spaces and reading `- tier '<tier>'
    declares a <kind> component installing to <target>`, on standard error, and the
    function SHALL report refusal.

18. **Command renderer (spec 0042).** A TypeScript twin of
    `scripts/lib/render-command.sh` SHALL live at `scripts/lib/render-command.ts`,
    complete — `render_command_gemini`, `render_command_claude`,
    `render_command_toml_provenance_comment` and the three extraction helpers — so
    that row G1b reuses it unchanged. Its strings SHALL carry no trailing line
    feed (callers add one), equal the shell's for every command source of
    `artifacts/`, for `extensions/core/hello-world/commands/hello.md` and for a
    synthetic command carrying provenance (the sources
    `scripts/tests/test-build-extension.sh` renders), and the Gemini form with
    provenance SHALL put the `# crewrig-provenance:` line above `description`.

19. **Model resolution (spec 0198).** A TypeScript twin of the closure of
    `resolve_agent` in `scripts/lib/model-resolve.sh` SHALL live at
    `scripts/lib/model-resolve.ts` (helper modules under `scripts/lib/model-resolve/`,
    each within the size threshold), exporting `resolveAgent`, `mappingInForce`
    and `mappingMergeCleanup`. The boundary the ticket asked to be read from the
    consumers is: all 50 functions of the shell library are reachable from
    `resolve_agent` or `mapping_merge_cleanup`, so no accessor stays behind;
    `scripts/check-model-mappings.sh` consumes only `mapping_in_force`, through a
    subshell that sets its own `MAPPING_MERGE_DIR`, and `scripts/check-agent-profiles.sh`
    sources nothing from the library; the shell library therefore stays whole, for
    its remaining sourcers (requirement 23), not because part of it is unmigrated.
    `resolveAgent` SHALL never throw, SHALL write no file other than the merge
    files of requirement 20, and SHALL set the four outputs of the shell —
    `RESOLVED_OFFERING_ID`, `RESOLVED_NATIVE_VALUE`, the directed frontmatter lines,
    the prose — and the diagnostic lines, tab-separated, `model-drop` with agent,
    target, dotted path, declared value and reason, or `model-note` with agent,
    target, category and detail, in the order the shell produces them, for every
    (agent, target) pair, reading a mapping through the scalar rendering of
    requirement 11. A mapping file that cannot be parsed SHALL read as an empty
    document (spec 0198 requirements 4 and 17), never as an error. The rules
    (rung ladders, floor and ceiling, the narrowing order, encoded-reasoning
    narrowing, lowest rank, the per-item gate, guard withholding, guidance
    rendering) are those of spec 0198 as the shell library realises them.

20. **Organisation override merge (spec 0199).** `mappingInForce` SHALL return the
    core mapping alone (`<REPO_DIR>/model-mappings/<target>.yml`) when
    `<target>.org.yml` is absent or declares nothing, and otherwise the path of a
    materialised merge. The merge root SHALL be `MAPPING_MERGE_DIR` with a trailing
    slash removed when set and non-empty, else `<TMPDIR or the platform temporary
    directory>/crewrig-mapping-<pid>`; created owner-only; reused only when owned by
    the current user on macOS and Linux (skipped on Windows, where ownership is not
    modelled), otherwise the core mapping (nothing when it does not exist) is returned
    with a `mapping-merge-note<TAB><target><TAB>merge-unavailable<TAB>root=<root>`
    line on standard error. The merged document SHALL live at
    `<root>/<digest>/<target>.yml`, where the digest is the lower-case SHA-256 of the
    bytes `<target>`, NUL, the core file's bytes (nothing when it does not exist),
    NUL, the org file's bytes, so both implementations compute the same path; an
    existing document SHALL be reused without a merge. Each merge SHALL append
    `<target>` and a line feed to `<root>/.merges`, and SHALL write the
    `mapping-merge` and `mapping-merge-note` lines of spec 0199 to standard error in
    its order. `mappingMergeCleanup` SHALL remove the merge root when and only when
    it was derived by the library (not when `MAPPING_MERGE_DIR` is set). The merged
    document SHALL be equal to the shell's after loading (node order and the
    top-level key order of spec 0199 requirement 26), not byte-identical (requirement
    33(h)), and a document written by either implementation SHALL be readable by the
    other.

21. **Conformance test between the two implementations.** A test, run on Linux
    only, spawning `bash` on purpose and retired together with the shell library in
    row I2, SHALL run the shell library and the TypeScript twin over the same
    fixture corpus and compare the offering id, the native value, the directed
    frontmatter lines, the prose and the diagnostic lines of `resolve_agent` and
    `resolveAgent` for the 22 core agent sources on the four targets, for every
    fixture of `scripts/tests/fixtures/agent-profiles/`, and for the mapping
    mutations and organisation-channel cases that `scripts/tests/test-model-resolution.sh`
    builds; and SHALL compare the merge digest, the `.merges` content and the
    standard-error lines for the organisation-channel cases. It SHALL also compare
    the collision pre-pass reports (requirement 17) and the command renderer
    (requirement 18) over their fixtures. The drift risk is named: two
    implementations of the resolution coexist until I2, so a change to either must
    be made in both, and spec 0215 delta-04 requirement 31 already obliges a change
    made on `main` to the shell original to be ported at sync time; the test turns
    that obligation into a failure instead of a recollection.

22. **Forwarding shim, fail-closed.** `scripts/build-components.sh` SHALL remain,
    reduced to a shim that locates its own directory physically, writes one
    `Error:` line naming the missing `node` and the Node.js 24 floor to standard
    error and exits 1 when `node` is absent, runs `scripts/lib/node-floor-guard.js`
    and exits with its status and diagnostic when that is non-zero, and otherwise
    replaces itself with `node scripts/build-components.ts` passing every argument
    unchanged, returning the entry's status, standard output and standard error
    unchanged, standard input untouched. It is fail-closed, unlike the hook shims of
    spec 0248, because a build that cannot run must not report success. It SHALL
    stay on `ci/shell-allowlist.txt` without adding an entry, and `REPO_DIR` and
    every other environment variable SHALL reach the entry as set.

23. **The shell libraries stay.** `scripts/lib/render-command.sh`,
    `scripts/lib/component-resolve.sh` and `scripts/lib/model-resolve.sh` SHALL stay
    byte-for-byte unchanged apart from comment lines outside function bodies, because
    suite O8 of `scripts/tests/test-model-resolution.sh` pins the hash of each
    non-merge accessor body. Each retires with its last consumer: `render-command.sh`
    (sourced by `scripts/build-extension.sh`, `scripts/build-claude-plugin.sh`,
    `scripts/build-copilot-plugin.sh`, `scripts/build-antigravity-extension.sh`,
    `scripts/lib/render-context.sh` and `scripts/tests/test-build-extension.sh`) with
    row G1b; `component-resolve.sh` (sourced by `scripts/manage-claude-component.sh`,
    `scripts/manage-copilot-component.sh`, `scripts/manage-workspace-component.sh`,
    `scripts/manage-antigravity-component.sh` and
    `scripts/tests/test-component-tier-resolution.sh`) with row F2 and its test; and
    `model-resolve.sh` (sourced by `scripts/check-model-mappings.sh`, and in-process
    by `scripts/tests/test-model-resolution.sh`) with rows I2 and J. The
    Bash invocations of `bash scripts/build-components.sh` inside shell scripts that
    have not migrated (`scripts/lib/common.sh`, `scripts/lib/component-resolve.sh`)
    stay and reach the entry through the shim until their own row.

24. **Dependency.** `js-yaml` SHALL move from `devDependencies` to `dependencies` of
    the root `package.json` with `package-lock.json` updated (parent requirements 6
    and 23), at the version the lockfile already pins, adding no package. No build
    module SHALL import it statically; the entry SHALL load it once through
    `loadDependency` after `--list-output-dirs`. Should it be missing, the build SHALL
    exit 1 with the diagnostic of spec 0240 requirement 7 naming `js-yaml` and the
    setup to re-run, having written nothing, and never an unhandled
    module-resolution error. Spec 0215 delta-04 requirement 35 records that
    `security-mcp.yml` does not run on the release branch, so the implementation PR
    SHALL run `npm audit --audit-level=critical` locally and record its result on its
    logbook comment. The ambient declaration `scripts/lib/js-yaml.d.ts` MAY be
    widened only as far as the build needs, and `@types/js-yaml` SHALL NOT be added.

25. **`--check` and the assembly test.** `--check` SHALL NOT run, and the entry SHALL
    NOT spawn `bash` for, `scripts/tests/test-assembly-verification.sh` (parent
    requirement 23); its last act SHALL be the drift verdict. That test, with its
    assertions unchanged, SHALL run as a gate step that triggers on every change
    that triggered `--check`'s chained run. The repository already registers it
    as a step of the `frontmatter` capability of `ci/ci-capabilities.yml` and of
    the matching `build.yml` job, under `scripts/ci-cache-guard.sh --stray-scan`,
    so `scripts/check-test-wiring.sh` stays satisfied; but that capability's path
    filter names neither `scripts/build-components.sh` nor the entry file (its
    `scripts/lib/**` entry already covers the modules), so the plan SHALL either
    add the shim and `scripts/build-components.ts` to it or add the test to
    `component-drift`, and record which; the `check-components` Taskfile task SHALL
    run `--check` and then this test, so one local command keeps running both. This changes the output
    and exit status of `--check` (requirement 33(c)); the assembly result is now
    reported by its own step, and the build runs from a throwaway root through
    symbolic links and the shim, which the entry SHALL support (requirement 9).

26. **Test dispositions (parent requirement 13).** The audit found every Bash suite
    that sources, extracts, copies, mutates or locates the script, listed with its
    disposition; none needs an exception beyond the two bounded ones of requirement
    13 and the preparatory pull request of requirement 32:
    - `scripts/tests/test-extract-frontmatter.sh` extracts and `eval`s
      `extract_frontmatter()` from the script text and cannot run against a shim.
      A **preparatory pull request** (PR A, requirement 32), in which the script does
      not migrate, rewrites it as a black-box test that drives the real
      `scripts/build-components.sh` over a fixture whose body holds a fenced `---`,
      and it SHALL pass unchanged against both versions afterwards.
    - `scripts/tests/test-model-resolution.sh`, case M10, runs `sed` on the script
      text to delete a call and asserts a stray merge root survives. That is an
      assertion on a property only a shell file has, with no TypeScript equivalent;
      it SHALL be removed in the migration pull request under the second bounded
      exception of parent requirement 13, which this requirement names and lists (the
      parent's own example is the `bash -n` assertion of
      `scripts/tests/test-e2e-auth-scripts.sh`). Case O10 (cleanup of a derived merge root, on the build and `--resolve`
      paths) stays, and the TypeScript unit suite SHALL assert the property M10
      protected: a root the library derived is removed, a root the caller set is
      left. Case M11 mutates `scripts/lib/model-resolve.sh`, which does not migrate,
      and stays.
    - `scripts/tests/test-check-core-paths.sh`, case i, copies the real script into a
      temporary repository and runs `--list-output-dirs` on the copy, which a shim
      without its siblings cannot do. PR A adapts the fixture's copy step (the
      assertions stay) so the copy carries the entry and `scripts/lib/`; it passes
      unchanged against both versions.
    - `scripts/tests/test-component-tier-resolution.sh` builds in a throwaway copy
      made of `scripts/*.sh` and `scripts/lib/` only, with no `.git`, no
      `package.json` and no `node_modules`, and its report filter lists the build's
      progress lines. PR A adapts the copy step (adds `scripts/*.ts`, the root
      `package.json`, a `.git` entry and a real copy of the `js-yaml` production
      closure under `node_modules`, since `loadDependency` refuses a symbolic link;
      assertions stay);
      the progress lines of requirement 9 stay as they are.
    - `scripts/tests/test-agent-profile-migration.sh`, case T1, asserts the literal
      `bash scripts/build-components.sh --target all --check` in the `component-drift`
      command list of `ci/ci-capabilities.yml`, which requirement 27 changes. PR A
      widens the matcher to accept the shim and the TypeScript form; the migration
      pull request leaves it untouched.
    - `scripts/tests/test-assembly-verification.sh` (symbolic links, the real script
      through the shim), `scripts/tests/test-artifact-build-install-scope.sh` (the
      real script, and a checksum of the script file that the shim satisfies),
      `scripts/test-build-components.sh`, `scripts/tests/test-check-agent-profiles.sh`,
      `scripts/tests/test-gemini-agent-frontmatter.sh`,
      `scripts/tests/test-pr-logbook-label-scope.sh` and the rest of
      `scripts/tests/test-model-resolution.sh` (which also runs the real tree's
      `--check` once and asserts its `OK:` line) are black-box on the script's
      arguments, exit status and outputs, so they stay unchanged and SHALL pass
      against the TypeScript version.
    - `scripts/tests/test-setup-ensure-tier-built.sh` stubs the script, and the
      other cases of `scripts/tests/test-check-core-paths.sh` stub it; both are
      unaffected. `scripts/tests/test-build-extension.sh` sources a library that
      stays unchanged (requirement 23) and is unaffected.
    - `tests/e2e/scenarios/03-skill-build/run.sh` copies `scripts/` into a
      container workspace and runs the build there. It is classified as a test of
      row J and keeps its verdict under the harness oracle of requirement 13; the
      container image carries Node.js 22, below the floor, and the copy carries no
      dependencies, so PR A adapts the scenario's staging and raises the image's
      `NODE_MAJOR` from 22 to 24, the Node.js floor (settled by the owner, see
      *Open questions*).

27. **CI wiring.** The pull request SHALL update `.github/workflows/build.yml`
    (maintained by hand), `ci/ci-capabilities.yml` and the `.gitlab-ci.yml`
    regenerated from it through `scripts/build-ci.sh` (a GitLab job's script is
    its capability's `command` list, so the dependency step belongs in that list
    where a capability needs it) so that: every job that executes the build,
    directly or through a suite, provides Node.js 24 (the shim runs the floor guard even for
    `--list-output-dirs`) and, when it runs more than that flag, has `js-yaml`
    resolvable before the build runs (the production command of spec 0240
    requirement 4, or a full `npm ci` whose result is a superset, in an order that
    does not remove it before the build); at authoring these include
    `component-drift`, `model-resolution`, `agent-profile-migration` and
    `frontmatter`, `core-paths` (which runs `scripts/tests/test-check-core-paths.sh`
    and `scripts/check-core-paths.sh`; the latter calls `--list-output-dirs` through
    the shim with standard error discarded, so a missing Node.js 24 would fail
    there without a visible diagnostic) and the `changeset-coverage` exhaustive run, and the plan SHALL complete the
    list by tracing `build-components` through the suites wired in
    `ci/ci-capabilities.yml`; `component-drift` no longer requires `yq` for the
    build, and keeps it for any suite that still uses it (the model-resolution and
    agent-profile suites do); the `component-drift` command list runs
    `node scripts/lib/node-floor-guard.js` and
    `node scripts/build-components.ts --target all --check` in place of the shell
    call; every path filter and cache key that names `scripts/build-components.sh`
    also names `scripts/build-components.ts`, and `scripts/lib/build-components/**`
    where `scripts/lib/**` does not already cover it (the shim stays named, so a
    change to it still reruns the oracle); every new file is owned by a
    capability's `paths:` or exempted for a reason, as
    `scripts/check-path-ownership.ts` requires; and `scripts/check-ci-parity.sh`
    stays green.

28. **`windows-latest` proof (parent requirement 17).** The implementation PR SHALL
    add a job, copied from the template of spec 0240 requirement 12 and recorded in
    `ci/ci-capabilities.yml` as `portability: specific` with the GitHub-only
    exception of spec 0240 requirement 15, whose steps run under `pwsh` and which
    runs, after installing Node.js 24 and the production dependencies:
    `node scripts/lib/node-floor-guard.js`; `node scripts/build-components.ts
    --target all --check`, asserting exit 0 and the `OK: All generated files match
    source.` line; a build with `REPO_DIR` set to a throwaway root made of the
    committed `artifacts/`, `model-mappings/` and `crewrig.config.toml`, followed by
    a byte-for-byte comparison of every produced file with the committed
    `.claude/`, `.gemini/`, `.github/` and `.agents/` trees (the write path is not
    exercised by `--check`); `--list-output-dirs`; and the TypeScript unit suites of
    this ticket (not the conformance test, which needs `bash`). The cross-system
    claim of byte identity SHALL rest on Linux CI and `windows-latest` each matching
    the one committed tree; macOS has no CI job and the implementer SHALL check
    `--target all --check` there locally and record the result on the logbook.

29. **No latency budget.** Parent requirement 15 binds only a script wired at a CLI
    integration point, and no hook, statusline or other integration point runs the
    build (verified at authoring: no `hooks/*.json` or CLI configuration names it),
    so this ticket sets no budget and no job fails on time. The implementation PR
    SHALL record, on its logbook comment, the wall-clock time of `--target all
    --check` on Linux, on `windows-latest` and locally on macOS, for the record; the
    shell version's own real-tree run costs about a minute.

30. **Built copies stay outside the toolchain.** `.oxlintrc.json`, `.oxfmtrc.json`
    and `BUILT_TREES` of `scripts/lib/ts-scope.ts` SHALL keep excluding
    `.claude/`, `.gemini/`, `.github/` and `.agents/`, and a test SHALL prove it
    once the TypeScript build writes `.ts` outputs there (four exist today, for
    example `.claude/skills/pr-reviewer/scripts/lint-typescript.ts`): after a build
    of a fixture skill whose `scripts/probe.ts` is deliberately unformatted and breaks
    the lint, erasable-syntax and size rules, into all four trees, Oxlint, Oxfmt in
    check mode and `scripts/check-typescript.ts` SHALL report no finding for any
    built copy, and every built copy SHALL be byte-identical to its source, which
    keeps the byte guarantee of requirement 14 independent of the formatter.

31. **References updated (parent requirement 9).** In the same pull request every
    page, task, step and instruction that names the old invocation SHALL be
    updated to the floor-guard step followed by `node scripts/build-components.ts`:
    the five `build-components*` tasks and `check-components` of `Taskfile.yml`
    (the `yq` precondition dropped) and the error hints printed by its inline checks;
    `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `artifacts/FORMAT.md` and every page
    of `docs/` other than ADRs, `docs/research/` and `docs/design*/`, which record
    history; the skill sources of `artifacts/` that tell an agent to run the build,
    each with the `metadata.provenance.version` bump of `AGENTS.md` → *Version Bump
    Convention* and the regenerated built copies staged in the same commit; and
    `docs/cli-matrix.md` and `docs/cli-matrix-maintenance.md` (every row that cites
    the script or its libraries, at authoring rows 3, 4, 4b, 4c, 5, 5b, 10, 12, 15,
    15b, 15c, 16, 24, 26, 30, 33, 34 and 35, the function names and paths they cite,
    and the parity of the build on the three operating systems). The documentation
    SHALL state the Node.js 24 floor and that `js-yaml` comes from the setup dependency
    step. Invocations inside unmigrated shell scripts and the Bash tests keep the
    shim path (requirement 23).

32. **Implementation split (expected; the PLAN confirms).** The work is expected to
    land as three pull requests against the release branch: PR A, preparatory, the
    oracle hardening of requirement 26 (the `test-extract-frontmatter.sh` rewrite,
    the fixture adaptations, the T1 matcher, and the e2e staging), passing unchanged
    against the shell version; PR B, the shared modules and twins (`render-command.ts`,
    `component-resolve.ts`, `model-resolve.ts` with their unit suites and the
    conformance test, and the corpus test of requirement 11), which changes no
    shipped behaviour; PR C, the entry and its modules, the shim, the dependency
    move, the CI and Taskfile wiring, the references, the `windows-latest` job and
    the removal of case M10. PR A SHALL merge before PR C, and no pull request
    SHALL both migrate the script and change an assertion of its Bash test, except
    the removal of case M10 in PR C, which requirement 26 grounds in the second
    bounded exception of parent requirement 13.

33. **Deviations from the shell behaviour (parent requirement 14).** The observable
    contract SHALL be preserved except for exactly these, each justified above:
    (a) the drift hint, `FAILED: Drift detected. Run 'bash scripts/build-components.sh'
    to regenerate.`, names the TypeScript invocation, as the shell form is not
    available on Windows; (b) the prerequisite check `Error: yq is required` is gone,
    replaced by the missing-dependency diagnostic for `js-yaml` (requirement 24);
    (c) `--check` no longer ends with the assembly test's output and exit status
    (requirement 25); (d) on Windows, printed paths use the platform's native
    separator, and on macOS and Linux a checkout reached through a symbolic link
    prints its physical path where the shell printed the logical one when `REPO_DIR`
    was unset; (e) a source with CRLF line endings or a leading byte-order mark is
    read as LF without the mark, where the shell found no frontmatter in it
    (parent requirement 22); (f) a `name` that is absent or null is skipped with the
    existing warning where the shell built a component named `null`, while the
    collision pre-pass still falls back to the directory name; (g) a provenance entry
    that is a mapping or a sequence is a build error where the shell emitted an empty
    `provenance:` block, and duplicate keys, aliases and explicit non-core tags in a
    frontmatter are outside the supported subset (the corpus has none) and follow the
    library, where `yq` tolerated them; (h) the merged mapping document is equal to
    the shell's after loading and not byte-identical; (i) the wording of the
    diagnostic for a value-taking flag in final position, for an unreadable
    `--resolve` source (the statuses 1 and 2 stay) and for a configuration key that
    is not a valid identifier, whose status the shell made 1 or 2 and the build
    makes 1; (j) temporary directory names; (k) the missing-
    dependency and floor diagnostics of the shim and the entry, which the shell
    never had; (l) `--list-output-dirs` order under a non-C locale where the shell's
    `sort` collated differently (the set never differs). On macOS and Linux no other
    byte of standard output, standard error or any file written differs.

## Scenarios

**Scenario:** The drift check passes on the real corpus on every system

Given the committed `.claude/`, `.gemini/`, `.github/` and `.agents/` trees
When `node scripts/build-components.ts --target all --check` runs on Linux CI and on
`windows-latest`, and a build into a throwaway root runs on `windows-latest`
Then each prints `OK: All generated files match source.` and exits 0, and every file
the throwaway build wrote equals the committed file byte for byte, LF endings included.

**Scenario:** The listing of output directories needs no library

Given a checkout with no `node_modules`, no `crewrig.config.toml` and no `artifacts/`
When `--list-output-dirs --target claude --tier community` runs
Then it prints `dist/community/.claude/agents` and `dist/community/.claude/skills`,
one per line, exits 0 and loads no YAML library.

**Scenario:** `--resolve` reports the four outputs and cleans up

Given an agent source declaring `intelligence: medium` and `reasoning: medium` and a
`model-mappings/claude.org.yml` that declares an offering
When `--resolve <source> claude --diagnostics <file>` runs
Then standard output holds the `offering:`, `native:`, `fm:` and `prose:` lines, the
diagnostic lines are on standard error and in the truncated file, the exit status is
0, and the derived merge root is gone afterwards.

**Scenario:** A malformed `canonical_repo` is refused before any output

Given `canonical_repo = "file:///tmp/foo"`
When a build runs
Then it exits 1 with `malformed` and the value on standard error, writes nothing to
standard output and nothing to the tree.

**Scenario:** A missing configuration file only warns

Given a repository root without `crewrig.config.toml`
When a build runs
Then standard error carries the `Warning: ... not found` line, `${CANONICAL_REPO}`
placeholders stay literal in the outputs, and the exit status is 0.

**Scenario:** Two components claiming one name are refused before any write

Given a `core` skill and a `core` command both named `probe`
When a build runs with `--target claude --tier library`, then with `--check`
Then each prints the collision report and the three `FAILED:` lines on standard error,
exits 1, and has written no file, because the pre-pass covers every tier and all four
CLIs whatever the flags say.

**Scenario:** The line-based and the YAML reading of a name differ on purpose

Given a skill whose frontmatter line is `name: probe # note`
When the collision pre-pass reads it and the build reads it
Then the pre-pass keys the component on `probe # note` and the build writes
`probe`, as the shell did.

**Scenario:** A version that looks like a number is not rewritten

Given a source whose provenance is `version: 1.0` and a source whose `description` is
a folded block scalar with a blank line
When the build writes them
Then the output carries `version: "1.0"` and the description folded as `yq` printed it,
with trailing line feeds removed, and the corpus test finds no difference.

**Scenario:** Placeholders resolve in file order, after the splice

Given `crewrig.config.toml` holding `canonical_repo` and `feedback_repo` and a source
with `canonical: "${CANONICAL_REPO}"` in its provenance
When a build writes the skill
Then the provenance block carries the configured URL, and a value that itself holds
`${FEEDBACK_REPO}` would be substituted by the later key.

**Scenario:** Core skill links and resource links are rewritten, other tiers are not

Given a `core` skill whose body links `../../../../docs/x.md`, a `.md` resource that
links `../../../../../specs/y.md`, and the same skill in tier `library`
When the build writes them
Then the core `SKILL.md` links `../../../docs/x.md`, the resource links
`../../../../specs/y.md`, and the library `SKILL.md` keeps its source link.

**Scenario:** An executable resource keeps its bit, and `--check` never compares it

Given a skill script with the execute bit
When the build writes it on Linux, the execute bit is then removed from the copy, and
`--check` runs
Then the copy was executable after the build, `--check` reports no drift for it, and
on Windows setting the bit is a no-op.

**Scenario:** A resource of another type is copied untouched

Given a skill asset with CRLF bytes
When the build writes it on any system
Then the copy is byte-identical to the source.

**Scenario:** Overlay tiers compile into a throwaway root in `--check`

Given a `community` fixture skill
When `--check` runs
Then the skill is compiled into a throwaway staging root, is never compared, leaves
nothing under `dist/`, and the staging root is removed even when the run fails.

**Scenario:** A CRLF source builds the same bytes

Given a skill source saved with CRLF line endings and the same source with LF
When each is built
Then both outputs are byte-identical and LF-only.

**Scenario:** A source that cannot be parsed is skipped by the warning

Given a frontmatter that is not valid YAML
When a build runs
Then it prints `Warning: <source> missing 'name' field, skipping`, continues and exits 0.

**Scenario:** The conformance test finds a divergence between the twins

Given the shell resolution library and `resolveAgent` run over the 88 core
(agent, target) pairs, the profile fixtures and an organisation-channel mapping
When their offering id, native value, frontmatter lines, prose and diagnostics are
compared
Then they are equal; and a change made to only one implementation turns the test red,
naming the pair and the differing output.

**Scenario:** The merge is made once per target and counted

Given a `MAPPING_MERGE_DIR`, a profile-bearing agent source and an organisation
channel declaring an offering for `claude` and `gemini`
When `--target all` runs, then runs again with the same directory
Then `.merges` holds one line per target after the first run, the second run adds none,
and a document written by the shell library in the same directory is reused.

**Scenario:** A derived merge root is removed and a caller's is not

Given a build with `TMPDIR` set and no `MAPPING_MERGE_DIR`, then one with
`MAPPING_MERGE_DIR` set
When each ends, on success and on a collision refusal
Then the first leaves no `crewrig-mapping-*` root under `TMPDIR` and the second leaves
its directory intact.

**Scenario:** The shim fails closed

Given `node` absent from the search path, then a `node` reporting major version 20
When `bash scripts/build-components.sh --check` runs
Then the first prints one `Error:` line naming `node` and 24 and exits 1, the second
prints the floor guard's diagnostic naming 20 and 24 and exits non-zero, and in both
no file is written.

**Scenario:** A missing dependency is named

Given a checkout whose `node_modules` lacks `js-yaml`
When a build runs
Then it exits 1 with the diagnostic naming `js-yaml` and the setup to re-run, writes
nothing and shows no module-resolution error; and `--list-output-dirs` still succeeds.

**Scenario:** A throwaway copy of `scripts/` builds its own tree

Given a directory holding a `.git` entry, a copy of `scripts/`, the root
`package.json` and a real copy of the `js-yaml` production closure under
`node_modules`
When `scripts/build-components.sh --target claude` runs there with no `REPO_DIR`
Then the entry builds that directory's `artifacts/`, not the checkout's.

**Scenario:** The assembly test is its own gate

Given a change to `scripts/build-components.ts` alone
When CI selects capabilities from the changed paths
Then a capability that runs `scripts/tests/test-assembly-verification.sh` is selected,
`--check` itself ends with the drift verdict, and a failing assembly test no longer
changes `--check`'s exit status.

**Scenario:** The Bash oracle passes against the shim

Given the TypeScript build and the shim on Linux CI
When `scripts/test-build-components.sh`, `scripts/tests/test-model-resolution.sh` (its
M10 case removed), `scripts/tests/test-component-tier-resolution.sh`,
`scripts/tests/test-check-core-paths.sh` and the other suites of requirement 26 run
Then they pass with their assertions unchanged, apart from the PR A adaptations
already merged.

**Scenario:** Built `.ts` copies are neither linted nor reformatted

Given a fixture skill whose `scripts/probe.ts` is unformatted and breaks the lint rules
When the build writes it into the four trees and Oxlint, Oxfmt in check mode and
`scripts/check-typescript.ts` run
Then none reports a built copy and each built copy equals its source byte for byte.

**Scenario:** A generated file is not owner-only

Given a umask of `022` on Linux
When the build writes a new file and rewrites an existing file whose mode is `0644`
Then the new file's mode is `0644` and the rewritten file keeps `0644`.

## Out of scope

- The extension and plugin builders (`scripts/build-extension.sh`,
  `scripts/build-claude-plugin.sh`, `scripts/build-copilot-plugin.sh`,
  `scripts/build-antigravity-extension.sh`, `scripts/build-ci.sh` and their
  helpers): row G1b (issue #1333), which reuses the renderer twin of requirement 18.
- `scripts/setup-*`, `scripts/install-*`, `scripts/manage-*` and
  `scripts/lib/common.sh`, including the rest of `scripts/lib/component-resolve.sh`
  (`ensure_overlay_tiers_fresh` and the install drivers): rows F1 and F2. Their calls
  of the build keep working through the shim.
- `scripts/check-model-mappings.sh` and `scripts/check-agent-profiles.sh`: row I2.
- Migrating any Bash test: the J rows. Requirement 26 changes only the
  `test-extract-frontmatter.sh` rewrite, the removal of case M10 and the fixture
  adaptations of PR A, and migrates none to TypeScript.
- Retiring `scripts/lib/render-command.sh`, `scripts/lib/component-resolve.sh` and
  `scripts/lib/model-resolve.sh`: each retires with its last consumer
  (requirement 23).
- Any change to a generated file's content, escaping or layout (for example quoting
  a description that contains a double quote), to the resolution rules of spec 0198,
  to the merge rules of spec 0199, to the mapping files, or to the tier routing of
  ADR-0011.
- Detecting or pruning orphaned outputs, a build cache, parallel compilation, and any
  speed target.
- A macOS CI job, a GitLab Windows runner, and the symbolic-link tests of the
  assembly suite on Windows.
- Migrating the end-to-end harness, and the container image beyond what requirement
  26 names.
- Replacing `js-yaml`, and any normative change to spec 0215; none is needed.

## Open questions

None. The five points below were raised while drafting and are settled by the
owner of ticket #1332; each is recorded where it binds.

- The four suites beyond `test-extract-frontmatter.sh` and case M10
  (`test-check-core-paths.sh` case i, `test-component-tier-resolution.sh`,
  `test-agent-profile-migration.sh` case T1 and `tests/e2e/scenarios/03-skill-build/run.sh`)
  are adapted in PR A, with the same device as `test-extract-frontmatter.sh` (a
  preparatory pull request in which the script does not migrate, assertions
  unchanged, passing against both versions). That includes raising `NODE_MAJOR` of
  `docker/e2e/base.Dockerfile` from 22 to 24, the Node.js floor of parent
  requirement 4. No delta of spec 0215 is needed (requirement 26).
- Every fixture that copies `scripts/` into a throwaway tree that builds more than
  `--list-output-dirs` supplies a `.git` entry, the root `package.json` and a real
  copy of the `js-yaml` production closure under `node_modules`, so `loadDependency`
  resolves `js-yaml` unchanged; it walks up to a `.git` entry and refuses a symbolic
  link (verified against `scripts/lib/require-dependency.ts` and
  `scripts/lib/paths.ts` by review pass `s1`). No delta of spec 0240 is needed
  (requirements 4 and 26).
- An absent or null `name` is skipped with the existing warning instead of
  reproducing the shell's component named `null` (requirement 33(f)).
- `--resolve` on an unreadable source keeps exit status 2, the shell's incidental
  awk status (requirement 6).
- The assembly test is already a step of the `frontmatter` capability and its
  `build.yml` job, so requirement 25 asks for the path filter and the local
  Taskfile task that the chained call used to provide, not a new job.
