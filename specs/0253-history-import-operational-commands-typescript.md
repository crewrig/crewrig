---
id: "0253"
slug: history-import-operational-commands-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1331
version: 1.0.0
---

# History import and operational commands in TypeScript

*Sub-spec F3 of the `large`-tier ticket #1231. Parent spec:
`specs/0215-shell-to-typescript-migration.md` with its deltas 01 to 04, under the
release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`:
this spec-PR and its implementation pull requests target
`release/1231-ts-migration`, "shipped" means merged there, and the base ref
wherever a protocol names `main` is `origin/release/1231-ts-migration`. Discharges
parent requirements 9, 13, 14, 17 and 19 for the fifteen scripts below and applies
requirements 2, 3, 16, 21, 22 and 23 to them. It reuses, and redefines nothing of,
spec 0240 (shared modules), spec 0243 requirement 5 (the entry form), and the shim
and `windows-latest` conventions of specs 0248 and 0250. No normative change to
the parent is made here. Line references are to `release/1231-ts-migration`.*

## Intent

A contributor on Windows, macOS or Linux backfills MemPalace from the four CLIs'
session history, prunes old transcripts, synchronises a downstream repository from
upstream, and runs the usage commands (declare a task, drain the journal, mirror,
query, price, attribute, prune, back-fill, dashboard) with commands that behave the
same on the three operating systems and need neither a POSIX shell nor `fzf`. Every
flag, message, exit status and file written stays as it is, except for the few
changes listed in requirement 25, so the `task` entries, the CI workflows, the
public rule that tells agents how to declare a task's attribution, and the
synchronisation of every downstream repository keep working untouched.

The scope is fifteen scripts, 1,705 lines: `scripts/import-claude-history.sh`,
`scripts/import-gemini-history.sh`, `scripts/import-copilot-history.sh`,
`scripts/import-antigravity-history.sh` (the four **import scripts**),
`scripts/prune-transcripts.sh`, `scripts/sync-from-upstream.sh`, and the nine
**usage wrappers** `scripts/usage-{attribute,backfill,dashboard,drain,mirror,price,
prune,query,task}.sh`.

## Requirements

1. **Entries and decomposition.** Each script SHALL gain a TypeScript entry at its
   path with `.sh` changed to `.ts` (parent requirement 9, spec 0240 requirement
   11), runnable as a direct `node` command line, written to the conventions of
   parent requirement 2 (erasable syntax, strict typing, every value entering from a
   file, the environment, a subprocess, stdin or the command line typed `unknown`
   and narrowed). No TypeScript file SHALL exceed the 300-line warning threshold:
   `sync-from-upstream` (823 lines) and the import family SHALL be decomposed, one
   concern per file, under `scripts/lib/sync-from-upstream/` and
   `scripts/lib/history-import/`; the nine usage entries are thin and need no
   module directory. The plan names the files.

2. **Entry form, floor and silence.** Every entry SHALL use the entry form of spec
   0243 requirement 5 — no top-level `import` or `export`, the `warning` listeners
   removed as the first statement, `require` plus dynamic `import()` for the rest —
   so that `node scripts/<name>.ts` writes no Node.js warning on any Node.js 24
   release with no flag. Only that entry form is borrowed: the exit-zero and
   zero-output clauses of 0243 requirement 5 belong to a hook and are not borrowed,
   since these commands exit non-zero and print diagnostics (requirements 11, 16,
   18). Each is a
   user-facing entry point (parent requirement 4): documented behind the floor-guard
   step, `node scripts/lib/node-floor-guard.js`, then `node scripts/<name>.ts`, and
   leaving the filesystem unmodified on a Node.js below the floor.

3. **Forwarding shims.** Every `.sh` path in scope SHALL be reduced to a forwarding
   shim of the shape fixed by spec 0250 requirement 22 and remain on
   `ci/shell-allowlist.txt` (parent requirements 9 and 10); the allowlist entry
   count is unchanged by this spec, and shim removal belongs to the final sub-spec
   of the parent. **Owner decision D2a (2026-10-09):** the shims are kept for all
   fifteen scripts, not only `usage-task.sh`.

4. **Reuse and the common-library dependency.** The entries SHALL reuse
   `scripts/lib/paths.ts`, `scripts/lib/tls-env.ts` (`readTlsEnv`, `tlsEnvPath`),
   `scripts/lib/tmp-file.ts`, `scripts/lib/line-endings.ts`,
   `scripts/lib/usage-store/**`, `scripts/lib/usage-capture/**` and
   `scripts/lib/mempalace-transcript/**`, and duplicate none of them. The four
   import scripts source `scripts/lib/common.sh` for `detect_mempalace_python`, and
   `prune-transcripts` sources it only for the MemPalace version pin
   (`MEMPALACE_MIN_VERSION`, `MEMPALACE_MAX_VERSION_EXCLUSIVE`); the TypeScript port
   of those helpers is owned by ticket #1330 (sub-spec D, spec 0252). F3 SHALL
   import D's module, SHALL NOT create a parallel port of `common.sh`, and SHALL
   NOT edit D's module. The interface D froze for F3's planning (2026-10-09; an
   optional parameter may still be added, a signature will not change) is `scripts/lib/mempalace-python.ts` (`detectMempalacePython(env?)`,
   returning the interpreter on which `mempalace.mcp_server` imports, or
   `undefined`) and `scripts/lib/mempalace-pin.ts` (`readMempalacePin(repoRoot)`,
   returning `{ min, maxExclusive }`, and `installSpec(pin)`). F3 plans against
   those signatures and SHALL NOT import either file before D's first pull request,
   which delivers them, has merged into the release branch (see requirement 28).

5. **Platform-aware paths and line endings (parent requirement 22).** Every path
   SHALL be built with platform-aware path handling; the default source directories
   (`~/.claude/projects`, `~/.gemini/tmp`, `~/.copilot/session-state`,
   `~/.gemini/antigravity-cli/history.jsonl`) SHALL resolve from the user's home
   directory on each operating system, and the existing override variables
   (`CLAUDE_PROJECTS_DIR`, `GEMINI_TMP_DIR`, `COPILOT_SESSIONS_DIR`,
   `ANTIGRAVITY_HISTORY_FILE`, `MEMPALACE_HISTORY_WING`, `MEMPALACE_HISTORY_AGENT`,
   `MEMPALACE_EXTRACT`, `CREWRIG_REPO_DIR`, and for `prune-transcripts` only
   `MEMPALACE_PYTHON`) SHALL keep their
   names and defaults.

6. **No POSIX tool (parent requirement 23).** No migrated entry SHALL spawn `find`,
   `xargs`, `du`, `awk`, `tr`, `wc`, `grep`, `sed`, `sort`, `ln`, `mktemp`, `date`,
   `cat`, `rm` or any other POSIX-only utility, and none SHALL spawn `bash`. The
   only subprocesses are `git`, the Python toolchain for the `mempalace` exception
   (parent requirement 16), `pipx` (only `pipx environment --value PIPX_HOME`, to
   locate the MemPalace virtual environment, as `prune-transcripts.sh` does today;
   `pipx` and the interpreters it names are part of that toolchain), and
   `process.execPath` (requirement 8).

7. **Contract of the nine wrappers.** Each usage entry SHALL run the same
   JavaScript command line as its shell predecessor, with the arguments forwarded
   verbatim and in order, the environment inherited, standard input, output and
   error inherited, and the exit status of the command line returned unchanged. The
   mapping is: `usage-attribute` to `scripts/lib/usage-store/ledger.js`,
   `usage-backfill` to `scripts/lib/usage-capture/backfill.js`, `usage-dashboard`
   to `scripts/lib/usage-dashboard/cli.js`, `usage-drain` to
   `scripts/lib/usage-store/journal.js`, `usage-mirror` to `.../mirror.js`,
   `usage-price` to `scripts/lib/usage-price/cli.js`, `usage-prune` to
   `.../prune.js`, `usage-query` to `.../query.js`, `usage-task` to
   `.../declaration.js`. `usage-drain` SHALL forward no argument (the shell version
   forwards none) and SHALL default `CREWRIG_USAGE_DRAIN_BUDGET_MS` to `0` when it
   is unset.

8. **Design choice: spawn the existing JavaScript command line.** The entries SHALL
   start the JavaScript command line in a child process of `process.execPath` with
   the flag `--disable-warning=ExperimentalWarning`, and SHALL NOT import it
   in-process. *Rationale:* those files are tracked JavaScript exempt from the
   ratchet (parent requirement 16), use `require.main === module`, and do not all
   export their main (`backfill.js` calls `main()` unconditionally); importing them
   would need edits to files this spec leaves alone and would change
   argument, exit-code and warning behaviour. The cost is one extra Node.js start
   (tens of milliseconds), acceptable because these are operator commands (see
   requirement 24). *Rejected alternative:* in-process import behind a thin
   `main` export, which is cleaner but touches ten JavaScript files and risks a
   silent contract drift; it MAY be revisited when the usage subsystem itself
   migrates, outside this spec. The precedent for a thin TypeScript entry is
   `scripts/usage-inventory.ts` with `scripts/lib/usage-store/inventory.ts`.

9. **No reference to MemPalace in the back-fill entry.** `scripts/usage-backfill.ts`
   and its shim SHALL NOT contain the strings `mempalace` or
   `import-<cli>-history`, because `scripts/tests/test-usage-capture.sh` (section 5,
   requirement 24 check, line 422) greps the shim and `backfill.js` for them and is
   an unchanged oracle.

10. **Public contract of `usage-task` (owner decision D2a, 2026-10-09).**
    `artifacts/core/rules/60-tools.md` (step 6 of *Session Start*, line 275) names
    `bash scripts/usage-task.sh set --task-key <handoff_key> --channel protocol`.
    That invocation SHALL keep working through the shim, and the TypeScript form
    `node scripts/usage-task.ts set --task-key <N> --channel protocol` SHALL be
    equivalent (same exit status, same bytes on standard output and error, same
    declaration file written). In the same pull request the rule text SHALL be
    rewritten to the `node` form, preceded by the floor-guard step where the rule
    documents an entry point. Because the file is a core rule, the same commit SHALL
    run `node scripts/lib/node-floor-guard.js` then `node scripts/build-components.ts`
    (as separate steps) and stage the regenerated outputs. The plan SHALL check
    `docs/version-bump-convention.md` (it governs skill and agent sources, so no bump
    is expected for a core rule) and record the result.

11. **Behavioural contract.** Each import script SHALL keep its banner, its
    prerequisite checks and messages, its source check, its counts, its summary
    block, its two-step flow (optional dry-run preview, then confirmed import), and
    its closing text, byte for byte except for requirement 25. The stream each
    script writes its `Error:` lines to SHALL be preserved per script: standard
    output for the Claude, Gemini and Copilot scripts, standard error for the
    Antigravity script. Exit statuses: `1` for a missing interpreter or source,
    `0` when there is nothing to import and when the user declines.

12. **Replacement of `fzf` (owner decision D1a, 2026-10-09).** The two `fzf`
    yes/no selections per script SHALL be replaced by a Node `readline` prompt on
    standard input that prints the same question text. An answer of `yes` or `y`
    (case-insensitive, surrounding whitespace ignored) selects yes; any other answer,
    an empty answer and end of input select no, matching `fzf` returning an empty
    selection on Escape. The `fzf` prerequisite check and its `Error: fzf is
    required.` message are removed. This is an R14 deviation (requirement 25, items
    1 and 2): `fzf` is not among the parent requirement 5 prerequisites, and
    parent requirement 23 forbids relying on a POSIX-only utility. Both prompts of a run
    SHALL read through one line reader over standard input, created once and
    closed only when the run ends: a line already buffered for the second prompt
    survives the dry-run child that runs between the two prompts, so piped input
    `yes` then `y` reaches the real import. The reader is paused, not closed,
    while a child process runs.

13. **Counting without POSIX tools.** The directory, file and record counts SHALL be
    computed with the Node.js file system API, not following symbolic links (as
    `find` does by default): direct subdirectories, files named `*.jsonl`
    (Claude), `session-*.json` and `logs.json` (Gemini), `events.jsonl` (Copilot),
    non-empty lines of the history file (Antigravity). Only counts and a size are
    observable, so enumeration order is not a contract and `find` ordering is not
    reproduced. The size line keeps its `~<size>` form with the unit scale of
    `du -h` (`K`, `M`, `G`, one decimal below ten); its value is the sum of the
    files' apparent sizes (requirement 25, item 3).

14. **MemPalace invocation.** The scripts SHALL run `<interpreter> -m mempalace
    mine <source> --mode convos --wing <wing> --agent <agent> --extract <mode>`
    (plus `--dry-run` for the preview) with the arguments exactly as today, the child
    inheriting standard input, output and error as it does today (the line reader of
    requirement 12 is paused meanwhile, so the child sees whatever input is left
    unread by the pipe, exactly as a child of the shell script did), and SHALL exit with the child's status when it is non-zero
    (the shell version runs under `set -e`). The interpreter comes from D's
    `detectMempalacePython` (requirement 4), which, like `detect_mempalace_python`,
    probes in order the pipx virtual environment's Python, the interpreter of the
    `mempalace` console script and `python3`, keeping the first on which `import
    mempalace.mcp_server` succeeds. The import scripts do NOT read `MEMPALACE_PYTHON`
    (today they ignore it); when no candidate imports `mempalace` they print the
    two `Error:` lines of today (`Error: 'mempalace' is not importable from any
    candidate Python.` then `Install MemPalace first: pipx install mempalace`) and
    exit 1.

15. **Antigravity temporary directory.** The Antigravity script SHALL create its
    temporary directory with `scripts/lib/tmp-file.ts`, place the history file in it
    as `history.jsonl` by a hard link (`fs.linkSync`) with a copy fallback
    (`copyFileSync`) when linking fails, and remove the directory on every exit
    path, including a declined prompt and a failing `mine`. A hard link is not a
    symbolic link, so parent requirement 21 is not triggered; the copy fallback
    preserves today's `ln` then `cp` behaviour.

16. **Contract.** `prune-transcripts` SHALL keep `--days <n>` (default 30),
    `--apply`, `--project <name>`, `--help`/`-h`, the validation messages
    (`Error: --days must be a positive integer`, `Error: --days must be at least
    1`, `Unknown option: <arg>` followed by the `Run ... --help` hint, all on
    standard error, exit 1), the banner, the dry-run default, and the guarantee
    that nothing is deleted without `--apply`. The cutoff date SHALL be the local
    calendar date `<days>` days before today, formatted `YYYY-MM-DD`, computed with
    calendar arithmetic (equal to `date -v-Nd` and `date -d "-N days"`).

17. **Python body stays Python (parent requirement 16).** The embedded Python of
    the shell version imports `mempalace.mcp_server` (`tool_list_drawers`,
    `tool_delete_drawer`). It SHALL move verbatim into a tracked `.py` file under
    `scripts/lib/` (name fixed at PLAN) that imports `mempalace`, and the entry SHALL
    spawn it with the environment variables `TRANSCRIPTS_WING`, `PROJECT_FILTER`,
    `CUTOFF_DATE`, `DRY_RUN` (`true` or `false`) and `MEMPALACE_INSTALL_SPEC`
    (`mempalace>=<min>,<<max>`, built from D's pin strings). Its standard output,
    standard error and exit status SHALL be unchanged.

18. **Interpreter and TLS environment of `prune-transcripts`.** The interpreter
    SHALL be, in order, `MEMPALACE_PYTHON`, the `mempalace` pipx virtual
    environment's Python (`<PIPX_HOME>/venvs/mempalace/bin/python3`) when `pipx` is
    on the path and that directory exists, else `python3`, with no import probe
    (the failure surfaces in the Python body, exit 2, as today). A missing
    interpreter SHALL print on standard error `Error: <interpreter> not found` then
    `Install MemPalace via pipx: pipx install '<install spec>'` and exit 1. The
    custom-CA variables of `~/.crewrig/tls-env.sh` SHALL be applied to the child
    environment through `readTlsEnv` (no sourcing of a shell file), with the
    precedence that sourcing gave today (requirement 25, item 8 and *Open
    questions*); the import scripts do not read `tls-env.sh` today and keep not
    doing so.

19. **Contract unchanged.** `sync-from-upstream` SHALL preserve every flag
    (including `--preserve-history`), message, exit status and file written of the
    shell version, with no deviation: the oracle is
    `scripts/tests/test-sync-from-upstream.sh` (3,273 lines), which SHALL pass
    **unchanged** against the TypeScript version through the shim, with
    `CREWRIG_REPO_DIR` honoured as today and `REPO_DIR` otherwise derived from the
    entry file's own location. Strict-path dirty abort, `reconcile_dir`, the
    graft commit and the marker files are covered by that suite.

20. **POSIX tools and the verified spawn sites.** The script does not call
    `build-docs-index.sh` (the only mention is a comment at line 519), so no
    ahead-of-step dependency exists. It spawns `git` for version control and, at
    these sites, POSIX tools that SHALL be replaced by in-process code: `grep` and
    `sed` reading `canonical_repo` (line 122), `grep` matching a component name
    (line 247), `sort -u` and `grep -Fx` over path lists (lines 384, 388, 400),
    `grep -q .` on `git ls-tree` output (line 614), and `sed` plus `grep` over
    `git cat-file commit` output to find a `gpgsig` header (line 810); `rm -f`,
    `mkdir -p` and `cat` become file-system calls. The pipe results SHALL keep the
    shell's byte semantics (sort by byte order, set semantics for `grep -Fx`).

21. **Self-update safety.** `sync-from-upstream` rewrites files under `scripts/`
    that include itself and its modules. The entry SHALL load every module it needs
    before the first write to the working tree, so that a restored `.ts` file never
    changes the code of the running process.

22. **Consumers updated in the same pull request (parent requirement 9).** Each
    migrating pull request SHALL update every `Taskfile.yml` task, workflow step,
    skill instruction and document that names the old invocation of its scripts to
    the `node scripts/<name>.ts` form (behind the floor-guard step in `Taskfile.yml`,
    as spec 0250 requirement 31 does). The candidates, to be confirmed at PLAN by
    searching the tree, are: `Taskfile.yml` (`usage:*`, `import-*-history`,
    `prune-transcripts`, `usage-backfill`, `usage-drain` entries),
    `.github/workflows/usage-*.yml` and `build.yml`, `.gitlab-ci.yml`,
    `ci/ci-capabilities.yml` (edited at its source and regenerated with
    `scripts/build-ci.sh` the way spec 0250 requirement 27 did, drift-checked),
    `README.md`, `DEVELOPMENT.md`, `docs/usage-*.md`, `docs/adoption-guide.md`,
    `docs/scripting-conventions.md`, `docs/runbooks/custom-ca-tls-trust.md`,
    `artifacts/core/rules/60-tools.md`, `artifacts/core/system-context/
    long-running-task-convention.md` and
    `artifacts/library/skills/harness-curator/scripts/curate.py` where it names an
    invocation. Paths on `docs/layers.md` and `.crewrig/core-paths.txt` do not
    change (the whole `scripts` directory is a manifest entry and every shim stays
    at its path), so no manifest edit is expected; the plan confirms it. The Bash
    tests keep calling the `.sh` shim, which is what keeps them unchanged oracles.

23. **Multi-CLI parity (parent requirement 19).** `docs/cli-matrix.md` SHALL be
    updated in the same diff (AGENTS.md, *CLI Matrix Maintenance*): row 8d, row 11
    and row 16 and any row naming the import scripts record the `.ts` entries, the
    `fzf` removal, and, for each (CLI x operating system) cell the script cannot
    serve, a parity gap with evidence. The expected gaps to prove or disprove on
    Windows are the Python and MemPalace availability for the four import scripts
    and `prune-transcripts`; the Copilot usage back-fill reads
    `~/.copilot/session-store.db`, unchanged here.

24. **Operator commands and latency.** These scripts are operator commands, not CLI
    integration points (parent requirement 15), so no latency budget applies, as
    for the build in spec 0250. The `windows-latest` job SHALL record each
    command's wall time in its log.

25. **Deviations from the shell behaviour (parent requirement 14).** The
    observable contract is preserved except for, and only for:
    1. the `fzf` prompt becomes a `readline` prompt (requirement 12, owner decision
       D1a); a non-interactive standard input answers no instead of failing;
    2. the `fzf` prerequisite diagnostic no longer exists; the order of the
       remaining checks is unchanged;
    3. the size shown by the import scripts is the sum of apparent file sizes, not
       the disk blocks `du -ch` counts; the `~` already marks it approximate, and
       disk usage has no portable equivalent;
    4. a line holding only a carriage return counts as empty in the Antigravity
       record count (CRLF input, parent requirement 22), where `grep -c .` counted
       it;
    5. `prune-transcripts --days` or `--project` with no value prints
       `Error: <flag> requires a value` on standard error and exits 1, replacing Bash's
       `unbound variable` diagnostic, which is a shell artefact and not a contract;
    6. `prune-transcripts --help` prints the name of the `.ts` entry in its `Usage:`
       line, because the shim forwards to it;
    7. on Windows only, the `prune-transcripts` interpreter lookup uses `Scripts\python.exe` for the pipx
       environment and `python` for the system fallback; POSIX behaviour is
       unchanged;
    8. TLS variables come from `readTlsEnv` instead of sourcing `tls-env.sh`
       (requirement 18), with the precedence preserved.
    Any further difference the oracle reveals SHALL be added by a delta-spec before
    its pull request merges.

26. **Oracle per script (parent requirement 13).** The oracle of each script is the
    test that executes it and passes unchanged against the TypeScript version.
    Scripts with an existing suite: `usage-attribute`
    (`test-usage-attribution.sh`, `test-usage-pricing.sh`, `test-usage-dashboard.sh`),
    `usage-backfill` (`test-usage-capture.sh`), `usage-dashboard`
    (`test-usage-dashboard.sh`, `test-usage-pricing.sh`), `usage-mirror`
    (`test-usage-storage.sh`, `test-usage-storage-mirror.sh`), `usage-price`
    (`test-usage-pricing.sh`, `test-usage-dashboard.sh`), `usage-prune` and
    `usage-query` (`test-usage-storage.sh`, `test-usage-attribution.sh` and the
    others that name them), `sync-from-upstream` (`test-sync-from-upstream.sh`).
    The plan SHALL confirm that each named suite executes its script and not merely
    names it. No test references `usage-drain.sh`, `usage-task.sh`, the four import
    scripts or `prune-transcripts.sh`: PR A SHALL add black-box Bash tests for
    those seven, with stubbed `python` / `mempalace` (for the import scripts, a
    `python3` stub first on `PATH` that answers the `import mempalace.mcp_server`
    probe and records the arguments of `-m mempalace mine`, since they ignore
    `MEMPALACE_PYTHON`; for `prune-transcripts`, a stub on `MEMPALACE_PYTHON`
    recording its environment) and prompts answered on standard input, covering at least the scenarios of this
    spec. A script and its Bash test SHALL NOT migrate in the same pull request:
    the Bash tests migrate later in J1a (#1340), not here.

27. **`windows-latest` proof (parent requirement 17).** Each migrating pull request
    SHALL ship a `windows-latest` job that invokes its scripts from PowerShell (not
    `bash`) and asserts an observable outcome, and the job SHALL pass before merge.
    For the usage wrappers: a real command (for example `usage-query` on an empty
    store, `usage-task set` then `read`). For `sync-from-upstream`: a sync against a
    local upstream repository created in the job, including the strict-dirty abort.
    For the import scripts and `prune-transcripts`, which need Python, MemPalace and
    a populated history, the job SHALL assert the deterministic offline paths only:
    the missing-interpreter diagnostic and exit 1, the missing-source diagnostic and
    exit 1, the empty-source message and exit 0, `--help`, argument validation, the
    declined-prompt exit 0 and a dry-run against a stub interpreter (a `.cmd` file named for the candidate
    the Windows lookup of `detectMempalacePython` probes, or set through
    `MEMPALACE_PYTHON` for `prune-transcripts`).
    The job states this limit in its name or comments; the end-to-end `mempalace`
    path is covered on Linux and macOS only, and recorded as such in requirement 23.

28. **Implementation split (expected; the PLAN confirms).** **Owner decision D3a
    (2026-10-09).** Four pull requests against the release branch: PR A, the oracle
    of requirement 26 (new black-box tests only, passing against the shell
    versions); PR B, the nine usage wrappers (requirements 7 to 10, 22 to 24, 27 for
    them, including the `60-tools.md` rewrite and rebuild); PR C, the four import
    scripts and `prune-transcripts` with `docs/cli-matrix.md`, which needs D's
    first pull request, delivering `scripts/lib/mempalace-python.ts` and
    `scripts/lib/mempalace-pin.ts`, merged first; PR D, `sync-from-upstream`. PR A merges before B, C and
    D. PR B and PR D do not depend on #1330. No pull request SHALL both migrate a
    script and change an assertion of its Bash test. Branch names follow the
    unchanged convention (delta-04 requirement 29): `feat/0253-<slug>-oracle`,
    `feat/0253-<slug>-usage`, `feat/0253-<slug>-import`, `feat/0253-<slug>-sync`,
    with `<slug>` the slug of this spec; the plan confirms them against
    `docs/spec-pr-workflow.md`.

29. **Shared files and ratchet.** `ci/shell-allowlist.txt`, `docs/cli-matrix.md`,
    `.github/workflows/**`, `Taskfile.yml`, `ci/ci-capabilities.yml` and
    `specs/README.md` are shared with sibling tickets (#1333 spec 0251, #1330 spec
    0252). Each pull request SHALL edit only the lines of its own scripts and SHALL
    be rebased on `origin/release/1231-ts-migration` and 0 commits behind it before
    merge (delta-04 requirement 29). The ratchet SHALL stay green: no new `.sh`
    file, shims on the allowlist, every new TypeScript file within strict typing and
    erasable syntax.

## Scenarios

**Scenario:** A usage wrapper runs from PowerShell on Windows

Given `windows-latest`, an empty usage store under a temporary home
When PowerShell runs `node scripts/usage-query.ts --rollup`, then `node
scripts/usage-task.ts set --task-key 1331 --channel protocol` and `node
scripts/usage-task.ts read`
Then each exits with the status of its JavaScript command line, the declaration
read back names task 1331 and channel `protocol`, and no Node.js warning is printed.

**Scenario:** The `usage-task` shim and the `node` form are equivalent

Given a temporary home on Linux
When `bash scripts/usage-task.sh set --task-key 7 --channel protocol` runs, then the
same arguments run through `node scripts/usage-task.ts` on a second temporary home
Then both exit 0 with identical standard output and error and an identical
declaration file, and `60-tools.md` names the `node` form.

**Scenario:** `usage-drain` ignores arguments and defaults its budget

Given `CREWRIG_USAGE_DRAIN_BUDGET_MS` unset
When `node scripts/usage-drain.ts --anything` runs
Then the child sees the budget `0`, receives no argument and the exit status is that
of `journal.js`.

**Scenario:** Import with no sessions exits 0

Given an interpreter stub on which `mempalace` imports, and `CLAUDE_PROJECTS_DIR`
pointing at an existing directory with no `.jsonl` file
When `node scripts/import-claude-history.ts` runs
Then it prints `No .jsonl session files found under <dir> — nothing to import.`,
runs no `mine`, never prompts, and exits 0.

**Scenario:** Import with a missing prerequisite

Given no candidate interpreter on which `mempalace` imports (`PATH` limited to stubs that fail the probe)
When any of the four import scripts runs
Then it prints `Error: 'mempalace' is not importable from any candidate Python.`
then `Install MemPalace first: pipx install mempalace`, on the stream of today
(standard error for Antigravity, standard output for the others), and exits 1.

**Scenario:** Import declined at the prompt

Given a populated source, a recording stub interpreter, and standard input `no`
then `no`
When `node scripts/import-gemini-history.ts` runs
Then it prints `Import canceled.`, the stub saw no `mine` call, and the exit is 0.

**Scenario:** Import confirmed through the readline prompt

Given the same setup and standard input `yes` then `y`
When the Claude import runs
Then the stub records a `--dry-run` call then a real call, both with `--mode convos`
and the configured wing, agent and extract mode, and the run ends with `Import
complete`.

**Scenario:** The Antigravity temporary directory is always removed

Given a history file and a stub whose `mine` fails
When the Antigravity import runs and answers yes
Then the exit status is the stub's, and the temporary directory no longer exists.

**Scenario:** Prune is a dry run unless `--apply` is given

Given a stub interpreter recording its environment
When `node scripts/prune-transcripts.ts --days 30` runs, then the same with `--apply`
Then the first run's child sees `DRY_RUN=true`, the second `DRY_RUN=false`, both see
`CUTOFF_DATE` equal to today minus 30 days and `TRANSCRIPTS_WING=transcripts`, and
`--days 0` exits 1 with `Error: --days must be at least 1`.

**Scenario:** Sync aborts on a dirty strict path, unchanged

Given an adopting repository with a local modification under a strict path
When `node scripts/sync-from-upstream.ts` runs, and the unchanged
`scripts/tests/test-sync-from-upstream.sh` runs against the shim
Then the sync aborts with the same message and exit status as the shell version,
the working tree is unchanged, and every case of the suite passes.

**Scenario:** The sync updates itself without breaking the run

Given upstream changed `scripts/sync-from-upstream.ts` and a module it imports
When the sync runs to completion
Then both files are restored, the run exits 0, and no module was loaded after the
first write.

## Out of scope

- `scripts/build-docs-index.sh` and its row G2: `sync-from-upstream` does not call
  it, and it migrates separately.
- The TypeScript port of `scripts/lib/common.sh` (`detect_mempalace_python`, the
  version pin): owned by #1330, spec 0252; F3 only consumes it (requirement 4).
- Migration of the Bash tests, including `test-sync-from-upstream.sh` and the
  usage suites: J1a (#1340), after each script has shipped green.
- The setup, install and manage scripts: F1 and F2.
- The usage JavaScript subsystem itself (`scripts/lib/usage-*`): untouched and
  ratchet-exempt.
- Removal of the shims: the final sub-spec of the parent.
- Any change to the normative text of spec 0215 or its deltas.
- New flags, new MemPalace behaviour, or a `--yes` option for the import scripts.

## Open questions

- **Stability of D's interface.** The signatures of requirement 4 were frozen by
  ticket #1330 for F3's planning and will land with spec 0252. PR C is blocked
  until D's first pull request has merged; if spec 0252 changes either signature
  before then, F3 adapts through a delta-spec of this spec and does not dictate.
- **Precedence of `tls-env.sh` variables.** Sourcing `~/.crewrig/tls-env.sh` lets the
  file override an inherited variable; `readTlsEnv` (spec 0247) returns the parsed
  values. The PLAN SHALL verify the semantics match and either apply them as the
  child environment or add a delta-spec listing a deviation.
