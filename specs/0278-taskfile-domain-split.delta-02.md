---
id: "0278"
slug: taskfile-domain-split
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1827
version: 1.2.0
---

# Taskfile domain split

Delta-02 corrects a wrong assumption of delta-01. Delta-01 assumed that a task
defined in a `taskfiles/ci/<group>.yml` file, flattened into
`taskfiles/ci.yml`, keeps the repository root as its working directory, as
base R9 requires. It does not. Proved on Task 3.54.0 in a `mkdtemp` tree
(`Taskfile.yml` includes `ci: ./taskfiles/ci.yml`, which includes
`./ci/<group>.yml` with `flatten: true`): a task defined in the nested
flattened file runs with `taskfiles/` as its working directory, whereas a task
defined in `taskfiles/ci.yml` itself runs from the root. Relative paths
(`AGENTS.md`, `artifacts/...`, `ci/ci-capabilities.yml`) therefore break for
the 95 tasks that moved. `dir: '{{.ROOT_DIR}}'` on the include does not fix
it; `dir: ..` on the include (resolved against the directory of the including
file, `taskfiles/`) does: the task then runs from the repository root. The
delta keeps the R9 invariant (every included task runs from the repository
root) and relaxes only the means: the ban on `dir:` of base R9 and of guard
rule (g) gets one narrow, exact exception.

## ADDED

### Requirements

**R31 (the nested flattened includes carry `dir: ..`).** In
`taskfiles/ci.yml`, each include of `taskfiles/ci/*.yml` SHALL be
written `{ taskfile: ./ci/<group>.yml, flatten: true, dir: .. }`. The value is
exactly the two characters `..`: relative to the including file's directory
(`taskfiles/`), it resolves to the repository root, and so every task of a
`taskfiles/ci/*.yml` file runs, like every task of `taskfiles/ci.yml`, from the
repository root, including when `task` is invoked from a subdirectory. The
files of `taskfiles/ci/` themselves SHALL NOT carry `dir:` anywhere, and no
task SHALL carry a per-task `dir:` to compensate. Acceptance: R32 and R33.

**R32 (guard rule (g) accepts exactly that exception).** Rule (g) of the guard
(`scripts/lib/governance/taskfile-tree-guard.ts`, header comment and fixtures
included) SHALL accept `dir:` on an include if and only if (a) the include is
declared in `taskfiles/ci.yml`, (b) its `taskfile:` target is a file under
`taskfiles/ci/`, and (c) the value is the exact string `..`. It SHALL keep
failing, naming the include, on any other `dir:` (another value, including
`'{{.ROOT_DIR}}'`, `.`, `../`, an absolute path), on `dir:` on any other
include (the root `Taskfile.yml` includes, the other `taskfiles/*.yml`
includes, an include nested in a `taskfiles/ci/*.yml` file), and on `excludes:`
and `aliases:` everywhere, unchanged. Acceptance: fixture tests under
`scripts/tests/` (the staged `mkdtemp` trees of the existing guard fixtures)
prove that `dir: ..` on a `taskfiles/ci.yml` include of `./ci/<group>.yml`
passes. Separately, each of the following fails the guard, naming the include:
`dir: '{{.ROOT_DIR}}'` on that include, `dir: ../x` on it, `dir: ..` on a root
include, `dir: ..` on a `taskfiles/e2e.yml` include, and `dir: ..` on a
`taskfiles/ci.yml` include whose target is not under `taskfiles/ci/`. A `ci`
sub-include with no `dir:` at all is not a guard failure; the runtime test of
R33 owns that omission.

**R33 (runtime proof from the repository root).** A committed test SHALL run,
with the real `task` binary on Task 3.54.0 (explicit notice when absent,
never a silent skip, base R14), one task from every `taskfiles/ci/*.yml` file
(every group file) and assert that its working directory (`pwd`) equals the
repository root, once from the root and once from a subdirectory (for example
`scripts/`). The test SHALL run on a staged `mkdtemp` copy of the real
Taskfile tree in which the probed task bodies are replaced by a `pwd`
recorder, so it never mutates the checkout (host-safety, base R15), and it
SHALL include a mutation proof: the same tree with `dir: ..` removed from one
include reports the working directory `taskfiles/` for that group and fails
the assertion. Both the baseline assertion and the mutation proof run with
the staged copy's root as the invoking directory and again from its `scripts/`
subdirectory, never from `taskfiles/`. Acceptance: the test fails on the delta-01 layout (no `dir:`)
and passes with R31.

## MODIFIED

Three clauses of the base spec (as amended by delta-01) change; every other
requirement is unchanged. The base spec's rejection of `dir:` on includes
(*Alternatives considered*, "`includes` with `dir:` on each include") still
holds for every include other than the group-file includes of R31.

