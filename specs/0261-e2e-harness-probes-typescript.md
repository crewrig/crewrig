---
id: "0261"
slug: e2e-harness-probes-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1342
version: 1.0.0
---

# End-to-end harness and probes in TypeScript

*Sub-spec J3 of the `large`-tier ticket #1231, row J3 of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>). Parent
spec: `specs/0215-shell-to-typescript-migration.md` (requirements 9, 13, 14, 17, 19, 22 and
23, row J3, step (e) of requirement 8), under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this spec-PR and
its implementation pull requests target `release/1231-ts-migration`, "shipped" means merged
there, and the base ref wherever a protocol names `main` is
`origin/release/1231-ts-migration` (requirement 34). Requirement 23 of the parent applies as
narrowed by `specs/0215-shell-to-typescript-migration.delta-05.md`. Depends on row H
(`specs/0258-skill-extension-bundled-scripts-typescript.md`: the entry form, the
`windows-latest` job conventions, the differential and golden conventions) and on the rows
before it (`specs/0240-*`, `0243-*`, `0254-*`, `0257-*`). It inherits the behavioural contracts
of ADRs 0001 to 0009 (the end-to-end images, the account flow, the runner and its TOML merge,
the assertion libraries, the pillar scenarios, the judge backends) and of specs 0076 to 0079,
0081 and 0194, which this spec does not reopen.*

## Intent

A maintainer who runs the end-to-end harness (`task e2e:build`, `task e2e:auth:*`,
`task e2e:test*`, `task e2e:report`, `task e2e:lock`), the account-setup scripts, the verdict
publisher or one of the three headless probes types the same commands, passes the same
arguments and gets the same verdicts, the same TAP lines, the same files in the report
directory and the same exit statuses as before, except for the few listed changes. The
harness, its libraries, its seven scenarios and its probes run with `node` from PowerShell,
`cmd.exe`, Bash or zsh and need no `bash`, `jq`, `yq`, `curl` or `mktemp` on the machine; the
parts that drive Docker and a real CLI still need Docker, as today. A maintainer who has no
account can prove, from a recording made before the migration, that every scenario and every
probe returns the same verdict for each CLI after it.

<!-- markdownlint-disable MD029 -->

## Requirements

### Scope and entry points

1. **Entry points.** Thirty-six TypeScript files, and one new module with no predecessor
   (`tests/e2e/lib/toml_subset.ts`, requirement 6), SHALL replace the behaviour of the shell
   files below, each at the path of its predecessor with `.sh` changed to `.ts` (parent
   requirement 9):
   - `tests/e2e/run.ts` and `tests/e2e/scenarios/{01-layered-context,02-cross-tool-memory,
     03-skill-build,04-harness-loop,05-copilot-model-routing,06-agent-surface-consumption,
     07-guidance-surface}/run.ts`;
   - `tests/e2e/lib/{assert,copilot_ephemeral_home,expand,llm_judge,mask_command,
     probe_a_resolve,probe_b_resolve,probe_c_resolve,probe_spawn_markers,report,structural,
     test-gemini-headless,toml_merge}.ts` and `tests/e2e/lib/llm_judge_drivers/{anthropic,
     claude-code,gemini,ollama-cloud}.ts`;
   - `scripts/e2e/{auth-claude,auth-copilot,auth-gemini,auth-ollama,publish-probe-verdict}.ts`
     and `scripts/e2e/lib/auth-common.ts`;
   - `scripts/probe-{antigravity-discovery,extension-hooks,extension-mcp-token}.ts`,
     `scripts/e2e-capture-versions.ts` and `scripts/lib/usage-headless.ts`.

   A file of the first three groups that callers execute (the runner, a scenario, `report`,
   `toml_merge`, an auth script, the publisher, a probe, `e2e-capture-versions`,
   `test-gemini-headless`) is an *entry*; the others are *modules* that entries import. The
   harness is classified as tests by parent requirement 13, lives inside the repository and
   is never copied to a user directory, so a module MAY import any other file of the
   repository and the entries of this row use the entry form of spec 0255 (not the
   self-contained form of spec 0258, which exists for skill scripts that are copied).

2. **Entry form.** Each entry SHALL be runnable as a direct `node <path>.ts` command line,
   written to the conventions of parent requirement 2, and SHALL keep its logic in importable
   functions so that a test calls them without a child process. Standard output, standard
   error and exit statuses are the contract; a warning on standard error SHALL NOT appear.

