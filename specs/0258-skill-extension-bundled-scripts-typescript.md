---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1337
version: 1.0.0
---

# Skill- and extension-bundled scripts in TypeScript

*Sub-spec H of the `large`-tier ticket #1231, row H of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>). Parent
spec: `specs/0215-shell-to-typescript-migration.md` (requirements 9, 13, 14, 15, 17,
19, 20 and 23, row H, step (d) of requirement 8), under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this
spec-PR and its implementation pull requests target `release/1231-ts-migration`,
"shipped" means merged there, not reached `main`, and the base ref wherever a protocol
names `main` is `origin/release/1231-ts-migration` (requirement 34). Requirement 23 of
the parent applies as narrowed by `specs/0215-shell-to-typescript-migration.delta-05.md`,
and requirement 26 (delta-01) removes `lint-shell.sh` from this row. Depends on
sub-specs A2 (`specs/0240-runtime-foundations-shared-ts-modules.md`: the entry form,
`scripts/check-timing-budget.ts`, the `windows-latest` job conventions), C1
(`specs/0243-usage-capture-hooks-typescript.md` and its deltas: the hook budget rule,
the cheap-guard and lazy-`import()` pattern, `docs/cli-matrix.md` rows 37-37f), D
(`specs/0252-windows-service-management.md`: `scripts/lib/service/`), G1b
(`specs/0254-extension-plugin-builders-typescript.md`: `scripts/build-extension.ts`,
`scripts/lib/extension/*`) and G2 (`specs/0257-packaging-release-typescript.md`: the
shape of a row, the differential and golden conventions). It inherits the behavioural
contracts of `specs/0179-*` (the neutral extension `hooks` section) and
`specs/0183-extension-model-migration.md` (the scaffolder).*

## Intent

A skill user, an extension author and a maintainer run the same commands as today and
get the same findings, the same lines on the terminal and the same exit statuses,
except for the few listed changes. The CI-configuration checks of the `github-actions`
and `gitlab-ci` skills, the linters of the `pr-reviewer` skill and the three wrappers
of the `harness-curator` skill run with `node` from PowerShell, `cmd.exe`, Bash or
zsh, with no `jq`, `yq`, `awk`, `sed`, `grep`, `mktemp` or `fzf` on the machine. The
two example hooks of the `hello-world` extension and the hook of the extension
skeleton are `node` command lines that stay within a stated latency budget. A newly
scaffolded extension contains no shell file, no `typescript` older than 7.0, and
passes the repository's type-check, Oxlint and Oxfmt steps unchanged.

<!-- markdownlint-disable MD029 -->

## Requirements

### Scope and entry points