1. R9 (working directory and variables). Original, first sentence:

   > An included task SHALL run with the repository root as its working
   > directory, including when `task` is invoked from a subdirectory (Task
   > changes to the root Taskfile's directory), so no `dir:` is added on any
   > include.

   Replacement:

   > An included task SHALL run with the repository root as its working
   > directory, including when `task` is invoked from a subdirectory. This holds
   > by default for every include of the root and of the `taskfiles/*.yml`
   > files, so no `dir:` is added on them; a flattened include nested one level
   > deeper (`taskfiles/ci/*.yml`, included by `taskfiles/ci.yml`) runs from
   > `taskfiles/` by default on Task 3.54.0, and SHALL carry `dir: ..` on its
   > include (R31 of delta-02).

   The acceptance sentence of R9 is extended: one task from every file of
   `taskfiles/ci/` SHALL also run from the repository root, from the root and
   from a subdirectory (R33 of delta-02). The remainder of R9 (root `vars`,
   `REPO_DIR`, the `TASKFILE_DIR` prohibition) is unchanged.

2. Guard rule (g), as its own modification. Rule (g) is not part of base
   R13 (a) to (f), nor of R7 or R9: it exists only in the header of
   `scripts/lib/governance/taskfile-tree-guard.ts`, which cites R7 and R9 as
   its rationale. Current text there:

   > (g) no include carries `dir:`, `excludes:` or `aliases:` (R7, R9)

   Replacement, which this delta also records as base R13 (g) so that the
   requirement and the guard agree:

   > (g) no include carries `excludes:` or `aliases:`, and no include carries
   > `dir:` except an include declared in `taskfiles/ci.yml` whose target is a
   > file under `taskfiles/ci/`, with the exact value `..` (R32 of delta-02).

   R7 is unchanged: it forbids working around a name collision with
   `excludes:` or `aliases:` and does not mention `dir:`.

3. R23 (delta-01), include form. The sentence "each written as `{ taskfile:
   ./ci/<group>.yml, flatten: true }`" becomes "each written as `{ taskfile:
   ./ci/<group>.yml, flatten: true, dir: .. }`".

## REMOVED

Nothing is removed.

### Scenarios

**Scenario:** a task of a nested flattened file runs from the repository root

Given the tree where `taskfiles/ci.yml` includes `./ci/gate.yml` with
`flatten: true, dir: ..`
When `task ci:<id>` for a task of `taskfiles/ci/gate.yml` runs from the root
or from `scripts/`
Then the task's working directory is the repository root

**Scenario:** the exception is exact

Given a staged tree where a `taskfiles/ci.yml` include carries `dir:
'{{.ROOT_DIR}}'`, or a `taskfiles/e2e.yml` include carries `dir: ..`
When the guard runs
Then it fails naming the include

### Out of scope

- Any change to task names, descriptions or commands, or to the layout of
  delta-01 (R21 to R30 are unchanged).
- Giving any other include a `dir:`; the ban of guard rule (g) stays for all of
  them.

### Alternatives considered

- **Per-task `dir: '{{.ROOT_DIR}}'` (or `dir: ..`) on every moved task**:
  rejected. It adds 95 repetitions the factorization of R22 just removed, a
  new task added to a `ci/` file forgets it silently (the failure is a missing
  relative path, found only when that task runs), and the guard cannot
  distinguish a legitimate per-task `dir:` from a wrong one.
- **`dir: '{{.ROOT_DIR}}'` on the include**: rejected, proved ineffective on
  Task 3.54.0 for a flattened include nested in an included file (the task
  still runs from `taskfiles/`).
- **Reading paths from `REPO_DIR` (`{{.REPO_DIR}}/...`) and leaving the cwd
  alone**: rejected. It rewrites every relative path of the 95 tasks (a
  behaviour change beyond R22's substitutions), cannot reach commands that
  rely on the cwd by nature (`git`, `markdownlint` globs, `node --test`
  discovery), and leaves tasks of the same namespace with two different working
  directories (the four control tasks run from the root, the moved ones from
  `taskfiles/`).
- **Flattening the group files directly into the root** (no nested include):
  rejected, it forfeits the `ci` namespace, i.e. a rename of every `ci:<id>`
  (base spec 0278 and delta-01 reject namespace changes).

### Acceptance

R31 to R33 each carry their own acceptance sentence. In addition:
`task ci:check-taskfile-tree` and `task ci:pre-push` pass, and the 99 `ci:*`
names and descriptions stay unchanged.

### Resolved decisions

- **Scope of the exception.** One exact form (`dir: ..` on the includes of
  `taskfiles/ci.yml`) rather than a general `dir:` allowance, so the guard
  stays a closed rule and any deviation is a loud failure.
