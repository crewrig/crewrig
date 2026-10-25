---
id: "0278"
slug: taskfile-domain-split
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1827
version: 1.1.0
---

# Taskfile domain split

Delta-01 raises the declared Task floor of every Taskfile from `3.39` to `3.54`
(the version CI already pins in `ci/task-pin.json`, spec 0282), then factorizes
`taskfiles/ci.yml` (809 lines, 99 tasks, the largest file of the tree by far)
and splits it into a `taskfiles/ci/` sub-tree of flattened group files, without
renaming any task. Every `ci:<id>` name stays stable, so the 95 `task ci:<id>`
capabilities of `ci/ci-capabilities.yml` and the spec 0283 contract are
untouched. The delta is a delta of spec 0278 and not a new spec: it amends R4
(reserved CI file), R8 (floor) and R13 (a) and (d) of the base spec, reuses its
loader (R10) and guard (R13), and a delta reuses its parent's id by
construction, so no spec id is reserved. It also settles, for spec 0279, that
the colon-anchoring rule (0279 R2, R20) and the parity guard apply to the whole
`ci` Taskfile sub-tree and not to one file name; 0279 needs no delta of its own
because the one-file rule of the spec-PR workflow allows one file here and the
amendment is a consequence of the layout this delta introduces (see *Open
questions*). The stage taxonomy is shared with the companion ticket #1828
(GitHub Actions grouping).

## ADDED

### Requirements

**R21 (floor 3.54 in the files).** Every Taskfile of the tree (the root
`Taskfile.yml`, every `taskfiles/*.yml`, and every new `taskfiles/ci/*.yml`)
SHALL declare `version: '3.54'`, replacing `'3.39'`. The prerequisite lands
first, as its own commit, before the factorization and the split, so the
split is designed and verified against the one Task version CI runs. The
uniform-version check of the guard (base R13 (d)) and the exported constant
it compares against (`TASKFILE_VERSION` in
`scripts/lib/governance/taskfile-tree-guard.ts`) SHALL move to `'3.54'`, and
every committed fixture and test that writes a Taskfile with `version:
'3.39'` (the `scripts/tests/` files that stage `taskfiles/ci.yml` or a root
Taskfile, `scripts/tests/lib/taskfile-tree-guard-fixtures.ts`,
`scripts/tests/fixtures/taskfile-tree/**`, the floor option of
`scripts/tests/check-task-provisioning.test.ts`) SHALL move with it. The
floor SHALL read `3.54` in the README prerequisites row and *Task note*, in
`DEVELOPMENT.md` (the floor, the loud-failure message, the add-a-task rule
and the pre-push requirements), in `docs/pre-push-guard.md`, in the
`.githooks/pre-push` error text, and in `docs/cli-matrix/rows/45.md` (with
`docs/cli-matrix.md` rebuilt in the same diff). Historical specs are left
alone. Acceptance: `git grep -n "3\.39" -- ':!specs' ':!docs/audit'` returns
no hit other than an explicitly historical mention; the guard fails a staged tree whose one
file declares `'3.39'`; `task ci:check-task-provisioning` still passes
(spec 0282: the pin is not below the floor); and a manual check on Task
3.53.x fails loudly with `Schema version (3.54.0) is greater than the
current version of Task`, the exact text recorded in the PR.