1. **Entry points.** Fifteen TypeScript entries SHALL replace the behaviour of the
   shell scripts below, each at the path of its predecessor with `.sh` changed to
   `.ts` (parent requirement 9):
   - `artifacts/core/skills/github-actions/scripts/{check-pinned-actions,
     check-secrets-exposure,lint-workflow,simulate-job,simulate-workflow}.ts`;
   - `artifacts/core/skills/gitlab-ci/scripts/{check-pinned-images,
     check-secrets-exposure}.ts`;
   - `artifacts/core/skills/pr-reviewer/scripts/{lint-json,lint-markdown,lint-python,
     lint-skill}.ts`;
   - `artifacts/library/skills/harness-curator/scripts/{curate,schedule-curator,
     setup-labels}.ts`;
   - `scripts/create-extension.ts`.

   Three further files have no `.sh` predecessor and replace shell files with a
   changed shape: `extensions/core/hello-world/hooks/{prompt-logger,shell-logger}.ts`
   and `extension-skeleton/hook/hooks/logger.ts` (requirement 22). The two Python files
   of the `harness-curator` skill, `curate.py` and `apply.py`, SHALL stay Python
   (parent requirement 16, the `mempalace` exception) and SHALL NOT change.
   `artifacts/core/skills/pr-reviewer/scripts/lint-shell.sh` SHALL NOT migrate: parent
   requirement 26 retires it, with no TypeScript replacement, in the pull request that
   removes the last tracked shell file (row J4, #1344). This row SHALL leave it and its
   line of `ci/shell-allowlist.txt` untouched. (The ticket and the decomposition count
   twelve skill scripts; eleven migrate.)

2. **Entry form.** Each entry SHALL be runnable as a direct `node <path>.ts` command
   line, written to the conventions of parent requirement 2, and SHALL be a thin file
   with no top-level `import` or `export`, using `process.exitCode` instead of
   `process.exit`. Its first statement SHALL be `process.removeAllListeners("warning")`,
   so that no warning reaches standard error, which the differential proof compares
   (requirement 29); the rest of its body SHALL be wrapped in
   `void (async () => { ... })();`, because a file with no `import` or `export` is a
   global script, so two entries that declare the same top-level name fail the
   type-check with TS2451, and a wrapper is where a run-time `import()` may `await`.
   Spec 0255's entry form loads built-ins with `require`, which
   exists only where the nearest `package.json` is typeless; the entries of this row
   run where it is not: a skill script is copied into the four built trees and into a
   user or adopter directory whose package type is unknown, and an extension hook sits
   next to an extension `package.json` that declares `"type": "module"`
   (`extensions/core/hello-world/package.json` and the skeleton's). A skill script, a
   hook and the skeleton's hook SHALL therefore load built-ins with
   `process.getBuiltinModule("node:<module>")`, which exists under both module
   systems, and SHALL import no other file (requirement 3). A test
   SHALL run each such entry from a copy placed under a package that declares
   `"type": "module"`, under a package that declares `"type": "commonjs"`, under a typeless one, and under a
   directory with no `package.json`, and SHALL require the same standard output,
   standard error and exit status from the four. Only `scripts/create-extension.ts`, which always runs
   inside the repository, MAY use the form of spec 0255.

3. **Self-contained skill scripts.** A script under `artifacts/**/skills/*/scripts/`
   SHALL be self-contained: the component build copies the `scripts/` directory of a
   skill byte for byte into the four built trees and the library, community and org
   tiers copy it again into a user directory where no repository and no `node_modules`
   is above it (`scripts/lib/build-components/resources.ts`,
   `scripts/lib/setup/tier-install.ts`; the same property is why
   `lint-typescript.ts` imports built-ins only). A skill script SHALL therefore be one file that
   imports no file of its own and loads built-ins with `process.getBuiltinModule`
   (requirement 2). It SHALL NOT import anything from `scripts/lib/` and SHALL NOT use
   `scripts/lib/require-dependency.ts`, which needs a `.git` ancestor; the two
   exceptions are the `js-yaml` lookup of `lint-skill` (requirement 11) and the checkout
   import of `schedule-curator` below, each a run-time `createRequire` or `import()`
   made inside an async function. It SHALL NOT
   load a helper file either: a helper with `export` fails under a package that declares
   `"type": "commonjs"`, and a `.mts` helper escapes the toolchain scope (`.ts` files
   only, `scripts/lib/ts-scope.ts`). The few lines that scripts of one skill have in
   common (the palette, the target resolution, the tool lookup) are therefore
   repeated, and each file SHALL stay under 300 lines (spec 0238). One entry is excepted: `schedule-curator.ts`
   registers an operating-system job through `scripts/lib/service/` (requirement 15) and
   SHALL reach that layer by a lazy `import()` of a file found by walking up from its own
   directory to a CrewRig checkout: the walk starts from the real path of the script
   (`fs.realpathSync`, so a link into a checkout is followed) and stops at the first
   ancestor that holds `scripts/lib/service/schedule-backend.ts`, a file this row
   creates (requirement 15). When there is no such ancestor, every mode except `--help`
   SHALL exit 1 with a diagnostic that names the missing checkout, register nothing and
   print nothing else (deviation (n)); `--help` needs no checkout. `curate.ts` and
   `setup-labels.ts` SHALL NOT load the layer.

4. **Observable contract.** Each entry SHALL preserve the observable contract of the
   script it replaces (parent requirement 14): arguments, environment variables read,
   exit codes, standard output, standard error and files written, except for the
   deviations of requirement 31, which is a closed list.

5. **No new spawned tool.** No entry SHALL spawn `jq`, `yq`, `awk`, `sed`, `grep`,
   `find`, `mktemp`, `crontab`, `fzf`, `seq`, `cat`, `cp`, `rm`, `ln`, `bash` or `sh`
   (parent requirement 23). JSON SHALL be read with the Node.js standard library and
   YAML with `js-yaml` (requirement 11). The tools an entry MAY spawn are exactly: Git;
   `gh` (the forge CLI); the Python interpreter that runs the two `mempalace` files;
   `pipx` and the Python launchers `python3`, `python` and `py`, to locate and run
   that interpreter (requirement 13); the host operating system's service manager
   through `scripts/lib/service/` (requirement 15); and the *wrapped tools* of
   requirement 6. The scheduled
   command of `schedule-curator` runs the current Node.js interpreter.

6. **Wrapped tools.** The `lint-workflow`, `simulate-job`, `simulate-workflow`,
   `lint-markdown` and `lint-python` entries exist to run a third-party tool of the
   user's choice (`actionlint`, `act` with `docker`, `markdownlint`, `ruff` and
   `flake8`) and degrade to a one-line note with exit 0 when the tool is absent, as
   today. Each of these tools ships a Windows build and none is POSIX-only, so parent
   requirement 23, which forbids POSIX-only utilities, does not forbid spawning them
   (decision D2). An entry SHALL locate a wrapped tool on `PATH`, honouring `PATHEXT`
   on Windows, SHALL spawn it with an argument array and no shell, and on Windows SHALL
   launch a `.cmd` or `.bat` shim through `cmd.exe` only after refusing any argument
   that holds `"`, `%`, `^`, `&`, `|`, `<`, `>` or a newline (the CVE-2024-27980
   restriction of Node.js 24 forbids spawning such a file directly).

### The `github-actions` and `gitlab-ci` skills

7. **Text scans.** `check-pinned-actions`, `check-secrets-exposure` (both skills) and
   `check-pinned-images` SHALL scan the files line by line with the shell's rules and
   print the same `[UNPINNED]`, `[RISK]`, `[OK]` and `[FAIL]` lines with the same file
   and line numbers, the same summary on standard error and exit 0, 1 or 2. Colour
   escapes SHALL be emitted exactly when standard output is a terminal. A file with LF
   or CRLF line endings SHALL give the same findings (parent requirement 22). The
   limitations the scripts document (inline `uses:`, `image:` and `name:` values
   only) SHALL be kept.

8. **Target resolution.** For a directory argument the entries SHALL resolve
   `<dir>/.github/workflows` else `<dir>` (GitHub), and `<dir>/.gitlab-ci.yml` plus
   every YAML file under `<dir>/.gitlab` (GitLab), and SHALL list `.yml` and `.yaml`
   files in byte order of their UTF-8 path (deviation (b)). The messages for a missing
   target, a usage error (exit 2) and an empty directory SHALL be unchanged.

9. **Simulators.** `simulate-job` and `simulate-workflow` SHALL run the four
   preconditions in the shell's order (workflow file present; `act` present; `docker`
   present; `docker info` succeeds), print the same `[SKIP]` and `[FAIL]` lines, print
   `+ act ...` and run `act` with `--dryrun` and the same arguments. `simulate-workflow`
   SHALL synthesise the same default payload per event when none is given, SHALL write
   it to an owner-only temporary file through `node:fs` and SHALL remove it on every
   exit path.

### The `pr-reviewer` skill

