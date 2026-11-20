---
id: "0312"
slug: extension-version-in-provenance-carrier
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2075
version: 1.0.0
---

# The provenance carrier of an extension component names its extension and that extension's version

*Amending spec, not a delta-spec: the approved specs `0043`, `0044` and `0258` are immutable and no `class: spec` review finding drives this change, so it carries its own id (`docs/spec-format.md` → *Delta-spec convention*). R13 lists exactly which requirements it supersedes. Grounding, each point checked in the tree: (a) `extensions/core/hello-world/package.json` declares the name `hello-world-extension` and the version `2.1.1`, its `extension.json` declares the name `hello-world` and `2.1.1`, while its skill `greeter` and its agent `reference-guide` carry `version="1.0.0"`; (b) `scripts/lib/governance/ext-version-bump.ts` globs `extensions/<tier>/skills/*/SKILL.md` and `extensions/<tier>/agents/*/AGENT.md`, which no file of the nested layout `extensions/<tier>/<extension>/skills/<name>/SKILL.md` matches, so the bump guard has never examined a real extension component; (c) `scripts/lib/governance/ext-manifest-version.ts` already walks `extensions/{core,library}/*/package.json` and compares each sibling `extension.json` with it, and the release step `scripts/release-sync-manifests.ts` rewrites both files at release time (`scripts/lib/monorepo-release/prepare-cmd.ts`); (d) the maintainer principle of issue #1004 (comment 5387545134) removes a check whose subject disappears rather than leaving it green.*

## Intent

An extension has one version, the one its package declares, and that version covers everything the extension ships. A skill or an agent inside an extension no longer has a version of its own: the per-component version duplicates the package version, disagrees with it in the one extension that exists, and is protected by a check that never reaches a real component. The provenance carrier of such a component, the marker a friction is filed against, names the extension that owns the component and that extension's version, next to the origin it already names, so that every artifact a friction can be filed on says which extension and which version it belongs to. The build fails when a carrier and its extension's package disagree, as it already fails when a manifest does. A reviewer who runs the bundled skill linter on an extension skill is no longer given a false failure, and the checks and documents that spoke of a per-component version are removed instead of being left passing on nothing.

## Requirements