**R22 (factorization, no new file, no rename).** Before the split, the
repetition in `taskfiles/ci.yml` SHALL be removed by YAML anchors and file
variables, with no change to any task name, description, alias or
behaviour. (a) The 47 identical `preconditions` blocks calling
`check-tool-binaries.ts js-yaml` with the message `Run: task lint-bootstrap`
SHALL be written once per file as an anchor (suggested `&needs-js-yaml`)
and reused by alias. YAML anchors are file-scoped, so each sub-file of R23
that needs the block defines the anchor once at its first use; no anchor is
shared across files. (b) The repeated prefix `node
--disable-warning=MODULE_TYPELESS_PACKAGE_JSON {{.REPO_DIR}}/scripts/` SHALL
be replaced by a variable (suggested `NODE`) declared once; where the
variable is declared (the `vars:` of each sub-file or of `taskfiles/ci.yml`)
is settled by the PLAN on Task 3.54.0 by the acceptance of R28 (b). (c)
Anchors, aliases and merge keys SHALL be used only in forms that Task
3.54.0 and the loader (js-yaml, `scripts/lib/taskfile-tree.ts`) resolve to
the same task definition. (d) The comments that state a rule (the Windows
proof notes, the spec references) SHALL be kept. The expected line gain is
about 250 lines, an estimate and not a requirement. Acceptance: R28 (b) and
(d); a committed test asserts that no `taskfiles/ci*` file repeats the
`check-tool-binaries.ts js-yaml` precondition literally more than once.

**R23 (split into group files).** The tasks of `taskfiles/ci.yml` SHALL be
redistributed over `taskfiles/ci/gate.yml`, `taskfiles/ci/modules.yml`,
`taskfiles/ci/governance.yml`, `taskfiles/ci/extensions.yml`,
`taskfiles/ci/integration.yml` and `taskfiles/ci/windows.yml`, the stage
taxonomy shared with #1828 (`gate`, `modules`, `governance`, `extensions`,
`integration`, `windows`; the group names are fixed and no other group file
SHALL be added). `taskfiles/ci.yml` SHALL keep the four control tasks
(`pre-push`, `hooks-install`, `hooks-uninstall`, `hooks-status`) and the
`includes` of the six files, each written as `{ taskfile: ./ci/<group>.yml,
flatten: true }`, itself included by the root under the namespace `ci` as
today. Each task SHALL be defined in exactly one file, as follows (a
`*-selftest` twin follows its parent; the sums are 19 + 23 + 9 + 13 + 7 +
24 + 4 = 99):

| File | Tasks (count) |
|---|---|
| `taskfiles/ci.yml` | `pre-push`, `hooks-install`, `hooks-uninstall`, `hooks-status` (4) |
| `taskfiles/ci/gate.yml` | `check-taskfile-tree`, `check-taskfile-tree-selftest`, `check-task-provisioning`, `check-task-provisioning-selftest`, `check-taskfile-commands`, `check-taskfile-commands-selftest`, `lint-specs`, `lint-specs-selftest`, `lint-markdown`, `markdown-links`, `repository-scan`, `lint-typescript`, `lint-typescript-selftest`, `ratchet`, `ratchet-selftest`, `check-agents-size`, `check-rules-size`, `check-comment-size`, `frontmatter` (19) |
| `taskfiles/ci/modules.yml` | `install-ts`, `setup-modules-ts`, `release-driver-modules-ts`, `packaging-modules-ts`, `governance-checks-ts`, `build-components-ts`, `extension-builders-ts`, `skill-scripts-ts`, `model-ci-tooling-ts` (9) |
| `taskfiles/ci/governance.yml` | `host-safety`, `host-safety-selftest`, `path-ownership`, `path-ownership-selftest`, `check-skill-versions`, `check-description-length`, `test-wiring`, `test-wiring-selftest`, `check-seat-brief`, `check-plan-review`, `check-model-mappings`, `check-agent-profiles`, `agent-profile-migration`, `check-metadata-keys`, `check-claude-agent-layout`, `check-ci-parity`, `ci-parity`, `gitlab-ci-check`, `alert-scheduled-failure`, `alert-scheduled-failure-selftest`, `alert-scheduled-failure-check`, `ci-pre-push-replay`, `misc` (23) |
| `taskfiles/ci/extensions.yml` | `component-drift`, `component-drift-selftest`, `docs-index`, `docs-index-selftest`, `cli-matrix-fresh`, `cli-matrix-fresh-selftest`, `extension-provenance`, `extension-manifest`, `extension-render`, `extension-install`, `setup`, `setup-differential`, `core-paths` (13) |
| `taskfiles/ci/integration.yml` | `setup-oracle`, `figure-labels`, `mempalace`, `chroma-mcp`, `e2e`, `worktree-guard`, `mempalace-transcript` (7) |
| `taskfiles/ci/windows.yml` | the 24 `windows-*` tasks, `windows-node-floor-guard` through `windows-setup-entries` (24) |