3. **Observable contract.** Each entry SHALL preserve the observable contract of the script
   it replaces (parent requirement 14): arguments, environment variables read, exit codes
   (including `78` for a skipped case and `2` for a usage error), standard output, standard
   error, the files written under the report directory (`run.tap`, `effective.json`,
   `<cli>/<scenario>/{scenario.tap,stdout,stderr,exit,invocation.txt}`, `judge.count`), the
   Docker command lines it builds and the mode and ownership it gives to the credential
   bundle, except for the deviations of requirement 24, which is a closed list.

4. **Spawned tools.** An entry or module SHALL NOT spawn `jq`, `yq`, `curl`, `awk`, `sed`,
   `grep`, `find`, `mktemp`, `cp`, `rm`, `chmod`, `stat`, `date`, `ssh-keygen`, `openssl`, `bash`
   or `sh` (parent requirement 23). JSON SHALL be read and written with the Node.js standard
   library, HTTP calls SHALL use the global `fetch`, signatures and tokens SHALL use
   `node:crypto`, and TOML SHALL be read as requirement 6 states. The tools it MAY spawn are
   exactly: Git (`ls-remote` of the branch assertion); `gh` (the forge CLI: the verdict
   publisher, the harness-loop scenario, the Copilot sanity check); the four supported CLIs
   (`claude`, `gemini`, `copilot`, `agy`); `ollama`, only inside a container; `mempalace`,
   only inside a container; the Python interpreter of the memory sidecar, only inside a
   container; and `docker`, the container runtime that is the purpose of the harness. `docker`
   is a cross-platform tool that ships a Windows build and is not a POSIX-only utility, so
   parent requirement 23 does not forbid spawning it (decision D1). Each spawn SHALL use an
   argument array and no shell.

### Oracle and proofs

5. **Recording before migrating.** Before any TypeScript file of requirement 1 reaches the
   release branch, a pull request SHALL commit a *recording*: golden files produced by
   running the shell harness unchanged, from a clean checkout of the release tip, in a Linux
   container that mirrors the CI runner (Ubuntu 24.04, bash 5.2, jq 1.7, `yq` v4.40 or later,
   Node.js 24, GNU `tar` and `gzip` on the hermetic `PATH`), then regenerated in a second
   image whose Node.js lives under a runner-like path
   (`/opt/hostedtoolcache/node/<version>/x64/bin`) with `diff -r` empty. A recording SHALL
   NOT be generated on the macOS host, and SHALL NOT be regenerated from the TypeScript side.
   Every host-specific value (Node.js path, run identifier, timestamps, random suffixes, scratch
   paths, ports, container names built from the run identifier) SHALL be normalised by a
   documented normaliser; goldens that embed a shell script SHALL carry a `.golden` suffix and
   a guarded leading `#!` (parent requirement 11, the ratchet counts every tracked shell or
   shebang file).

6. **TOML subset reader.** `toml_merge.ts` SHALL read `defaults.toml` and `local.toml` with a
   reader written for this row, `tests/e2e/lib/toml_subset.ts`, that accepts exactly the syntax
   the two committed files use plus what `local.toml` may reasonably hold: table headers
   (`[a.b]`), `key = value` with basic double-quoted strings and the TOML basic escapes
   (`\"`, `\\`, `\n`, `\t`, `\r`, `\uXXXX`), literal single-quoted strings, booleans,
   integers, floats, arrays of scalars across several lines with comments between elements
   and a trailing comma, `#` comments (never inside a string), and LF or CRLF line endings.
   It SHALL refuse every other construct (dates, multi-line strings, inline tables,
   arrays of tables, dotted keys, quoted keys, nested arrays) with a non-zero exit, a
   one-line diagnostic that names the file, the line and the construct, and no output. The
   merge SHALL keep the semantics of ADR 0003 (tables merge recursively, arrays append
   without de-duplication, scalars replace, `command` is replaced as a whole, `env_keys` is
   de-duplicated first-seen), and SHALL write JSON that is byte-identical to the shell's
   (two-space indentation, declaration order of keys, the float token as the shell printed
   it, one trailing line feed); the recording of requirement 5 carries the merged JSON of
   `defaults.toml` alone, of `defaults.toml` with `local.toml.example` uncommented, and of
   each negative fixture. A fuzz test SHALL compare the reader with `yq` on every committed
   `.toml` file of the repository and SHALL skip when `yq` is absent (decision D2).

