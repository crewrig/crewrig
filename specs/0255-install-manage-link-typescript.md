---
id: "0255"
slug: install-manage-link-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1334
version: 1.0.0
---

# Install, manage and link scripts in TypeScript

*Sub-spec F2 of the `large`-tier ticket #1231, row F2 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirements 9, 13,
14, 17, 19 and 21, row F, as ordered by `specs/0215-shell-to-typescript-migration.delta-01.md`),
under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38):
this spec-PR and its implementation pull requests target
`release/1231-ts-migration`, "shipped" means merged there, not reached `main`,
and the base ref wherever a protocol names `main` is
`origin/release/1231-ts-migration` (requirement 34). Applies parent requirements
2, 4, 6, 22, 23 and 26 where relevant. Depends on sub-specs D
(`specs/0252-daemon-endpoint-typescript.md`, implemented: `scripts/lib/service/*`),
A2 (`specs/0240`: `scripts/lib/paths.ts`, `line-endings.ts`, `tmp-file.ts`,
`require-dependency.ts`, `node-floor-guard.js` and the `windows-latest` job
conventions), G1a (`specs/0250`: `scripts/lib/component-resolve.ts`,
`render-command.ts`, `model-resolve.ts`, `build-components/*`) and G1b
(`specs/0254`, implemented: `scripts/lib/extension/*`, `scripts/lib/org-mcp.ts`).
It inherits the behavioural contracts of `specs/0119` (the overlay tier set of
the component commands), `specs/0177` (the cross-CLI installer), `specs/0045`
(the shared plugin marketplace), `specs/0180` and `specs/0183` (MCP delivery and
the install-time token resolution) and preserves them except for the deviations
of requirement 22. Line references are to `release/1231-ts-migration` at
`c68854a`.*

## Intent

A contributor or an adopter on Windows, macOS or Linux installs, links and
removes extensions, plugins and artifact components for Gemini CLI, Claude Code,
GitHub Copilot CLI and Antigravity CLI with the same commands on the three
operating systems and with no POSIX shell, `jq` or `ln` on the machine. Every
flag, every message a script or a test reads, every exit status and every file
written stays what it is today, except for the few listed changes. Where the
machine cannot create a symbolic link because the privilege is missing
(typically Windows without Developer Mode or administrator rights), or the file
system reports that links are not supported, the "link" mode no longer fails or
stays unavailable: it places a copy of the target, says so on standard error
naming every destination that became a copy, and a later run of the same command
refreshes that copy unconditionally, so a copy never goes silently stale. The same link-or-copy module is
the one `monorepo-release` (row G2) and `check-extension-provenance` (row I1)
adopt later.

## Requirements

1. **Entry points.** Thirteen TypeScript entries SHALL replace the behaviour of
   thirteen shell scripts, each at the path of its predecessor with `.sh` changed
   to `.ts` (parent requirement 9, spec 0240 requirement 11), runnable as a direct
   `node` command line and written to the conventions of parent requirement 2
   (erasable syntax, strict typing, every value entering from a file, the
   environment, a subprocess or the command line typed `unknown` and narrowed
   before use): `scripts/install-extension.ts` (93 lines of shell),
   `scripts/install-extension-all.ts` (131), `scripts/install-claude-plugin.ts`
   (126), `scripts/install-copilot-plugin.ts` (50),
   `scripts/install-antigravity-extension.ts` (69), `scripts/install-workspace.ts`
   (37), `scripts/manage-claude-component.ts` (174),
   `scripts/manage-copilot-component.ts` (160),
   `scripts/manage-antigravity-component.ts` (178),
   `scripts/manage-workspace-component.ts` (160), `scripts/link-extensions.ts` (17),
   `scripts/unlink-extensions.ts` (26) and `scripts/unlink-component.ts` (32).
   Each `.sh` SHALL be reduced to a forwarding shim (requirement 25) in the pull
   request that switches the references, and is deleted only where requirement 25
   says so.

2. **Reuse, no redefinition.** The build reuses what ships on the release branch
   and redefines none of its primitives; where one needs a new export, the export
   is added and the existing behaviour is untouched. At authoring these exist:
   `scripts/lib/paths.ts` (`joinPath`, `resolveReal`, `repoRootFrom`),
   `scripts/lib/line-endings.ts`, `scripts/lib/tmp-file.ts` (`createTempNextTo`,
   `publishTemp`, `writeFileAtomic`), `scripts/lib/require-dependency.ts`,
   `scripts/lib/node-floor-guard.js`, `scripts/lib/component-resolve.ts`
   (declared name, emit target, target display name, `reportCollision`,
   `installedTargets`, `reportInstalledNameCollisions`; spec 0250),
   `scripts/lib/render-command.ts`, `scripts/lib/model-resolve.ts`,
   `scripts/lib/org-mcp.ts` (`orgMcpToNative`, `MCP_RESERVED_NAMES`),
   `scripts/lib/extension/` (among others `resolve.ts` for the three-tier
   extension lookup, `manifest.ts`, `shape-guard.ts`, `plugin-main.ts`,
   `plugin-claude.ts`, `plugin-copilot.ts`, `plugin-antigravity.ts`,
   `json-write.ts` and `tree-copy.ts` with `copyTree`, `assertSafeToRemove`,
   `emptyDir` and `LINK_REFUSALS`; spec 0254) and `scripts/lib/service/exec.ts`
   (the `CREWRIG_TEST_*` seam convention, spec 0252). The plan SHALL fix, by
   reading those files, which of them the entries import and which need a new
   export. Spec 0250's `component-resolve.ts` does **not** yet carry the twins of
   the shell functions the manage scripts call (`component_set_staging_roots`,
   `component_set_artifact_roots`, `component_read_lines`,
   `resolve_component_in_roots`, `enumerate_components_in_roots`,
   `report_unresolved`, `ensure_overlay_tiers_fresh`, `component_install_named`,
   `component_install_all` of `scripts/lib/component-resolve.sh`, 624 lines) nor
   the twin of `migrate_antigravity_superseded_components` of
   `scripts/lib/common.sh`; these SHALL be added in this row as TypeScript modules
   (requirement 5), for one reason and no other: they are dependencies of the
   manage scripts of step (c). Their other shell consumers keep calling the
   shell originals, `component-resolve.sh` and `common.sh` stay byte for byte
   except for comment lines (`common.sh` is retired by row J4), and the existence
   of these dependencies SHALL NOT be cited as precedent for retiring them here.