Classification notes. `host-safety` and `path-ownership` sit in
`governance` as the owner taxonomy lists them, although `host-safety` is a
`lint.yml` neighbour in the domain split; the `*-size` checks and
`frontmatter` are `gate`; `extension-provenance` and `extension-manifest`
are `extensions` because the taxonomy assigns `extension-*` to it;
`alert-scheduled-failure*`, `ci-pre-push-replay` and `misc` have no named
place in the taxonomy and go to `governance` (CI contract tooling); the
taxonomy's `runtime-foundations` and `usage-capture` entries and the
`node-24-0` twins name no task of `ci.yml` today and so place none. A
`windows` file exists because 24 `ci:windows-*` tasks exist. Each file
SHALL stay at or under 200 lines after R22; if `windows.yml` cannot (its
block is 243 lines before factorization and its tasks use no
`check-tool-binaries` precondition), the PLAN MAY add `windows-b.yml` to the
same group and record it in the mapping, the group name staying `windows`.
The control file `taskfiles/ci.yml` SHALL stay at or under 200 lines.
Acceptance: the loader reports, for each of the 99 `ci:*` names, the defining
file named here; a committed size test fails on any file of `taskfiles/ci.yml`
plus `taskfiles/ci/*.yml` above 200 lines; `ci:*` names and descriptions are
identical to the pre-split tree (R28 (d)).

**R24 (unanchored calls resolve inside the namespace).** An unanchored `-
task: x` written in a file flattened under the `ci` namespace SHALL resolve
to `ci:x` on Task 3.54.0, exactly as in the single file today. The
colon-anchoring rule of spec 0279 R2 and R20 (every `- task:` call from a
`ci` task to a task of another file is written `- task: :<name>`) SHALL
apply to every file of the `ci` sub-tree (`taskfiles/ci.yml` and
`taskfiles/ci/*.yml`), because the resolution rule is unchanged. Acceptance:
R28 (a).

**R25 (guard reachability over the sub-tree).** The reachability check of
`scripts/check-taskfile-tree.ts` (base R13 (a), implemented by
`checkUnreachable` in `scripts/lib/governance/taskfile-tree-guard.ts`,
which lists only `taskfiles/*.yml` today) SHALL cover every `*.yml` under
`taskfiles/` recursively, so an orphan `taskfiles/ci/foo.yml` fails the
guard naming that path. The guard docs line and the header comment of
`scripts/check-taskfile-tree.ts` SHALL say `taskfiles/**/*.yml`. The
`.crewrig/core-paths.txt` and `docs/layers.md` entries SHALL be re-checked:
`taskfiles/**` already covers the sub-tree; if the manifest form read by
`scripts/sync-from-upstream.ts` is not recursive, an explicit
`taskfiles/ci/**` entry is added in the same diff. Acceptance: a test on a
`mkdtemp` tree with an unreferenced `taskfiles/ci/foo.yml` fails the guard
naming it.

**R26 (parity guard walks the sub-tree).** `scripts/check-ci-pre-push-parity.ts`
SHALL stop comparing `task.file` to the single constant `CI_FILE =
"taskfiles/ci.yml"` for the colon-anchoring check (0279 R2), and SHALL apply
it to every `ci:` task whose defining file is `taskfiles/ci.yml` or under
`taskfiles/ci/`. The command-normalisation of 0279 R3 SHALL expand the
file variables of R22 (b) (the literal `vars:` of the `ci` files) before
comparing, so a variable never produces a parity finding; where the
variable is defined (R22, settled in the PLAN) does not change this
requirement, only the place the expansion reads from. Acceptance: a
fixture task in a `taskfiles/ci/` file with an unanchored call to a name that
also exists as `ci:<name>` fails the guard, and the anchored form passes;
a task using the variable passes against a capability that spells the
expanded text.

