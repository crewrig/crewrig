---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.0.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Sub-spec I2 of the `large`-tier ticket #1231, row I2 of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>). Parent
spec: `specs/0215-shell-to-typescript-migration.md` (requirements 12, 13, 14, 16
(Python) and 17, row I2), under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27-38): this
spec-PR and its implementation pull requests target `release/1231-ts-migration`,
"shipped" means merged there, and the base ref wherever a protocol names `main` is
`origin/release/1231-ts-migration` (requirement 34). Requirement 23 of the parent
applies as narrowed by `specs/0215-shell-to-typescript-migration.delta-05.md`. Depends
on row I1 (`specs/0259-governance-checks-typescript.md`: `scripts/lib/governance/**`,
including `base-ref.ts`, and its differential and Windows proof, whose shape this row
reuses) and on the model and component resolvers already shipped as TypeScript
(`scripts/lib/model-resolve.ts`, `scripts/lib/model-resolve/**`,
`scripts/lib/component-resolve.ts`).*

## Intent

A maintainer, a contributor and a CI runner invoke the model-mapping and agent-profile
checks, the CI parity check and generator, the spec-id tools, the cache guard, the
changeset-coverage runner, the spec-PR merge helper and the en-US sweep exactly as
today and get the same output, the same diagnostics on the same streams and the same
exit status on the same input, on Linux, macOS and Windows without a POSIX layer. None
of them needs `yq`, `jq`, `awk`, `sed`, `grep`, `sort`, `mktemp`, `sha256sum` or Python
on the machine. The generated `.gitlab-ci.yml` and workflow fragments stay byte for byte
what the shell generator emits today. The three resolver shell libraries
(`model-resolve.sh`, `component-resolve.sh`, `base-ref-resolve.sh`) and the Python
sweep engine no longer exist.

<!-- markdownlint-disable MD029 -->

## Requirements

### Scope and entry points

1. **Entry points.** Ten TypeScript entries SHALL replace the behaviour of
   `scripts/{check-model-mappings,check-agent-profiles,check-ci-parity,
   check-spec-id-reserved,build-ci,ci-cache-guard,ci-changeset-coverage,
   reserve-spec-id,merge-spec-pr,sweep-en-us}.sh`, each at the path of its predecessor
   with `.sh` changed to `.ts`. `scripts/lib/en_us_sweep.py` SHALL be replaced by
   TypeScript and deleted (parent requirement 16). The Python files that import
   `mempalace` are outside this row and SHALL NOT change; every other file outside this
   list SHALL NOT change in behaviour.

2. **Entry form.** Each entry SHALL be runnable as a direct
   `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/<name>.ts` command line,
   SHALL follow the conventions of parent requirement 2 and of the entries of spec 0259
   (a thin entry, one clearly named helper module per concern under `scripts/lib/`,
   `process.exitCode` instead of `process.exit` after output), and SHALL keep every file
   under 300 lines (spec 0238). The two largest scripts (`check-ci-parity`,
   `check-model-mappings`) SHALL therefore be split into pass or concern modules.

3. **Observable contract.** Each entry SHALL preserve the observable contract of the
   script it replaces (parent requirement 14): arguments, environment variables read
   (`CREWRIG_REPO_DIR`, `BASE_REF`, `CREWRIG_SPEC_ID_*`, `REPO_DIR`, `TMPDIR`, `PYTHON`
   where it is read today), files read and written, exit codes, standard output and
   standard error, byte for byte, with the shell run under `LC_ALL=C`, except for the
   deviations of requirement 24, a closed list. Ordering follows byte order, never a
   locale (`localeCompare` is forbidden).

4. **No new spawned tool.** No entry SHALL spawn `jq`, `yq`, `awk`, `sed`, `grep`,
   `find`, `sort`, `mktemp`, `sha256sum`, `shasum`, `diff`, `wc`, `basename`, `dirname`,
   `head`, `tr`, `python3` or `sh` (parent requirement 23). JSON SHALL be read with the
   Node.js standard library, YAML and front matter with `js-yaml` or the reader of
   `scripts/lib/build-components/`, digests with `node:crypto`. The tools an entry MAY
   spawn are exactly: Git; `gh` (only `merge-spec-pr`, as a pass-through); the current
   Node.js interpreter (`process.execPath`); `aspell` for `sweep-en-us --aspell`
   (optional, as today); the commands that `ci-cache-guard` and `ci-changeset-coverage`
   exist to run, through the shell they use today (`bash -c`, including the
   `ci-cache-guard` probe), the one permitted shell spawn; on Windows these two entries
   use the `bash` resolved from the parent `PATH`, and a Windows case that needs
   that shell and finds none is labelled POSIX-only.