7. **Scenario oracle.** The oracle of the harness (parent requirement 13) is a table, in the
   recording of requirement 5, of one tuple per (scenario, CLI) pair — the exit status, the
   `scenario.tap` of the case, the Docker command lines the scenario issued, normalised, and
   the files written — that the TypeScript harness SHALL reproduce exactly. The tuples are
   produced with no account and no spend: a stand-in for `docker` placed first on `PATH`
   records each command line and answers from a fixture table keyed by scenario, CLI and call
   ordinal (volume and container creation, detached sidecars, interactive runs, copies, the
   answer file a scenario reads from a mounted directory, canned exit codes including `124`
   and `126`); `E2E_JUDGE_MOCK=1` with a canned response drives the judge, a scratch `HOME`
   and a scratch `CREWRIG_E2E_HOME` hold the credential bundle, and a dummy token
   (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `COPILOT_GITHUB_TOKEN`) opens the authentication
   gate. The stand-in SHALL be one TypeScript fixture module shared by the shell run and the
   TypeScript run; the executable file that `PATH` resolves SHALL be generated into a scratch
   directory by the test, never tracked, so that no tracked shell or shebang file is added
   (on Windows a `.cmd` launcher; the Docker-driving cases run on POSIX only, requirement 21).
   Each scenario SHALL have, besides its passing fixtures, at least one negative fixture
   (a wrong answer, a non-zero probe exit, a timeout, a failed sidecar) whose expected outcome
   is also recorded.

8. **Coverage bound.** The recording SHALL give full fixtures, with the Docker command lines
   and the verdict, to the pairs whose control flow a canned container output can drive
   (scenarios `01` and `03` for each of their three CLIs, `02` for its two, `04` for its
   three), and a skip-path and command-line recording to the others (`05` for Copilot, `06`
   and `07` for Copilot and Claude Code) unless the PLAN shows a canned output that drives
   their verdict resolvers. The spec SHALL NOT claim more than that: the oracle proves the
   orchestration (command-line assembly, mount and environment rules, exit-status mapping,
   TAP emission, skip paths, the layout of the report directory) and the resolvers, and it
   does not prove the behaviour of a real CLI (requirement 22).

9. **Library oracles.** Each of the pure functions of the libraries SHALL also be pinned by
   a recording made from the shell: the resolvers of probes A, B and C on synthetic inputs,
   `probe_spawn_markers` on captured outputs, `mask_command`, `expand`, `structural`,
   `report` on synthetic TAP, the assertion functions on passing and failing fixtures (the
   `# FAIL` diagnostic block verbatim), the judge on a local HTTP server that stands in for each
   backend's endpoint (the four drivers, their preflight, their `UNCERTAIN` and `strict`
   paths, `max_calls` and `judge.count`), and `auth-common` (every function, with a stand-in
   `docker` that fails the test when it is asked to `run`).

10. **Differential suites.** Each dark TypeScript twin SHALL ship with a differential test
    that runs the shell and the TypeScript on the same inputs and requires the same standard
    output, standard error, exit status and files, under `LC_ALL=C` for the shell. A suite that
    mutates the shell in a sandbox SHALL mutate the TypeScript twin the same way, SHALL copy
    only what Git tracks (never an untracked `node_modules` or `dist`), SHALL carry `.git`, the
    root `package.json` and a real copy of `js-yaml` and `argparse` when it runs a loader, SHALL
    unset `NODE_TEST_CONTEXT` in a nested `node --test` and SHALL delete `CI` from the child
    environment of a partial-copy harness. A suite that compares the shell with the
    TypeScript SHALL run in an Ubuntu 24.04 container before its pull request opens.

11. **Probes without a Bash test.** `probe-extension-hooks` and `probe-extension-mcp-token`
    have no Bash test. Before either migrates, a black-box test SHALL be written, in
    TypeScript, that runs the shell probe with stand-in `claude`, `gemini`, `copilot`, `agy`,
    `gh` and `jq`-free fixtures generated into a scratch `PATH`, a scratch `HOME`, an isolated
    Antigravity install root and a scratch usage root, and that asserts the verdict, the
    report files, the exit status and the cleanup of everything the probe installed; the
    same test SHALL then pass unchanged against the TypeScript probe and play the oracle
    role (parent requirement 13). No probe SHALL be run against a real account by a test.

12. **Probes with a Bash test.** `scripts/tests/test-antigravity-discovery-probe.sh` (spawns
    the probe with a stub `agy` and a scratch `HOME`) and `scripts/tests/test-e2e-probes.sh`
    (the publisher, the resolvers, the masking and the scenario structure) SHALL stay
    unchanged in their assertions while the probe and the publisher migrate and SHALL pass
    against the TypeScript twins through forwarding shims (requirement 16); they migrate only
    in the Bash-suite pull requests of item (7) of requirement 25, never earlier.

### Libraries, shims and callers