**R27 (every consumer of the single file migrates).** Every script or test
that reads or writes `taskfiles/ci.yml` as if it held the `ci:*` tasks SHALL
resolve tasks through the loader of base R10 (or its file list) instead.
Inventory, from `git grep -n "taskfiles/ci.yml" -- scripts` (the PLAN
re-verifies each entry before editing): (a) code that indexes the file's
`tasks:` map by `ci:<id>`: `scripts/tests/lib/ci-task-commands.ts`
(`ciTaskCommands`, `ciTaskDelegatedCommands`),
`scripts/tests/ci-selftest-split.test.ts`,
`scripts/tests/agent-profile-committed.test.ts`,
`scripts/tests/ci-alert-scheduled-failure.test.ts`, and
`scripts/check-alert-scheduled-failure.ts` (default path and error text);
(b) code that stages a fixture `taskfiles/ci.yml` or lists it as a path:
`scripts/tests/ci-pre-push-env-scrub.test.ts`,
`ci-pre-push-hooks-config.test.ts`, `ci-pre-push-hook.test.ts`,
`ci-pre-push-parity.test.ts`, `ci-pre-push-parity-migrated.test.ts`,
`governance-check-test-wiring-cases.test.ts`, and the `mapping.json`
baseline of `scripts/tests/fixtures/taskfile-tree/` (its `ci:*` entries move
to the defining file of R23); (c) the production reader of the Task CI
contract: `scripts/lib/governance/test-wiring.ts`, which globs
`taskfiles/*.yml` and SHALL glob `taskfiles/**/*.yml`, so that a test wired
only in a moved task is still wired; (d) `scripts/lib/ci-pre-push/hooks.ts`,
whose existence probe for `taskfiles/ci.yml` stays valid because the control
tasks stay in that file, and SHALL be re-verified to resolve any task through
the loader. Acceptance: `git grep -n "taskfiles/ci.yml" -- scripts` returns
only the allow-list of the control-file probe, the staged-fixture writers
that need an included skeleton, and error text naming the control file;
`task ci:test-wiring` passes with a test wired only in a moved task; the
wiring test of the checker proves a test wired only in `taskfiles/ci/gate.yml`
is seen.

**R28 (verification of the tooling assumptions).** The following SHALL be
proved by committed tests on Task 3.54.0, the five checks of the issue:
(a) a fixture tree where a file flattened under `ci` calls `- task: x` runs
`ci:x`, run by the real `task` binary when present and by the loader's
resolver otherwise, with an explicit notice when `task` is absent (never a
silent skip, base R14); (b) YAML anchors, aliases and the variable of R22
are accepted by Task 3.54.0 and read identically by js-yaml: for every `ci`
task the raw definition from the loader equals the definition Task reports
(`task --list-all --json` names plus the resolved `cmds` of `task --dry`),
and two sibling flattened files declaring the same variable name with the
same value load without a conflict (if they do not, the variable is declared
once in `taskfiles/ci.yml`; the PLAN picks the form that Task accepts); (c)
the parity guard of R26 does not report a finding caused by a variable, and
still fails a real command difference; (d) `task --list-all` output on the
split tree is byte-identical to a baseline captured on the pre-split tree
and committed as a fixture (and the sorted `(name, desc)` pairs equal the
baseline of base R6); if Task's display order proves include-dependent, the
PLAN records the observed difference and falls back to the sorted-pair
comparison of base R6 with that justification; (e) mutation proof on a
sub-file: `jq` planted in a task of `taskfiles/ci/gate.yml` (flattened under
a namespace) makes `check-taskfile-commands` fail naming the effective task
`ci:<id>` and the command, so the Windows rule (spec 0266 R13) still sees
every moved task. Every mutation operates only on paths the test created
with `mkdtemp` (host-safety rule, base R15).