1. **R1 (extension target).** A target SHALL be an *extension skill* when its path, relative to the working directory and with `./` and backslashes normalised, has an `extensions/` segment, at any depth, followed by a tier segment (`core`, `library` or `org`) and then further segments. Every other target, an `artifacts/**` skill included, SHALL be an *ordinary skill* and SHALL be linted by the current rules with no change in findings, wording or exit status.
2. **R2 (skill linter, extension target).** For an extension skill, `artifacts/core/skills/pr-reviewer/scripts/lint-skill.ts` SHALL require `name` and `description` only. It SHALL NOT require `license`, `compatibility` or `metadata.provenance.version`, SHALL read no version from the frontmatter or the carrier, SHALL run no version-bump comparison, and SHALL NOT parse the carrier: the lockstep guard of R5 owns the version. A missing `name` or `description` SHALL produce the existing `missing required frontmatter key: <key>` finding. The script-citation check, the exit statuses, the `--json` shape and the `BASE_REF` handling SHALL be unchanged for every target, and the script SHALL stay one file with no `import` of a repository file.
3. **R3 (one version per extension).** The version declared by the extension package (`package.json`) SHALL be the only version of every skill, agent and command the extension ships. A skill or an agent of an extension SHALL NOT carry a version of its own and SHALL NOT have its own bump rule. The requirement that the manifests of one extension declare one version (`specs/0044-extension-versioning-manifest.md` requirements 5 and 6, as amended by its delta-01) stands.
4. **R4 (carrier content).** The `crewrig-provenance` carrier of a component under `extensions/core` or `extensions/library` SHALL carry four fields: `canonical`, `feedback`, `extension` (the identity of the owning extension: its name, which is the directory name of the extension and the `name` of its `extension.json`, for example `hello-world`; the extension name is the canonical identity, and the package name and the paths are derived from it by convention) and `version` (the version of the owning extension, not of the component). Routing to `canonical`, the self-contained origin, the preservation of the carrier on install and link, and the `feedback` equals `canonical` invariant (`specs/0043-extension-provenance-routing.md` requirements 2, 3, 4 and 5) stand. The carrier of a canonical `artifacts/**` component is unchanged.
5. **R5 (lockstep guard).** `scripts/check-extension-manifest-version.ts` SHALL, for every carrier of a skill or agent under `extensions/core/<extension>/` and `extensions/library/<extension>/`, fail the build when the carrier's `extension` or `version` differs from the value derived from the `package.json` of that extension directory, exactly as it fails when a divergent `extension.json` is found: one `FAIL` finding line per carrier naming the carrier file, the field and both values, exit status 1, and an `OK` line when they agree. A carrier whose extension directory has no `package.json`, or whose `extension` or `version` field is absent or empty, SHALL be a finding that names the file; it SHALL NOT be skipped. `extensions/org` SHALL NOT be scanned. The comparison of `extension.json` and its output are otherwise unchanged.
6. **R6 (a release keeps the carriers in lockstep).** The release step that rewrites `package.json` and `extension.json` SHALL rewrite the `version` of every carrier of that extension in the same step and the same commit, so that no release leaves a carrier at a version other than the one it publishes, and a contributor SHALL NOT be required to edit a carrier version by hand. A release of an extension with no carrier SHALL be unaffected. A contributor's hand edit of a carrier version SHALL still be caught by R5.
7. **R7 (provenance guard).** `check-extension-provenance` SHALL require a carrier on the first body line and non-empty `canonical`, `feedback`, `extension` and `version` for each component of `extensions/core` and `extensions/library`, reporting the missing fields by name, and SHALL NOT scan `extensions/org`. The comparison of the carrier against the package is R5's, not this guard's: the two checks SHALL NOT report the same defect twice. Its output, exit status and `feedback` equals `canonical` rule are otherwise unchanged.
8. **R8 (migration).** In the change that implements this spec the carriers of `greeter` and `reference-guide` SHALL be rewritten to carry `extension` and `version` equal to the values R5 derives from `extensions/core/hello-world/package.json` (today `2.1.1`), so that the guards of R5 and R7 pass on the tree the change leaves.
9. **R9 (bump guard removed).** The check `check-extension-version-bump` SHALL be removed, not repaired, in the same change that retires the per-component version it compared: the entry script, its library and message files under `scripts/lib/governance/`, its unit and suite tests, its `taskfiles/governance.yml` task, its job in `.github/workflows/_ci-governance.yml` and in `.gitlab-ci.yml`, its entry in `ci/capabilities/governance-other.yml`, its paths in `ci/capabilities/extensions-other.yml` (the `extension-manifest` capability stays, scoped to the lockstep checks, and its name no longer says "version-bump"), its fixtures and baselines under `scripts/tests/fixtures/taskfile-tree/`, its line in `ci/push-main-exemptions.txt`, and its lines in `docs/ci-reference-format.md` and `docs/shell-removal.md`. No replacement bump check SHALL be added: R5 is a lockstep, not a bump rule. A helper whose last reader was the removed guard SHALL be removed with it; `base-ref.ts` and `carrier.ts` SHALL stay while another check reads them.
10. **R10 (documents).** `docs/version-bump-convention.md` SHALL drop the extension-component section and the paragraph that distinguishes it from the manifest version, and SHALL state that an extension is versioned by its package version only, written at release time, with the carrier version kept in lockstep by R5 and R6. `artifacts/FORMAT.md`, `AGENTS.md` (the *Version Bump Convention* affected-paths list), `docs/cli-matrix/rows/4b.md`, `5b.md` and `5c.md` (and the rebuilt `docs/cli-matrix.md`) and the extension-authoring documentation SHALL show the four-field carrier of an extension component. Any other document that describes the extension carrier or a per-component version SHALL be updated.
11. **R11 (skill of the reviewer).** The `SKILL.md`, header comment and `references/` text of `pr-reviewer` that state the five required keys SHALL say that an extension skill needs `name` and `description` only, and the `metadata.provenance.version` of the skill and its agent SHALL be bumped per `docs/version-bump-convention.md`. A change under `artifacts/` SHALL be built and its outputs staged in the same commit.
12. **R12 (tests).** The change SHALL add or update tests for: `lint-skill` on the greeter skill (exit 0), an extension skill missing `name`, an ordinary skill that still reports the five keys, and a path that only resembles an extension (`artifacts/extensions/x/SKILL.md`, ordinary); the lockstep guard on agreeing carriers, a carrier with a divergent `version`, a divergent `extension`, an absent `version`, and a carrier with no `package.json`; `check-extension-provenance` on a four-field carrier (clean) and a carrier missing `extension`; the release step on an extension with and without carriers; and the task list, capability and taskfile baselines after R9. The suites of the removed guard SHALL be deleted, not skipped.
13. **R13 (what this spec supersedes).** This spec supersedes, by amendment and without editing them: `specs/0044-extension-versioning-manifest.md` requirements 1, 2, 3 and 4 in full and requirement 7 in so far as it covers the extension bump guard and its affected-paths list; `specs/0043-extension-provenance-routing.md` requirement 1 in so far as it fixes the fields of the carrier (now R4), requirement 6 in full (the version field is now the owning extension's version and is governed by R5), and requirements 7 and 8 in so far as they name the fields; and the sentence of `specs/0258-skill-extension-bundled-scripts-typescript.md` requirement 11 that applies the five required keys to every target. Every other requirement of those specs stands. The spec files themselves SHALL NOT be edited, apart from the lifecycle metadata the spec format allows.

## Scenarios

### Happy path

- **Given** `extensions/core/hello-world/skills/greeter/SKILL.md` with `name`, `description` and a carrier whose `extension` and `version` match its `package.json`,
- **When** `BASE_REF=origin/main node artifacts/core/skills/pr-reviewer/scripts/lint-skill.ts <that file>` runs,
- **Then** it reports no finding and exits 0.

### Happy path (lockstep)

- **Given** every carrier of `extensions/core/hello-world` declares the `extension` and `version` derived from its `package.json`,
- **When** `check-extension-manifest-version` runs,
- **Then** it prints an `OK` line for the extension and exits 0.

### Failure path (divergent carrier)

- **Given** a carrier that reads `version="1.0.0"` in an extension whose `package.json` declares `2.1.1`,
- **When** `check-extension-manifest-version` runs,
- **Then** it prints a `FAIL` line naming the carrier file, the field `version`, `1.0.0` and `2.1.1`, and exits 1.

### Failure path (carrier without an extension)

- **Given** an `extensions/core` component whose carrier has `canonical`, `feedback` and `version` but no `extension`,
- **When** `check-extension-provenance` runs,
- **Then** it reports a `FAIL` line naming the missing `extension` field and exits 1.

### Failure path (extension skill without a description)

- **Given** an extension skill whose frontmatter has `name` but no `description`,
- **When** `lint-skill.ts` runs on it,
- **Then** it reports `missing required frontmatter key: description` and exits 1, and no other key.

### Edge (release, ordinary skill)

- **Given** an extension released at a new version, and a canonical `artifacts/**` skill missing `license`,
- **When** the release step runs and `lint-skill.ts` runs on the canonical skill,
- **Then** `package.json`, `extension.json` and every carrier of that extension declare the new version in one commit, and the canonical skill still reports `missing required frontmatter key: license` exactly as before.

## Out of scope

- Dropping the version from the carrier (the variant that leaves the carrier with `canonical` and `feedback` only): rejected, because the long-term direction is that every artifact on which a friction can be filed carries markers naming its package, its owning extension and the associated version, and a carrier with no version would have to be reopened for it.
- Generating provenance markers uniformly for every artifact a friction can be filed on, in-place linked extensions included: tracked in issue #2078 ("Generated provenance markers on every frictionable artifact").
- Any per-component versioning of extension skills or agents under another name (a changelog field, a content hash).
- The shape of the carrier on canonical `artifacts/**` skills and agents, and `check-skill-versions` for them.
- Routing, harness curation, and the `feedback` equals `canonical` invariant, which this spec leaves as they are.
- Two pull requests (the linter fix first, the rest second): rejected, because the guard removal, the carrier migration and the lockstep guard must land together or continuous integration is red on `main`; the implementation is one pull request.
- A carrier `version` kept by hand by the contributor, with the guard only checking it, or a release step and a hand edit both writing it: rejected, because the release step already owns the version write and a second writer of one value drifts; R5 stays only a backstop.
- The package name as the value of `extension`, or a second `package` field: rejected, because the extension name is the canonical identity and the package name and the paths are derived from it.
- Detecting an extension by a path prefix relative to the repository root, or by the content of the file: rejected, because the first fails from a subdirectory and the second would class a core skill that lost its carrier as ordinary.
- `extensions/org` and third-party extensions: nothing in them is rewritten and no guard scans them.

## Open questions

None.