13. **Sourced libraries.** The shell files that suites `source` in-process
    (`tests/e2e/lib/{assert,structural,llm_judge,probe_a_resolve,probe_b_resolve,
    probe_c_resolve}.sh`, `llm_judge_drivers/*.sh` and `scripts/e2e/lib/auth-common.sh`) are
    sourced libraries (parent requirement 13). A Bash suite that sources one cannot run
    against a TypeScript module, so, under the first bounded exception of that requirement,
    the suites `test-e2e-assert-lib`, `test-e2e-structural-lib`, `test-e2e-llm-judge-lib`,
    `test-e2e-auth-common` and `test-e2e-auth-ready` MAY migrate in the same pull request as
    the library they source, and the cases of `test-e2e-probes` that source a library (the resolvers of probes A, B and C,
    `mask_command` and `probe_spawn_markers`; the pull request moves those cases to TypeScript
    and leaves the other cases of the file unchanged until requirement 19), always within item (7) of requirement
    25 and after the switch pull request, because the unchanged
    suites still source the libraries until then, on the conditions of that
    requirement: before that pull request, every behaviour each asserts SHALL be covered by an
    unchanged test that does not source the library. The substitute tests are the black-box
    recordings of requirements 7 and 9, which run the scenarios, the auth scripts and the
    runner as consumers; the PLAN SHALL list, per suite, each assertion and the substitute that
    covers it, and a behaviour with no substitute (a driver's HTTP request shape, for one)
    SHALL gain a recorded test of requirement 9 first.

14. **Assertions only a shell file has.** The assertions that check a property only a shell
    file has — `bash -n`, the shebang and `set -euo pipefail` checks, the executable bit of a
    scenario `run.sh` as a proof of runnability — are not oracles (parent requirement 13) and
    SHALL be removed in the pull request that migrates the file they check; the executable bit
    is retained while the shim exists.

15. **Static reads.** Every Bash suite, TypeScript test, skill body, hook, `Taskfile.yml`
    `cmd:` entry, workflow `run:` line and allowlist that reads the text of a file this row
    rewrites SHALL be enumerated in the PLAN, with the before and after of each, and SHALL be
    retargeted in its own pull request, before the switch pull request, so that it passes
    against both the shell and the TypeScript. The categories known at authoring time are:
    the suites that `grep` a script for a Docker mount or a `source` line
    (`test-e2e-auth-claude-json`, `test-e2e-auth-ollama`, `test-e2e-auth-scripts`,
    `test-e2e-runner`, `test-e2e-runner-delegation`, `test-e2e-runner-taskfile`,
    `test-e2e-probes`, `test-e2e-scenarios-structure`); the `Taskfile.yml` entries
    `e2e:lock`, `e2e:auth:*`, `e2e:test*` and `e2e:report`; the path filters of the `e2e` jobs of
    `.github/workflows/build.yml`, `.gitlab-ci.yml` and `ci/ci-capabilities.yml`; the
    `ci/shell-allowlist.txt` lines of the scope; `ci/test-wiring-exemptions.txt`; the
    `build-components` old-invocation allowlist and `build-components-fixture-closure.test.ts`,
    which read scenario `03-skill-build/run.sh`; `scripts/lib/en_us_sweep.py` and
    `scripts/sweep-en-us.sh`, which name the harness libraries (files of row I1: reported to
    the coordinator, never edited here); the rows 21, 31 and 32 of `docs/cli-matrix.md`; the
    runbooks `antigravity-discovery-probe.md`, `extension-hook-probe.md` and
    `extension-mcp-token-probe.md`; and `tests/e2e/README.md`, `tests/e2e/lib/README.md` and
    `tests/e2e/scenarios/README.md`, which `test-e2e-readme` and `test-e2e-libs-readme` read.
    A new inline `js-yaml argparse` literal in a Bash suite SHALL be registered in the
    `LITERALS` of `build-components-fixture-closure.test.ts`.

16. **Shims and deletions.** When a file migrates, its `.sh` path SHALL be removed in the same
    pull request or reduced to a forwarding shim that only invokes the TypeScript (parent
    requirement 9). A shim SHALL exist for each executable that an unchanged Bash suite, a
    `Taskfile.yml` entry or a workflow still names: `tests/e2e/run.sh`, the seven scenario
    `run.sh`, `tests/e2e/lib/{report,toml_merge}.sh`, the four `auth-*.sh`,
    `publish-probe-verdict.sh`, the three probes and `e2e-capture-versions.sh`. A shim is a
    `bash` file of three lines that runs `node` on the sibling `.ts` and forwards its arguments
    and status, stays on `ci/shell-allowlist.txt`, and is deleted in the pull request that
    migrates the last J3 suite that spawns it when no file outside this row names it, and is
    otherwise left to row J4. A sourced library with no executable caller (requirement 13)
    SHALL be deleted, not shimmed, in the pull request of its suite.

17. **Retirement of `usage-headless.sh` and `extension-hooks.sh`.** `scripts/lib/usage-headless.ts`
    SHALL expose the behaviour the probes use (`usage_headless_capture_usage_file` and
    `usage_headless_agy_rewrite_json_response`) by loading
    `scripts/lib/usage-capture/adapters/headless-envelope.js`, `record.js` and `sink.js` (the
    adapter and sink of spec 0243, which left `usage-headless.sh` itself unmigrated: its
    out-of-scope list names it for this row), with the same never-fail-the-wrapped-run
    contract, and
    SHALL replace the `source` of `scripts/lib/usage-headless.sh` in the three probes. Parent
    requirement 8 retires a shell library with its last consumer; at authoring time
    `scripts/lib/usage-headless.sh` has, besides the three probes, the consumer
    `scripts/tests/test-usage-capture.sh` (row J1a), and `scripts/lib/extension-hooks.sh` has
    no consumer in this row and four outside it (`scripts/lib/extension-manifest.sh`,
    `scripts/check-extension-hook-map.sh`, `scripts/check-extension-hook-tokens.sh` of row I1,
    and the sandbox-mutating suites of rows J1a and J2). This row SHALL delete each of the two
    files in its last pull request when `git grep` finds no `source` of it and no
    sandbox-mutating suite that reads its text; when a consumer of another row remains, this
    row SHALL leave the file, its allowlist line and its path filters untouched and SHALL
    record the retirement as ledgered for the row that removes the last consumer (J4 at the
    latest), with the consumers named, in the logbook of #1342.

18. **Callers.** Every `Taskfile.yml` task, workflow step, documentation page and runbook
    that names an old invocation SHALL be updated in the pull request that migrates the
    script (parent requirement 9), except the `Taskfile.yml` entries and path filters that an
    unchanged Bash suite still reads, which keep naming the shim until the suite migrates and
    are then rewritten to `node <path>.ts` in that same pull request. A path filter of another
    row's job that names a J3 file (`scripts/probe-extension-mcp-token.sh`,
    `scripts/lib/extension-hooks.sh`, `scripts/lib/usage-headless.sh`) SHALL keep working: the
    shim keeps the path, and the `.ts` path is added as this row's own line.

