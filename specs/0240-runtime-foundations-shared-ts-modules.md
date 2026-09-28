---
id: "0240"
slug: runtime-foundations-shared-ts-modules
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1324
version: 1.0.0
---

# Runtime foundations and shared TypeScript modules

*Sub-spec A2 of the `large`-tier ticket #1231, row A2 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirement 24).
Discharges parent requirements 1, 3, 4, 5, 6, 15 (the timing-harness half),
17 (the `windows-latest` scaffolding half) and 22. Depends on sub-spec A1,
`specs/0238-shell-ratchet-and-typescript-toolchain.md` (issue #1321): every
TypeScript source this spec introduces is written to, and checked by, A1's
already-approved ratchet and toolchain gates. This spec neither restates nor
re-decides A1's tool choices. `0215.delta-01` (pull request #1357, merged)
reorders the strangler steps and retires shell-only tooling; this spec's
requirements are unaffected by it either way — none of them assumes either
change, and none would need to change had the delta gone the other way.*

## Intent

A contributor whose Node.js is too old to run this migration's TypeScript is
told so immediately and precisely — the version detected, the version
required, and where to obtain it — before a single file is touched, on every
Node.js release including ones that cannot execute TypeScript at all. Every
one of the four setup entry points installs the repository's pinned
production dependencies on every run, not only the first, so a contributor
who pulls a change that added one is never left resolving it by hand; and
when a script still cannot find a package it needs, it says so plainly
instead of failing with a raw module-resolution error. A later sub-spec that
needs to build a path, read a file whose line endings it cannot predict, or
write a file safely reaches for one already-reviewed shared module instead
of writing its own, so migrated code stays small, consistent, and free of
duplicated arithmetic. From this point onward, continuous integration proves
that a script behaves the same way on a Windows runner as it does on Linux,
and fails — naming the script, its time budget, and the measured time — the
moment a change makes it slow enough to miss that budget.

## Requirements

1. **Node.js floor guard — contract.** A guard SHALL detect, without relying
   on type stripping or any construct a pre-24 Node.js release cannot parse,
   whether the running Node.js major version is 24 or later. When it is not,
   the guard SHALL exit non-zero, print a diagnostic naming the detected
   version, the required floor (24), and where to obtain a supported
   release, and SHALL leave every file on disk unmodified. When the version
   is 24 or later, the guard SHALL exit zero and produce no output,
   discharging parent requirement 4.

2. **Node.js floor guard — form and ratchet exception.** The guard SHALL be
   a single plain JavaScript file at `scripts/lib/node-floor-guard.js`,
   importing no third-party package, callable directly with `node
   scripts/lib/node-floor-guard.js` or by another script requiring it. This
   pull request SHALL name `scripts/lib/node-floor-guard.js` as the Node.js
   floor guard exception that sub-spec A1's JavaScript ratchet (spec 0238
   requirement 3) reserves for it, so the ratchet check permits this file
   without treating it as a disallowed new JavaScript source.

3. **Node.js floor guard — verification on a pre-24 release.** A
   continuous-integration job SHALL install a Node.js release older than 24,
   invoke the guard directly, and assert both the non-zero exit code and
   that the diagnostic names the detected version and the required floor,
   so the guard's failure path is proven on a release that cannot execute
   TypeScript, not merely asserted in prose.

4. **Production-dependency step — command and verification.** The dependency
   step SHALL run `npm ci --omit=dev --workspaces=false` at the repository
   root, which this sub-spec SHALL verify, against the root `package.json`
   `workspaces` field, installs only the transitive closure of the root
   package's own `dependencies` — no `devDependencies`, and no package
   declared only by a workspace under `extensions/*/*` — discharging the
   command-naming half of parent requirement 6.

5. **Production-dependency step — wiring and re-run.** Each of
   `scripts/setup-claude-interactive.sh`, `scripts/setup-gemini-interactive.sh`,
   `scripts/setup-copilot-interactive.sh` and
   `scripts/setup-antigravity-interactive.sh` SHALL run the dependency step
   of requirement 4 on every invocation, not only on a first install, before
   any step of that script that could depend on a third-party package.

6. **Production-dependency step — failure handling.** When the dependency
   step of requirement 4 exits non-zero, the invoking setup script SHALL
   exit non-zero, SHALL surface npm's own diagnostic to the user, and SHALL
   NOT proceed to any later step, leaving no partially installed
   `node_modules` tree treated as usable.

7. **Missing-dependency diagnostic — shared primitive.** A shared TypeScript
   module SHALL expose a function that wraps an attempt to load a
   third-party package, catches a module-not-found failure, and raises a
   diagnostic naming the missing package and instructing the user to re-run
   setup, so that a caller using it never lets an unhandled
   module-resolution error reach the user. A script wired at a CLI
   integration point SHALL be free to catch that diagnostic and continue
   degraded, consistent with parent requirement 6's CLI-integration clause;
   this spec wires no such integration point itself.