5. **Shared modules.** The entries SHALL reuse `scripts/lib/model-resolve.ts`,
   `scripts/lib/model-resolve/**`, `scripts/lib/component-resolve.ts` and
   `scripts/lib/governance/{base-ref,git-run,carrier,report,walk}.ts` instead of
   re-implementing them. A YAML reader that reproduces the `yq` accessors the scripts
   use (the `// ""` default, absent versus null versus empty, scalar rendering of
   numbers, booleans and null, `keys` in document order) SHALL live in one module under
   `scripts/lib/` and be shared by the checks and the generator. This module is the one
   new shared module of the row.

### The model and agent-profile checks

6. **`check-model-mappings`.** The entry SHALL run the same three passes per target (the
   core file, the org file, the mapping in force with the `(mapping in force)` label),
   in conform mode and in `--print-selection` mode, and SHALL emit the same rejections,
   in the same order, with the same `FAILED:` lines. `--print-selection` output SHALL be
   byte-identical: its consumers are `scripts/tests/test-model-resolution.sh` (cases C3
   and M4) and the conform-mode case C7. A port MAY parse each file once; it SHALL still
   check the mapping in force when the org channel is substantive.

7. **`check-agent-profiles`.** The entry SHALL check the `metadata.model` capability
   profile of every agent source as the shell does, reusing `model-resolve/profile.ts`
   and `model-resolve/narrowing.ts`.

### The CI tooling

8. **`build-ci`.** The entry SHALL generate `.gitlab-ci.yml` from `ci/ci-capabilities.yml`
   and SHALL support `--check` (the drift gate that `check-ci-parity` composes) with the
   same output, exit statuses and diagnostics as the shell. The generated file SHALL be
   byte-identical to the one the shell produces from the same reference, including key
   order, quoting and block scalars, and the entry SHALL need neither `yq`, `jq` nor
   Python. The invocation text it emits for other tools (including
   `bash scripts/ci-cache-guard.sh`) SHALL NOT change in this row.