19. **Bash suites.** The twenty-six suites — the twenty-five `scripts/tests/test-e2e-*.sh` and
    `scripts/tests/test-antigravity-discovery-probe.sh` — SHALL each migrate to a TypeScript
    suite `scripts/tests/e2e-<topic>.test.ts` (a file over 300 lines is split), in the pull
    requests of item (7) of requirement 25, which follow the switch pull request, only after the TypeScript harness has
    shipped green on Linux CI and on its `windows-latest` job (parent requirement 13). A
    migrated suite SHALL keep every assertion that is not a requirement-14 assertion, SHALL
    run on Windows when it needs no Docker and no POSIX-only facility, and SHALL be wired
    into the CI jobs of the old suite by the same lines.

20. **Latency.** None of the entries of requirement 1 is wired as a hook, a statusline or any
    other CLI integration point, so parent requirement 15 sets no latency budget for this row;
    the `windows-latest` job SHALL still fail when an entry exceeds a generous bound that the
    PLAN states, so that a module graph that grows by accident is caught.

### Platforms, parity and real runs

21. **Windows proof.** One `windows-latest` job, `windows-e2e-harness`, SHALL run, from
    PowerShell, the entries that need no container: `run.ts --dry-run` (the TAP plan, the
    `effective.json` bytes and the report directory), `toml_merge.ts`, `report.ts`,
    `publish-probe-verdict.ts --dry-run`, the auth scripts and `e2e-capture-versions.ts` up to
    the diagnostic they print when `docker` is absent (and with a stand-in `docker.cmd` for the
    image-missing path), the three probes against stand-in CLIs, and the pure libraries. The
    job SHALL resolve interpreters from the parent `PATH` before narrowing the child `PATH`,
    SHALL scan for carriage returns only in the landing zones the entries write (never
    `AppData`), SHALL aggregate failures with the command, standard output and standard error,
    SHALL keep each test file under 300 lines, SHALL note that `System32\bash.exe` is on every
    runner's `PATH` and SHALL NOT depend on it, SHALL use `GIT_CONFIG_NOSYSTEM=1` rather than
    `GIT_CONFIG_SYSTEM=<os.devNull>`, and SHALL write the paths it wires with forward slashes.
    The scenarios that drive Docker run on POSIX only: the Windows runner cannot run Linux
    containers, so the cell (Windows × scenario with a Linux container) SHALL be recorded as a
    parity gap with that evidence in `docs/cli-matrix.md` (parent requirement 19).

