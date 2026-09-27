---
id: "0238"
slug: shell-ratchet-and-typescript-toolchain
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1321
version: 1.0.0
---

# Shell ratchet and TypeScript toolchain

*Sub-spec A1 of the `large`-tier ticket #1231, row A1 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirement 24).
Discharges parent requirements 2, 10, 11, 12, and the enforcement half of
requirement 16. No other sub-spec of #1231 needs to land before this one.*

## Intent

A pull request that would grow the repository's remaining shell footprint,
its unmigrated-JavaScript footprint, or its non-`mempalace` Python footprint
is rejected by continuous integration before it can merge, on both
continuous-integration platforms the repository builds on. A pull request
that introduces a new TypeScript source is held, from the same day this
lands, to the conventions every later migration step depends on: it type-
checks, it contains no syntax that cannot be erased without generating code,
it never lets an unsafe or unknown value flow through unnamed, and an
oversized file is flagged for the reviewer without blocking the merge. A
contributor can run the same checks locally before pushing, and the
independent reviewer pass sees the same finding continuous integration
would have rendered, so nobody discovers a violation for the first time at
the merge gate.

## Requirements

1. **Shell ratchet.** From the pull request that lands this check onward,
   continuous integration SHALL fail whenever a tracked shell script — a
   `*.sh` file, or any tracked file whose shebang names `bash` or `sh` —
   exists outside a single git-tracked allowlist. The allowlist SHALL be
   generated, not hand-maintained: it SHALL list exactly the qualifying
   files tracked at the moment this pull request lands, SHALL only ever
   shrink afterward, and the check SHALL fail a later pull request that
   either adds a new entry or removes a file without removing that file's
   entry in the same pull request. Exact file counts are deliberately not
   fixed by this requirement: whatever is tracked when the implementation
   pull request lands is the baseline, not any figure carried over from the
   parent spec or the architect decomposition.

2. **Built-copy exclusion from the shell ratchet.** The check in
   requirement 1 SHALL exclude every file under the four generated,
   built-copy trees `.claude/`, `.gemini/`, `.github/`, and `.agents/` from
   its shell-file scan. A shell file regenerated under one of these trees
   is already covered through its `artifacts/**` source, which the same
   scan reaches directly, so a built copy SHALL NOT need an allowlist entry
   of its own.

3. **JavaScript and Python ratchet.** The same continuous-integration check
   SHALL fail whenever a pull request adds a tracked JavaScript file
   (`*.js`, `*.mjs`, `*.cjs`) outside the baseline set of such files tracked
   at the moment this pull request lands — except a file that a later
   sub-spec justifies and names, when introducing it, as either the
   Node.js floor guard or a configuration file a third-party tool mandates
   in JavaScript. The check SHALL also fail whenever a pull request adds a
   tracked Python file that does not import the `mempalace` Python library;
   this SHALL be tested by inspecting the file's own import statements, not
   by matching it against a fixed list of filenames, so the check keeps
   working as the small set of `mempalace`-importing files grows or is
   renamed.

4. **Type-checking.** A continuous-integration check SHALL type-check every
   tracked TypeScript source file in the compiler's strict mode and SHALL
   fail the build on any type error.

5. **Erasable syntax.** A continuous-integration check SHALL fail the build
   when a tracked TypeScript source file contains a construct that Node's
   built-in type stripping cannot erase without generating code — an
   `enum`, a `namespace` carrying runtime content, a parameter property, a
   legacy decorator, or an `import =` alias — naming the file, the line,
   and the forbidden construct.

6. **Strict typing, enforced by Oxlint in type-aware mode.** A
   continuous-integration check SHALL fail the build on: an explicit `any`
   in a tracked TypeScript source, including `as any` and `any` used as a
   generic argument; an `@ts-ignore` or `@ts-nocheck` directive; an
   `@ts-expect-error` directive that carries no written justification on
   the same line; and an unsafe use — assignment, member access, call,
   argument, or return — of a value whose type is implicitly `any`, which is
   how the check reaches a value such as the result of `JSON.parse` that a
   library declaration types `any`. Each failure SHALL name the file, the
   line, and the forbidden construct.

7. **Non-blocking file-size warning, enforced by Oxlint.** A
   continuous-integration check SHALL report, as a warning that SHALL NOT
   fail the build, every tracked TypeScript source file — test files
   included — that exceeds 300 lines counting every line, naming the file
   and its line count. The JavaScript files in the baseline set of
   requirement 3 SHALL be exempt from this warning until each is
   individually converted to TypeScript. A `.ts` file under an extension or
   skeleton workspace (requirement 11) SHALL NOT be exempt: once such a
   file exists, it is subject to the same warning as any other tracked
   TypeScript source.