8. **Shared module — paths.** A shared TypeScript module at
   `scripts/lib/paths.ts` SHALL expose functions that join path segments
   platform-independently, resolve a path to its absolute, symlink-resolved
   form, and locate the repository root from a calling script's own file
   location, so that no script under this migration re-derives that
   arithmetic or depends on two paths that differ only by letter case,
   discharging the path-handling half of parent requirement 22.

9. **Shared module — line endings.** A shared TypeScript module at
   `scripts/lib/line-endings.ts` SHALL expose a function that reads a text
   file's content correctly whether its line endings are LF or CRLF, and a
   function that normalizes a string to LF line endings before it is written
   to a file the repository commits, so that every such committed file is
   byte-identical regardless of which operating system generated it,
   discharging the line-ending half of parent requirement 22.

10. **Shared module — temporary files.** A shared TypeScript module at
    `scripts/lib/tmp-file.ts` SHALL expose a function that creates a
    temporary file next to a given target path with a name that cannot
    collide with a concurrently created temporary file, restricted to
    owner-only access where the underlying platform supports that
    restriction, and a function that publishes such a temporary file to its
    final destination as a single atomic rename — preserving, for a
    TypeScript caller, the same security properties the existing
    `mktemp`-based Bash helpers in `scripts/lib/common.sh` provide today.

11. **Shared TypeScript module layout.** A migrated script SHALL keep the
    path of the shell script it replaces, with its extension changed from
    `.sh` to `.ts`, per parent requirement 9. A new shared TypeScript module
    that is not the replacement of a single shell script — such as the three
    modules of requirements 8 through 10 — SHALL live under `scripts/lib/`,
    named after the concern it addresses, in a single file kept under the
    300-line, non-blocking warning threshold of sub-spec A1 (spec 0238
    requirement 7) through functional decomposition rather than through
    exemption. Every later sub-spec's new shared module SHALL follow this
    same layout, so the convention this spec establishes is not
    re-litigated per sub-spec.

12. **`windows-latest` scaffolding — reusable job shape.** A
    continuous-integration job definition SHALL exist in
    `.github/workflows/build.yml` that runs on `windows-latest`, installs
    Node.js 24, and invokes a Node.js script from a non-POSIX command
    interpreter, in a shape a later sub-spec can copy and point at its own
    migrated script, discharging the scaffolding half of parent requirement
    17.

13. **Timing-assertion harness — reusable shape.** A reusable timing-assertion
    check SHALL run a given script a stated number of times, measure the
    wall-clock time from process start to process exit for each run
    including Node.js start-up, and fail the build — naming the script, its
    stated budget, and the measured time — when the measured time exceeds
    that budget, discharging the harness half of parent requirement 15.

14. **Scaffolding proven against the floor guard.** This sub-spec SHALL set a
    latency budget for `scripts/lib/node-floor-guard.js` and SHALL apply the
    job of requirement 12 and the harness of requirement 13 to it on
    `windows-latest`, so the reusable scaffolding this spec introduces is
    proven working against a real script before any later sub-spec depends
    on it, rather than shipped as untested infrastructure.

15. **`windows-latest` job recorded as engine-specific.** The job of
    requirement 12, and every job built from it, SHALL be recorded in
    `ci/ci-capabilities.yml` as `portability: specific` with an `exception`
    naming `github-actions` and evidence that GitLab CI, as configured for
    this repository, exposes no Windows runner — the same pattern already
    used for this file's other GitHub-only capabilities — rather than left
    undocumented or asserted to need a GitLab equivalent that does not
    exist.

16. **No new runtime dependency.** None of the JavaScript or TypeScript
    sources this spec introduces SHALL import a third-party package; each
    SHALL rely on the Node.js standard library alone. This holds in
    particular for the floor guard of requirements 1 and 2, which SHALL run
    correctly before the dependency step of requirement 4 could have
    installed anything.

## Scenarios

**Scenario:** The floor guard passes on a supported Node.js release

Given a machine running Node.js 24
When `scripts/lib/node-floor-guard.js` runs directly
Then it exits zero, prints nothing, and leaves the filesystem unmodified.

**Scenario:** The floor guard rejects an unsupported Node.js release

Given the continuous-integration job of requirement 3, running on Node.js 20
When it invokes `scripts/lib/node-floor-guard.js`
Then the guard exits non-zero, its diagnostic names version 20, the required
floor 24, and where to obtain a supported release, no module-loading or
syntax error appears instead, and the job asserts all of this.

**Scenario:** The dependency step installs production dependencies only

Given the root `package.json` declares a `dependencies` entry, a
`devDependencies` entry, and an `extensions/*/*` workspace package that
declares its own dependency
When `npm ci --omit=dev --workspaces=false` runs at the repository root
Then only the root package's own `dependencies` are installed, and neither
the root's `devDependencies` nor the workspace package's dependency appear
under `node_modules`.