22. **Real-CLI runs.** The harness drives the real Claude Code, Gemini CLI and Copilot CLI
    (scenarios) and the four CLIs (probes, Antigravity included) and may need credentials or
    paid calls. No test, no CI job and no agent of this row SHALL run a scenario or a probe
    against a real account or spend credit; the proofs of this spec are the recording and the
    differential of requirements 5 to 11, the Windows job, and the Bash suites that already
    run in the `e2e` job. The behaviour against a real CLI SHALL be proven by one manual run by
    the owner of the test accounts, on their machine, after the switch pull request: `task
    e2e:test` on the commit before the switch and on the merge commit of the switch, comparing
    per (scenario, CLI) pair ok, not ok and skip (a model's answer varies, so a flip is
    investigated, not automatically a failure). That run is not a merge gate. Its status
    (not requested, requested, done with its table) SHALL be recorded in the logbook of #1342
    and in the row of `docs/cli-matrix.md`, and the cells it has not covered SHALL be named as
    unmeasured, not claimed.

23. **Multi-CLI parity.** The cells the harness covers SHALL NOT change: the three CLIs of
    `defaults.toml` for the scenarios (scenario `05` Copilot only, `06` and `07` Copilot and
    Claude Code, `02` Claude Code and Gemini CLI) and the four CLIs of the probes. No CLI SHALL
    gain or lose a scenario by this migration. The rows 21, 31 and 32 of `docs/cli-matrix.md`
    SHALL name the new files in the pull request that switches them, and the row for the
    Windows cell (requirement 21) and the row for the real-run status (requirement 22) SHALL
    be added there, in the same diff, per `docs/cli-matrix-maintenance.md`.

### Deviations

24. **Closed list of deviations.** The only differences from the shell that this row
    introduces are: (a) the runner no longer reports a missing `jq` or `yq` and no longer
    requires Bash 4: the diagnostic lines `jq is required` and `yq is required` disappear and
    no prerequisite of those tools exists; (b) `toml_merge` refuses a TOML construct outside the
    subset of requirement 6 with the diagnostic of that requirement where `yq` accepted it;
    (c) the random four-hex suffix of a run identifier is drawn with `node:crypto`, in the
    same format; (d) `mask_command` and the `invocation.txt` writer quote with the rules of
    requirement 7's normaliser, which the recording pins, instead of Bash `%q`, when and only
    when the PLAN shows a command line that Bash `%q` quotes in a way no JSON consumer can tell
    apart; (e) the judge drivers reach their endpoints with `fetch`, so a proxy variable that
    `curl` honoured is honoured only as Node.js honours it; (f) on a machine with no
    `docker`, `e2e-capture-versions` and the auth scripts print the same diagnostic and exit
    with the same status, never a Node.js stack trace; (g) the assertions of requirement 14
    are removed. Any other difference found in the differential of requirement 10 is a defect
    of this row unless a delta-spec of this spec lists it.

### Delivery

25. **Pull requests.** The row SHALL be delivered in pull requests that target
    `release/1231-ts-migration`, in this order, each green on Linux and on the Windows jobs
    before the next opens (the PLAN fixes the cut): (1) the recording and the stand-in
    (requirements 5, 7, 8, 9); (2) the black-box tests of the two untested probes
    (requirement 11) and the retargeting of the static reads (requirement 15), each against
    the shell; (3) the dark TypeScript libraries, with their differential suites; (4) the dark
    TypeScript auth scripts, publisher, capture script, runner and scenarios; (5) the dark
    TypeScript probes and `usage-headless.ts`; (6) the switch (shims, callers, allowlist,
    documentation, `docs/cli-matrix.md`, the Windows job); (7) the Bash suites to TypeScript,
    in as many pull requests as the PLAN needs, the last of which retires the files of
    requirement 17 where it can, flips this spec to `status: implemented` and carries the
    `feat/`, `fix/`, `refactor/`, `perf/` or `chore/` branch prefix that the spec linter reads
    as the implementation-complete pull request. Every other implementation branch SHALL be
    named `test/1342-<slug>`. The pull requests of this row SHALL NOT change
    `package-lock.json`: a need for a dependency SHALL be escalated to the coordinator first
    (decision D2 avoids it). Each pull request SHALL pass the ratchet, `lint-typescript`, the
    repository-wide guards (`check-no-machine-paths`, the Bash 3.2 and `pipefail` guards, the
    version-range guard, the skill-version check) and the Windows jobs.