8. **Formatting, enforced by Oxfmt.** A continuous-integration check SHALL
   run in check mode and SHALL fail the build when a tracked `*.ts` file is
   not formatted as the tool would format it. This check SHALL scope to
   `*.ts` files only at landing; it SHALL NOT be run against the JavaScript
   files in the baseline set of requirement 3, so that landing this spec
   does not force an unrelated reformatting of files this migration is not
   touching.

9. **Toolchain versions and dependency kind.** TypeScript SHALL be pinned
   at version 7.0 or later, repository-wide, including every workspace
   under `extensions/*/*`. Oxlint, Oxfmt, and the TypeScript compiler SHALL
   each be declared as a `devDependency` only, never a runtime dependency,
   consistent with the lint tooling constraint of parent requirement 2 and
   the runtime-dependency boundary of parent requirement 6.

10. **Extension workspace version alignment.** In the same pull request
    that raises the repository-wide TypeScript floor, `extensions/core/hello-world/package.json`'s
    pinned `typescript` `devDependency` SHALL be raised to satisfy that
    floor, and that workspace's own `tsc` build SHALL be verified to still
    pass. This closes the alternative left open by the toolchain-decision
    comment on this ticket — a named follow-up ticket — because the
    repository-wide floor is already decided and non-negotiable, the
    affected surface is a single tracked TypeScript source file
    (`extensions/core/hello-world/src/index.ts`), and landing a
    "repository-wide" floor that a tracked file already on `main`
    immediately violates is worse than the small, mechanical version bump
    this requirement asks for.

11. **Extension workspace lint scope.** The Oxlint and Oxfmt configuration
    SHALL cover `extensions/**` and `extension-skeleton/**` under the same
    repository-wide configuration used everywhere else — one configuration,
    not a duplicate per workspace.

12. **Built-copy exclusion from the TypeScript checks.** The checks in
    requirements 4 through 8 SHALL exclude the same four built-copy trees
    named in requirement 2 (`.claude/`, `.gemini/`, `.github/`,
    `.agents/`), for the same reason: a built copy is covered through its
    source and gains nothing from being checked a second time under its
    generated path.

13. **Continuous-integration wiring.** Every check in requirements 1
    through 8 SHALL run in both `.github/workflows/build.yml` and
    `.gitlab-ci.yml`, on the same triggering events already used by this
    repository's other lint jobs, and a failure in either platform's job
    SHALL block that platform's own merge gate.

14. **Reviewer parity.** A new script SHALL be added to
    `artifacts/core/skills/pr-reviewer/scripts/`, alongside the existing
    `lint-json.sh`, `lint-markdown.sh`, `lint-python.sh`, `lint-shell.sh`,
    and `lint-skill.sh`. Because this is new code, it SHALL be authored in
    TypeScript (`lint-typescript.ts`), never as a new shell script, and it
    SHALL run the same Oxlint type-aware pass and the same Oxfmt
    check-mode pass, scoped to a pull request's changed `*.ts` files, that
    requirements 6 and 8 run in continuous integration — so an independent
    reviewer pass surfaces the same finding a contributor would otherwise
    see for the first time at the merge gate. Adding it SHALL bump the
    `pr-reviewer` skill's `metadata.provenance.version` and SHALL run
    `bash scripts/build-components.sh` in the same pull request, per the
    project's version-bump convention.

15. **Local entry points.** `Taskfile.yml` SHALL gain tasks that invoke
    exactly the commands requirements 4 through 8 run in continuous
    integration, so a contributor reproduces the same verdict locally
    without composing the underlying command themselves.

16. **Self-compliance.** Every new TypeScript source this spec introduces —
    the checks of requirements 1 through 8 and the reviewer script of
    requirement 14 — SHALL itself satisfy requirements 4 through 7, and
    SHALL run directly from its `.ts` source through Node's built-in type
    stripping, with no compilation, bundling, or transpilation step of its
    own.

## Scenarios

**Scenario:** An unrelated pull request passes the ratchet unchanged

Given the checks of requirements 1 through 3 are active on `main`
When a pull request that touches no shell, JavaScript, or Python file merges
Then every check reports success and the allowlist and the baseline set are
unchanged.

**Scenario:** A new shell script is rejected by the ratchet

Given the check of requirement 1 is active on `main`
When a pull request adds `scripts/check-new-thing.sh` without adding it to
the allowlist, or adds it directly to the allowlist
Then the check fails, naming the offending file or entry, and the pull
request cannot merge.