**Scenario:** The dependency step fails at first install

Given a first install on a machine that cannot reach the npm registry
When setup reaches the dependency step of requirement 4
Then setup exits non-zero with npm's own diagnostic, and does not proceed to
any step that could depend on a third-party package.

**Scenario:** A pulled change adds a runtime dependency

Given an installed checkout, and a `git pull` that adds a runtime dependency
without the user re-running setup
When a script wrapped with the shared diagnostic of requirement 7 tries to
load that dependency before setup has installed it
Then the caller receives a diagnostic naming the missing package and
instructing the user to re-run setup, and no unhandled module-resolution
error is shown.

**Scenario:** A generated file is byte-identical across operating systems

Given the same string written through the module of requirement 9 once on a
machine using LF and once on a machine using CRLF for its own working files
When each write completes
Then both resulting files are byte-identical, with LF line endings, so a
diff between the two shows no difference.

**Scenario:** A migrated script's Windows job catches a timing regression

Given `scripts/lib/node-floor-guard.js` carries the latency budget of
requirement 14
When a change makes the guard load unnecessary work before it decides
whether to exit, and its `windows-latest` job runs the timing-assertion
harness of requirement 13 the stated number of times
Then the job fails, naming the guard, its budget, and the measured time, and
the pull request cannot merge on that job alone.

**Scenario:** The floor guard's own timing stays within budget

Given the same job as the previous scenario, on an unchanged guard
When the harness runs the stated number of times
Then every run stays under the budget, and the job passes.

**Scenario:** The new floor-guard file passes sub-spec A1's ratchet

Given sub-spec A1's JavaScript ratchet (spec 0238 requirement 3) is active
When this pull request adds `scripts/lib/node-floor-guard.js`, named per
requirement 2 as the reserved Node.js floor guard exception
Then the ratchet check passes for this file, while an unnamed, unjustified
new JavaScript file elsewhere in the same pull request would still fail it.

**Scenario:** The `windows-latest` job needs no GitLab equivalent

Given `ci/ci-capabilities.yml` records the job of requirement 12 as
`portability: specific` per requirement 15
When `scripts/check-ci-parity.sh` (or its later TypeScript equivalent) checks
`.gitlab-ci.yml` against the capability reference
Then it does not report a missing GitLab job for this capability, because
the reference already records it as engine-specific with evidence.

## Out of scope

- Migrating `scripts/setup-claude-interactive.sh`,
  `scripts/setup-gemini-interactive.sh`,
  `scripts/setup-copilot-interactive.sh` or
  `scripts/setup-antigravity-interactive.sh` themselves to TypeScript, or
  wiring the floor guard of requirements 1 and 2 into them. These four
  scripts stay Bash in this spec, gaining only the dependency step of
  requirements 4 through 6; their migration is sub-spec F1 (issue #1335).
- Wiring the missing-dependency diagnostic of requirement 7, or the floor
  guard of requirements 1 and 2, into any hook, setup, build, or other CLI
  integration point. Those belong to the sub-spec that migrates each such
  entry point (rows C1–C3, D, F1–F3, G1a–G2, H, I1–I2, J1–J4 of the
  architect decomposition), which SHALL call the shared primitives this
  spec introduces rather than reimplement them.
- Choosing or re-deciding a lint tool, formatter, or TypeScript compiler
  version. Oxlint, Oxfmt and the TypeScript 7.0 floor are sub-spec A1's
  decision (spec 0238 requirements 6, 8, 9); this spec's new sources are
  simply written to those already-approved gates.
- Bumping `extensions/core/hello-world/package.json`'s pinned TypeScript
  version. Already discharged by sub-spec A1 (spec 0238 requirement 10).
- A Windows equivalent continuous-integration runner on GitLab CI. None
  exists for this repository today (requirement 15), and building one is
  outside this migration's scope.
- The Windows equivalent of macOS LaunchAgents and Linux user units (row D,
  issue #1330), the symbolic-link copy fallback (merged into row F2, issue
  #1334), and the measured Windows hook command-line matrix (sub-spec B,
  issue #1322, deferred pending a Windows environment per the logbook on
  issue #1231).
- The strangler-step reordering and the shell-only tooling retirement
  (`scripts/check-bash32-portability.sh`, `scripts/check-pipefail-grep.sh`,
  `scripts/lib/bash32-array-guard.sh` and
  `artifacts/core/skills/pr-reviewer/scripts/lint-shell.sh`, per
  requirement 26) that `0215.delta-01` (pull request #1357, merged)
  enacted. This spec's requirements are unaffected by that delta and would
  hold identically had it gone the other way.
- Replacing the `js-yaml` library, or any other justified-replacement
  decision under parent requirement 23. Sub-spec H (issue #1337) owns that
  question if it arises.
- Any Node.js version-management tooling (nvm-windows, fnm, Volta) on the
  user's machine. This spec checks the floor; it does not install Node.js.

## Open questions