10. **Lint wrappers.** `lint-markdown` and `lint-python` SHALL print the same
    `no files supplied` and `not found — skipping` notes, SHALL run the wrapped tool
    on the files as one invocation and print its output unchanged on failure, and
    `lint-python` SHALL keep its second pass: one `<file>:<line>: bare print() in
    non-test file` line per hit in each file whose path does not contain `test` or
    `tests`, with the shell's `^\s*print\(` rule.

11. **`lint-json` and `lint-skill`.** `lint-json` SHALL parse each file with
    `JSON.parse` and report `<file>: invalid JSON — <message>` (deviation (c)), keep
    the trailing-comma heuristic (`,\s*[}\]]` per line, one line per hit), and read
    standard input when no argument is given. `lint-skill` SHALL read the leading
    `---` frontmatter block only and check the five required keys
    (`name`, `description`, `license`, `compatibility`,
    `metadata.provenance.version`) and the version bump against `BASE_REF` (default
    `origin/main`) through `git show`. It SHALL parse the block with `js-yaml`,
    resolved at run time with `createRequire`, first from the directory of the
    script itself (which reaches the repository's `node_modules` from a built tree
    inside a checkout) and then from the working directory (which reaches an adopter
    repository that has the package), so that the script stays self-contained
    (requirement 3). When `js-yaml` cannot be resolved from either place it SHALL print
    the one-line note `lint-skill: js-yaml not found — using line fallback for the
    required keys and the version; run it from a CrewRig checkout after setup for the
    full check.` and use the shell's line-based fallback unchanged: its rules read the
    whole file, body included, where the `js-yaml` leg reads the frontmatter block
    only (an imprecision the shell's fallback already had and that this row keeps),
    and it skips no check the shell's fallback ran; it SHALL never fail with an
    unhandled module-resolution error (parent requirement 6). The fallback is a documented
    degraded mode of the kind every wrapped tool has, not an inability to run, so the
    exit status stays that of the findings (decision D1). `yq` SHALL NOT be spawned
    (deviation (d)).

12. **Ordering and exit codes.** Every `pr-reviewer` entry SHALL return exit 0 for no
    finding and exit 1 for a finding, and SHALL process its arguments in the order
    given. `lint-typescript.ts` is already TypeScript, SHALL NOT change in this row and
    SHALL stay wired into the `pr-reviewer` linter pass beside the new entries (spec
    0238 requirement 14).

### The `harness-curator` skill

13. **`curate`.** `curate.ts` SHALL accept the shell's options (`--dry-run`,
    `--apply`, `--from-stdin`, `--target-repo`, `--threshold`, `--max-issues`,
    `--dedup`, `--deep`, `--deep-window`, `--help`), validate them with the shell's
    messages and exit codes (1 for a malformed option, 2 for a missing interpreter, 3
    for `--apply` without `gh`), resolve the interpreter that has the `mempalace`
    library as the shell does (`MEMPALACE_PYTHON`, else the `pipx` environment's
    `venvs/mempalace` interpreter, else `python3`) and, on Windows only, the
    interpreters `Scripts\python.exe`, `python` and `py -3` in that order
    (deviation (g)). It SHALL run `curate.py` beside itself with the same environment
    variables, and in `--apply` mode SHALL pass its standard output to `apply.py`
    (with `--dedup` when requested) on standard input. `--from-stdin` SHALL write the
    payload to an owner-only temporary file that is removed on every exit path.

14. **`setup-labels`.** `setup-labels.ts` SHALL keep the nine-label vocabulary
    (names, colours, descriptions), the `--dry-run` plan lines
    `would create: <name> (color=<hex>, description=<text>)`, the `--repo` option, the
    `ok:` and `FAIL:` lines, the attempt of every label before exit, exit 1 for a usage
    error or a missing `gh`, and exit 2 when any label failed. It SHALL spawn `gh label
    create --force` with an argument array.

15. **`schedule-curator`.** `schedule-curator.ts` SHALL keep `--dry-run`,
    `--uninstall` and `--help`, and SHALL register the recurring job through the
    row D service layer (`scripts/lib/service/`; spec 0252): a launchd agent on macOS,
    a systemd user timer with its service on Linux and a Task Scheduler task on Windows
    (parent requirement 20), under the label `io.crewrig.harness-curator`, running
    `node <curate.ts> --apply --dedup --max-issues 5`. It SHALL NOT duplicate the unit
    rendering, the registration or the state reading that the layer owns; where the
    layer, written for supervised daemons, has no calendar trigger, this row SHALL add
    one to it as additive code that no existing caller observes (the existing suites
    of the layer SHALL pass unchanged): a job kind of the layer's names with the label
    `io.crewrig.harness-curator` (so a plist written by the shell is replaced in place),
    a renderer for a calendar plist, a `.service` and `.timer` pair and a Task
    Scheduler calendar trigger, a backend selector in the new file
    `scripts/lib/service/schedule-backend.ts`, an optional unit to enable (the
    `.timer`), and a replace-on-reinstall path (uninstall, then install) so that a changed hour takes
    effect. The scheduled command SHALL carry an absolute interpreter path and the
    installer's `PATH` (the shell relied on `bash -lc` for a login `PATH`), and where
    the manager is unavailable (no user systemd session, no `schtasks`) the entry SHALL
    exit non-zero naming the missing capability and register nothing (parent
    requirement 20). It SHALL spawn no `crontab` and SHALL leave no
    partly registered job when a step fails. The
    `fzf` prompts SHALL become a built-in prompt on a terminal, with the shell's defaults
    (`weekly` first in the choice, hour `09`), and the additive options
    `--frequency weekly|daily` and `--hour <0-23>` (deviation (f)); a weekly job SHALL
    fire on Monday and every job at minute 0 of its hour, as the shell's plist and
    cron line did; without a terminal
    and without those options the entry SHALL exit 1 naming them. `--uninstall` on a
    machine with no registered job SHALL exit 0 with a line that contains
    `nothing to remove`, and after removing a job SHALL print `Removed:` and its path
    (the existing Bash suite asserts `nothing to remove|removed`).

