---
id: "0215"
slug: shell-to-typescript-migration
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1324
version: 3.0.0
---

# Shell-to-TypeScript migration (parent spec)

## ADDED

None.

## MODIFIED

Requirement 6 — the production-dependency step's re-run condition, gated on
the committed lockfile's content hash instead of running unconditionally on
every setup invocation:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 6. **Runtime and distribution (binding 1).** The first-install entry point
>    SHALL use the Node.js standard library alone up to and including the
>    step where it installs the repository's lockfile-pinned production
>    dependencies — `npm ci --omit=dev` or an equivalent npm command fixed
>    by sub-spec A — and no migrated script SHALL import a third-party
>    package before that step has run. That step SHALL install only the
>    transitive closure of the root package's `dependencies`: no
>    `devDependencies` (the release and lint tooling) and no package needed
>    only by a workspace under `extensions/`; sub-spec A SHALL verify the
>    chosen command against the root `package.json` workspaces and SHALL
>    name it. Release tooling and other `devDependencies` SHALL NOT be
>    required at runtime. Every third-party runtime dependency SHALL be
>    declared under `dependencies`, pinned by the lockfile and justified in
>    the sub-spec that introduces it; at authoring time the root package
>    declares none, so a sub-spec that needs no third-party package SHALL
>    rely on the Node.js standard library alone. When the dependency step
>    fails, the entry point SHALL exit non-zero with the npm diagnostic and
>    SHALL NOT continue with a partial install. Setup SHALL re-run this
>    dependency step on every run, not only on the first install, so that a
>    dependency added by a later change is installed by the next setup run.
>    When a migrated script nevertheless cannot resolve a third-party
>    package — typically after a `git pull` that added a runtime dependency
>    without setup being re-run — it SHALL exit non-zero with a diagnostic
>    naming the missing package and instructing the user to re-run setup,
>    never with an unhandled module-resolution error. For a script wired at
>    a CLI integration point (requirement 15), that failure SHALL NOT block
>    the CLI beyond what the CLI's own semantics for a failing hook or
>    statusline command impose; sub-specs A and C decide how.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 6. **Runtime and distribution (binding 1, narrowed at delta-02).** The
>    first-install entry point SHALL use the Node.js standard library alone
>    up to and including the step where it installs the repository's
>    lockfile-pinned production dependencies — `npm ci --omit=dev` or an
>    equivalent npm command fixed by sub-spec A — and no migrated script
>    SHALL import a third-party package before that step has run. That step
>    SHALL install only the transitive closure of the root package's
>    `dependencies`: no `devDependencies` (the release and lint tooling) and
>    no package needed only by a workspace under `extensions/`; sub-spec A
>    SHALL verify the chosen command against the root `package.json`
>    workspaces and SHALL name it. Release tooling and other
>    `devDependencies` SHALL NOT be required at runtime. Every third-party
>    runtime dependency SHALL be declared under `dependencies`, pinned by
>    the lockfile and justified in the sub-spec that introduces it; at
>    authoring time the root package declares none, so a sub-spec that
>    needs no third-party package SHALL rely on the Node.js standard
>    library alone. When the dependency step fails, the entry point SHALL
>    exit non-zero with the npm diagnostic and SHALL NOT continue with a
>    partial install. Setup SHALL run this dependency step when the current
>    checkout holds no record of a previously successful run of that step,
>    or when the content hash of the committed `package-lock.json` differs
>    from the hash recorded at that prior successful run; otherwise it
>    SHALL skip the step and report to the user, by name, that the step was
>    skipped and why. When a migrated script nevertheless cannot resolve a
>    third-party package — typically after a `git pull` that added a
>    runtime dependency without setup being re-run — it SHALL exit non-zero
>    with a diagnostic naming the missing package and instructing the user
>    to re-run setup, never with an unhandled module-resolution error. For a
>    script wired at a CLI integration point (requirement 15), that failure
>    SHALL NOT block the CLI beyond what the CLI's own semantics for a
>    failing hook or statusline command impose; sub-specs A and C decide
>    how.
>
>    This narrows the re-run condition that PR #1239's own SPECS review
>    added to requirement 6 (finding s2-F4, addressed at `072db8e`) to
>    encode binding 1's runtime requirement; binding 1 as voted in issue
>    #1192 did not itself specify a re-run cadence. The narrowing was
>    decided by @hcross on issue #1324 (PLAN review
>    finding v1-F2 of sub-spec A2,
>    `specs/0240-runtime-foundations-shared-ts-modules.md`, comment
>    <https://github.com/crewrig/crewrig/issues/1324#issuecomment-5866754935>),
>    after the plan review found that `npm ci` deletes `node_modules` and
>    needs the network on every invocation even though the root package
>    declares no runtime dependency at authoring time, which wipes every
>    contributor's development toolchain (installed by sub-spec A1's own
>    `devDependencies`) on every single setup run for no benefit on the
>    common case where nothing changed. The residual missing-dependency
>    diagnostic for a script that cannot resolve a package after an
>    un-refreshed `git pull` is unchanged by this narrowing: gating the
>    dependency step on a content-hash comparison does not remove that
>    failure path, since a pull that adds a runtime dependency also changes
>    `package-lock.json`'s content and therefore its hash, so the next setup
>    run still re-installs; the diagnostic still covers the window between
>    such a pull and the next setup run.

Requirement 24's decomposition table — row A's `Covers` cell, corrected
to describe the lockfile-hash-gated re-run instead of an unconditional
one, so the immutable table does not tell a future reader the wrong
cadence for R6:

Original:

> | A | Foundations | Ratchet and allowlist (R10–R12); dependency step re-run on every setup, its npm command and the missing-dependency diagnostic (R6); TypeScript conventions: type-check, erasable-syntax check, strict-typing check and non-blocking 300-line size warning, with their `devDependency`-only lint tooling (R2); Node floor check (R4); `windows-latest` CI scaffolding and timing harness (R15, R17); shared path, line-ending and temporary-file handling (R22) | — |

Replacement:

> | A | Foundations | Ratchet and allowlist (R10–R12); dependency step re-run gated on the lockfile content hash, its npm command and the missing-dependency diagnostic (R6, narrowed at delta-02); TypeScript conventions: type-check, erasable-syntax check, strict-typing check and non-blocking 300-line size warning, with their `devDependency`-only lint tooling (R2); Node floor check (R4); `windows-latest` CI scaffolding and timing harness (R15, R17); shared path, line-ending and temporary-file handling (R22) | — |

## REMOVED

None.
