---
id: "0215"
slug: shell-to-typescript-migration
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1324
version: 4.0.0
---

# Shell-to-TypeScript migration (parent spec)

## ADDED

None.

## MODIFIED

Requirement 6 — the production-dependency step's closure property, reworded
to the shape `0240.delta-01` requirement 4 already gave the child spec's own
copy of the same property, so overlap packages are tolerated instead of
forbidden outright:

Original:

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

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 6. **Runtime and distribution (binding 1, narrowed at delta-02, closure
>    corrected at delta-03).** The first-install entry point SHALL use the
>    Node.js standard library alone up to and including the step where it
>    installs the repository's lockfile-pinned production dependencies —
>    `npm ci --omit=dev` or an equivalent npm command fixed by sub-spec A —
>    and no migrated script SHALL import a third-party package before that
>    step has run. That step SHALL install every package reachable through
>    the transitive closure of the root package's own `dependencies`, and
>    SHALL install no package reachable ONLY through the transitive closure
>    of the root package's `devDependencies` (the release and lint tooling)
>    and no package reachable ONLY through a workspace's own dependencies
>    under `extensions/`; a package reachable through both a root
>    `devDependencies` entry and some workspace's own dependencies — an
>    overlap package — MAY be present after the step runs, and such a
>    package is tolerated and is not a supported runtime dependency.
>    Sub-spec A SHALL verify the chosen command against the root
>    `package.json` workspaces and SHALL name it. Release tooling and other
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
>
>    This further corrects the closure clause itself, which is not part of
>    binding 1 as voted in issue #1192 — that vote said nothing about
>    `devDependencies` or workspace packages. The clause was added during
>    the SPECS-stage review of pull request #1239 as the remedy to finding
>    s1-F3 (`class: spec`, "R5, R6 and the first Scenario do not fit
>    together"; addressed at commit `de2a5b5`), which asked for a
>    whole-migration invariant on how a pinned runtime dependency reaches
>    the checkout, not for the "no `devDependencies`" wording specifically.
>    `0240.delta-01` requirement 4
>    (`specs/0240-runtime-foundations-shared-ts-modules.delta-01.md`)
>    already reworded the child sub-spec's own copy of this property, after
>    PLAN review finding v1-F2 (issue #1324, comment
>    <https://github.com/crewrig/crewrig/issues/1324#issuecomment-5866754935>)
>    measured that the real lockfile carries no `dev` flag on 94
>    `node_modules/*` entries while only 22 are actually installed, because
>    `ajv` and `ajv-formats` — both root `devDependencies` — are also
>    reachable through a workspace's own production closure. The disjoint
>    fixture v1-F2 used (root `dependencies: {ms}`, `devDependencies:
>    {semver}`, a workspace depending on `is-number`) installs only `ms`,
>    matching this closure property both before and after this correction;
>    the overlapping fixture (the workspace depends on `semver` instead)
>    installs `semver`, `lru-cache` and `yallist`, which the original "no
>    `devDependencies`" wording forbade outright and which this correction
>    now names as a tolerated overlap, not a supported runtime dependency.
>    PLAN review finding v2-F1 (issue #1324, comment
>    <https://github.com/crewrig/crewrig/issues/1324#issuecomment-5870564394>)
>    found that `0240.delta-01` reworded only the child sub-spec's copy of
>    the property and left this parent sentence saying "no
>    `devDependencies`" verbatim, so the child's own requirement 4 already
>    discharged a property the parent no longer stated identically; this
>    delta closes that gap by bringing the parent's wording to the same
>    shape as the child's.

## REMOVED

None.
