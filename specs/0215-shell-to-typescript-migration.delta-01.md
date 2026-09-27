---
id: "0215"
slug: shell-to-typescript-migration
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1231
version: 2.0.0
---

# Shell-to-TypeScript migration (parent spec)

## ADDED

1. **New requirement (R26) — Shell-only tooling exception (binding 2,
   narrowed at delta-01).** A tracked script whose sole purpose is to
   lint, check, or guard shell syntax or shell-specific portability
   checks a property that no longer exists once the last shell file is
   removed. Such a script SHALL NOT migrate to TypeScript. It SHALL
   instead be retired — deleted, together with any CI wiring and Bash
   test it has — in the same pull request that removes the last tracked
   shell file (the terminal act of requirement 8's step (e)). At
   authoring time this covers `scripts/check-bash32-portability.sh`,
   `scripts/check-pipefail-grep.sh` and `scripts/lib/bash32-array-guard.sh`
   — each with its own CI wiring and its own dedicated Bash test — and
   the skill-bundled `artifacts/core/skills/pr-reviewer/scripts/lint-shell.sh`,
   which has neither: it runs as part of the `pr-reviewer` skill's own
   logic (row H, step (d) of requirement 24's decomposition table), not
   as a top-level CI check, and carries no dedicated Bash test. This
   narrows binding 2 as voted in issue #1192, which required every
   tracked shell script to migrate with no such carve-out. The narrowing
   was decided by @hcross on issue #1231, following the architect-led
   decomposition's finding (comment
   <https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>)
   that porting this tooling into TypeScript ahead of the shell files it
   checks would ship a replacement immediately deleted at step (e) — a
   throwaway migration with no runtime benefit.

**Scenario:** Shell-only tooling is retired instead of migrated

Given the pull request that removes the last tracked shell script and
closes step (e) of the strangler order
When that pull request lands
Then `scripts/check-bash32-portability.sh`, `scripts/check-pipefail-grep.sh`,
`scripts/lib/bash32-array-guard.sh` and their Bash tests are deleted along
with it, `artifacts/core/skills/pr-reviewer/scripts/lint-shell.sh` is
deleted alongside them, no TypeScript replacement for any of the four is
added, and the CI wiring of the first three is removed in the same pull
request.

## MODIFIED

Requirement 5 — the cross-reference to the strangler order's
setup/install/manage step, kept accurate after this delta reorders
requirement 8:

Original:

> A POSIX shell SHALL NOT be a prerequisite on any operating system once the
> setup/install/manage step of the strangler order (requirement 8) has
> shipped.

Replacement:

> A POSIX shell SHALL NOT be a prerequisite on any operating system once the
> setup/install/manage step (step (c) after delta-01's reorder of requirement
> 8) of the strangler order (requirement 8) has shipped.

Requirement 8 — the strangler order itself, reordered:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 8. **Scope and strangler order (binding 2).** The migration SHALL proceed
>    incrementally, with shell and TypeScript coexisting, in this order: (a)
>    hooks; (b) setup, install, manage and import entry points; (c) build
>    scripts; (d) skill- and extension-bundled scripts; (e) CI checks and
>    tests, ending with the removal of the last shell file. A shared
>    `scripts/lib/` shell library SHALL be retired in the same step as its
>    last consumer, not earlier. A sub-spec MAY migrate a script ahead of its
>    step only when that script is a dependency of a script in the current
>    step, and SHALL name that dependency.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 8. **Scope and strangler order (binding 2, reordered at delta-01).** The
>    migration SHALL proceed incrementally, with shell and TypeScript
>    coexisting, in this order: (a) hooks; (b) build scripts; (c) setup,
>    install, manage and import entry points; (d) skill- and
>    extension-bundled scripts; (e) CI checks and tests, ending with the
>    removal of the last shell file. A shared `scripts/lib/` shell library
>    SHALL be retired in the same step as its last consumer, not earlier. A
>    sub-spec MAY migrate a script ahead of its step only when that script is
>    a dependency of a script in the current step, and SHALL name that
>    dependency.
>
>    This reorders binding 2 as voted in issue #1192 (comment
>    <https://github.com/crewrig/crewrig/issues/1192#issuecomment-5835891931>:
>    "Strangler order: hooks → setup, install and manage → build →
>    skill-bundled scripts → CI checks and tests"), which put setup, install
>    and manage ahead of build. The reorder was decided by @hcross on the
>    parent ticket (issue #1231), after the architect-led decomposition
>    (comment
>    <https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>)
>    found that every setup and install entry point invokes
>    `scripts/build-components.sh` or the extension and plugin builders, and
>    that requirement 23's bar on a migrated script spawning a POSIX-only
>    utility reaches a pre-migration Bash interpreter — a TypeScript setup or
>    install script cannot shell out to a build script that has not migrated
>    yet. The decomposition had already reached this order in practice
>    through the named-dependency clause above (two build sub-specs declared
>    as dependencies of the setup and install sub-specs); this reorder
>    promotes that practical necessity into the declared order so a later
>    sub-spec no longer needs the named-dependency clause to justify it.

Requirement 24's proposed decomposition table — the Setup/install/manage
and Build rows, reordered and their dependencies corrected to match:

Original:

> | F | Setup, install, manage and import | The 18 `scripts/{setup,install,manage,import}-*.sh` entry points and their helpers | C, D, E |
> | G | Build | `scripts/build-*.sh` and their helpers; byte-identical outputs (R22) | F |

Replacement:

> | G | Build | `scripts/build-*.sh` and their helpers; byte-identical outputs (R22) | C |
> | F | Setup, install, manage and import | The 18 `scripts/{setup,install,manage,import}-*.sh` entry points and their helpers | C, D, E, G |

The scenario "Windows user installs CrewRig without a POSIX layer" — the
step reference updated to match the reordered requirement 8:

Original:

> When the user clones the repository and runs the Claude Code setup entry
> point from PowerShell after step (b) of the strangler order has shipped

Replacement:

> When the user clones the repository and runs the Claude Code setup entry
> point from PowerShell after step (c) of the strangler order has shipped

## REMOVED

None.