3. **Entry form, floor and silence.** Each entry SHALL use the entry form of spec
   0243 requirement 5 as spec 0250 requirement 3 and spec 0254 requirement 4 apply
   it (no top-level `import` or `export`, the `warning` listeners removed as the
   first statement, the module graph loaded with `import()`), so that
   `node scripts/<entry>.ts` writes no Node.js warning on any Node.js 24 release
   with no flag and no environment variable on the command line. As user-facing
   entry points (parent requirement 4) they SHALL be documented behind the
   floor-guard step (`node scripts/lib/node-floor-guard.js`, then the entry, as
   two separate steps) and SHALL leave the filesystem unmodified on a Node.js
   below the floor (the shims of requirement 25 run the floor guard first). The
   repository root SHALL be derived from the entry's own location (`repoRootFrom`),
   never by searching upward for a `.git` entry, so that a copy of `scripts/` in a
   throwaway tree acts on that tree, as the shell's `$(dirname "$0")/..` does.

4. **Decomposition and size.** No TypeScript file this ticket adds SHALL exceed
   the 300-line warning threshold of spec 0238, so the work is decomposed, one
   concern per file. The plan names the files; the modules fall under
   `scripts/lib/install/` (extension install, the umbrella installer, the Claude
   marketplace upsert, the Antigravity token resolution) and `scripts/lib/manage/`
   (the shared component placement and MCP registration of requirement 6, the
   per-CLI type tables, the overlay-tier install loops, the link-mode confirmation
   of requirement 12), and `scripts/lib/link-or-copy*.ts` (requirements 14-21).

5. **Component-resolution twins.** The TypeScript twins of the shell functions
   named in requirement 2 SHALL live beside `scripts/lib/component-resolve.ts`
   (in new files, so that file stays under 300 lines), reproduce their ordering
   (overlay tier set of spec 0119, tiers in their declared order, entries in
   code-unit order, requirement 22(g)), their collision and unresolved-name
   diagnostics (text, stream and exit status) and their staleness refresh of the
   overlay tiers, and be exercised by the unchanged Bash oracles
   `test-component-tier-resolution.sh` and `test-antigravity-component-install.sh`
   through the shims. A conformance test (Linux only, retired with the shell
   libraries) SHALL compare each twin with the sourced shell function over a
   fixture matrix.