**R29 (CI path filters follow the split).** Because `ci/ci-capabilities.yml`
names `taskfiles/ci.yml` in 15 `paths:` entries (and `.gitlab-ci.yml` in
the regenerated occurrence), a change to a `taskfiles/ci/*.yml` file would
otherwise trigger none of those jobs. Every filter that lists
`taskfiles/ci.yml` SHALL also list `taskfiles/ci/**` (the seven entries
already written `taskfiles/**` are covered), with `.gitlab-ci.yml`
regenerated by `scripts/build-ci.ts` and `check-ci-parity` passing.
`docs/ci-shrink-report.md` (the `taskfiles/ci.yml` row, listed by
`scripts/tests/ci-shrink-report.test.ts`) SHALL describe the sub-tree and
its new line counts. This delta does not itself edit
`ci/ci-capabilities.yml` or `.github/workflows/`; the edit is one line per
filter and is sequenced with the companion ticket #1828, which rewrites the
same file (see *Open questions*). The CI line ratchet of spec 0285 counts
only the three engine surfaces and is not affected by moving lines between
Taskfiles.

**R30 (documentation).** `DEVELOPMENT.md` (the layout and add-a-task
section), `docs/pre-push-guard.md` (lines naming `taskfiles/ci.yml` as the
home of the `ci:*` tasks), `docs/ci-reference-format.md` (the line naming
`taskfiles/ci.yml`), and `docs/layers.md` (the `.githooks/` row) SHALL state
that the `ci:*` tasks live in `taskfiles/ci.yml` (control tasks) and
`taskfiles/ci/<group>.yml`, and that a new `ci:<id>` task goes into the file
of its stage group, with the taxonomy of R23. Historical specs and ADRs are
left alone.

### Scenarios

**Scenario:** an old Task fails loudly on the new floor

Given Task 3.53.x and the split tree
When any `task` command runs
Then it exits non-zero with `Schema version (3.54.0) is greater than the
current version of Task` and no task runs

**Scenario:** the split does not rename a `ci:<id>`

Given the `task --list-all` output captured before the split
When the same command runs on the split tree
Then the output is byte-identical and every `ci:<id>` is defined in the file
named by the R23 table

**Scenario:** an orphan sub-file is rejected

Given a staged tree where `taskfiles/ci/foo.yml` exists and no include names it
When the guard runs
Then it fails naming `taskfiles/ci/foo.yml` as unreachable

**Scenario:** an unanchored call in a sub-file keeps its meaning

Given `taskfiles/ci/gate.yml` where a task calls `- task: lint-markdown`
unanchored, and a `ci:lint-markdown` task exists
When the parity guard runs
Then it fails with an `unanchored-call` finding naming the task, and the
anchored `- task: :lint-markdown` form passes

**Scenario:** a forbidden utility in a moved task is caught

Given a staged copy where `jq` is planted in a task of `taskfiles/ci/gate.yml`
When `check-taskfile-commands` runs on the copy
Then it fails naming the effective `ci:<id>` task and the command

### Out of scope

- Renaming any `ci:<id>` task, and any change to the commands a task runs
  beyond the variable and anchor substitutions of R22.
- Any change to `ci/ci-capabilities.yml`, `.github/workflows/`, or the GitHub
  Actions grouping (companion ticket #1828); R29 only states the one-line path
  filter consequence.
- Splitting any other Taskfile (`extensions.yml` is 212 lines and stays).
- Pinning a different Task version in CI (`ci/task-pin.json` already says
  3.54.0) or changing the provisioning mechanism of spec 0282.
- A GitLab grouping change; the shared taxonomy is recorded, the engine
  mapping is owned by #1828.

### Alternatives considered

- **The issue's first layout** (`meta`, `lint`, `governance`, `modules`,
  `setup`, `runtime`): rejected, superseded by the owner decision that one
  stage taxonomy (`gate`, `modules`, `governance`, `extensions`,
  `integration`, `windows`) drives Task, GitHub and GitLab, so a job is found
  by the same name in all three.
