---
id: "0240"
slug: runtime-foundations-shared-ts-modules
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1324
version: 2.0.0
---

# Runtime foundations and shared TypeScript modules

## ADDED

**Scenario:** An overlapping dependency is tolerated, not rejected

Given the root `package.json` declares a `devDependencies` entry and a
workspace under `extensions/*/*` that declares the same package as one of
its own production dependencies
When `npm ci --omit=dev --workspaces=false` runs at the repository root
Then that package, and any of its own transitive dependencies reachable
through the workspace's production closure, remain installed under
`node_modules` as a tolerated overlap package, and the pull request is not
rejected for their presence.

**Scenario:** The dependency step is skipped when the lockfile is unchanged

Given a checkout with a record of a successful prior run of the dependency
step of requirement 4 and the `package-lock.json` content hash recorded at
that run
When setup reaches the dependency step and the current `package-lock.json`
content hash matches the recorded hash
Then setup skips the step, reports to the user that it was skipped and why,
and does not invoke `npm ci`.

## MODIFIED

Requirement 4 — the closure property the dependency step's command SHALL
satisfy, corrected against the empirical lockfile behaviour PLAN review
finding v1-F2 measured (94 `node_modules/*` entries carry no `dev` flag in
the real lockfile, but only 22 are actually installed; the residue is the
intersection of the root `devDependencies` closure with a workspace's
production closure, not "every package a workspace's closure reaches"):

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 4. **Production-dependency step — command and verification.** The
>    dependency step SHALL run `npm ci --omit=dev --workspaces=false` at
>    the repository root, which this sub-spec SHALL verify, against the
>    root `package.json` `workspaces` field, installs only the transitive
>    closure of the root package's own `dependencies` — no
>    `devDependencies`, and no package declared only by a workspace under
>    `extensions/*/*` — discharging the command-naming half of parent
>    requirement 6.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 4. **Production-dependency step — command and verification (reworded at
>    delta-01).** The dependency step SHALL run `npm ci --omit=dev
>    --workspaces=false` at the repository root. This sub-spec SHALL
>    verify, against the root `package.json`'s `workspaces` field and the
>    committed lockfile, that the command: (a) installs every package
>    reachable through the transitive closure of the root package's own
>    `dependencies`; (b) installs no package reachable ONLY through the
>    transitive closure of the root package's `devDependencies`; (c)
>    installs no package reachable ONLY through a workspace's own
>    dependencies under `extensions/*/*`, and installs and links no
>    workspace package itself. A package reachable through both a root
>    `devDependencies` entry and some workspace's own dependencies — an
>    overlap package — MAY be present after the command runs; such a
>    package is tolerated, is not a supported runtime dependency, and
>    SHALL NOT be imported by a migrated script — discharging the
>    command-naming half of parent requirement 6.
>
>    This corrects the original wording, which PLAN review finding v1-F2
>    (issue #1324, comment
>    <https://github.com/crewrig/crewrig/issues/1324#issuecomment-5866754935>)
>    showed does not hold on the real repository tree: `ajv` and
>    `ajv-formats`, both root `devDependencies`, are installed by the
>    command anyway, because the lockfile records no `dev` flag for a
>    package a workspace's production closure also reaches. A disjoint
>    fixture (root `dependencies: {ms}`, `devDependencies: {semver}`, a
>    workspace depending on `is-number`) already satisfies the corrected
>    wording exactly as it satisfied the original. An overlapping fixture
>    (the workspace instead depends on `semver`) installs `semver`,
>    `lru-cache` and `yallist` — all reachable through both the root
>    `devDependencies` closure and the workspace's own production
>    closure — which the corrected wording now names as tolerated overlap
>    rather than a violation. The clause is deliberately not "named":
>    this spec introduces no manifest or list where overlap-package names
>    are recorded, so a delta that wanted such a record would have to
>    name where it lives. The SHALL NOT clause is stated as a bare
>    normative bar, not as a description of an existing enforcement
>    mechanism: `scripts/lib/require-dependency.ts` (requirement 7) guards
>    only a caller that resolves the package through its `loadDependency`
>    function, and nothing in this spec yet stops a migrated script's
>    static `import` of an overlap package from bypassing that guard,
>    since the package genuinely exists on disk once the dependency step
>    has installed it.

Requirement 5 — the dependency step's re-run condition, aligned with
`specs/0215-shell-to-typescript-migration.delta-02.md`'s narrowing of
parent requirement 6 from an unconditional re-run to a lockfile-hash
gate:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 5. **Production-dependency step — wiring and re-run.** Each of
>    `scripts/setup-claude-interactive.sh`,
>    `scripts/setup-gemini-interactive.sh`,
>    `scripts/setup-copilot-interactive.sh` and
>    `scripts/setup-antigravity-interactive.sh` SHALL run the dependency
>    step of requirement 4 on every invocation, not only on a first
>    install, before any step of that script that could depend on a
>    third-party package.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 5. **Production-dependency step — wiring and re-run (aligned with
>    `0215.delta-02` at delta-01).** Each of
>    `scripts/setup-claude-interactive.sh`,
>    `scripts/setup-gemini-interactive.sh`,
>    `scripts/setup-copilot-interactive.sh` and
>    `scripts/setup-antigravity-interactive.sh` SHALL run the dependency
>    step of requirement 4, before any step of that script that could
>    depend on a third-party package, when the current checkout holds no
>    record of a previously successful run of that step, or when the
>    content hash of the repository's committed `package-lock.json`
>    differs from the hash recorded at that prior successful run.
>    Otherwise it SHALL skip the step and report to the user, by name,
>    that the step was skipped and why. Each script SHALL record its own
>    successful run and the `package-lock.json` content hash at that time,
>    so a later invocation can make this comparison.
>
>    This aligns with parent requirement 6 as narrowed by
>    `specs/0215-shell-to-typescript-migration.delta-02.md`, decided by
>    @hcross on issue #1324 (PLAN review finding v1-F2) because `npm ci`
>    deletes `node_modules` — wiping every contributor's sub-spec A1
>    `devDependencies` toolchain — and needs the network on every setup
>    run, for no benefit on the common case where `package-lock.json` has
>    not changed since the last successful run. The residual
>    missing-dependency diagnostic of requirement 7, for a script that
>    cannot resolve a package after a `git pull` without a setup re-run,
>    is unaffected: a pull that adds a runtime dependency also changes
>    `package-lock.json`'s content hash, so the next setup run still
>    re-installs.

## REMOVED

None.