6. **One shared module for the four manage scripts.** The four
   `manage-*-component` entries share the shell's `place_component`, the
   plugin-skip of `.gitkeep`, the type-name normalisation, the overlay-tier loop
   and the per-type destinations, and differ only by a per-CLI table (home
   directory, accepted types and aliases, staging roots, refresh CLI) and by the
   MCP-declaration handler. The duplication across the four SHALL be replaced by
   one shared module driven by a per-CLI descriptor, and each entry SHALL be a
   thin wrapper that supplies its descriptor. The four descriptors SHALL carry
   exactly today's values: `claude` (home `~/.claude`; `claude-skills`, `policies`,
   `mcp-servers`; skills to `skills/` from `.claude/skills`, policies to
   `rules/`; MCP servers registered through `claude mcp add --scope user`),
   `copilot` (home `~/.copilot`; `skills`, `commands`, `mcp-servers`, and the
   accepted `agent` alias; skills and commands to `skills/` from `.github/skills`;
   MCP servers merged into `mcp-config.json`), `antigravity`
   (`~/.gemini/antigravity-cli`, customization root `~/.gemini/config`;
   `antigravity-skills`, `policies`, `mcp-servers`; skills to
   `~/.gemini/config/skills` from `.agents/skills`, then the supersession
   migration of requirement 2; MCP servers merged into `settings.json`) and
   `workspace` (home `~/.gemini`; `commands`, `skills`, `hooks`, `agents`,
   `policies`, `mcp-servers`, `themes`; the JSON types merged into `settings.json`
   under the type's key). Singular aliases (`skill`, `policy`, `mcp-server`, ...)
   SHALL normalise as in the shell. An unknown type SHALL print
   `Error: unknown type '<type>'` and the per-CLI `Types:` line on standard output
   and exit 1; a missing type SHALL print the `Usage:` and `Types:` lines on
   standard output and exit 1 (requirement 22(i) for the script path in the usage
   line).

7. **Placement semantics.** `place_component` SHALL keep its observable behaviour:
   the item name is the basename of the source, `.gitkeep` is skipped, an existing
   destination (file, directory, or symbolic link including a dangling one) is
   removed first, and the result is reported as `Linked: <name>` (indented by two spaces) (link mode,
   a symbolic link created) or `Copied: <name>` (indented by two spaces) (install mode, and link mode when
   the link was refused, requirement 17) on standard output. Placement SHALL go
   through the link-or-copy module (requirements 14-21), never through a direct
   `fs` call in an entry. A manage entry is one process: when it placed at least
   one fallback copy it prints exactly one aggregated notice at its end
   (requirement 18), whatever the number of types or components it handled.

8. **MCP registration and merge.** The `claude` handler SHALL spawn the `claude`
   binary (`claude mcp list`, then `claude mcp add --scope user <name> -- <command>
   <args…>`), skip an already registered name, print the shell's lines
   (`<name>: already registered, skipping` , `<name>: registered (scope=user)` (indented by two spaces),
   `<name>: missing 'command' field, skipping` (indented by two spaces), `<name>: FAILED — re-run manually: claude mcp add …`) and return the shell's statuses; an absent `claude`
   binary SHALL print `Error: 'claude' CLI required to register MCP servers.` and
   exit 1. The `copilot`, `antigravity` and `workspace` handlers SHALL merge the
   declaration into `~/.copilot/mcp-config.json`, `~/.gemini/antigravity-cli/settings.json`
   and `~/.gemini/settings.json` (key `mcpServers`, or the type's key for
   `workspace`) as the shell's `jq` expression does: the target file is created as
   `{"mcpServers":{}}` (or `{}` for `workspace`) when absent, copied to `<file>.bak`
   first, and rewritten with the entry added under the declaration's basename
   without `.json`, `Merged: <name> into <key>` printed. The files SHALL be written
   as spec 0254 requirement 12 states for JSON (two-space indentation, key order
   preserved, a final line feed, LF) through the order-preserving writer of
   `scripts/lib/extension/json-write.ts`, and written atomically
   (`writeFileAtomic`). An entry that is not a `*.json` file SHALL print `Error:
   '<path>' is not a JSON MCP declaration.` (`… is not a JSON <type> declaration.`
   for `workspace`) on standard error and return 1.

9. **Extension install.** `install-extension.ts <install|link> [name|--include-org]`
   SHALL resolve the extension through the three-tier lookup of spec 0254
   (`core`, `library`, `org`, found in two tiers: `Error: extension '<name>' exists
   in multiple tiers; names must be unique.` on standard error, status 2 inside
   the resolver and 1 for the caller), render the Gemini tree by running
   `scripts/build-extension.ts --target gemini <name>` (as a `node` subprocess or
   in-process, the plan decides: it places nothing and prints no notice; its
   standard output is sent to standard error as the shell does with `>&2`), then replace `~/.gemini/extensions/<name>` with a
   link to, or a copy of, `build/extensions/<name>/` through the link-or-copy
   module, printing `Linked: <name> (build directory)` or `Copied: <name> (build directory)`, each indented by two spaces. With no name it SHALL process `core` and `library`, and
   `org` too under `--include-org` or `INCLUDE_ORG` set non-empty, each tier's
   directories in code-unit order. A failure of one extension prints `Error:
   rendering extension '<name>' failed.` and, as the shell's `set -e` did, ends
   the run with a non-zero status (requirement 22(j) pins the status). With no name the loop runs
   **in-process**, so the run is one process and prints at most one aggregated
   notice at its end, naming every extension destination that became a copy.

10. **Plugin installers.** `install-claude-plugin.ts`, `install-copilot-plugin.ts`
    and `install-antigravity-extension.ts` SHALL each take one extension name
    (`Usage: <script> <extension-name>` on missing argument, exit 1), require the
    CLI binary (`claude`, `copilot`, `agy`) on the path with the shell's `Error: '<cli>'
    CLI is required. Install … first.` line and exit 1 (jq is no longer a
    prerequisite, requirement 22(a)), resolve the extension, build the plugin by
    calling the spec 0254 builder (`scripts/build-claude-plugin.ts` into
    `${CLAUDE_CONFIG_DIR:-~/.claude}/local-marketplace/<name>`, the copilot and
    antigravity builders into `dist-copilot-plugin/<name>` and
    `dist-antigravity-plugin/<name>`) and spawn the CLI (`claude plugin marketplace
    add … --scope user` then `claude plugin install <name>@<market> --scope user`;
    `copilot plugin install <dir>`; `agy plugin install <dir>`), printing the
    shell's closing lines. The Claude installer SHALL upsert
    `.claude-plugin/marketplace.json` in the marketplace directory exactly as the
    `jq` expression does: the marketplace is named `<basename of the repository
    root>-local`, owner `{name: "crewrig contributors"}`, the plugin list is the
    existing list minus any entry of the same name plus `{name, description,
    author: {name}, source: "./<name>"}` appended last, the description from
    `extension.json` (`""` when absent), the author from `.claude.author.name`,
    then `.author.name`, then `Unknown`; a missing manifest SHALL print the shell's
    `Error: No extension.json found in <dir> — run scripts/migrate-extension.sh …`
    line and exit 1, and the shape guard of spec 0254 SHALL run before any write.
    The Antigravity installer SHALL, after `agy plugin install`, rewrite
    `${extensionRoot}` in every string leaf of
    `~/.gemini/config/plugins/<plugin name>/mcp_config.json` to that directory
    (the twin of `ext_antigravity_resolve_tokens`), with the shell's three
    diagnostics (an empty plugin name, a missing installed file, a failed rewrite)
    on standard error and status 1.

11. **Umbrella installer.** `install-extension-all.ts <name>` SHALL keep its
    contract: `-h` or `--help` prints the usage block and exits 0; no argument
    prints the same block and exits 1; the extension is resolved first (`Error:
    extension '<name>' exists in multiple tiers …` or `Error: Extension '<name>' not
    found in extensions/ (searched core, library, org).` on standard error, exit
    1); each of the four CLIs is attempted in the order Gemini, Claude Code, GitHub
    Copilot CLI, Antigravity CLI and reported as `[INSTALLED] …` (indented by two spaces), `[SKIPPED]
    …` or `[FAILED]    … (<script> failed)` (indented by two spaces) (the last on standard error), with the
    child's standard output and standard error swallowed; the Gemini branch is taken
    when `$GEMINI_HOME` (default `~/.gemini`) is a directory or `gemini` is on the
    path; the closing counters and the two terminal `Error:` lines and the
    `Summary:` line are unchanged; the exit status is 1 on any failure or when
    nothing was installed, 0 otherwise. The child installs run in install mode only and place no link, so no
    fallback notice is ever swallowed; they SHALL run in-process or as `node`
    subprocesses with their output captured (the plan decides), and the
    `[SKIPPED]` branch for a missing binary SHALL no longer be reachable for `jq`
    (requirement 22(a)). The `PATH` resolution of `claude`, `copilot`, `agy` and
    `gemini` SHALL use the platform's own executable lookup (`PATHEXT` on Windows)
    and SHALL spawn no POSIX tool (parent requirement 23).

12. **Link-mode confirmation.** The `claude`, `copilot` and `antigravity` manage
    entries in `link` mode SHALL print the shell's multi-line `WARNING:` block on
    standard output (the `workspace` entry prints it too but asks nothing, as
    today) and then the prompt `Continue? [y/N]` followed by a space, read exactly one key without
    waiting for a line feed, echo a line feed, and exit 1 unless the key is `y` or
    `Y`. Reading one key SHALL work on a POSIX terminal and on a Windows console
    (raw mode on `process.stdin` when it is a TTY, restored on every exit path) and
    when standard input is a pipe or a file (the first byte read), as `read -n 1`
    does; end of input answers no. This is the only interactive prompt of the row.

13. **Unlink.** `unlink-component.ts <type> <name>` SHALL normalise singular types
    (`command`, `skill`, `hook`, `agent`, `policy`, `mcp-server`, `theme`), print
    `Usage: <script> <type> <name>` and the `Types:` line and exit 1 when an
    argument is missing, remove `~/.gemini/<type>/<name>` and print `Removed:
    <type>/<name>` when it exists as a file, a directory or a symbolic link
    (dangling included), otherwise `Not found: <type>/<name>`, exit 0.
    `unlink-extensions.ts [--include-org]` SHALL do the same for every extension
    directory of the same tiers as `link-extensions`, keyed on the bare name,
    printing `Removed: <name>` (indented by two spaces) only for what existed. Both SHALL remove through
    `removePlaced` of requirement 19, by name, never following a link. `INCLUDE_ORG`
    set non-empty acts as `--include-org`. `link-extensions.ts [--include-org]` SHALL
    run `install-extension.ts link <name>` as a `node` subprocess for each extension,
    in tier order, and stop at the first failure, as its `set -e` does; it prints no
    notice of its own and leaves each child's own notice as is, because the Bash
    oracles stub child scripts in sandboxes and the child boundary is part of the
    contract. `install-workspace.ts [mode]` SHALL likewise run
    `manage-workspace-component.ts` as a `node` subprocess for each of the seven
    types in the shell's order (up to seven notices, one per child that copied),
    collect failures rather than stop, and print the shell's `Artifacts installation finished with failures
    in:<types>` block on standard error and exit 1, or `Artifacts installation
    complete.` and exit 0.

14. **Link-or-copy: detection.** The module SHALL attempt `fs.symlinkSync(target,
    path, "dir" | "file")` on every call, the type taken from `statSync(source)`
    (needed on Windows), and decide from the error code alone: no probe, no cache
    of a first refusal, no `process.platform` sniffing as the sole criterion.
    The fallback exists for a missing symbolic-link privilege (`EPERM` on `win32`) and
    for file systems that report that links are unsupported (`ENOTSUP`, `EOPNOTSUPP`,
    `ENOSYS`); a probe would leave temporary files. The link SHALL be created under a
    staging name first so that a refusal never destroys the destination, and when the
    destination is a real directory or file the link goes in by the same swap as a
    copy (requirement 16), because a symbolic link cannot be renamed over a non-empty
    directory on POSIX.

15. **Link-or-copy: which refusals fall back.** The fallback to a copy SHALL occur
    only for: `EPERM` when the platform is `win32`; `ENOTSUP`, `EOPNOTSUPP` and
    `ENOSYS` on any platform. Every other error SHALL be rethrown unchanged:
    `EEXIST`, `ENOENT`, `ELOOP`, `ENAMETOOLONG`, `EINVAL`, and, on a POSIX platform,
    `EPERM` and `EACCES` (parity with `ln -s` under `set -e`: copying would mask a
    wrong landing zone), and any code a Windows volume that cannot link may yield
    beyond `EPERM`. Such an error propagates and fails loudly, never a silent copy;
    the code a non-linking Windows volume yields is unverified (see Open questions).
    The classification SHALL be a pure function of
    `(code, platform)`. The module MAY share the `LINK_REFUSALS` constant of
    `scripts/lib/extension/tree-copy.ts` only if the two sets are made equal without
    changing `tree-copy.ts` behaviour; the plan decides. The mapping of the Windows
    `ERROR_PRIVILEGE_NOT_HELD` to `EPERM` by Node.js 24 is an unverified assumption
    (see Open questions): the `windows-latest` job of requirement 28 records the
    code it observes, under the seam and for the real attempt.

16. **Link-or-copy: copy semantics.** A copy SHALL be byte for byte (no CRLF
    conversion, parent requirement 22), keep file mode bits, not preserve mtimes, and
    dereference symbolic links found inside the source (none exist in `artifacts/`,
    `extensions/` or `dist/` today). `copyTree` of `tree-copy.ts` merges into its
    destination and recreates the symbolic links found inside the source, so the copy
    SHALL use a new dereferencing export added to `tree-copy.ts` (requirement 2 allows
    it), and the existing behaviour of `copyTree` stays untouched; the copy reuses
    `assertSafeToRemove` as is. It is not atomic by construction, but a failed
    copy SHALL leave the old destination intact: stage as a sibling
    `.<name>.crewrig-tmp-<hex>` on the same volume, rename the old destination aside,
    rename the stage into place, delete the old one, and roll back the first rename
    when the second fails; a Windows `EPERM` or `EBUSY` on a rename SHALL be retried a
    bounded number of times (5 attempts, 50 ms apart) and then fail with the old
    entry intact. Destination states: absent (create the parent, then place); a symbolic link,
    dangling included (remove the link only, using `lstat`, never `existsSync`); a
    directory or a file (replace after the staged copy succeeded, parity with
    `rm -rf`); a destination inside its source SHALL be refused. The staged link of requirement 14 follows the same swap when the
    destination is a real directory or file. A copy SHALL be replaced by a link when
    a link now succeeds. The destination name is the basename
    of the resolved source (the trailing-slash case pinned by case 4b of
    `test-component-tier-resolution.sh`). Paths are built with `joinPath` and
    `resolveReal`.

17. **Link-or-copy: no marker, no registry, unconditional refresh.** The module
    SHALL NOT write a marker file inside a copy and SHALL NOT keep a registry of
    copies. Every caller knows `(source, destination)` by component name and the
    operation always rewrites the destination, so every later run of the same command
    refreshes a copy unconditionally, which is how a copy cannot silently go stale. Consequently a same-named user
    directory is indistinguishable from a stale copy and is replaced like one, as
    `rm -rf` does today.
    A copy made because a link was refused SHALL be reported on standard output as
    `Copied:` (the Bash oracles grep that word) and counted as a fallback. Known
    weakness, accepted: a component removed or renamed upstream leaves an orphan
    copy, as copy mode does today.

18. **Link-or-copy: reporting.** The module SHALL never print. Each process that placed
    at least one fallback copy SHALL print on standard error, at its end, exactly one
    aggregated notice that names every destination that became a copy, one per line,
    and states that a change to the source takes effect there only after the same
    operation is run again. The aggregation SHALL use `summarizeFallbacks(outcomes)`
    of requirement 21 so the wording is single-sourced. An entry that
    runs child entries as subprocesses (`install-workspace`, `link-extensions`) leaves
    each child's own notice as is and adds none; an entry that fans out in-process
    (`install-extension` with no name, the manage entries over several components)
    aggregates into one. Nothing SHALL be printed on standard error when every
    placement was a link or the mode was install.

19. **Link-or-copy: unlink.** `removePlaced(dest)` SHALL remove by name, never
    follow a link, and return `"symlink" | "copy" | "absent"`; `unlink-*` use it with
    strict parity to the shell (`[ -e ] || [ -L ]`, then `rm -rf`): no refusal, no
    `--force`. The module computes no drift and reports none: the unconditional
    refresh of requirement 17 is what meets the parent's requirement that a copy
    cannot silently go stale.

20. **Link-or-copy: module surface.** The module is synchronous, like `paths.ts` and
    `tmp-file.ts`, and exports, in files each under 300 lines: `linkOrCopy(source, dest,
    opts?) -> LinkOutcome` with `opts: { onRefusal?: "copy" | "throw"; platform?;
    symlinkImpl? }` (`"throw"` is for `monorepo-release`, so that a refused link never
    copies a whole `node_modules`), `placeCopy(source, dest, opts?)` (explicit copy
    mode, used by install mode), `removePlaced(dest)` and
    `summarizeFallbacks(outcomes)`. Drift reporting and `inspectPlacement` are not
    part of this row (see the Decision record). The names are finalised in the PLAN; the semantics
    are not.

21. **Link-or-copy: test seam.** For unit tests the injected `symlinkImpl` and
    `platform` options force a refusal. For the Bash oracles and the `windows-latest`
    job, which cross a process boundary, an environment variable (proposed
    `CREWRIG_TEST_LINK_REFUSAL=<code>`, following the `CREWRIG_TEST_*` convention of
    `scripts/lib/service/exec.ts`) SHALL, only when set, force the thrown error code
    and the Windows classification so the fallback runs on Linux and on a Windows
    runner that can actually link. It SHALL be read in one place, ignored when unset,
    and never documented as a user feature.

22. **Listed deviations (parent requirement 14).** The observable contract changes
    only as follows, each deviation tagged in the differential test: (a) a machine
    without `jq` works: the `Error: jq is required` exits and the `[SKIPPED] … ('jq'
    dependency not found in PATH)` lines of `install-extension-all` disappear (a
    machine with `jq` but without `claude` still skips on the missing binary);
    (b) in link mode, a refused symbolic link places a copy, reports it as in
    requirement 18 and exits 0 where `ln -s` failed; on every other platform and
    volume nothing changes; (c) the one-key prompt of requirement 12 works on a
    Windows console, where `read -n 1` does not exist; end of input answers no;
    (d) JSON files written are byte-identical to `jq`'s output for the inputs the
    scripts handle, except that a number is written as JavaScript writes the value
    it parses to (spec 0254 requirement 28(d)); (e) a JSON file that is not valid
    prints a one-line `Error:` naming the file where `jq` printed its parse error;
    (f) a `settings.json` or `mcp-config.json` is written atomically, where the shell
    truncated it in place; (g) every list of files is processed in code-unit order,
    equal to the shell's under the `C` locale; (h) an absolute path printed in a
    message is the platform's physical form where it differs from `pwd`'s logical
    form; (i) a usage line has no script path prefix; (j) a failure inside
    `install-extension` in its all-extensions loop ends the run with status 1 where
    the shell's `set -e` ended it with the failing command's own status (the plan's
    differential test fixes which); (k) the shell's `ln -s` on Windows (Git Bash
    msys, which may copy silently) is not reproduced. Letters (l) onward are reserved
    for deviations the plan's differential test discovers and a `delta-01` of this
    spec records.

23. **Line endings, paths, case (parent requirement 22).** Every file a script writes
    SHALL have LF line endings. Paths SHALL use platform-aware handling and be written
    to a message with the platform separator only where the shell wrote an absolute
    path; a path inside a written file SHALL use `/`. No script SHALL depend on two
    paths differing only by letter case. `HOME` on Windows SHALL resolve through
    `os.homedir()` when `HOME` is unset, and the tests of requirement 26 SHALL set
    both `HOME` and `USERPROFILE`.

24. **No POSIX tool (parent requirement 23).** The entries SHALL spawn only `claude`,
    `copilot`, `agy`, `gemini`, `git` and `node`, by name through the platform's
    lookup, with arguments passed as an array and never through a shell. The
    restricted-`PATH` behaviour of the oracles (`PATH=/usr/bin:/bin:$FAKE_BIN`) is
    preserved: a `node` executable must be on that path for a shim to forward, and
    the stub CLIs of the oracles are found by the same lookup.

25. **Shims and the retirement of `scripts/lib/extension-install.sh`.** Each of the
    thirteen shell scripts SHALL be reduced to a forwarding shim on the model of spec
    0250 requirement 22 and spec 0254 requirement 24: with no `node` on the path one
    `Error:` line naming `node` and 24 and exit 1; otherwise the floor guard, then
    `exec node` of the sibling `.ts` with the arguments forwarded and standard input
    untouched (the one-key prompt of requirement 12 reads it). Each shim stays on
    `ci/shell-allowlist.txt` where it is today, and the allowlist gains nothing.
    `scripts/lib/extension-install.sh` (51 lines, `ext_antigravity_resolve_tokens`)
    is retired **in intent** here: its twin is the Antigravity token rewrite of
    requirement 10 and `install-antigravity-extension.sh` stops sourcing it. The
    finding of authoring: `scripts/release-package-extension.sh` (row G2, not edited)
    does **not** source the library (it only names `install-extension.sh` in a comment);
    its only remaining consumer is `scripts/tests/test-release-package-extension.sh`,
    which sources it in-process at `:204`, `:226` and `:246` for the R19 oracle, and
    that suite is a Bash test that stays unchanged (parent requirement 13). The file
    SHALL therefore be kept, untouched but for comment lines and with its allowlist
    entry, until that suite migrates (rows G2 or the J rows retire it with its last
    consumer), and the path `scripts/lib/extension-install.sh` in the CI `paths:` of
    `build.yml` stays. This is the one place where "retired here" does not mean
    "deleted here"; the plan SHALL state it in the pull request description.

26. **Oracle and black-box tests (parent requirement 13).** No pull request SHALL both
    migrate a script and edit a Bash assertion of its tests. The Bash suites stay
    unchanged in their assertions: `scripts/tests/test-antigravity-component-install.sh`
    (runs `manage-antigravity-component.sh` against a sandbox with `HOME` redirected),
    `test-component-tier-resolution.sh` (drives the claude, workspace and copilot
    manage scripts, 38 touch points, among them the `Continue?` prompt with stdin
    piped), `test-install-extension-all.sh` (stub CLIs on `PATH`, grep of
    `[INSTALLED]`/`[SKIPPED]`/`[FAILED]`), `test-install-claude-plugin-marketplace.sh`
    (it keeps a real `jq` and refuses to run without it: it is the script
    under test that becomes `jq`-free, not its oracle; the Windows job of
    requirement 28 does not run the Bash oracles) and, incidentally, `test-build-extension.sh`
    (a hermetic claim on `install-claude-plugin.sh` sharing a fix),
    `test-check-extension-provenance.sh` (its fixtures reproduce the `ln -s` and `cp
    -rf` primitives and stay a Bash suite until row I1) and
    `test-release-package-extension.sh` (sources `extension-install.sh`, requirement
    25). All of them SHALL pass unchanged through the shims on Linux and macOS; a
    sandbox needs, beyond today's, a `node` on the restricted `PATH`, the root
    `package.json`, and the fixture closure the shim and the entries import (the
    fixtures copy `scripts/lib` and `scripts/*.sh|*.ts` whole, so `scripts/lib/link-or-copy*.ts`,
    `scripts/lib/install/` and `scripts/lib/manage/` are staged automatically; an
    import outside those paths would not be). The only edits allowed are in a
    preparatory pull request that leaves the thirteen scripts byte-identical (an empty
    diff, asserted in its description) and lets a suite stage those dependencies. The
    four oracles never assert `-L`, only `-e`, `-f` and `-d`, and symbolic links always
    succeed on macOS and Linux, so they cannot see the fallback: the fallback is
    covered by TypeScript tests with the seam of requirement 21 (checking `lstat` and
    the target).
    Scripts with no Bash test SHALL receive a black-box test before or with their
    migration, as a `node:test` suite that runs the unchanged shell first and the
    TypeScript entry after over the same sandbox (parent requirement 13): at least
    `install-workspace` (stubbed `manage-workspace-component` recording the order,
    one failing type, the closing block and status), `unlink-component`,
    `unlink-extensions`, `link-extensions` (tier order, `--include-org`, `INCLUDE_ORG`),
    `install-extension` (install and link, the all-extensions loop, a render failure)
    and `install-copilot-plugin` and `install-antigravity-extension` (stub CLIs, the
    token rewrite, each diagnostic). These suites SHALL land in the preparatory pull
    request, against the shell, before any entry exists.

27. **Parity proof (parent requirements 13, 14, 17, 22).** The pull request that
    ships the entries SHALL carry: a Linux differential test running the unchanged
    shell scripts and the TypeScript entries over a fixture matrix (every type of
    every manage script, install and link, a collision, an unknown type, the prompt
    answered `y`, `n`, other and end of input, an existing dangling link, a
    trailing-slash source, the marketplace upsert over an existing marketplace, a
    stubbed refusing `claude`) and comparing exit status, standard output, standard
    error (temporary names normalised) and the written trees and JSON byte for byte,
    each expected difference tagged with the letter of requirement 22 so that an
    unlisted difference fails; unit suites for the shared manage module, the
    marketplace upsert and the token rewrite; and unit suites for the link-or-copy
    module covering each requirement from 14 to 21 (every error code of requirement 15
    on both platforms, the staging and the rollback for a copy and for a link, a dangling destination, a
    real-directory destination replaced by a link through the swap, a destination
    inside its source, the retry, a copy that dereferences a link in its source, the
    aggregated notice naming every destination, `removePlaced` on a link, a copy and
    an absent name).

28. **`windows-latest` job (parent requirement 17).** A job on `windows-latest` run
    from PowerShell (and the `unlink` and `link` entries once from `cmd`) SHALL,
    after the production dependency install and the floor guard, run each of the
    thirteen entries against a sandbox `HOME`/`USERPROFILE` and assert its observable
    outcome: the files and trees each placed, the stdout lines, the exit statuses, no
    carriage return in a written file, `unlink` removing a link and a copy by name and
    reporting `Removed:`/`Not found:`, the Claude marketplace file's content with a
    stub `claude`, the Antigravity token rewrite with a stub `agy`, and the umbrella
    installer's `[INSTALLED]`/`[SKIPPED]` lines with stubs; link mode SHALL be run
    twice, once as the runner allows (a real link, or the real fallback when the runner
    cannot link, recording the error code observed) and once with the seam of
    requirement 21 forcing `EPERM` so the fallback and its aggregated notice are proved
    where Windows runners usually can link. It SHALL print the elapsed time of each
    step (parent requirement 15 does not gate on it). A mismatch that is not a path or
    separator artefact stops the work and is a `spec`-class finding. The job follows
    the conventions of the existing `windows-extension-builders`, `windows-build-components`,
    `windows-service-task` and `windows-history-import` jobs of
    `.github/workflows/build.yml` (spec 0243, 0250, 0252, 0254): `portability: specific`
    with its evidence block in `ci/ci-capabilities.yml`, mirrored by hand in
    `.github/workflows/build.yml`, then `.gitlab-ci.yml` regenerated.

29. **Ratchet, toolchain and CI.** No file outside the permitted languages SHALL be
    added; `ci/shell-allowlist.txt` loses no entry in the shim pull request (every
    script of requirement 1 stays as a shim) and gains none; `scripts/lib/extension-install.sh`
    stays (requirement 25). Every new file SHALL satisfy the checks of spec 0238 and the
    300-line warning. The CI capabilities that execute a script of requirement 1 (at
    authoring `extension-render`, the capabilities that call the install scripts and
    the component-tier tests) SHALL declare Node.js 24 and the production dependency
    install before their first call, the `paths:` of each SHALL name the TypeScript
    entries and modules beside the shell, and a new portable capability SHALL run the
    TypeScript suites of requirements 26 and 27; each is mirrored by hand in
    `.github/workflows/build.yml` and `.gitlab-ci.yml` regenerated. Every existing job
    SHALL stay green.

30. **CLI matrix and parity (parent requirement 19).** `docs/cli-matrix.md` SHALL gain
    the new module names and the three-system parity in every row that names the
    scripts (at authoring rows 12, 13, 14 and 16, and the `Taskfile.yml` row), as
    `AGENTS.md` → *CLI Matrix Maintenance* requires, in the pull request that ships
    the entries. A parity gap is claimed only with evidence that the mechanism does
    not exist in the target CLI; none is expected: the four CLIs keep their current
    install flows, and the only asymmetry (the workspace entry has no prompt)
    pre-exists and is preserved and recorded in the row.

31. **Skills, agents and provenance.** If a pull request of this ticket changes a skill
    or agent source under `artifacts/` or an extension's shipped skill that names one
    of the thirteen invocations, its `metadata.provenance.version` SHALL be bumped
    (`docs/version-bump-convention.md`), the built copies regenerated and staged in
    the same commit (`node scripts/build-components.ts`). The scripts themselves are
    not shipped skills or agents and carry no provenance field.

32. **References (parent requirement 9).** In the pull request that installs the
    shims, every documentation page, `Taskfile.yml` task, workflow step and skill
    instruction that tells a reader or an agent to run one of the thirteen scripts
    SHALL be updated to the TypeScript entry, written as two separate steps (the floor
    guard, then `node` and the entry), never chained with `&&` (the rule of
    `docs/ticket-ownership.md`, for PowerShell 5.1), each page stating the Node.js 24
    floor. At authoring the files that name them are `Taskfile.yml` (the
    `install-workspace`, `link-workspace`, `install-component`, `link-component`,
    `unlink-component`, the copilot, claude and antigravity component tasks,
    `install-extension-all`, `install-gemini-extension(s)`, `link-gemini-extension(s)`,
    `unlink-gemini-extensions` and the three deprecated aliases), `.github/workflows/build.yml`,
    `.gitlab-ci.yml`, `ci/ci-capabilities.yml`, `README.md`, `CONTRIBUTING.md`,
    `DEVELOPMENT.md`, `artifacts/FORMAT.md`, `docs/cli-matrix.md`,
    `docs/cli-matrix-maintenance.md`, `docs/layers.md`, `docs/extension-authoring.md`,
    `docs/extension-mcp-servers.md`, `docs/gitlab-release-publishing.md`,
    `docs/adr/0001-*` and `docs/adr/0011-*` (dated records: mentions, kept),
    `extension-skeleton/EXTENSION-FORMAT.md`, `extension-skeleton/base/README.md`,
    `extensions/core/hello-world/README.md`, `tests/gemini-extension-path-form.md`,
    and the Bash and fixture files (`scripts/tests/fixtures/*/old-invocation-allowlist.txt`);
    the plan classifies each line as an instruction (rewritten) or a mention (kept
    where the sentence only names the script, or a dated record) and lists the result.
    A test SHALL fail when a tracked file outside a committed allowlist (unmigrated
    shell, Bash tests, dated records, ADRs, `specs/`) still tells a reader to run
    `bash scripts/<one of the thirteen>.sh`.

33. **Pull-request staging and branch prefix.** The PLAN fixes the real split; the
    proposal is: PR A, the oracle hardening and the black-box tests of requirement 26
    with the shell untouched (an empty diff on the thirteen scripts); PR B, the
    link-or-copy module, the component-resolution twins and the shared manage module,
    dark (no entry imports them, each with its unit tests, none changing a script);
    PR C, the thirteen entries, dark behind the unchanged shell, with the differential
    test, the `windows-latest` job and the conformance test; PR D, the switch to shims
    and references (requirements 25 and 32, 29 and 30); PR E, the status flip of this
    spec. Every PR but the last targets `release/1231-ts-migration` and uses the branch
    prefix `test/1334-<slug>`, because the spec linter binds a `feat/` prefix to a
    `status: implemented` spec; the last uses `feat/1334-<slug>`.

### Decision record

**Decision: link-or-copy by attempt, no marker, no registry (taken by two
independent `architect` passes, arbitrated on recognition).**

Adopted: attempt the link on every call and decide from the error code
(requirements 14 and 15); copy through a staged rename (16); recognise nothing and
refresh unconditionally (17); report the fallback once on standard error naming every
destination (18); no drift computation (19).

Rejected alternatives:

- *A one-time probe of link support.* A probe leaves temporary files, and a cached
  first result is stale as soon as the destination changes.
- *Deciding on `process.platform` alone.* A Windows machine in Developer Mode links
  and a POSIX file system may report `ENOTSUP`.
- *Caching the first refusal.* Same objection as the probe.
- *NTFS junctions for directories.* Requirement 21 of the parent and the scenario say
  "copies the target instead"; junctions are local-volume and absolute-only, are not
  symbolic links, add a third state to unlink and refresh, and files need the
  copy path anyway. Reopen through a delta of this spec if wanted.
- *Hard links for files.* Same-volume only, and the link silently breaks when an
  editor replaces the file.
- *A copy by `rm -rf` then `cp -rf` (the shell's behaviour).* An interrupt leaves an
  empty landing zone; the staged rename keeps the old entry.
- *A marker file inside the copy.* It breaks the byte-identical copy, is impossible
  for a single-file target and pollutes directories that a CLI loads as skills or
  agents.
- *A registry outside the copies (`~/.crewrig/link-copies.json`, destination to
  source and digest, `unlink` refusing an unregistered directory without `--force`).*
  It deviates from the unlink contract (parent requirement 14), adds persistent state
  with a read-modify-write race and sandbox plumbing, and the unconditional refresh
  already covers staleness. **Reopen condition:** a data-loss incident on a same-named
  user directory, or a consumer row (G2, I1) that needs to tell a copy from a link
  (the registry alternative reopens only on one of those two conditions).
- *Drift detection at refresh time (sha256 of each file) and a read-only
  `inspectPlacement`.* With no marker and no registry a same-named user directory is
  indistinguishable from a stale copy, so a `foreign` state has no criterion, and no
  consumer in this row reads the result. Mtime or size comparison would not work in
  any case, since a copy does not preserve mtimes.

**Deferred.** Drift reporting and `inspectPlacement` are deferred to the row that
needs them (G2 or I1), added through a delta of this spec, together with the
registry reopen condition above. The requirement that a copy cannot silently go
stale is met by the unconditional refresh of requirement 17.

Other `ln -s` sites, recorded so they are not missed: `scripts/lib/common.sh`
(retired by J4) and `scripts/monorepo-release.sh` (row G2: one `node_modules` entry
per package; it uses `onRefusal: "throw"`).

## Scenarios

**Scenario:** Symbolic link refused on Windows

Given Windows without Developer Mode or administrator rights, so that creating a
symbolic link fails with `EPERM`, and an installed Gemini extension directory
When `node scripts/install-extension.ts link hello-world` runs
Then `~/.gemini/extensions/hello-world` is a real copy of
`build/extensions/hello-world/`, `Copied: hello-world (build directory)` (indented by two spaces) is
printed on standard output, standard error holds one notice that names
`~/.gemini/extensions/hello-world` as a destination that became a copy and says
that a change to the source takes effect only after the same command is run again,
the exit status is 0, and a second run replaces the copy with the current build.

**Scenario:** A link failure that is not a refusal still fails

Given a POSIX system and a destination whose parent is read-only (`EACCES`)
When any entry runs in link mode
Then no copy is made, the error is reported with the shell's non-zero status, and
the previous destination is intact.

**Scenario:** A failed copy leaves the old destination intact

Given a copy fallback in which the second rename fails
When the placement runs
Then the first rename is rolled back, the old destination is still in place with its
old content, and no `.<name>.crewrig-tmp-<hex>` sibling remains.

**Scenario:** A dangling link is replaced

Given `~/.claude/skills/foo` is a dangling symbolic link
When `node scripts/manage-claude-component.ts install claude-skills foo` runs
Then the link is removed, `foo` is a directory copy, and `Copied: foo` (indented by two spaces) is printed.

**Scenario:** Unlink by name removes a copy or a link

Given `~/.gemini/skills/foo` is a copy made by the fallback
When `node scripts/unlink-component.ts skills foo` runs
Then it is removed, `Removed: skills/foo` is printed, and nothing else changes; a
second run prints `Not found: skills/foo`.

**Scenario:** Link mode asks once and a bare answer cancels

Given `manage-copilot-component.ts link skills` with standard input holding `n`
When it runs
Then the `WARNING:` block and `Continue? [y/N]` followed by a space are printed, a line feed is echoed,
the exit status is 1 and nothing is placed; with `y` the components are placed.

**Scenario:** The umbrella installer reports each CLI

Given stubs for `claude` and `copilot` on the path, none for `agy` and `gemini`, and
no `~/.gemini`
When `node scripts/install-extension-all.ts hello-world` runs
Then `[SKIPPED]` is printed for Gemini and Antigravity, `[INSTALLED]` for Claude Code
and Copilot, the child output is not shown, and the `Summary:` line reports 2
installed and 2 skipped with exit 0.

**Scenario:** The marketplace is upserted, not duplicated

Given a local marketplace that already lists `hello-world`
When `node scripts/install-claude-plugin.ts hello-world` runs
Then `marketplace.json` lists `hello-world` once, appended last, and the stub `claude`
was called with `plugin marketplace add … --scope user` then `plugin install
hello-world@<repo>-local --scope user`.

**Scenario:** The Antigravity token is resolved after install

Given a plugin whose `mcp_config.json` holds `${extensionRoot}` and a stub `agy`
that installs it under `~/.gemini/config/plugins/<name>/`
When `node scripts/install-antigravity-extension.ts <name>` runs
Then the installed file holds the installed directory in place of every token and
`Resolved ${extensionRoot} -> <dir> in <file>` (indented by two spaces) is printed.

**Scenario:** The Bash oracle passes through the shims

Given the shims installed
When the four oracles and the incidental suites of requirement 26 run on Linux and
macOS
Then every assertion passes unchanged.

**Scenario:** A too-old Node.js changes nothing

Given Node.js 20 on the path
When the shim of any of the thirteen scripts runs
Then one line names Node.js 24 as the floor, the exit status is 1 and no file is
written.

## Out of scope

- The setup entry points (`scripts/setup-*.sh`, row F1, #1335) and any edit of
  `scripts/lib/common.sh` (retired by J4).
- Monorepo release and packaging (`scripts/monorepo-release.sh`,
  `scripts/release-package-extension.sh`, row G2, #1336), which adopt the link-or-copy
  module later; `scripts/check-extension-provenance.sh` (row I1).
- Migrating any Bash test (the J rows); the new black-box tests of requirement 26 are
  added beside them.
- The builders (`scripts/build-*.sh`), already migrated (spec 0254).
- Any change to the install flows, the supported CLIs, the manifest schema or the
  overlay tier set.
- Windows junctions, hard links and a registry of copies (see the Decision record).
- A Windows run of the Bash oracles, and a latency budget.

## Open questions

- **Assumption, unverified:** Node.js 24 on a real Windows host surfaces the Windows
  `ERROR_PRIVILEGE_NOT_HELD` of `CreateSymbolicLinkW` as `EPERM`. The `windows-latest`
  job of requirement 28 records the code it observes under a forced refusal when the
  runner can link, and proves the real fallback when it cannot; a different code
  (for example `EACCES` or `UNKNOWN`) is a `spec`-class finding and a delta of this
  spec.
- **Unverified:** the code that a Windows volume which cannot create symbolic links
  yields. Under requirement 15 any code outside the admitted set propagates and fails
  loudly; a delta of this spec widens the set if the `windows-latest` job (or a
  maintainer) observes one.
- **Assumption, unverified:** the Windows `EPERM`/`EBUSY` retry bound of requirement
  16 (5 attempts, 50 ms) is enough against antivirus and indexer locks; the PLAN
  measures it on `windows-latest`.
- Whether the new module shares `LINK_REFUSALS` of `tree-copy.ts` (requirement 15) is
  left to the PLAN.
- The environment variable name of requirement 21 is proposed, not fixed.