### Extension hooks and the skeleton

16. **Hook behaviour.** `prompt-logger.ts` and `shell-logger.ts` SHALL read standard
    input up to the first line feed (or to end of input) and write that line, with
    every leading and trailing blank (space and tab) removed as `read -r` does and
    with the escapes left as read, followed by one line feed, and nothing else, exit
    status 0. An empty input SHALL give one line feed. The payload SHALL reach standard
    output unchanged otherwise (deviation (i) lists the one pathological case).

17. **Hook command lines.** The `command` of each hook in
    `extensions/core/hello-world/extension.json` and in
    `extension-skeleton/hook/hooks.json.fragment` SHALL be
    `node "${extensionRoot}/hooks/<hook>.ts"`, a direct command line with no
    dispatcher and no intermediate entry (parent requirement 15). The quotes keep a
    root that holds a space whole under the POSIX and PowerShell parsers recorded in
    `docs/cli-matrix.md` row 37b. The builders (spec 0254 requirement 10) SHALL emit
    the line for the four targets from this one source, the Antigravity line being the
    plugin-relative `node "hooks/<hook>.ts"`.

18. **Hook latency budget.** Each of the two `hello-world` hooks SHALL have a
    budget, stated as an upper bound on wall-clock time from process start to exit,
    Node.js start-up included, over ten consecutive runs, enforced by a step of the
    hook job (requirement 27) that runs `scripts/check-timing-budget.ts`. The initial
    budget SHALL be 2000 ms for every run, with a fixed one-line payload on standard
    input and no other work. After the first green run on `windows-latest` the budget
    SHALL be replaced, in the workflow beside its script and with the observed maximum
    and the run id, by `max(5 x the largest observed run, 750 ms)` rounded up to the
    next 50 ms when that is lower, and never lowered again by a later run. The
    tolerance is deliberately wider than spec 0243's: issue #1509 shows that a bound
    tight on a shared runner flakes, and this row SHALL NOT add a bound that can. The
    replacement SHALL be made in pull request D, as a commit on its own branch after its
    first green run and before it merges. A run over its budget SHALL fail the job with
    the line the harness prints
    (`timing-budget: <script> exceeded <M> ms: measured <t> ms`).

19. **Cheap guard and lazy import.** An example hook SHALL read the payload and return
    with built-ins only; it has no module graph, so the lazy `import()` rule of parent
    requirement 15 is met by construction and a test SHALL assert that the entry
    contains no `import` statement, no `import()` and no `require` outside its comments.
    The skeleton's `logger.ts` SHALL
    carry a comment that shows an author where a guard and a lazy `import()` belong
    when a hook grows a module graph.

20. **Failure silence.** A hook SHALL never write to standard error and SHALL exit 0
    on a read error, as the shell's `read` and `echo` do for a closed input.

21. **Windows cells.** The command line of requirement 17 has no measured Windows
    row: `docs/cli-matrix.md` rows 37-37f measured project-directory tokens, not the
    plugin-root tokens (`${CLAUDE_PLUGIN_ROOT}`, `${extensionPath}`,
    `${COPILOT_PLUGIN_ROOT}`) or Antigravity's plugin-relative path. This row SHALL
    NOT claim those cells work: it SHALL add to `docs/cli-matrix.md` a row, numbered
    after 37f, that records each of the four (CLI, Windows) cells as *not measured*
    with this spec as the owner of the obligation, and the open question of this spec
    carries the measurement. Because the example hooks only echo a payload, an
    unmeasured cell cannot lose user data; a hook that does real work SHALL NOT ship
    on an unmeasured cell.

22. **Skeleton hook.** `extension-skeleton/hook/hooks/logger.ts` SHALL replace
    `logger.sh`, with the behaviour of requirement 16 and the substitution token
    `${SKELETON_NAME}` in its header. The two `hello-world` hooks and the skeleton hook
    SHALL be deleted as shell files, not turned into shims: each ships inside one
    extension package together with the manifest line that names it, so no installed
    copy names the old path (parent requirement 9, removal in the same pull request).

### `create-extension` and the scaffold toolchain