26. **Proofs touch no external state.** A proof of this row SHALL stub `gh`, stub the service
    directory through `CREWRIG_TEST_SERVICE_BIN_DIR`, use a scratch `HOME`, and SHALL NOT create
    a real label, issue, scheduled job or CLI configuration. After any proof that runs an
    installer, a scaffolder or an auth script, the real `~/.gemini/extensions`, `~/.claude`,
    `~/.copilot` and `~/.crewrig-e2e` SHALL be checked for leaked files.

### Decision record

**Decision D1 — `docker` is not a POSIX-only utility.** *Adopted:* requirement 4: the harness
spawns `docker`, whose whole purpose it is, by argument array. *Rejected:* (i) a delta of
parent requirement 23 naming `docker`, held back for the reason of spec 0258 D2 (a reviewer who
reads the requirement as a closed list can obtain one, and it SHOULD name the class — a
cross-platform tool the user installs, run by argument array with no shell — rather than the
tool); (ii) a Docker client library, which adds a dependency and a lockfile change for a
dozen commands.

**Decision D2 — an in-tree TOML subset reader, not a dependency.** *Adopted:* requirement 6,
after an independent architect cross-check reached the same recommendation from the two
committed files. *Rejected:* (i) a TOML library, which changes `package-lock.json` (frozen for
the wave, and it breaks the setup goldens until #1614) and moves a runtime dependency for a
test harness; (ii) a vendored copy, which adds provenance and licence handling and a file the
ratchet counts; (iii) spawning `yq`, which parent requirement 23 forbids; (iv) converting the
files to JSON or YAML, which breaks ADR 0003 and the documented `local.toml`. The cost is that
a `local.toml` that uses an exotic construct is refused, loudly and with a line number.

**Decision D3 — the oracle is a stand-in `docker` plus recordings, not recorded real runs.**
*Adopted:* requirements 5, 7, 8 and 9, after the same cross-check: there is no stub of
`docker` today, the scenarios are never run in CI, and a recording of real runs needs
credentials and spend. *Rejected:* (i) recording real runs, forbidden by requirement 22;
(ii) `--dry-run` alone, which skips every scenario and proves nothing of the control flow;
(iii) a tracked shell stand-in, which adds a file to the ratchet; (iv) claiming all sixteen
pairs, which a canned output cannot support for the three probe scenarios (requirement 8).
The stand-in proves orchestration, not model behaviour, and its fixtures are fixed from the
shell run so that they cannot flatter the TypeScript.

**Decision D4 — shims for what is executed, deletion for what is only sourced.**
*Adopted:* requirement 16, as spec 0258 D3 did. *Rejected:* a shim for every file, which keeps
a shell file on the allowlist for no oracle; deletion of every file, which breaks the unchanged
Bash suites that spawn the executables.

**Decision D5 — the two shell libraries are retired when their last consumer goes, not before.**
*Adopted:* requirement 17. *Rejected:* retiring them here by editing the consumers of rows I1,
J1a and J2, which the wave forbids, or by leaving a copy of their text in a J3 fixture.

## Scenarios

**Scenario:** The dry run gives the same plan on every platform

Given a checkout with no `local.toml`, no credentials and no `docker`
When `node tests/e2e/run.ts --dry-run --report-dir <dir>` runs from PowerShell on Windows
and from Bash on Linux
Then both write the same `effective.json` bytes as the shell's `merge`, print a TAP plan of
sixteen `skip` lines in `<cli>/<scenario>` order and exit 0.

**Scenario:** A local override merges as before

Given a `local.toml` that appends a mount and an `env_keys` entry already present, and
replaces `command` for one CLI
When `toml_merge.ts defaults.toml local.toml` runs
Then the output is byte-identical to the shell's recording: the mount appended, the
`env_keys` de-duplicated first-seen and `command` replaced.

**Scenario:** An unsupported TOML construct is refused

Given a `local.toml` that holds an inline table
When `toml_merge.ts` reads it
Then it exits non-zero, prints one line naming the file, the line and `inline table`, and
prints nothing on standard output.

**Scenario:** A scenario returns the recorded verdict for each CLI

Given the stand-in `docker`, dummy credentials, `E2E_JUDGE_MOCK=1` and a scratch `HOME`
When scenario `01-layered-context` runs for Claude Code, Gemini CLI and Copilot CLI through
`run.ts`
Then each case's exit status, `scenario.tap` and normalised Docker command lines equal the
recorded shell tuple.

**Scenario:** A wrong answer fails the case as before

Given the negative fixture of scenario `01` whose canned answer does not match
`expected.regex`
When the case runs
Then it emits `not ok`, exits non-zero and writes the same `# FAIL` diagnostic block as the
shell.

**Scenario:** A missing credential skips the case

Given no token and no marker file for Gemini CLI
When the runner reaches the Gemini CLI cases
Then it emits `skip` with the reason `unconfigured`, exit status `78` maps to `skip`, and no
container is started.

**Scenario:** The publisher renders a verdict without posting

Given a probe A `verdict.json` and a probe B `verdict.json`
When `publish-probe-verdict.ts <dir> --issue 1103 --dry-run` runs with no `gh`
Then it prints the same Markdown comment as the shell and exits 0.

**Scenario:** An auth script reports a missing image

Given a stand-in `docker` that reports no image `crewrig/e2e-claude:latest`
When `auth-claude.ts` runs
Then it exits 1 and prints the `task e2e:build:claude` hint, writes nothing under the bundle
and never asks `docker run`.

**Scenario:** The judge reaches a stand-in endpoint

Given a local HTTP server that answers like the Anthropic endpoint and a backend that names it
When the judge runs with `max_calls` of 1 and then a second time
Then the first call returns the canned `VERDICT` and the second returns `UNCERTAIN` for the
exceeded cap, and `judge.count` holds `1`.

**Scenario:** A probe verdict is unchanged

Given a stand-in `agy` in a scratch `PATH` that lists the sentinel in the open listing
When `node scripts/probe-antigravity-discovery.ts` runs with `AGY_PROBE_TIMEOUT=1` and a
scratch `HOME`
Then the verdict table equals the shell's, nothing remains installed under the scratch root
and the exit status is the shell's.

**Scenario:** A probe with no CLI installed degrades as before

Given a `PATH` with no `claude`, `gemini`, `copilot` or `agy`
When `probe-extension-hooks.ts` runs
Then it prints the same missing-binary lines as the shell and exits with the shell's status.

**Scenario:** The Bash oracles pass through the shims

Given the shims installed
When the unchanged `test-e2e-runner`, `test-e2e-report`, `test-e2e-toml-merge`,
`test-e2e-probes` and `test-antigravity-discovery-probe` run on Linux
Then every assertion passes.

**Scenario:** A retired library still has a consumer

Given `scripts/tests/test-usage-capture.sh` still sources `scripts/lib/usage-headless.sh`
When the last pull request of this row runs `git grep` for its `source`
Then the file is left in place, its retirement is ledgered with the consumer named, and the
allowlist line is untouched.

## Out of scope

- The Bash suites of other rows, including `test-usage-capture.sh`, the extension-hook suites
  and `scripts/lib/common.sh` with its last consumers (rows J1a, J1b, J2 and J4, #1340,
  #1341, #1343, #1344), and the final removal of the shims (row J4).
- The repository-wide governance checks (row I1, #1338) and the files they read:
  `scripts/lib/en_us_sweep.py`, `scripts/sweep-en-us.sh`, `scripts/lib/extension-manifest.sh`,
  `scripts/check-extension-hook-map.sh`, `scripts/check-extension-hook-tokens.sh`.
- Running any scenario or probe against a real account, and the manual owner run beyond what
  requirement 22 records; adding a scenario or an Antigravity scenario to the harness.
- Scheduling the harness in CI (the README's deliberate follow-up), and changing what any
  scenario asserts, the nine pillar scenarios' prompts, the judge backends, the images under
  `docker/e2e/`, `docker/e2e/.versions.lock` or the committed evidence under
  `tests/e2e/reports/`.
- The lockfile and the setup goldens (#1614), the Windows timing-budget flake (#1509, #1545),
  #1599, #1601, J1b #1341, I2 #1339, J2 #1343 and the final shim removal of J4 #1344.
- The historical ADRs (0001 to 0009), the research notes and the earlier specs that name the
  `.sh` paths: they record decisions and are not rewritten.

## Open questions

- Whether the owner of the test accounts runs the manual comparison of requirement 22, and
  when: requested through the coordinator after the switch pull request; it is not a merge
  gate and its absence leaves the cells named unmeasured.
- The cut of the pull requests of requirement 25 (items 3 to 5 may merge or split depending on
  the size of each differential suite), and the per-suite table of assertions and substitute
  tests of requirement 13, to be fixed in the PLAN.
- The complete list of static reads of requirement 15, with the before and after of each, and
  the number of Bash-suite pull requests of requirement 25 (7), to be fixed in the PLAN.
- Whether the release gate wants a delta of parent requirement 23 that names the class of
  cross-platform, user-installed tools (decision D1), or accepts the reading of spec 0258 D2.