**Scenario:** A stale allowlist entry is rejected

Given a script is removed from the repository in a pull request that
migrates it to TypeScript
When that pull request leaves the script's entry in the allowlist instead of
removing it
Then the check fails, naming the stale entry, and the pull request cannot
merge until the entry is removed in the same pull request.

**Scenario:** A disallowed new JavaScript file is rejected

Given the check of requirement 3 is active on `main`
When a pull request adds a new `*.mjs` helper that is neither the Node.js
floor guard nor a tool-mandated configuration file, with no justification
recorded in the pull request
Then the check fails, naming the file and requirement 3's permitted
exceptions.

**Scenario:** A Python file that does not import `mempalace` is rejected

Given the check of requirement 3 is active on `main`
When a pull request adds a tracked Python file whose imports do not include
`mempalace`
Then the check fails, naming the file.

**Scenario:** A non-erasable construct is rejected

Given the check of requirement 5 is active on `main`
When a pull request introduces a TypeScript `enum` in a tracked source file
Then the check fails, naming the file, the line, and the `enum` construct,
and the pull request cannot merge.

**Scenario:** An explicit `any` fails the strict-typing check

Given the check of requirement 6 is active on `main`
When a pull request introduces `as any` in a tracked TypeScript source file
Then the check fails, naming the file, the line, and the forbidden
construct, and the pull request cannot merge.

**Scenario:** An oversized TypeScript file warns without failing

Given the check of requirement 7 is active on `main`
When a pull request adds a 350-line TypeScript source file
Then the check reports a warning naming the file and its 350-line count,
and the build still passes on that ground alone.

**Scenario:** An unformatted TypeScript file fails the format check

Given the check of requirement 8 is active on `main`
When a pull request introduces a `*.ts` file whose layout does not match
the formatter's own output for that file
Then the check fails, naming the file, and the pull request cannot merge
until the file is reformatted.

**Scenario:** A contributor reproduces the CI verdict locally

Given the `Taskfile.yml` tasks of requirement 15 are in place
When a contributor runs the local task before pushing a change that would
fail requirement 6 or requirement 8 in continuous integration
Then the local task reports the same failure, naming the same file and the
same construct, before the change ever reaches a pull request.

**Scenario:** The independent reviewer pass surfaces the same finding as CI

Given the `pr-reviewer` script of requirement 14 is in place
When a pull request that would fail requirement 6 or requirement 8 in
continuous integration is reviewed
Then the reviewer pass reports the same finding, naming the same file and
the same construct, independently of the continuous-integration job.

## Out of scope

- The Node.js floor guard, the production-dependency install step and its
  missing-dependency diagnostic, the `windows-latest` continuous-integration
  scaffolding and timing harness, and the shared TypeScript modules for
  paths, line endings, and temporary files — all sub-spec A2 (issue #1324).
- The empirical Windows reproduction of each command-line interpreter's hook
  quoting and path handling, and the corresponding `docs/cli-matrix.md` row
  — sub-spec B (issue #1322).
- Migrating any individual shell script to TypeScript. This spec freezes
  the allowlist; it converts nothing on it.
- Converting the baseline JavaScript files (requirement 3) to TypeScript.
  Parent spec 0215 already excludes this, and requirement 7 exempts them
  from the file-size warning for the same reason.
- Running the checks of requirements 1 through 8 on a `windows-latest`
  continuous-integration runner. They are continuous-integration-only
  checks, not migrated user-facing entry points, and stay on the same
  runner the repository's other lint jobs already use; sub-spec A2 owns
  the `windows-latest` scaffolding these checks do not need.
- Reformatting the existing baseline JavaScript files with Oxfmt.
  Requirement 8 scopes the formatter to `*.ts` files at landing precisely
  to avoid this.
- Migrating or retiring the existing shell-only lint tooling
  (`lint-shell.sh`, `check-bash32-portability.sh`, `check-pipefail-grep.sh`,
  `scripts/lib/bash32-array-guard.sh`) or any other shell script beyond
  what requirement 14 adds. Whether that tooling is later migrated or
  retired is exactly the question a proposed, unenacted delta to spec 0215
  is raising in parallel; this spec depends on neither answer and touches
  none of those files.
- Reordering the strangler steps of parent spec 0215's requirement 8. A
  second proposed, unenacted delta to spec 0215 is raised in parallel on
  that question; this spec does not depend on it and does not implement
  it.
- Deciding which of the two parallel sets of sub-spec tickets opened under
  issue #1231 is canonical. That is a ticket-hygiene question already
  raised to the ticket owner on issue #1231 and is unrelated to this
  spec's content.

## Open questions