23. **Scaffolder behaviour.** `scripts/create-extension.ts` SHALL keep the shell's
    contract: the `NAME` and `TIER` environment variables (`TIER` among `core`,
    `library` and `org`, default `org`), the usage and tier errors and the existing-
    target error with exit 1, the copy of `extension-skeleton/base` and of each
    selected component directory, the substitution of `${SKELETON_NAME}`, the merge of
    each selected component's `<component>.json.fragment` into `extension.json` with
    the semantics of `jq -s '.[0] * .[1]'` (objects merged recursively, any other
    value replaced by the fragment's, key order of the base kept, new keys appended)
    printed with two-space indentation and a final line feed, and the deletion of the
    fragment. It SHALL derive its placeholder set by scanning `extension-skeleton/` for
    every `${SKELETON_*}` token, SHALL fail and remove the partly written target when a
    token survives in a text file (a file holding no NUL byte), SHALL render the
    scaffold once with `node scripts/build-extension.ts --target all <NAME>`
    (spec 0254) to derive `accepted-gaps.json` exactly as the shell does, including
    the review banner and the sweep of the three `dist-*-plugin` staging directories,
    and SHALL print the same progress and `Next steps` lines.

24. **Component selection.** The selection SHALL come, in this order, from
    `--components <a,b,...>`; from the environment variable
    `CREWRIG_TEST_FZF_SELECTION`, one component per line, when that variable is set,
    including set and empty, which means no component; from a built-in multi-select
    prompt when standard input is a terminal; and otherwise the entry SHALL exit 1
    naming the two non-interactive forms. The variable keeps the name that the
    existing Bash suites already set so that they pass unchanged; the `fzf` stub they
    put on `PATH` SHALL be ignored (deviation (h)). `fzf` SHALL NOT be a prerequisite
    of `task create-extension` any more.

25. **Name validation.** `NAME` SHALL match `^[A-Za-z0-9][A-Za-z0-9._-]*$`; any other
    value SHALL be refused with exit 1 before anything is created (deviation (h)): the
    shell wrote outside `extensions/<tier>/` for `NAME=../x` and substituted a
    `sed` expression for a name holding `/` or `&`.

26. **Scaffold toolchain.** `extension-skeleton/base/package.json` SHALL carry
    `typescript` at the version the repository root pins (`7.0.2` at authoring time,
    never lower than 7.0) and `@types/node` at the root's major; the skeleton SHALL
    carry no `typescript` 5.x and no `.sh`, `.js`, `.mjs` or `.cjs` file. A scaffold
    created under `extensions/<tier>/<name>/` sits inside the root workspace, so the
    repository's `tsconfig.json`, `.oxlintrc.json` and `.oxfmtrc.json` apply to it by
    inheritance and SHALL NOT be copied into the scaffold; a test SHALL scaffold with
    every component and require `scripts/check-typescript.ts --step all` to pass on the
    result. The ratchet (spec 0238) SHALL pass on the scaffolded tree.

### Reuse, oracles and proofs

27. **Windows jobs.** Each pull request that ships entries SHALL ship its own
    `windows-latest` job (parent requirement 17), registered in
    `ci/ci-capabilities.yml` as `portability: specific` with the exception paragraph of
    the earlier Windows jobs and mirrored by hand in `.github/workflows/build.yml`:
    `windows-skill-scripts` (the eleven skill entries), `windows-harness-curator` (the
    three wrappers), `windows-extension-hooks` (the hooks, with their budget steps) and
    `windows-create-extension` (the scaffolder); each ships with the pull request that
    adds the entries it covers. A job SHALL invoke each entry from PowerShell, with `bash`
    absent from the narrowed `PATH` of the child (interpreters resolved from the parent
    `PATH` first; `System32\bash.exe` is on every runner `PATH` and SHALL NOT satisfy a
    check), SHALL use stub wrapped tools and a stub `gh` written at test time (no
    tracked shell, `.js` or shebang file), SHALL assert the entry's observable outcome
    and SHALL fail on a carriage return in a file written under its landing zone.

28. **Oracles.** The eleven skill entries have no test today, so a black-box oracle
    (parent requirement 13) SHALL land first, before any entry, as TypeScript tests
    under `scripts/tests/` that run the shell script on a fixture matrix and compare
    standard output, standard error, exit status and every file written, under
    `LC_ALL=C`, with the expected values stored as golden files with a `.golden`
    suffix. The oracle SHALL select its subject by file presence — the `.ts` entry
    when it exists, else the `.sh` — so that the switch pull request leaves its text
    unchanged. For `lint-skill` it SHALL cover both the line-fallback leg (no `yq` and
    no `js-yaml` on the child's path) and the YAML leg. The golden container of
    requirement 29 SHALL carry `yq` (the Go implementation, version pinned in the
    regeneration script), since the shell takes its YAML leg only when `yq` exists;
    CI compares the entry's YAML leg with those goldens and runs the shell's YAML leg
    live only where `yq` is present, but the line-fallback leg runs live everywhere and
    the oracle SHALL fail, not skip, when that leg is absent. For the hooks, the oracle SHALL be a corpus of
    standard-input payloads (empty; no trailing line feed; leading and trailing blanks;
    a CRLF payload; a backslash; a long line; several lines) run against the shell and
    the entry. The existing Bash suites `artifacts/library/skills/harness-curator/scripts/test.sh`,
    `scripts/tests/test-create-extension-combinations.sh` and the `create-extension`
    cases of `scripts/tests/test-build-extension.sh` are the oracles of their scripts
    and SHALL NOT change in this row except for the static reads of requirement 30.

29. **Differential and goldens.** A test SHALL run each shell script and its entry on
    the same fixtures before the switch and compare the four outputs of requirement 28;
    every difference SHALL be tagged with a deviation letter of requirement 31 or fail.
    Golden files SHALL be generated in a Linux container that mirrors the CI runner
    (Ubuntu 24.04, Bash 5.2, `jq` 1.7, a pinned Go `yq`, Node.js 24, GNU `tar` and `gzip`
    on the hermetic `PATH`), never on the maintainer's host, with host-specific values (the Node.js
    path, temporary paths, random tokens, ports) normalised, and SHALL then be
    regenerated in a second image with Node.js under a runner-like path
    (`/opt/hostedtoolcache/node/<version>/x64/bin`) with an empty `diff -r` between
    the two. After the switch the shell leg is gone and the same test compares the entry
    with the committed goldens. A suite that mutates a shell implementation in a
    sandbox SHALL also mutate its entry, in a sandbox that holds `.git`, the root
    `package.json` and real copies of `js-yaml` and `argparse`, with `NODE_TEST_CONTEXT`
    and `CI` removed from the child environment.

30. **Static reads.** Every file that reads the text of a script this row rewrites
    SHALL be listed in the PLAN, before and after, and SHALL be retargeted in a pull
    request that lands before the switch that would break it, each with a vacuity
    guard. At authoring time the list holds at least:
    `scripts/tests/test-extension-render-conformance.sh` (the expected output file sets
    name `hooks/prompt-logger.sh` and `hooks/shell-logger.sh`, lines 161-190),
    `scripts/tests/test-build-extension.sh` (case 16 asserts `hooks/logger.sh`, line
    751), `scripts/tests/fixtures/extension/old-invocation-allowlist.txt` (line 20)
    with `scripts/tests/extension-references.test.ts`,
    the extension-golden fixtures under
    `scripts/tests/fixtures/extension-golden/hello-world/` and the packaging goldens
    under `scripts/tests/fixtures/packaging-release/` that hash the hook bytes. A new
    inline `js-yaml argparse` literal in a Bash suite SHALL be registered in
    `build-components-fixture-closure.test.ts`.

### Shims, callers and the rest of the repository

31. **Deviations.** The deviations from the shell contract are a closed list; letters
    from (o) onward are reserved for what the differential test finds and SHALL be
    added through a delta of this spec.
    - (a) The script name printed in usage lines and diagnostics (`$(basename "$0")`)
      is the entry's name, ending in `.ts`.
    - (b) Files are listed in byte order of their UTF-8 path; `find` printed them in
      directory order, which no test can pin.
    - (c) `lint-json` reports Node.js's own parse message in the `invalid JSON` finding; the
      `jq not found` note disappears with the dependency; standard input is named
      `<stdin>` in findings instead of a random temporary path.
    - (d) `lint-skill` parses with `js-yaml`, not `yq`; the note names `js-yaml`.
    - (e) A skill script that needed `mktemp` creates its temporary file with
      `node:fs` and a random suffix; the name pattern differs, the permissions
      (owner-only) do not.
    - (f) `schedule-curator`: Linux registers a systemd user timer instead of a
      `crontab` entry; the prompts are built-in; Windows is supported; a `crontab` entry
      written by an earlier version is NOT removed (reading it needs `crontab`), and on
      Linux both `--uninstall` and an install print one line that names the marker
      `# crewrig-harness-curator` and asks for its manual removal; the `curate.sh`
      shim keeps that entry working until row J4 and `--dedup` makes a double run
      harmless; the unsupported-OS message names the three supported systems.
    - (g) `curate` resolves Windows interpreter names; `--help` prints a constant text
      identical to the former header lines.
    - (h) `create-extension`: no `fzf`; `NAME` is validated; the placeholder is
      replaced literally; the additive `--components` option; Windows is supported.
    - (i) A hook payload that is one word of the form `-` followed by one or more of
      the letters `n`, `e` and `E` (`-n`, `-e`, `-E`, `-ne`, `-en`, ...) is taken by
      the shell's `echo` as options and printed as nothing or as an empty line; the
      hook writes it literally.
    - (j) `schedule-curator`: the launchd verbs (`load -w` and `unload -w` in place of
      `bootstrap` and `bootout`) and the `Wrote:` and `Loaded` lines MAY differ from the
      shell's, since the job is registered through the service layer.
    - (k) `curate` on Windows sets `PYTHONUTF8=1` for the interpreter it starts, so that
      Gitmoji in a title survives a console code page.
    - (l) An option that needs a value and is given none (`--threshold` last on the
      line) reports a usage error with exit 1; the shell died with `unbound variable`.
    - (m) `lint-json` rejects what `JSON.parse` rejects, which is stricter than
      `jq empty`: an empty file, several top-level values and the non-standard literals
      `nan` and `NaN` that `jq` accepted are reported as `invalid JSON`.
    - (n) `schedule-curator` needs a CrewRig checkout in every mode but `--help`, `--dry-run` included
      (requirement 3); the shell ran from any directory.

32. **Shims, deletion and callers.** A script with a Bash oracle or a CI or Taskfile
    caller that is not retargeted in the same pull request SHALL become a forwarding
    shim of the form of spec 0255 requirement 25 (Node.js floor guard, then `exec node
    <entry>.ts "$@"`): `curate.sh`, `schedule-curator.sh`, `setup-labels.sh` and
    `create-extension.sh`; each keeps its line in `ci/shell-allowlist.txt` until row
    J4. A shim inside a skill has no `scripts/lib/` above it, so the three curator shims
    SHALL carry the Node.js floor check inline (a `node -e` major-version test that prints
    the parent requirement 4 diagnostic and exits non-zero) in place of the guard file. A script with neither SHALL be deleted with its allowlist line, in the switch pull
    request of requirement 35: the eleven skill scripts and the three hook scripts. Every
    skill body, agent body, reference page, `README.md`, `DEVELOPMENT.md`,
    `CONTRIBUTING.md`, `artifacts/FORMAT.md`, `Taskfile.yml` task and workflow line that
    names the old invocation SHALL be updated in the same pull request (parent
    requirement 9); an instruction SHALL read `node scripts/<name>.ts <arguments>`
    resolved against the skill's own directory. `task create-extension` SHALL run
    `node scripts/create-extension.ts` after the Node.js floor guard and SHALL no longer
    precondition on `fzf`; `task harness-curate` SHALL run `curate.ts` the same way.

33. **Shipped components.** Every skill and agent source modified here (the
    `github-actions`, `gitlab-ci`, `pr-reviewer`, `harness-curator` and
    `harness-report` skills, the `ci-configurator` and `ci-debugger` agents) SHALL
    bump `metadata.provenance.version` in the same diff (MINOR for a changed
    invocation), in the switch pull request S1, and `scripts/check-skill-versions.sh`
    SHALL pass there. Every commit that adds or changes a file under `artifacts/`,
    including the entry pull requests B and C, SHALL run the component build
    (`node scripts/lib/node-floor-guard.js`, then `node scripts/build-components.ts`)
    and stage its regenerated outputs in the same commit; the entry pull requests add
    files only, so the check does not require a bump there. The
    `hello-world` extension's manifest version is written by the release driver and
    SHALL NOT be hand-bumped (`docs/version-bump-convention.md`);
    `scripts/check-extension-manifest-version.sh` and
    `scripts/check-extension-version-bump.sh` SHALL pass.

34. **Parity.** `docs/cli-matrix.md` SHALL be updated in the same diff as each pull
    request that touches a CLI integration point (`AGENTS.md`, *CLI Matrix
    Maintenance*): the rows that describe skill scripts and extension hooks, the new
    row of requirement 21, and the parity statement that the four CLIs consume the same
    skill scripts and the same hook source. The migration SHALL stay symmetric across
    Claude Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI; the Copilot CLI
    installs only `SKILL.md` of a skill, never its `scripts/` (`scripts/lib/setup/tier-install.ts`),
    an existing asymmetry that this row SHALL record and SHALL NOT change.

35. **Staging.** The work SHALL ship as the spec-PR plus eight implementation pull
    requests, every one targeting `release/1231-ts-migration` and each rebased on it and
    re-tested before its merge. Entries land first, beside the shell scripts they
    replace, so that the differential of requirement 29 can run on CI against the live
    shell; a separate switch pull request then removes or shims the shell:
    - R0, the static-read retargets of requirement 30 that need no entry;
    - A, the eleven-script oracle and its goldens, green against the shell;
    - B, the eleven skill entries, the differential and `windows-skill-scripts`;
    - C, the three curator entries, the service-layer calendar trigger, the
      differential and `windows-harness-curator`;
    - D, the hook oracle, the three hooks beside their shell twins (the skeleton's
      `logger.ts` beside its `logger.sh`), the differential, the budgets,
      `windows-extension-hooks`, and the regeneration of the extension and packaging
      goldens that the added files change;
    - E, `create-extension.ts`, the differential, `windows-create-extension` and the
      skeleton's `package.json` toolchain of requirement 26;
    - S1, the switch of the skill and curator scripts: deletions, the three curator
      shims, callers, skill and agent version bumps, the component build;
    - S2, the switch of the extension side: the manifest lines of requirement 17, the
      second regeneration of those goldens, the deletion of the three hook scripts and
      of the skeleton's `logger.sh`, the skeleton fragment, the scaffold toolchain test
      of requirement 26, the `create-extension` shim, the Taskfile tasks, the final
      documentation, and the flip of this spec to
      `status: implemented`.

    Every pull request but S2 SHALL be on a branch `test/1337-<slug>`; S2 SHALL be on
    `feat/1337-<slug>` (the spec linter reads `feat`, `fix`, `refactor`, `perf` and
    `chore` as the implementation-complete pull request). R0, A, C, D and E have no
    dependency among them and SHALL be opened in parallel; B follows A; S1 follows B
    and C; S2 follows R0, D and E. The skill and curator scripts have no static read
    that R0 could retarget before their switch, so R0 holds the extension-side reads
    only. S2 regenerates the `create-extension` goldens that
    E committed, because the skeleton it changes is their input.

### Decision record

**Decision D1 — skill scripts are self-contained single-skill files.** *Adopted:*
requirements 3 and 11: one file per script, built-ins only, `js-yaml` resolved
from the script's directory then the working directory, with a line fallback. The
fallback reads the parent requirement 6 sentence that demands a non-zero exit and a
re-run-setup instruction as governing a script that cannot do its work without the
package; `lint-skill` can, in the degraded mode the shell already had. A reviewer who
reads requirement 6 literally can obtain a one-sentence clarifying delta of the
parent. *Rejected:* (i) importing the shared
modules of `scripts/lib/`, which a copied skill cannot reach and which needs a `.git`
ancestor; (ii) a hand-written YAML reader, which parent requirement 23 forbids because
one YAML library SHALL remain; (iii) a per-skill helper file loaded with a relative `import()`, which fails under a
`"type": "commonjs"` package when it is a `.ts` file with `export` (measured by seat pass
5) and leaves the toolchain scope when it is a `.mts` file, the price being a few
repeated lines; (iv) declaring `lint-skill` checkout-only in its
`SKILL.md`, which breaks it for the library tier; (v) installing `js-yaml` next to
every skill at setup, which adds a dependency step to a copy operation that has none.

**Decision D2 — wrapped tools are not POSIX-only utilities.** *Adopted:* requirement
6: the five scripts that wrap `actionlint`, `act`, `docker`, `markdownlint`, `ruff` and
`flake8` keep doing so, because the tools ship Windows builds and the scripts' whole
contract is to degrade when they are absent. *Rejected:* (i) deleting the wrappers,
which drops a documented skill capability; (ii) bundling a linter as a dependency, which
puts `markdownlint` and a Python tool into the runtime closure that parent requirement 6
limits to production dependencies; (iii) a delta of parent requirement 23 naming the
tools, held back because the requirement forbids POSIX-only utilities and these are
not; a reviewer who reads the requirement as a closed list, as delta-05 read it for
`powershell`, can obtain that delta, which SHOULD name the class (a user-installed,
cross-platform tool run only as an optional check, by argument array with no shell,
whose absence degrades to a note and exit 0, and which is not a tool the requirement
names) and not the six tools, so that a new linter needs no new delta.

**Decision D3 — deletion for scripts nothing else reads, shims for the others.**
*Adopted:* requirement 32. *Rejected:* a shim for all fifteen, which keeps fifteen
shell files on the allowlist for no oracle and no caller; deletion of all fifteen, which
breaks the Bash oracle of the curator and of `create-extension` that parent requirement
13 forbids this row to edit.

**Decision D4 — `create-extension` keeps the oracle's variable name.** *Adopted:*
requirement 24. *Rejected:* (i) a new variable, which fails the unchanged Bash suites;
(ii) spawning `fzf`, forbidden by parent requirement 23 as a tool absent from the
permitted list and absent from Windows by default; (iii) editing the Bash suites,
forbidden by parent requirement 13 until rows J1a and J2.

**Decision D5 — Linux scheduler.** *Adopted:* requirement 15, a systemd user timer
through the row D layer, as the ticket directs. *Rejected:* (i) keeping `crontab`, a
POSIX-only utility that the layer does not wrap and that Windows lacks; (ii) a Node.js
process that sleeps, which is a daemon and not a schedule. The cost, deviation (f),
is that an old `crontab` entry persists until its owner removes it; `--dedup` makes a
double run harmless.

**Decision D6 — hooks are deleted, not shimmed, and the Windows cells are named
unmeasured.** *Adopted:* requirements 21 and 22. *Rejected:* measuring now, which needs
the four CLIs on a Windows machine that CI does not have (open question 1); claiming the
cells work from rows 37-37f, which measured another token.

## Scenarios

**Scenario:** A skill check runs from PowerShell

Given Windows with Node.js 24, a `.github/workflows` directory holding one workflow
with an unpinned `uses: actions/checkout@v4` and no `bash` on the path
When `node check-pinned-actions.ts .` runs from the skill's `scripts` directory
Then it prints one `[UNPINNED]` line with the file, line number and value, prints the
summary on standard error and exits 1, with no warning on standard error.

**Scenario:** A workflow with CRLF line endings gives the same findings

Given a workflow file whose lines end in CRLF and one whose lines end in LF, with the
same content
When `check-secrets-exposure` runs on each
Then both runs print the same findings with the same line numbers.

**Scenario:** A wrapped tool is absent

Given a machine with no `actionlint` on the path
When `node lint-workflow.ts .github/workflows` runs
Then it prints the `[SKIP] actionlint not found` line and exits 0.

**Scenario:** `lint-skill` runs in a copied skill

Given the skill copied to a directory with no repository above it and a `SKILL.md`
missing `license`
When `lint-skill.ts SKILL.md` runs there
Then it prints the `js-yaml not found` note, reports the missing key through the line
fallback and exits 1, and no module-resolution error appears.

**Scenario:** `lint-skill` reads the frontmatter with `js-yaml`

Given a checkout with its dependencies installed and a `SKILL.md` whose body, not its
frontmatter, holds a line `license: x`, with `license` missing from the frontmatter
When `lint-skill.ts SKILL.md` runs from the checkout
Then it reports `license` missing, the shell's YAML leg having reported the same, and
exits 1.

**Scenario:** The curator dry run reads standard input

Given a friction payload on standard input and no `mempalace` library
When `node curate.ts --from-stdin --dry-run` runs
Then it prints the same clusters JSON as `curate.sh` printed, removes its temporary
file and exits 0.

**Scenario:** The labels plan is stable

Given no network
When `node setup-labels.ts --repo crewrig/crewrig --dry-run` runs
Then it prints nine `would create:` lines in the vocabulary order and exits 0.

**Scenario:** The schedule is removed cleanly

Given a machine with no registered curator job
When `node schedule-curator.ts --uninstall` runs
Then it prints a line that contains `nothing to remove`, exits 0 and has spawned no
`crontab`.

**Scenario:** An example hook echoes its payload within budget

Given the `hello-world` hook `shell-logger.ts` and one JSON line on standard input
When the Windows job runs it ten times
Then each run writes the line and one line feed, exits 0, writes nothing to standard
error, and finishes within the budget of requirement 18.

**Scenario:** A hook that grows a module graph breaks its budget

Given a change that makes a hook load a large module before reading its input
When the budget step runs
Then the job fails with `timing-budget: <script> exceeded <M> ms: measured <t> ms` and
the pull request cannot merge.

**Scenario:** A scaffold passes the repository toolchain

Given `NAME=probe TIER=org` and every component selected through
`CREWRIG_TEST_FZF_SELECTION`
When `node scripts/create-extension.ts` runs
Then `extensions/org/probe` holds no `.sh` file and no `typescript` older than 7.0,
every `${SKELETON_*}` token is replaced, `extension.json` holds the merged sections,
and `check-typescript.ts --step all` and the ratchet pass on it.

**Scenario:** A hostile name is refused

Given `NAME=../escape`
When `create-extension.ts` runs
Then it exits 1 naming the allowed pattern and creates nothing.

**Scenario:** The Bash oracles pass through the shims

Given the four shims installed
When `test.sh` of the `harness-curator` skill and the two `create-extension` suites
run on Linux and macOS
Then every assertion passes unchanged.

## Out of scope

- Any Bash test migration, including `artifacts/library/skills/harness-curator/scripts/test.sh`
  and the `create-extension` suites (rows J1a, J1b and J2: #1340, #1341, #1343), and
  `lint-shell.sh` (requirement 26 of the parent, row J4).
- `scripts/build-ci.sh` and the CI checks (rows I1 and I2: #1338, #1339).
- Porting `curate.py` and `apply.py`, which stay Python (parent requirement 16).
- Workspace `node_modules` in the release archive (#1599), the Windows timing flake of
  #1509 and #1545, and the items row G2 ledgered for J2 and J4 on #1336.
- Measuring the plugin-root tokens of the four CLIs on Windows (open question 1).
- A latency budget for the skill and curator entries: they are not wired at a CLI
  integration point.
- Changing what any wrapped tool checks, the nine curator labels, the curator's
  clustering, or the neutral `hooks` vocabulary of spec 0179.

## Open questions

- Whether the plugin-root command lines of requirement 17 launch on each (CLI, Windows)
  cell: issue #1601, run on the maintainer's Windows machine with the probe of
  `scripts/probe-windows-hook-parsing.ts`, closes it and replaces the row of
  requirement 21. This row ships the unmeasured cells named, not hidden.
- The exact shape of the calendar-trigger addition to `scripts/lib/service/`
  (requirement 15) and its Task Scheduler XML, to be fixed in the PLAN and pinned by the
  layer's own suites.
- The complete list of static reads of requirement 30, with the before and after of
  each, to be fixed in the PLAN.
