---
id: "0256"
slug: setup-entry-points-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1335
version: 1.0.0
---

# Setup entry points in TypeScript

*Sub-spec F1 of the `large`-tier ticket #1231, row F1 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirements 4, 5, 6, 9,
13, 14, 15, 17, 19, 21, 22 and 23, row F, as ordered by
`specs/0215-shell-to-typescript-migration.delta-01.md`), under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md` (requirements
27-38): this spec-PR and its implementation pull requests target
`release/1231-ts-migration`, "shipped" means merged there, not reached `main`, and
the base ref wherever a protocol names `main` is `origin/release/1231-ts-migration`
(requirement 34). Requirement 23 of the parent applies as narrowed by
`specs/0215-shell-to-typescript-migration.delta-05.md`. Depends on sub-specs D
(`specs/0252-windows-service-management.md`, implemented: `scripts/lib/service/*`),
A2 (`specs/0240-runtime-foundations-shared-ts-modules.md`: `scripts/lib/paths.ts`,
`line-endings.ts`, `tmp-file.ts`, `require-dependency.ts`, `node-floor-guard.js`
and the `windows-latest` job conventions), G1a
(`specs/0250-component-build-core-typescript.md`: `component-resolve.ts`,
`render-command.ts`, `model-resolve.ts`, `build-components/*`), G1b
(`specs/0254-extension-plugin-builders-typescript.md`: `scripts/lib/org-mcp.ts`),
F2 (`specs/0255-install-manage-link-typescript.md`: the entry form, the
link-or-copy module, `scripts/lib/install/`, `scripts/lib/manage/`), F3
(`specs/0253-history-import-operational-commands-typescript.md`: the line-queue
prompt of `scripts/lib/history-import/prompt.ts`), C1
(`specs/0243-usage-capture-hooks-typescript.md`: the usage-capture hook
rewrite and recognition modules) and C3
(`specs/0247-mempalace-transcript-hook-typescript.md`: the transcript hook
modules and the `tls-env.ts` reader). It inherits the behavioural contracts of
`specs/0084-custom-root-ca-support.md` (custom-CA trust delegation),
`specs/0158-verify-mcp-listener-owner.md` and `specs/0252` (the MemPalace HTTP
daemon), and the four shell setup flows themselves, and preserves them except for
the deviations of requirement 44. Line
references are to `release/1231-ts-migration` at `2ed0086`.*

## Intent

An adopter on Windows, macOS or Linux installs CrewRig for Claude Code, Gemini
CLI, GitHub Copilot CLI or Antigravity CLI by running one command from the shell
that operating system ships, with no POSIX shell, `fzf` or `jq` on the machine:
on Windows from PowerShell, on macOS and Linux as today. The run offers the same
choices in the same order, deploys the same rules, skills, agents, hooks and MCP
registrations, writes the same files, prints the same messages a script or a
test reads, and exits with the same statuses, except for the few listed changes.
The choices are asked as numbered questions on any terminal, and every question
can be answered ahead of time on the command line, so that an installation
can be scripted and a run with no terminal and no answers refuses to guess,
naming the question it could not ask, instead of changing the user's home
directory on a default nobody chose. Re-running setup after an update still
refreshes every installed hook command and every dependency without asking
again.

<!-- markdownlint-disable MD029 -->

## Requirements

### Entries and structure

1. **Entry points.** Four TypeScript entries SHALL replace the behaviour of four
   shell scripts, each at the path of its predecessor with `.sh` changed to `.ts`
   (parent requirement 9, spec 0240 requirement 11), runnable as a direct `node`
   command line and written to the conventions of parent requirement 2 (erasable
   syntax, strict typing, every value entering from a file, the environment, a
   subprocess, a prompt answer or the command line typed `unknown` and narrowed
   before use): `scripts/setup-claude-interactive.ts` (571 lines of shell),
   `scripts/setup-gemini-interactive.ts` (528), `scripts/setup-copilot-interactive.ts`
   (512) and `scripts/setup-antigravity-interactive.ts` (671). Each `.sh` SHALL be
   reduced to a forwarding shim (requirement 36) in the pull request that
   switches the references.

2. **Entry form, floor and silence.** Each entry SHALL use the entry form of spec
   0255 requirement 3 (no top-level `import` or `export`, the `warning` listeners
   removed as the first statement, the module graph loaded with `import()` inside
   one asynchronous wrapper that reports an uncaught error as one `Error:` line
   with control characters escaped and sets `process.exitCode`), so that
   `node scripts/<entry>.ts` writes no Node.js warning on any Node.js 24 release
   with no flag and no environment variable. As user-facing entry points (parent
   requirement 4) they SHALL be documented behind the floor-guard step (`node
   scripts/lib/node-floor-guard.js`, then the entry, as two separate steps) and
   SHALL leave the filesystem unmodified on a Node.js below the floor. The
   repository root SHALL be derived from the entry's own location, never by
   searching upward for a `.git` entry.

3. **One module graph, symmetric setups.** The four entries SHALL share one module
   graph under `scripts/lib/setup/`, one concern per file, no TypeScript file this
   ticket adds exceeding the 300-line warning threshold of spec 0238, and each
   entry a thin wrapper of at most 300 lines that supplies a per-CLI descriptor.
   The four setups SHALL stay symmetric (parent requirement 19): the common flow
   (banner, `--link` warning, prerequisites, identity check, rules, validation
   backend, TLS offer, dependency step, MCP, picks, tier install, hooks, summary)
   lives once; the per-CLI differences that exist today (home directories, rule
   file names, the `/init-soul` invocation string, the order of the picks, whether
   agents are installed, the MCP target and writer, which hook channels exist)
   SHALL be data or a strategy supplied by the descriptor, never a copy of the
   flow. The plan names the files.

4. **Reuse, no redefinition.** The build reuses what ships on the release branch
   and redefines none of its primitives; where one needs a new export, the export
   is added and the existing behaviour is untouched. At authoring these exist:
   `scripts/lib/paths.ts`, `line-endings.ts`, `tmp-file.ts`, `jsonc.ts`,
   `escape-control.ts`, `link-or-copy*.ts` (`linkOrCopy`, `placeCopy`,
   `removePlaced`, `summarizeFallbacks`), `node-floor-guard.js`,
   `require-dependency.ts`; `scripts/lib/install/` (`ctx.ts`, `spawn.ts`) and
   `scripts/lib/manage/` (`entry.ts`, `confirm.ts`, `place.ts`, `mcp-json.ts`,
   `mcp-claude.ts`, `overlay-loop.ts`); `component-install.ts`,
   `component-resolve.ts`, `component-roots.ts`, `component-overlay.ts`,
   `antigravity-migrate.ts`, `render-command.ts`, `model-resolve.ts`,
   `build-components/*` (the build is callable in-process);
   `mempalace-python.ts`, `mempalace-pin.ts`, `mempalace-registration.ts`,
   `org-mcp.ts`, `playwright-mcp*.ts` with `scripts/setup-playwright-mcp.ts` (an
   existing setup entry with injected dependencies); `worktree-claim/launch-windows.ts`
   (PATHEXT and `.cmd` launch); `hook-rewrite.ts`, `hook-config.ts`,
   `hook-command.ts`, `hook-registry.ts`, `hook-recognition.ts`,
   `transcript-recognition.ts`, `hook-statusline.ts`, `hook-guard-manifest.ts`,
   `hook-transcript-manifest.ts`, `hook-transcript-cli.ts`, `hook-antigravity*.ts`,
   `session-check-config.ts`, `scripts/hook-wiring.ts`,
   `scripts/session-check-hooks.ts`; `service/*` (row D); `tls-env.ts` (reader);
   `history-import/prompt.ts` (a pattern to follow, not to edit). The plan SHALL
   fix, by reading those files, which of them each entry imports and which need
   a new export.

5. **What this row adds.** Because the shell functions below have no TypeScript
   twin, the row SHALL write them, for one reason and no other: they are
   dependencies of the four setups. `scripts/lib/common.sh` (retired by row J4),
   `scripts/lib/gemini-settings.sh` and `scripts/lib/tls-exec.sh` SHALL stay
   byte for byte except for comment lines, other shell consumers keep calling the
   shell originals, and the existence of the twins SHALL NOT be cited as precedent
   for retiring them here: `install_file`, `install_dir`, `backup_file`,
   `pick_catalogue_entry`, `ensure_tier_built`, `install_production_dependencies`,
   `offer_tls_delegation` and its writer, `configure_validation_backend`,
   `print_store_access_guidance`, `warn_if_linked_worktree`,
   `offer_mempalace_install`, `mempalace_version_in_range`, `install_chroma_daemon`,
   the MemPalace registration glue around `ensure_mempalace_http`,
   `merge_preexisting_mcp_servers`, `read_org_mcp_manifest`, `apply_org_mcp_servers`,
   `register_org_mcp_claude`, `write_json_config_secure` and
   `write_json_config_secure_from`, the settings merge of `gemini-settings.sh`
   (`gemini_settings_write`), every `usage_capture_*` function,
   `render_session_recording_manifest`, `merge_session_recording_hooks`,
   `install_antigravity_tier_to_home`, `install_tls_exec_wrapper` and the four
   entries.

### Observable contract and oracle

6. **Contract preserved.** Each entry SHALL preserve the observable contract of
   its shell predecessor (parent requirement 14): the one flag `--link` (every
   other argument ignored, as today, except the `--answer` flag of requirement 13),
   the environment it reads (`HOME`, `CREWRIG_USAGE_ROOT` in the Antigravity
   setup, `TLS_DELEGATION=on|off`, and the `VALIDATION_*` bypass of
   `configure_validation_backend`, `common.sh:2325`), the order of the steps listed
   in requirement 3, every message on standard output and standard error that a
   script or a test reads, the exit statuses and the files written, except for the
   deviations of requirement 44.

7. **The black-box oracle is written first.** No test runs any setup script end to
   end today (the suites extract fragments, source `common.sh` or grep text). A
   black-box harness SHALL therefore land before any TypeScript entry exists, in a
   pull request that leaves the four scripts and the two libraries byte-identical
   (an empty diff, asserted in its description): a sandboxed `HOME` and
   `USERPROFILE`, a stub `fzf` that answers by the `--header` it receives, stub
   `claude`, `npm` and `pipx` (and `agy`), a real `jq` on Linux, a root
   `package.json` and the fixture closure the shell needs, and golden outputs
   (`.golden` fixtures) recording standard output, standard error, exit status and
   the written tree for each of the four setups over a matrix: default answers, a
   decline everywhere, `--link`, an existing context file kept and refreshed, an
   empty catalogue, the tier opt-ins, a missing prerequisite, a missing identity
   file and a cancelled prompt. The suite runs the unchanged shell first and the
   TypeScript entry after over the same sandbox, and plays the oracle role of
   parent requirement 13 for scripts that have no Bash test of their own.

8. **Oracle rules.** No pull request SHALL both migrate a script and edit a Bash
   assertion of its tests (parent requirement 13). The existing Bash suites SHALL
   stay unchanged in their assertions and pass through the shims of requirements
   36 and 37 on Linux and macOS. A suite that mutates the shell implementation in
   a sandbox to prove that it fails on a regression SHALL, from the pull request
   that adds the TypeScript twin, mutate the twin as well, so that the oracle
   cannot pass vacuously against code it no longer exercises (the oracle mutation
   rule of spec 0255).

9. **Static-read retarget carve-out.** Many Bash and TypeScript suites assert a
   property of a setup script's text rather than its behaviour (they extract a
   function body or a block, grep for a call and its order, or read a message). A
   pull request that migrates no script MAY retarget such an assertion, so that it
   reads a TypeScript declaration or the observed behaviour of the entry, on
   three conditions: the pull request lists each retarget as before and after;
   each retargeted assertion keeps a vacuity guard (the test fails when the
   declaration it now reads is removed or emptied); and the retarget is landed
   before the switch, never in the pull request that reduces a script to a shim.
   The starting list is that of the design notes of this ticket: the suites
   `test-setup-mcp-merge.sh`, `test-setup-catalogue-picker.sh`,
   `test-setup-usage-capture-optin.sh`, `test-setup-gemini-md-cleanup.sh`,
   `test-artifact-build-install-scope.sh`, `test-mcp-daemon.sh`,
   `test-component-tier-resolution.sh`, `test-setup-claude-transcript.sh`,
   `test-setup-gemini-transcript.sh`, `test-setup-copilot-transcript.sh`,
   `test-setup-antigravity-transcript.sh`, `test-check-gemini-overlay-enrollment.sh`,
   `test-setup-validation-backend.sh`, `test-tls-delegation.sh`,
   `test-setup-org-mcp.sh`, `test-setup-ensure-tier-built.sh`,
   `test-setup-mempalace-rc-guard.sh`, `test-setup-init-command-instructions.sh`,
   `test-system-context-store.sh`, `test-mempalace-doctor.sh`,
   `test-antigravity-component-install.sh`, `test-setup-gemini-settings-merge.sh`,
   and the TypeScript suites `hook-transcript-floor.test.ts`,
   `hook-guard-setup.test.ts`, `setup-dependency-step.test.ts`,
   `mempalace-registration.test.ts`, `mempalace-registration-agreement.test.ts`,
   `mempalace-session-check.test.ts` and `tests/lib/session-check-harness.ts`.
   Non-test code that names a script (`scripts/check-gemini-overlay-enrollment.sh`
   reading the `NN_NAME.md` tokens, the warning text of `mempalace-registration.ts`,
   the hint of `require-dependency.ts`) follows the same rule. The PLAN completes
   the list by running every suite that reads a setup script's text and records
   the result.

10. **Parity proof.** The pull request that ships the entries SHALL carry a Linux
    differential test running the unchanged shell setups and the TypeScript entries
    over the matrix of requirement 7 and comparing exit status, standard output,
    standard error (temporary names normalised, `LC_ALL=C`) and the written trees
    and JSON byte for byte, each expected difference tagged with the letter of
    requirement 44 so that an unlisted difference fails; unit suites for each new
    module; a test table that pins the prompt ids, option order, defaults and
    messages of requirements 11 to 16; and a differential test of every TypeScript
    twin of a shell library function (`tls-env` writer against the shell writer,
    the settings merge against `gemini-settings.sh`, the usage-capture functions
    against `usage-capture-optin.sh`) over a fixture matrix, Linux only and retired
    with the shell libraries.

### Prompt layer

11. **One prompter, no `fzf`.** Every question the shell asked through `fzf` or
    `read` SHALL be asked by one prompt module built on the Node.js standard
    library, in line mode, identically on every operating system and every terminal
    state. No setup SHALL spawn `fzf`, and the `command -v fzf` and `command -v jq`
    prerequisite guards SHALL be removed (requirement 44). The prompt module SHALL
    offer the options in the order the shell listed them, so that a blank answer
    selects the first option, as pressing Enter did on `fzf` (yes/no questions that
    list `yes` first default to yes; the opt-ins that list `no` first default to
    no). It SHALL read from one line queue shared by every question of the run (the
    pattern of `scripts/lib/history-import/prompt.ts`, which is not edited here).

12. **Prompt ids.** Every question SHALL carry a stable identifier, a public
    surface pinned by a test table: at least the rules action (keep or refresh),
    the Sequential Thinking opt-in, the validation backend, the transcript
    opt-in and its confirmation, the usage-capture opt-in, the three catalogue
    picks (`catalogue.team`, `catalogue.expertise`, `catalogue.level`), the profile
    method, the overlay tiers (`overlay.community`, `overlay.org`), the legacy MCP
    removal, the settings template install and the `--link` confirmation. The exact
    list and the spelling are fixed by the PLAN and then frozen.

13. **Pre-answers.** Each entry SHALL accept the repeatable flag `--answer
    <id>=<value>`, forwarded by the shims, that answers the question with that
    identifier without asking it and echoes `[answer] <id>=<value>`. An unknown id,
    an id given twice with different values or a value that is not one of the
    question's options SHALL be a usage error that exits 2 before any file is
    modified. Every other unknown argument stays ignored, as today.

14. **Fail closed.** When a question has no pre-answer and standard input is not a
    terminal and holds no further line (a closed pipe, `/dev/null`), the entry SHALL
    exit 2 with a diagnostic naming the question's id and suggesting `--answer`,
    and no question SHALL be answered by default, because defaulting would
    auto-confirm questions whose first option is yes. This applies before the first
    file is modified for every question the run can know it will ask, and at the
    question otherwise.

15. **Cancel and input forms.** A question SHALL accept the option's number or its
    name, case-insensitive; a leading U+FEFF and a trailing carriage return SHALL be
    stripped (PowerShell 5.1 pipes); a piped invalid answer SHALL be an immediate
    error, an interactive invalid answer SHALL be asked again up to three times.
    Cancelling a question (end of input on an interactive terminal) SHALL keep the
    shell's per-site asymmetry: at the sites that end in `|| true` today
    (transcript, its confirmation and the usage-capture question of the Claude,
    Gemini and Copilot setups) cancel SHALL be a decline and the run SHALL continue;
    at every other site (all the Antigravity questions, Sequential Thinking, the
    profile method and the rest) cancel SHALL abort with the shell's status 130 and
    the line `Setup cancelled at: <header>` on standard error. Ctrl-C keeps its
    default behaviour.

16. **The `--link` warning and stdin ownership.** The `--link` mode SHALL print the
    shell's warning and ask the one-key question of `scripts/lib/manage/confirm.ts`
    reused unchanged (exit 1 with `Aborted. Run without --link for secure copy mode.`
    unless the key is `y` or `Y`); the line-mode prompter SHALL be created only after
    that question, so the two readers never contend for standard input. A child
    process the setup spawns (npm, the build, pipx, a CLI) SHALL NOT read the answer
    queue: its standard input is ignored, or the queue is paused for the call.

17. **Catalogue picker.** The team, expertise and level picks (and the overlay-tier
    picks) SHALL list the entries of the catalogue directory sorted ordinally, and
    SHALL accept `?N` to print the first 20 lines of entry N in place of the `fzf`
    preview. An empty catalogue SHALL short-circuit before any question and print the
    two messages of `pick_catalogue_entry` verbatim on standard error (`No … catalogue
    entries found`, `No … selected`) with its status. The order of the picks per CLI
    is unchanged (the Copilot setup asks level, expertise, then team).

### TLS delegation

18. **Offer.** The TLS delegation step SHALL keep its detection (the eight
    environment variables that name a bundle, then the three operating-system bundle
    paths, each only if it is a file; a custom-CA context is the twelve variables
    non-empty or a non-empty anchors directory), its `TLS_DELEGATION=on|off` bypass
    (any other value an error with status 1), its guidance when no bundle is found
    and its position: after the validation backend and before the production
    dependency step, so that the order `offer_tls_delegation` < dependency step <
    tier build stays what `setup-dependency-step.test.ts` pins.

19. **Writer and format.** The writer SHALL live in `scripts/lib/tls-env.ts` beside
    the reader, and the format of `~/.crewrig/tls-env.sh` SHALL stay the shell format
    (Decision record): three comment lines, six `export NAME=<quoted path>` lines in
    the order `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`,
    `PIP_CERT`, `GIT_SSL_CAINFO`, `CURL_CA_BUNDLE`, then `export UV_SYSTEM_CERTS=true`,
    LF only, no mode change, written atomically next to the target and removed on
    failure, a decline writing nothing and leaving an existing file untouched. The
    quoting SHALL be accepted by the shell (`.`) and by the reader of `tls-env.ts`,
    escaping every other printable ASCII character with a backslash (so that a
    Windows path with a drive letter and a space round-trips), never single quotes,
    never a verification-disabling variable, and rejecting a NUL. After writing, the
    entry SHALL read the file back with the reader; a file the reader rejects is a
    fatal error. It SHALL then place the variables in its own environment so that
    every child it spawns inherits the bundle with no wrapper, and print the written
    configuration, each line indented by four spaces. A file already installed is
    valid input and SHALL NOT be migrated; it is rewritten only on a later run whose
    user consents. A later change of the format SHALL change the reader, the service
    trust wrapper and `tls-exec.sh` together under a deprecation cycle.

### Production dependencies

20. **Dependency step.** After the TLS step and before importing any third-party
    package (parent requirement 6), each entry SHALL run `npm ci --omit=dev
    --workspaces=false` at the repository root on every run, gated as today on the
    SHA-256 of `package-lock.json` recorded in `.crewrig-state/production-deps.sha256`
    after the last successful run; a hit skips the install silently as the shell
    does, a miss installs, and a failure prints the npm diagnostic and exits non-zero
    with no further step and no partial install. Everything before this step SHALL
    use the Node.js standard library alone. The children inherit the CA variables of
    requirement 19. On Windows `npm` SHALL be launched through the platform lookup
    (`npm.cmd`) with arguments as an array and never through a shell. A script that
    still cannot resolve a third-party package SHALL name the package and tell the
    user to re-run setup (`require-dependency.ts`), never print a module-resolution
    error. The step has no TypeScript twin today (row 36 of `docs/cli-matrix.md`);
    this row adds it.

### Prerequisites, identity and rules

21. **Prerequisites and identity.** The prerequisite checks SHALL be those of the
    shell minus `fzf` and `jq` (requirement 44): `claude` for the Claude setup,
    `agy` first for the Antigravity setup, and for the Copilot setup only the warning
    when neither `gh copilot` nor `copilot` is found; the lookup SHALL use the
    platform's executable resolution (`PATHEXT` on Windows). The identity check
    SHALL require `config/SOUL.md` and `config/PROFILE.md`, print the list of missing
    files and the per-CLI invocation string (`claude /init-soul`, `gemini /init-soul`,
    `copilot -i "/init-soul"`, `agy -i "/init-soul" --new-project`, and the profile
    counterpart), and exit as the shell does.

22. **Rules deployment.** Each setup SHALL deploy its CLI's rule files (Claude
    `~/.claude/rules/{20-organization,60-tools,65-org-tools,00-soul,50-team,40-expertise,10-level,30-profile}.md`;
    Gemini `~/.gemini/NN_*.md` including `66_ORG_RULES` from `AGENTS.org.md`;
    Copilot `~/.copilot/instructions/*.instructions.md`; Antigravity the files under
    its home and the generated `~/.gemini/config/AGENTS.md` with its
    `<!-- crewrig-section: <name> -->` headers), the system-context store to
    `~/.crewrig/system-context`, and the `.selected_{team,expertise,level}` marker
    files, with the keep-or-refresh and keep-local-or-overwrite questions and the
    backup-first behaviour of the shell. Under `--link` every file and directory
    SHALL be placed through the link-or-copy module of spec 0255 (a refused symbolic
    link places a copy, reported once at the end, requirement 44(i)); the removal of
    a legacy `~/.gemini/GEMINI.md` carrying `<!-- crewrig-section:` SHALL stay.

23. **Validation backend.** `configure_validation_backend` SHALL be reproduced with
    its `VALIDATION_*` bypass, its configuration file and its messages unchanged.

24. **Tier install and build.** The library tier SHALL install automatically and the
    community and org tiers each behind their opt-in question and only when the
    built tier directory exists. The build SHALL be run through the in-process entry
    of `scripts/build-components.ts` and never through `bash
    scripts/build-components.sh` (parent requirement 23). Skills, agents and the
    Copilot skills-only rule, the Gemini `.gemini` staging with flat agents and the
    Antigravity install and supersession migration SHALL be placed as today, through
    `component-install.ts` and `antigravity-migrate.ts`.

### MemPalace and MCP

25. **MemPalace flow.** Each setup SHALL keep the flow: detect the Python
    interpreter, offer the install when none, check the installed version against the
    range (a version outside the range exits 1), install the Chroma daemon, and
    register or converge the MemPalace MCP entry for the CLI. The registration
    SHALL go through `mempalace-registration.ts`, wrapping the launch with
    the trust wrapper when a TLS file exists.

26. **The daemon contract.** The result of `ensure_mempalace_http` (return code 0:
    HTTP endpoint ready, keep; 1: converge to the stdio launch; 2: keep the existing
    entry and warn) SHALL be preserved for each CLI, including the `LOCKOUT WARNING`
    text the Gemini setup prints. How the contract maps onto the row-D service
    modules is left to the PLAN (see Open questions); the mapping SHALL not change
    what a run leaves on the machine, and SHALL be pinned by the unchanged
    `test-setup-mempalace-rc-guard.sh` after its retarget (requirement 9).

27. **MCP registration per CLI.** The Claude setup SHALL register servers through
    the `claude` CLI (`claude mcp list`, `add --scope user`, `remove`), skip an
    already registered name, and launch `claude` through the platform lookup with
    `PATHEXT` and `.cmd` handling (the `launch-windows.ts` precedent). The Gemini
    setup SHALL merge `~/.gemini/settings.json` as `gemini-settings.sh` does (return
    code 0 ok, 2 incomplete exits 1, any other exits 1). The Copilot and Antigravity
    setups SHALL write `~/.copilot/mcp-config.json` and
    `~/.gemini/config/mcp_config.json`, capturing the pre-existing servers before the
    overwrite and merging them back, replacing the `__CREWRIG_REPO_DIR__`
    placeholder. Every written JSON file SHALL be backed up first, written
    atomically and, where the shell restricted it, mode 0600.

28. **Organisation MCP and Sequential Thinking.** The organisation MCP declaration
    SHALL be folded into each CLI's configuration through `org-mcp.ts` (for Claude,
    through `claude mcp add`), and the Sequential Thinking opt-in SHALL register the
    server wrapped as `tls-exec.sh npx -y @modelcontextprotocol/server-sequential-thinking`
    where the shell does.

### Hooks and usage capture

29. **Installed commands are rewritten on every run.** Every run SHALL rewrite the
    already-installed command lines of the guard hooks, the transcript hooks, the
    usage-capture hooks and the Antigravity statusline to the form of parent
    requirement 15 (a direct `node "<path>/<script>.ts"` line), even when the user
    declines the corresponding question and before the session-recording question
    is asked, using `hook-rewrite.ts`, `hook-statusline.ts` and
    `hook-antigravity*.ts`. The statusline marker string
    `crewrig-setup-antigravity-interactive` stays.

30. **Session recording and usage capture.** The session-recording opt-in SHALL keep
    its steps (render the manifest, merge, and for Claude the environment patch
    `MEMPALACE_TRANSCRIPT_ENABLED=1` and `MEMPALACE_PYTHON` only when the
    transcript hooks were wired), the Copilot `disableAllHooks` warning and the
    Antigravity transcript deployment. The usage-capture opt-in SHALL keep its
    states (keep, enable, remove, reinject, apply and the disclosure text), its
    deduplication and repointing of installed entries, its pruning, its path-safety
    rejection of a path holding a quote, `$`, a backtick, a backslash or a newline,
    and the grouped hook shape for Claude and Gemini and the flat shape for Copilot.
    The unchanged `test-setup-usage-capture-optin.sh` is its oracle (requirement 8).
    The Antigravity usage channel (the statusline, with its marker state file under
    `$CREWRIG_USAGE_ROOT/state/`) SHALL stay a separate path from the
    hooks-file channel.

31. **Settings files.** Every settings and hook file a setup writes SHALL be
    byte-identical to the shell's output for the inputs it handles, mode 0600 where
    the shell set it, backed up first (`<file>.bak` rule of `backup_file`), and
    written atomically (requirement 44(j)); a file that is not valid JSON SHALL name
    the file in a one-line error (requirement 44(j)).

32. **Session check.** After the hook steps each setup SHALL run the floor guard and
    register the session-check hooks for its CLI exactly as `session-check-hooks.ts
    register <cli>` does today, and print the closing summary of the shell (the rules
    installed, the registered servers for the CLI, and the store-access guidance).

### The two library shims

33. **Function shims (Decision D3).** `scripts/lib/tls-delegation.sh` and
    `scripts/lib/usage-capture-optin.sh` SHALL become forwarding function shims in
    the switch pull request: each public function keeps its name, arguments,
    standard output and return code and forwards to the TypeScript implementation
    (one floor-guarded node entry per library), so that the unchanged Bash suites
    that source them in-process (`test-tls-delegation.sh`,
    `test-setup-usage-capture-optin.sh`,
    `test-setup-{claude,copilot,gemini}-transcript.sh`, the suites that source them
    through `scripts/tests/lib/bash-libs.ts`) become the oracle of the port. The
    shell variables the originals set (`SR_TRANSCRIPT_WIRED`, `SR_ALL_HOOKS_DISABLED`)
    SHALL travel back to the sourcing shell through a side channel the PLAN fixes;
    the shell `offer_tls_delegation` SHALL keep sourcing the written file in the
    calling shell. Both shims stay on `ci/shell-allowlist.txt` and retire with the
    last Bash test that sources them (rows J1b and J4). `common.sh`,
    `gemini-settings.sh` and `tls-exec.sh` are not edited.

### Windows

34. **`windows-setup-entries` job (parent requirement 17).** A job on
    `windows-latest`, run from PowerShell with a sandboxed `HOME` and `USERPROFILE`
    and `.cmd` stubs for the CLIs, SHALL, after the production dependency step and
    the floor guard, run each of the four entries and assert the files and trees
    written, the standard output lines, the exit statuses and that no written file
    holds a carriage return. It SHALL include an end-to-end "install CrewRig from
    PowerShell" proof for at least the Claude entry, including a real `npm ci
    --omit=dev --workspaces=false` and a real `claude mcp` call against a stub, and
    these cases: a run driven only by `--answer` flags; a run with piped standard
    input (CRLF line ends and a byte-order mark); a run with closed standard input
    and no answers that asserts exit 2 and the diagnostic; a TLS opt-in that writes
    a file both readers accept; a `--link` run with the link-or-copy seam forced to
    refuse. A mismatch that is not a path or separator artefact stops the work and is
    a `spec`-class finding. The job follows the conventions of the existing Windows
    jobs (`portability: specific` with its evidence block in `ci/ci-capabilities.yml`,
    mirrored by hand in `.github/workflows/build.yml`, then `.gitlab-ci.yml`
    regenerated). The real-console path (interactive raw input) is covered by a
    fake-terminal unit test and one manual Windows check recorded on the logbook.

35. **Timings are printed, not asserted.** The job SHALL print the elapsed time of
    each step. Parent requirement 15's latency budgets apply to scripts wired into a
    CLI integration point and run on a hot path (a hook, a statusline); the setup
    entries are run by hand, once, and are dominated by `npm ci`, the MemPalace and
    Chroma installs and the user's answers, so no budget is set or asserted for them.

### Shims, references and cross-cutting

36. **Shims for the four setups.** Each of the four `.sh` SHALL be reduced, in the
    switch pull request, to a forwarding shim on the model of spec 0255 requirement
    25: with no `node` on the path one `Error:` line naming `node` and 24 and exit 1;
    otherwise the floor guard, then `exec node` of the sibling `.ts` with the
    arguments forwarded and standard input untouched. Each shim stays on
    `ci/shell-allowlist.txt` where it is today and the allowlist gains nothing
    except by requirement 33.

37. **Sandbox rule.** A setup writes into the real home directory. Every proof
    (differential, golden, Windows job, an agent's own run) SHALL run with `HOME`
    and `USERPROFILE` redirected to a temporary directory, and the author SHALL
    verify that the real `~/.claude`, `~/.gemini`, `~/.copilot` and `~/.crewrig`
    are unmodified after any run.

38. **Line endings, paths, case (parent requirement 22).** Every file a setup writes
    SHALL have LF line endings, including `tls-env.sh`, rules, settings and hook
    files; paths SHALL be built with platform-aware handling and written inside a
    file with `/`; no setup SHALL depend on two paths that differ only by letter
    case; and `HOME` on Windows SHALL resolve through `os.homedir()` when `HOME` is
    unset.

39. **No POSIX tool (parent requirement 23).** The entries SHALL spawn only `claude`,
    `agy`, `gh`, `git`, `npm`, `node`, the Python toolchain for the MemPalace
    install, and the service manager through `scripts/lib/service/*`, by name through
    the platform lookup with arguments as an array and never through a shell. They
    SHALL NOT spawn `fzf`, `jq`, `find`, `sed`, `awk`, `wc`, `diff`, `grep`, `ls`,
    `cp`, `mv`, `rm`, `mktemp`, `curl` or `bash`. The two function shims and the
    four shims are the shell, and are the only files exempt.

40. **Ratchet, toolchain and CI.** No file outside the permitted languages SHALL be
    added; every new file SHALL satisfy the checks of spec 0238; the `.golden`
    fixtures SHALL be named as the repository's golden convention requires. The CI
    capabilities that execute a setup script SHALL declare Node.js 24 and the
    production dependency step before their first call, name the TypeScript entries
    and modules in their `paths:`, and a new portable capability SHALL run the
    TypeScript suites of requirements 7 to 10; each is mirrored by hand in
    `.github/workflows/build.yml` and `.gitlab-ci.yml` regenerated. Every existing
    job SHALL stay green.

41. **CLI matrix and parity (parent requirement 19).** `docs/cli-matrix.md` SHALL
    gain the new module names and the three-system parity in every row that names
    the setups (at authoring rows 7, 7b to 7g, 8c, 10, 16, 27 and 36), in the pull
    request that ships the entries, and a Windows parity statement. A parity gap is
    claimed only with evidence that the mechanism does not exist in the target CLI.
    One gap is expected and recorded: on Windows the operating-system CA bundle
    candidates of the TLS step are POSIX paths, so only an explicit `CREWRIG_TLS_CA`
    selects a bundle there (`docs/runbooks/custom-ca-tls-trust.md` already places
    Windows out of scope of spec 0084).

42. **Skills and provenance.** If a pull request of this ticket changes a skill or
    agent source under `artifacts/` (at authoring `user-validate/SKILL.md` names the
    script), its `metadata.provenance.version` SHALL be bumped
    (`docs/version-bump-convention.md`) and the built copies regenerated and staged
    in the same commit (`node scripts/build-components.ts`).

43. **References (parent requirement 9).** In the switch pull request, every
    documentation page, `Taskfile.yml` task, workflow step and skill instruction
    that tells a reader or an agent to run one of the four scripts SHALL name the
    TypeScript entry, as two separate steps (the floor guard, then `node` and the
    entry, never chained with `&&`) with no `fzf` precondition on the task, each page
    stating the Node.js 24 floor. At authoring the files that name them are
    `Taskfile.yml`, `.github/workflows/{build,usage-capture,mempalace-session-check}.yml`,
    `.gitlab-ci.yml` (regenerated by `scripts/build-ci.sh`), `ci/ci-capabilities.yml`,
    `ci/path-ownership-exemptions.txt`, `ci/shell-allowlist.txt`, `README.md`,
    `DEVELOPMENT.md`, `AGENTS.org.md`, `docs/adoption-guide.md`,
    `docs/usage-guide.md`, `docs/layers.md`,
    `docs/runbooks/{chroma-http-server,mempalace-mcp-server,custom-ca-tls-trust}.md`,
    `docs/cli-matrix.md` and `artifacts/library/skills/user-validate/SKILL.md`;
    ADRs and older specs are dated records and stay. The plan classifies each line as
    an instruction (rewritten) or a mention (kept) and lists the result. A new test
    with a committed allowlist `scripts/tests/fixtures/setup/old-invocation-allowlist.txt`
    (each entry carrying a reason; a stale or duplicate entry fails) SHALL fail when
    a tracked file outside it still tells a reader to run `bash
    scripts/setup-<cli>-interactive.sh`. The switch pull request SHALL also fix the
    stale entries that earlier rows left in
    `scripts/tests/fixtures/build-components/old-invocation-allowlist.txt` and the
    shell allowlist.

44. **Listed deviations (parent requirement 14).** The observable contract changes
    only as follows, each deviation tagged in the differential test: (a) a machine
    without `fzf` or `jq` works: the two `command -v` guards and their exits
    disappear; (b) questions are numbered line-mode questions instead of the `fzf`
    menu (no arrow keys, no incremental filter); (c) Esc is no longer a distinct
    input, since line mode cannot detect it (cancel is end of input); (d) the
    catalogue preview is `?N` instead of the `fzf` preview; (e) a run with no terminal
    and no pre-answer exits 2 naming the question, where `fzf` failed for lack of
    `/dev/tty`; (f) the new `--answer <id>=<value>` flag, its echo `[answer] …` and
    the prompt ids; (g) a cancel at a site without `|| true` prints `Setup cancelled
    at: <header>` where the shell was silent (the status 130 is unchanged); (h)
    catalogue entries are sorted ordinally where the shell sorted by the glob under
    the user's locale (equal under the `C` locale); (i) in `--link` mode a refused
    symbolic link places a copy and reports it once where `ln -s` failed (spec 0255
    22(b)); (j) JSON files are written atomically and byte-identical to `jq`'s output
    except that a number is written as JavaScript writes it, and an invalid JSON file
    prints a one-line `Error:` naming the file (spec 0255 22(d)-(f)); (k) an absolute
    path in a message is the platform's physical form where it differs from `pwd`'s
    (spec 0255 22(h)); (l) the build runs in-process and the production dependency
    step puts the CA variables into the setup's own environment instead of running
    through `tls-exec.sh` (invisible on output). Letters (m) onward are reserved for
    deviations the plan's differential test discovers and a `delta-01` of this spec
    records.

45. **Pull-request staging and branch prefix.** The PLAN fixes the real split; the
    principle is: oracle hardening (requirement 7, shell untouched) -> retargets of
    static reads (requirement 9, no script migrates) -> dark modules in layers (the
    prompt, files, catalogue, dependency and TLS modules; then MCP, MemPalace and
    organisation MCP; then hooks, usage capture and session recording) -> the four
    entries, the differential test and the `windows-setup-entries` job, dark behind
    the unchanged shell -> the switch (shims of requirements 33 and 36, references,
    CI, CLI matrix, allowlists) -> the one-file status flip of this spec. Every pull
    request but the last targets `release/1231-ts-migration` and uses the branch
    prefix `test/1335-<slug>`, because the spec linter binds a `feat/` prefix to a
    `status: implemented` spec; the last uses `feat/1335-<slug>`.

### Decision record

**Decision D1: `~/.crewrig/tls-env.sh` keeps the shell format; the writer is added
next to the reader (two independent `architect` passes agreed).**

Adopted: requirements 18 and 19. The format is read by several TypeScript readers
(`mempalace-transcript/run.ts`, `service/chroma-launch.ts`, the trust wrapper
`service/launcher/trust-wrapper.ts` and `history-import/prune-env.ts`) and by the shell `tls-exec.sh`, which sources it. The header
of `tls-env.ts` already says F1 either keeps the format or changes the reader in the
same pull request; F1 keeps it.

Rejected alternatives:

- *JSON or dotenv with a migration.* It breaks every reader, makes `tls-exec.sh` need
  a parser (a `jq` or `node` dependency in a thin wrapper that stays until J4), the
  service bundle installed at `~/.crewrig/service-lib/tls-env.ts` would parse a new
  file as malformed and silently start the daemon without the CA until the service
  is reinstalled, and the oracle `test-tls-delegation.sh` pins the shell format.
- *Writing both formats.* Two sources of truth.
- *A Node-based `tls-exec` replacing the shell wrapper now.* That is row J4's scope
  and would break the oracle.

**Decision D2: the prompt layer is one stdlib `readline` prompter, answered by
`--answer` (two independent passes agreed on the architecture; the details are the
author's).**

Adopted: requirements 11 to 17. Rejected alternatives:

- *Spawning `fzf` when present.* It is absent on Windows, is not a prerequisite of
  parent requirement 5, and needs `/dev/tty`.
- *A raw-mode arrow-key selector.* It cannot be exercised on `windows-latest` and is
  a large state machine.
- *Defaulting when there is no terminal.* `Apply these changes?` lists `yes` first,
  so end of input would auto-confirm.
- *Environment variables `CREWRIG_ANSWER_<KEY>` for pre-answers.* A second
  mechanism, invisible in shell history.
- *A `--yes` take-the-defaults flag.* An installer that silently mutates `~/.claude`
  in CI is the wrong default.
- *An answers file.* A new schema to document and validate.
- *Normalising every cancel to a decline (including Antigravity).* An unrequested
  behaviour change; aborting before anything else mutates is the conservative
  outcome, so the shell's asymmetry (requirement 15) is kept.

**Decision D3: the two shell libraries become forwarding function shims, not
deletions.**

Adopted: requirement 33. Rejected alternative: delete both and retire their Bash
suites in the same pull request under the sourced-library exception of parent
requirement 13. That exception requires every asserted behaviour to be covered by an
unchanged black-box test of a consumer, and no black-box test of the setups exists
today; the unchanged suites stay the oracle until J1b.

<!-- markdownlint-enable MD029 -->

## Scenarios

**Scenario:** Windows user installs from PowerShell with no POSIX shell

Given Windows with Node.js 24, npm, Git and the `claude` CLI, and no `bash`, `fzf`
or `jq` on the path, and `config/SOUL.md` and `config/PROFILE.md` present
When `node scripts/setup-claude-interactive.ts --answer rules-action=refresh` runs
from PowerShell with the remaining `--answer` flags the plan lists
Then the production dependencies are installed with `npm ci --omit=dev
--workspaces=false`, the rules, skills and MCP registrations are written under the
user's profile directory, no written file holds a carriage return, and the exit
status is 0.

**Scenario:** Re-running setup rewrites the installed hook commands

Given an installed usage-capture hook command in the old form and the user declines
every opt-in
When any setup runs again
Then the installed command lines of the guard, transcript, usage-capture hooks (and
the Antigravity statusline) are rewritten to the direct `node "<path>/<script>.ts"`
form, and nothing else about the opt-ins changes.

**Scenario:** A run with no terminal and no answer fails closed

Given standard input is closed and no `--answer` flag is given
When `node scripts/setup-gemini-interactive.ts` reaches its first question
Then it exits with status 2, names the question's id and suggests `--answer`, and
no file under the home directory is modified.

**Scenario:** `--answer` drives a full run

Given an `--answer <id>=<value>` flag for every question the run asks and a closed
standard input
When the entry runs
Then it prints `[answer] <id>=<value>` for each, asks nothing, and installs exactly
what the same answers selected through the shell's menu installed.

**Scenario:** Cancelling a question behaves per site

Given an interactive terminal and end of input at the transcript question of the
Claude setup, and then at the first question of the Antigravity setup
When each setup reaches that question
Then the Claude setup treats it as a decline and continues, and the Antigravity
setup prints `Setup cancelled at: <header>` on standard error and exits 130.

**Scenario:** `--link` falls back to a copy

Given `--link`, the key `y` on standard input and a platform that refuses the
symbolic link
When a setup places its rules
Then each destination is a copy, `Copied:` lines are printed, one notice on standard
error names every destination that became a copy, and the exit status is 0.

**Scenario:** A TLS opt-in writes a file both readers accept

Given a detected CA bundle and `TLS_DELEGATION=on`
When a setup runs
Then `~/.crewrig/tls-env.sh` holds the six `export` lines and `UV_SYSTEM_CERTS=true`
with LF line ends, the TypeScript reader returns the bundle path, sourcing the file
in a POSIX shell yields the same path, and the dependency step runs with the bundle
in its environment.

**Scenario:** A missing dependency gives a diagnostic

Given a `package-lock.json` whose hash differs from the recorded one and an
unreachable registry
When a setup runs
Then the npm diagnostic is printed, the exit status is non-zero, and no later step
ran.

**Scenario:** Unknown arguments are ignored as before

Given the argument `--frobnicate` and no `--link`
When a setup runs
Then it runs in copy mode exactly as it does without the argument.

**Scenario:** The Bash oracles pass through the shims

Given the shims and the two function shims installed
When the existing setup suites run on Linux and macOS
Then every assertion passes unchanged.

## Out of scope

- Retiring `scripts/lib/common.sh`, `scripts/lib/gemini-settings.sh` and
  `scripts/lib/tls-exec.sh` (row J4).
- Migrating any Bash test (row J1b, #1341); the black-box harness of requirement 7 is
  added beside them.
- Packaging and release scripts (row G2, #1336) and the scripts bundled with skills
  (row H, #1337).
- Converging the prompt module with that of spec 0253 (row J).
- A default operating-system CA bundle on Windows.
- A latency budget for the setup entries (requirement 35).
- Any change to the install flows, the supported CLIs, the catalogue content or the
  overlay tier set.

## Open questions

- How the return codes 0, 1 and 2 of `ensure_mempalace_http` (not ported; neither
  is `mcp-daemon-launcher.sh`) map onto `scripts/lib/service/*` (requirement 26).
- The side-channel protocol by which the function shims return `SR_TRANSCRIPT_WIRED`
  and `SR_ALL_HOOKS_DISABLED` to the sourcing shell (requirement 33): a file, a
  tagged line on standard output or a set of `eval` lines.
- Whether the atomic write of `tls-env.sh` and of the settings files needs a short
  retry on a Windows `EPERM` rename (unverified; to be measured on `windows-latest`).
- The exact list and spelling of the prompt ids (requirement 12).
- How each static-read suite of requirement 9 is retargeted (a node helper that
  evaluates a TypeScript declaration, as spec 0255 did, or a behavioural check), and
  the complete list of suites that read a setup script's text.
- Whether the sandbox harness for the shell side of requirement 7 must run under
  bash 3.2 (macOS) as well as bash 5 (Linux), given that `printf %q` and the locale
  differ between them.
- Whether `claude mcp list` output, which the shell parses with `grep -qE "^name:"`,
  is stable across the Claude Code releases the stub must model.