- **A namespace per group** (`ci:gate:lint-specs`): rejected, it renames every
  `ci:<id>`, the contract of 95 capabilities and spec 0283.
- **A shared anchor file** included by every group: rejected, YAML anchors do
  not cross files and Task has no cross-file anchor mechanism; each file
  defines its anchor once.
- **Keep the floor at 3.39 and verify on 3.54 only**: rejected by the owner
  decision, a floor below the version actually run lets a feature of 3.54
  slip in and fail only on older installs.
- **A generated sub-tree built from a template**: rejected for the reason of
  base spec 0278 (a build step and a drift check for what `includes` does
  natively).

### Acceptance

R21 to R30 each carry their own acceptance sentence. In addition:
`task ci:check-taskfile-tree`, `task ci:check-ci-parity` and `task ci:pre-push`
pass; no file of `taskfiles/ci.yml` plus `taskfiles/ci/*.yml` exceeds 200
lines; the 99 `ci:*` names and descriptions are unchanged.

### Resolved decisions

- **Path filters sequencing with #1828 (R29).** The 15 `taskfiles/ci.yml`
  entries of `ci/ci-capabilities.yml` need `taskfiles/ci/**` added, and that
  file is rewritten by #1828. Decision: the #1827 implementation PR adds the
  line to each filter (a mechanical one-line change) and rebases on whichever
  ticket merges first; a coordinator decision is requested if the two PRs
  conflict.
- **Spec 0279 amendment form.** R24 and R26 reinterpret 0279 R2 and R20
  ("`taskfiles/ci.yml`") as the whole `ci` file sub-tree. Decision: this delta
  records the amendment, because the one-file spec-PR rule forbids a second
  file; it is cross-referenced from here and the base text of 0279 is read
  together with this delta (delta-cumulative rule of `docs/spec-pr-workflow.md`).
  A separate `0279-pre-push-guard.delta-04.md` is not required.
- **`windows.yml` size (R23).** Whether 24 `windows-*` tasks fit in 200
  lines after factorization cannot be known before the PLAN; the allowed
  fallback is a `windows-b.yml` of the same group.

## MODIFIED

Three clauses of the base spec change; every other requirement (R1 to R3, R5
to R7, R9 to R12, R14 to R20) is unchanged.

1. R4 (reserved CI file). Original:

   > `taskfiles/ci.yml` SHALL exist as a valid, empty skeleton (`tasks: {}`),
   > included under the namespace `ci`, reserved for WP-B (#1763).

   Replacement (already superseded in practice by spec 0279, which filled the
   file; stated here for the new layout):

   > `taskfiles/ci.yml` SHALL be included under the namespace `ci` and hold the
   > four control tasks and the `includes` of the six flattened group files of
   > `taskfiles/ci/` (R23 of delta-01); every `ci:<id>` task is defined in
   > exactly one of those files.

2. R8 (floor in the files). Original:

   > Every Taskfile, root and included, SHALL declare the same `version:
   > '3.39'`.

   Replacement:

   > Every Taskfile, root and included, SHALL declare the same `version:
   > '3.54'` (R21 of delta-01). A Task older than 3.54 fails loudly with
   > `Schema version (3.54.0) is greater than the current version of Task`; the
   > reasoning about `flatten:` introduced in 3.39 stays true and is subsumed.

3. R13 (a) and (d). Original:

   > (a) a `taskfiles/*.yml` file is not reachable from the root `includes`; [...]
   > (d) any Taskfile of the tree has a `version` other than the uniform floor of
   > R8;

   Replacement:

   > (a) a `*.yml` file under `taskfiles/` (recursively) is not reachable from
   > the root `includes`; [...] (d) any Taskfile of the tree has a `version`
   > other than the uniform floor `'3.54'` of R8;

## REMOVED

Nothing is removed.