9. **`check-ci-parity`.** The entry SHALL perform the same checks (reference validity,
   traceability, the reference-to-GitHub-Actions arm, the reference-to-GitLab arm
   through the `build-ci` entry's `--check`, path filters) and print the same findings.
   It SHALL be split so that no module exceeds 300 lines, and SHALL ship in at most
   three pull requests that each leave the shim contract intact (requirement 30).

10. **`ci-cache-guard`.** The entry SHALL derive the same content-addressed key (key files
    and key environment variables), write the same marker, print the same log lines in
    both the wrapper mode and the `--stray-scan` mode, reject the same mutually exclusive
    option combinations, and pass the wrapped command's exit status through.

11. **`ci-changeset-coverage`.** The entry SHALL run every command of every
    `changeset-gated: true` capability in reference order, continue after a failure,
    run the stray scan, and exit 0, 1 or 2 as the shell does.

### The spec-workflow tools

12. **`reserve-spec-id`.** The entry SHALL compute the allocated set, create the
    reservation ref with the same create-only compare-and-swap push
    (`--force-with-lease=<ref>:`), honour `--issue`, `--id`, `--corpus` and `--offline`
    and the `CREWRIG_SPEC_ID_*` variables, and print the id on standard output exactly as
    the shell does. Every proof SHALL use a scratch bare remote and never push to,
    delete, or read a reservation ref of the real remote.

13. **`check-spec-id-reserved`.** The entry SHALL apply the same backstop (every added
    or renamed non-delta spec outside `specs/org/` has a matching reservation), the same
    CI environment detection and the same wiring-fault exit statuses, resolving the base
    through `scripts/lib/governance/base-ref.ts`.

14. **`merge-spec-pr`.** The entry SHALL refuse a `status: draft` spec on a `spec/*`
    branch with the same message and status and otherwise delegate to
    `gh pr merge --squash` with every argument. Every proof SHALL use a stub `gh`.

15. **`sweep-en-us`.** The entry and the TypeScript replacement of `en_us_sweep.py` SHALL
    reproduce `--apply`, `--check`, `--scope-test`, `--list` and `--aspell` over the
    unchanged data files `scripts/lib/en-gb-us-map.txt` and
    `scripts/lib/en-gb-detect.txt`. The masking rules (code, links, front matter,
    structure) SHALL give the same text as the Python engine; differences between the
    `re` module and the JavaScript regular-expression flavour (word boundaries, Unicode
    classes, case folding) SHALL be settled by the differential proof of requirement 26.
    The row SHALL add a test for the script, which has none today.

### Switch, retirement and wiring

16. **Forwarding shims.** In the switch pull request each of the ten `.sh` files SHALL
    become a forwarding shim of the shape of `scripts/check-agents-size.sh` (the Node.js
    floor guard, then the TypeScript entry with every argument and its standard input,
    status passed through, fail closed when `node` is absent). The shims remain in
    `ci/shell-allowlist.txt` until row J4, are added to the shim contract test of spec
    0259, and the Bash suites `scripts/tests/test-check-*.sh`, `test-build-ci.sh` and
    `test-reserve-spec-id.sh` SHALL run through them with their assertions unchanged
    (parent requirement 13). `scripts/lib/en_us_sweep.py` SHALL be deleted.

17. **Retirement of the three libraries.** `scripts/lib/model-resolve.sh`,
    `scripts/lib/component-resolve.sh` and `scripts/lib/base-ref-resolve.sh` SHALL be
    deleted only in a pull request after which no shell consumer of any of them remains.
    Their consumers are:
    - `check-model-mappings` and `check-spec-id-reserved` (TypeScript after the switch);
    - `scripts/tests/test-model-resolution.sh` and
      `scripts/tests/test-component-tier-resolution.sh`, which source the libraries in
      process, and the `resolve_remote_ref` group of
      `scripts/tests/test-check-test-strays.sh`. Under the sourced-library exception of
      parent requirement 13 they are retired (the third only loses that group) in the
      same pull request as the library they source, with every case group each asserts
      mapped, in the plan, to an unchanged black-box test of a consumer script or to a
      TypeScript test of `scripts/lib/model-resolve/**`, `component-resolve.ts` or
      `governance/base-ref.ts`; a mutation case of a retired suite SHALL gain a mutation
      case of its TypeScript substitute;
    - `scripts/tests/lib/shell-resolve-harness.ts`,
      `scripts/tests/lib/component-twins-harness.ts`,
      `scripts/tests/model-resolve-ladders.test.ts`,
      `scripts/tests/component-resolve.test.ts`,
      `scripts/tests/build-components-conformance-render.test.ts` and the conformance
      tests that use them, whose shell legs SHALL be replaced by golden expectations
      generated from the shell before the library is deleted (the rule of substitute
      and mutation case applies to the two that source `component-resolve.sh` in
      process);
    - `scripts/tests/test-check-model-mappings.sh`, whose `setup_pass3_root` copies
      `model-resolve.sh` into each hermetic root for the shell checker to source. That
      copy is setup, not an assertion: a pull request before the switch SHALL retarget
      it (the hermetic root no longer needs the library once the entry imports its own
      modules from the checkout), assertions unchanged, consistently with
      requirement 26.
    The wiring that names the libraries (path filters in `ci/ci-capabilities.yml` and the
    generated files, `.crewrig/core-paths.txt`, `ci/shell-allowlist.txt`,
    `scripts/tests/fixtures/build-components/old-invocation-allowlist.txt`) SHALL be
    updated in the same pull request.

18. **Callers and static reads.** Every caller SHALL be retargeted to the TypeScript entry
    command line of requirement 2, or left on the shim, as follows. The capabilities in
    `ci/ci-capabilities.yml` and the `Taskfile.yml` entries retarget to the entry where
    the job needs no shell; the generated files are regenerated from a fresh base with
    `bash scripts/build-ci.sh`, never merged by hand. The invocations of
    `ci-cache-guard` that the generator emits stay on the shim (the generated text is
    part of the byte-identity contract of requirement 8; row J4 removes the shim). The
    skill, agent and doc bodies that name the scripts stay valid through the shims and
    are touched only where the plan lists them (with the version bump of any skill
    source, and the rendered copies regenerated by `node scripts/build-components.ts`).
    Every Bash suite or TypeScript test that greps or mutates the TEXT of a migrated
    script (`check-stray-scan-wiring.ts` and its test, `test-build-ci.sh`,
    `test-check-ci-parity.sh`, `ci-cache-guard-scan.test.ts`,
    `ci-changeset-coverage.test.ts`, `setup-bash-triggers.test.ts`, and any further
    suite the plan lists) SHALL be retargeted, assertions unchanged, in a pull request
    before the switch so that its mutation reaches the TypeScript twin as well.
    `jq`, `yq` and `python@3.12` SHALL be removed from a job only when neither the entry
    nor any unchanged Bash suite the job runs still needs the tool (the suites build
    fixtures with `yq` until row J2).

19. **`yq` and `jq` pin of the GitLab generator (decision of this spec).** The generator
    SHALL pin both tools in `tool_install_lines` of `scripts/build-ci.sh`, in the first
    pull request of the row so that the `skill-scripts-ts` oracle of row H runs against
    the versions its goldens were made with:
    - `yq`: Go `mikefarah/yq` `v4.44.3`, downloaded from the versioned release URL and
      verified with `sha256sum -c` against the published checksum of the `linux_amd64`
      asset (the value already used by the pinned steps of `.github/workflows/build.yml`);
    - `jq`: `1.7.1`, downloaded from the versioned release URL of the `jq-linux-amd64`
      asset and verified against the checksum published with that release, because the
      distribution package is `1.6` on Debian-based images;
    - the pinned `.github/workflows` steps that install `yq` from `latest` follow the
      same pin, and `.gitlab-ci.yml` is regenerated. The decision and the rejected
      alternative (keeping `latest` and `apt`, which let the oracle drift with the
      upstream release) are recorded on #1339.

20. **No `build-ci` text drift.** Apart from requirement 19, the pull requests of the row
    SHALL leave `.gitlab-ci.yml` unchanged except for lines that follow from a
    capability edit that the pull request itself makes.

### Proof

21. **Differential proof before the switch.** Before any switch, a test SHALL run each
    shell script under `LC_ALL=C` and its TypeScript entry on the same input and require
    equal standard output, standard error and exit status: on the real repository, on
    every fixture of the script's Bash suite, and (for `build-ci`) on the whole
    capability reference and on mutated references. The fixture comparison SHALL run the
    UNCHANGED Bash suite in a sandbox in which the script is replaced by a wrapper that
    runs both implementations, fails on any difference and returns the shell's result;
    the sandbox SHALL copy only what Git tracks (never untracked `node_modules` or
    `dist`), SHALL provide `.git`, the root `package.json` and real copies of `js-yaml`
    and `argparse`, SHALL delete `CI` and `NODE_TEST_CONTEXT` from the child
    environment, and SHALL carry a self-comparison guard and a positive control that
    must report a difference. Because the Bash suites assert exit code and a diagnostic
    substring only, the byte comparison is the proof. The comparison SHALL run in an
    Ubuntu 24.04 container before each pull request opens, and any golden fixture SHALL
    be generated there and regenerated in a second image with Node.js under a
    runner-like path, `diff -r` empty.

22. **Forge and ref safety.** The proofs of `reserve-spec-id`, `check-spec-id-reserved`
    and `merge-spec-pr` SHALL use a stub `gh`, a scratch bare remote and a scratch
    `HOME`, and SHALL NOT push, delete or reserve any real `refs/spec-ids/*` ref. A
    guard in the test harness SHALL fail the test if the remote URL is not under the
    scratch directory.

23. **`windows-latest` job.** Every migrated entry SHALL ship, in the pull request that
    adds it, a case of a `windows-latest` job that runs the entry from PowerShell against
    the real repository or a fixture and asserts verdict, diagnostic and exit status,
    with interpreters resolved from the parent `PATH`, `GIT_CONFIG_NOSYSTEM=1`, and each
    test file under 300 lines. A case needing a POSIX shell or symlink privilege SHALL
    be labelled POSIX-only. The job SHALL pass before the pull request merges (parent
    requirement 17).

24. **Deviations (closed list).** (a) Ordering follows requirement 3. (b) On Windows,
    printed paths use forward slashes. (c) Where the shell fails through its own runtime
    and not through a message of the script (an unreadable input, a Bash arithmetic or
    `[` diagnostic that carries a script path and line number, a `yq` abort such as
    `Error: cannot index array with 'item'`), the entry SHALL print one
    `Error: <path>: <reason>` line on standard error and exit 1; such inputs are
    excluded from the byte comparison and compared on exit status only. (d)
    `check-model-mappings` SHALL reject multi-document YAML input deliberately with a
    stable `Error:` line and exit 1 (the shell rejects it with unstable text). (e) An
    offering id that starts with `-` is treated literally by `check-model-mappings`
    (the shell makes `grep -qxF` print its usage text and accepts the id with exit 0):
    the entry accepts the id and prints no usage text. No other deviation is permitted.

25. **Ratchet and quality gates.** Every tracked file counts for the ratchet, fixtures
    included (stored with a `.golden` suffix and no leading `#!`). All new TypeScript
    SHALL pass the repository's type-check, erasable-syntax, Oxlint and Oxfmt steps and
    the 300-line limit.

26. **Oracle suites.** The Bash suites `scripts/tests/test-check-{model-mappings,
    agent-profiles,ci-parity,spec-id-reserved}.sh`, `test-build-ci.sh` and
    `test-reserve-spec-id.sh` SHALL NOT migrate in this row (row J2, #1343) and SHALL
    pass, unchanged in their assertions, against the TypeScript entries through the
    shims on Linux CI after the switch. A sandbox that mutates the shell implementation
    SHALL also mutate its TypeScript twin.

27. **Pull-request grouping.** The implementation SHALL ship as a bounded number of
    pull requests, each reviewable on its own and each carrying the entries, the
    differential proof and the Windows cases of its scripts; the plan SHALL fix the
    grouping and the merge order. Every pull request but the last SHALL use a branch
    named `test/1339-<slug>`; the last flips the status of this spec and its deltas to
    `implemented`.

28. **No real external state.** No proof SHALL create a label, an issue, a scheduled job
    or a CLI configuration, and every proof that runs an installer or scaffolder SHALL be
    followed by a check that the real HOME directories received no file.

29. **Static-read enumeration.** The plan SHALL list, per migrated file, every static
    read found by a repository-wide search (Bash suites, TypeScript tests, skill and
    agent bodies, hook JSON, `Taskfile.yml`, workflow `run:` lines, allowlists) and the
    pull request that retargets it before the switch.

30. **Shim contract between pull requests.** Until the switch, every `.sh` file of the
    scope SHALL remain the executable the CI runs; the TypeScript entries are dark. The
    switch pull request makes the shims, regenerates the generated CI files, retargets
    the capabilities and deletes the libraries in the order of requirement 17.

## Scenarios

**Scenario:** Same verdict on the repository

Given the repository at the release tip
When  each script runs as the shell under `LC_ALL=C` and as its TypeScript entry
Then  standard output, standard error and exit status are equal for every script.

**Scenario:** Same generated CI

Given the capability reference `ci/ci-capabilities.yml`
When  `build-ci` runs as the shell and as the TypeScript entry
Then  the two `.gitlab-ci.yml` outputs are byte-identical, and `--check` exits with the
      same status on a drifted copy.

**Scenario:** A failing fixture fails the same way

Given a fixture of `test-check-model-mappings.sh` that makes the check reject offering `A9`
When  the unchanged suite runs with the comparison wrapper in place of the script
Then  both implementations print the same `FAILED:` line and exit 1.

**Scenario:** No real reservation

Given a test of `reserve-spec-id`
When  it runs
Then  it pushes only to a scratch bare remote and fails if the remote is not scratch.

**Scenario:** A Windows contributor

Given a `windows-latest` runner with Node.js 24 and no POSIX layer on the `PATH`
When  PowerShell runs `node scripts/check-model-mappings.ts`
Then  it prints the same verdict and exits with the same status as on Linux.

**Scenario:** Retirement blocked by a consumer

Given a shell file that still sources `scripts/lib/model-resolve.sh`
When  the retirement pull request is prepared
Then  the library is not deleted until that consumer is retired or replaced.

## Out of scope

- The migration of any Bash test under `scripts/tests/` (row J2, #1343), except the
  in-process tests that source a retired library (requirement 17).
- `scripts/lib/extension-hooks.sh`, `check-bash32-portability.sh`, `check-pipefail-grep.sh`
  and the final shim removal (row J4, #1344).
- The `mempalace` Python files, `package-lock.json`, and the tickets #1599, #1545, #1601,
  #1611 and #1343.
- Changing the invocation text that the generator emits for the cache guard
  (requirement 8) and the wording of the skill and doc bodies beyond requirement 18.

## Open questions

- None. The decisions that the ticket left open are recorded above: the `yq` and `jq`
  pin (requirement 19, with the rejected alternative), multi-document YAML and `-`
  leading ids in `check-model-mappings` (requirement 24), and the shims that remain
  until row J4 (requirement 16).
