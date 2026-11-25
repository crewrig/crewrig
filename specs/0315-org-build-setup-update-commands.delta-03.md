---
id: "0315"
slug: org-build-setup-update-commands
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2146
version: 1.3.0
---

# The `build`, `setup` and `update` commands of the organization config repository (WP4 of epic 1822)

Settles how a two-root run (R6) supplies the marker fields that spec 0316 stamps, which the archive of R11 and the organization directory (0314 R12) cannot supply today. Spec 0316 takes the marker field `package` from the `name` of the root `package.json` (0316 R2), at build time and at deploy time (0316 R11), and resolves `${CANONICAL_REPO}` and the `feedback` rule of spec 0030 from `crewrig.config.toml`. Pointers read at the sync branch `chore/1822-sync-main-20261125` (PR #2147), where the 0316 code reaches the release branch; line numbers are those of that branch.

Evidence, three defects of one cause (a two-root run has no checkout root):

- The archive root `package.json` is `{"type": "module"}` (`scripts/lib/framework-release/archive-package.json:1`, R11), and the organization repository has no `package.json` (0314 R12). `crewrig build` compiles into a temporary out root (`scripts/lib/crewrig-cli/compile.ts:75`, `roots: {framework: versionRoot, source: orgDir, out: outDir}`), and the build reads `package.json` at that out root (`scripts/lib/build-components/main.ts:135`, `:165`, through `packageNameOf`, `scripts/lib/provenance-marker.ts:170-184`): 24 failures of `scripts/tests/crewrig-module-type.test.ts` (`<tmp>/crewrig-compile-XXXX/package.json: cannot be read as JSON; name is required`).
- `stampBase` (`scripts/lib/setup/rule-stamp.ts:29-47`) reads `package.json` at `ctx.repoDir`, the pinned version root, and throws "`name` is missing" on the archive's file (issue 2146, defect 1). The `rules-shared` step calls it at `scripts/lib/setup/steps-rules.ts:185`.
- `stampBase` resolves placeholders with `loadConfig(ctx.repoDir, ...)` (`rule-stamp.ts:42`); in a two-root run `crewrig.config.toml` is in the organization directory, so `${CANONICAL_REPO}` stays literal in the deployed `canonical` and `feedback` (issue 2146, defect 2), which breaks the provenance routing of frictions.

Decided by the owner (not reopened here): the archive `package.json` gains a `name`, whose value is the framework's root package name `crewrig`, rather than a new source (such as `crewrig.entry.json`) or a hard-coded constant.

Cumulative effect: R11 is amended (one JSON object with two members instead of one); R6 gains two sentences (the package-name source and the configuration root of a two-root run); six scenarios are added. R5 is unchanged: `build` and `setup` already share the compile. Every other requirement and scenario of the parent and of delta-01 and delta-02 is unchanged. Spec 0316 is not edited (one-file rule); the open question on its wording is stated below.

Settled by the owner on 2026-11-25 (review s1-F2): 0316 R2 and R11 say `package` is "the `name` of the root `package.json`" without naming the root in a two-root run. This delta reads the root as the framework root, a refinement that 0316 already permits, so 0316 is not changed. Consequence accepted by the owner: in a two-root run, the components authored in the organization directory also carry `package="crewrig"`; `package` names the framework that wrote the marker, and the organization is identified by `feedback`. Review s1-F1 is settled by the qualified sentence of R6 below: placeholders stay literal only when the organization has no `crewrig.config.toml`, exactly as in the build.

## ADDED

### Scenario "the archive package.json holds the name and the type"

```text
Given the framework release archive built from a checkout whose root package.json declares workspaces and no `type`
When  its root `package.json` is read
Then  it is one JSON object with exactly two members, `name` with the value `crewrig` and `type` with the value `module`, and it is not a copy of the repository's `package.json`.
```

```text
Given the archive-root file and the repository's own root `package.json`
When  the two are compared
Then  the `name` of the archive file equals the `name` of the repository file, so that a rename of the framework's root package fails a check instead of drifting.
```

### Scenario "build under any ancestor module type stamps package crewrig"

```text
Given an organization directory with one skill and a pinned version root whose `package.json` is the archive's, and an ancestor `package.json` of the version root declaring "type": "commonjs" (a second run: "type": "module")
When  the user runs `node crewrig build`
Then  it exits 0 with no module-type error and no warning on standard error, and every marker in `dist/`, the organization's own skill included, carries `package="crewrig"`, read from the `package.json` of the version root and never from the temporary out root.
```

```text
Given the same organization and a version root whose `package.json` has no `name`
When  the user runs `node crewrig build`
Then  it exits 1 with a message naming the version root's `package.json` and the missing `name`, and the `dist/` of a previous successful build is unchanged.
```

### Scenario "setup in a two-root run stamps rules with the organization's configuration"

```text
Given an organization directory whose `crewrig.config.toml` sets `canonical_repo`, a pinned version root whose `package.json` is the archive's and that holds no `crewrig.config.toml`, and a rule whose authored provenance has `canonical: ${CANONICAL_REPO}`
When  the user runs `node crewrig setup --cli <name>` for each of the four CLIs
Then  the `rules-shared` step succeeds, every deployed rule marker carries `package="crewrig"`, and its `canonical` and `feedback` hold the configured repository with no `${...}` text left.
```

```text
Given the same run where the organization directory has no `crewrig.config.toml`
When  `setup` stamps the rules
Then  the step behaves as `crewrig build` does for the same organization (same resolution outcome for the placeholders), reads nothing from the version root's configuration, and leaves the organization directory unchanged.
```

### Scenario "the checkout flow is unchanged"

```text
Given a checkout of the repository, whose root `package.json` carries the `name` `crewrig`, and a single-root run of `build` and of `setup --cli <name>`
When  both run
Then  the `package` of every marker is the `name` of that root `package.json`, the placeholders resolve from the checkout's `crewrig.config.toml`, and the output is byte-identical to the run before this delta.
```

## MODIFIED

### R11, first sentence

Original sentence:

```text
The archive SHALL contain, at its root, a file `package.json` that is one JSON object with exactly one member, `type`, whose value is `module`, and that is not a copy of the repository's own `package.json`.
```

Replacement:

```text
The archive SHALL contain, at its root, a file `package.json` that is one JSON object with exactly two members, `name`, whose value is `crewrig` (the `name` of the framework's root `package.json`), and `type`, whose value is `module`, and that is not a copy of the repository's own `package.json`. The module-type behaviour of the rest of R11 is unchanged: `name` has no effect on how a file loads.
```

### R6, last sentence

Original sentence (as amended by delta-02):

```text
An organization run SHALL take the step list of the same CLI's checkout run with two changes, and a checkout run SHALL take neither.
```

Replacement: the sentence is kept, and the following two sentences are appended at the end of R6.

```text
In a two-root run, the `package` field of every marker (0316 R2), whether written by the compile of R5 or by the rule and system-context stamping of `setup` (0316 R11), SHALL be the `name` of the `package.json` at the version root, the framework root; it SHALL NOT be read from the temporary out root of the compile nor from the organization directory, and a version root whose `package.json` has no non-empty `name` SHALL end the command with code 1 naming that file. In a two-root run, the placeholders of the markers written by `setup` (`${CANONICAL_REPO}` and the `feedback` rule of spec 0030) SHALL be resolved from the `crewrig.config.toml` of the organization directory, the same file the compile of R5 reads, so that no literal placeholder remains in a deployed marker, except when the organization directory has no `crewrig.config.toml`: the existing warning then applies and the placeholders stay literal, exactly as in the compile; the version root's own `crewrig.config.toml` is not read for this purpose, and the file is only read, never written (R12). In a checkout run both sources remain the repository root.
```

## REMOVED

(none)
