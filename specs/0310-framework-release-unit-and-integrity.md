---
id: "0310"
slug: framework-release-unit-and-integrity
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2062
version: 1.0.0
---

# Framework release unit and release integrity (WP2 of epic 1822)

## Intent

CrewRig maintainers can publish the framework as a release of its own: a prerelease for human acceptance, cut only from the reviewed release branch, and, once the work has reached `main`, a stable release cut from `main` alone. Each release carries one archive and its published SHA-256 digest, so that an organization author can write the pin from the release page and can check that the release is authentic. Nobody below the maintainer role can obtain a prerelease, nobody can obtain the stable credential without an administrator's approval, a stable tag cannot be created or reused by mistake, a published release is never altered, and the repository holds a dated record that these controls were checked against the live repository before the first prerelease.

## Requirements

Parent: [spec 0288](0288-distribution-model.md) (R8, R9, R16 to R18, R24 to R26, R31) and [ADR-0022](../docs/adr/0022-distribution-model.md). This spec designs the mechanism those requirements leave open; it restates a parent obligation only where the mechanism needs it. Facts marked *verified 2026-11-17* were read from `crewrig/crewrig` with read-only `gh api` calls on that date; no repository setting was changed to write this spec. Every control in R8 to R11 is a repository setting, hence an act of a repository administrator (0288 R31), never of a `spec-author`, `developer` or reviewer agent. Every pull request of this ticket targets `release/1822-distribution` (0288 R16, R18).

1. **R1 (unit, tags and version source).** The framework SHALL be a release unit named `crewrig`, tagged `crewrig-v<X.Y.Z>` for a stable release and `crewrig-v<X.Y.Z>-next.<N>` for a prerelease (0288 R9, R26). The version SHALL be declared in exactly one committed place, the `version` field of the root `package.json` (today `1.0.0`, with `private: true`, verified 2026-11-17). A release job SHALL fail, before it creates a release or uploads an asset, when `X.Y.Z` of its tag differs from the version declared in the tagged commit; changing the declared version is a reviewed change to that file and the only permitted path to a new version.

2. **R2 (extension units untouched).** The extension release engine (`scripts/monorepo-release.ts`) SHALL keep its `<ext>-v<version>` tag format, its release-pull-request flow and its `release-monorepo.yml` trigger unchanged, except for the one change that R10 allows when its compatibility check fails. It SHALL refuse, exit non-zero and create no tag when a directory of `extensions/*/*` is named `crewrig`, which keeps `<ext>-v*` and `crewrig-v*` disjoint (0288 R9). When no extension is so named it SHALL behave exactly as before. The tag rulesets of R8 SHALL NOT match `<ext>-v*` or `spec-id/*` tags.

3. **R3 (asset).** A framework release SHALL carry exactly one asset, `crewrig-<version>.tgz`, where `<version>` is the full version of the tag, `-next.<N>` included for a prerelease, so that the download path of 0288 R5 (`<base>/<tag>/crewrig-<version>.tgz`) resolves for a pin naming that version (owner decision 2026-11-17, #2062: 0288 R4 and R5 prevail, so the prerelease asset is `crewrig-1.0.0-next.1.tgz`, not `crewrig-1.0.0.tgz`; the 0288 scenario that says otherwise is corrected by a separate one-file delta-spec of 0288 on `main`, pending and outside this ticket). The stable asset `crewrig-1.0.0.tgz` is built anew after the final merge, so its digest differs from the digest of the prerelease accepted in the run of 0288 R28; this is by construction, and the acceptance run does not vouch for the stable digest. The archive contents SHALL be those of 0288 R8 and SHALL be declared in one committed manifest: the build SHALL fail when a manifest entry is absent from the build output, and SHALL NOT ship a file the manifest does not list. The entry points the launcher spec adds (WP3, WP4) join the manifest in their own pull requests; no bundled command-line entry point exists on the release branch on 2026-11-17, so `crewrig-v1.0.0-next.1` proves the pipeline and the controls only, and the run of 0288 R28 SHALL use a later prerelease published after WP3 and WP4 (owner decision 2026-11-17, #2062).

4. **R4 (digest on the release page).** The notes of every framework release SHALL carry a fixed block naming the tag, the asset name and the lowercase 64-character hexadecimal SHA-256 of the archive, ready to copy into the pin file (0288 R4). The job SHALL compute that digest from the archive bytes and SHALL compare it with the digest GitHub computes for the uploaded asset (`assets[].digest` of the release API) before it publishes; on a mismatch it SHALL publish nothing.

5. **R5 (publish once, never replace).** A framework release SHALL be created unpublished, receive its asset, and be published once. The job SHALL fail, publishing nothing, when a published release already exists for the tag. It SHALL NOT overwrite or re-upload an asset of a published release. A leftover unpublished draft of the same tag from an earlier failed run SHALL be deleted by the job before it creates a new one; it SHALL NOT be published as found. A defective release is superseded by a new version (0288 R9).

6. **R6 (prerelease workflow).** The prerelease workflow SHALL trigger on `push` of tags matching `crewrig-v*-next.*` and on nothing else (0288 R26), and its file SHALL live on the release branch only. Before it creates a release, it SHALL evaluate the three guards of 0288 R26 and the version check of R1, on refs it has just fetched from `origin`; a ref that cannot be fetched or resolved SHALL fail its guard. It SHALL mark the release *prerelease* and not *latest*. It SHALL run with the repository's default `GITHUB_TOKEN` raised to the permissions it needs (`contents`, `id-token`, `attestations`) and SHALL read no environment secret and no GitHub App credential, so that it can create neither a stable-form tag nor any tag other than the one that triggered it.

7. **R7 (stable release, designed, run only after the final merge).** The stable workflow SHALL trigger on manual dispatch only (owner decision 2026-11-17, #2062: a dispatch workflow on `main`, not a unit inside the release-pull-request flow; the stable path does not run `scripts/monorepo-release.ts`, which is a per-extension flow, and shares with the prerelease workflow only the version source of R1 and the guard script of R12), and its file SHALL reach `main` at the final merge of 0288 R29 and not before; GitHub dispatches a workflow only when its file is on the default branch, so no run is possible earlier (documented GitHub behaviour, not a repository fact). Its single job SHALL declare the deployment environment of R9, which holds the job until an administrator approves it, and SHALL fail, before it uses the credential, unless: the ref is `refs/heads/main`; the commit is the current head of `main`; the version of R1 is the input version; no tag `crewrig-v<X.Y.Z>` and no release of that name exists. The stable release SHALL NOT be marked *latest* (owner decision 2026-11-17, #2062). It SHALL then build, attest (R11), create the unpublished release targeting that commit, attach the asset, apply R4, and publish; the tag is created by that publication, so a run that fails earlier leaves no tag. The release SHALL NOT be created from the release branch (0288 R25).

8. **R8 (who may create `crewrig-v*` tags; three tag rulesets).** The repository SHALL carry three active tag rulesets, none of which the other controls replace: (a) *stable tags*: target `refs/tags/crewrig-v*` excluding `refs/tags/crewrig-v*-next.*`, rule `creation`, bypass limited to the GitHub App of R9; (b) *prerelease tags*: target `refs/tags/crewrig-v*-next.*`, rule `creation`, bypass limited to the repository roles Maintain and Admin; (c) *immutable tags*: target `refs/tags/crewrig-v*`, rules `update` and `deletion`, `bypass_actors: []`. A tag-creation attempt by any actor outside these bypass lists SHALL be refused by the forge, which closes squatting (a pre-created `crewrig-v1.0.0`) and a stable tag created by mistake from a maintainer account. No push by an actor outside these lists SHALL be required for any release.

9. **R9 (stable credential confined to `main`).** The stable credential SHALL be a dedicated GitHub App (owner decision 2026-11-17, #2062; creating and installing it is an administrator act) installed on this repository alone and the sole bypass actor of ruleset (a), with the single permission `contents: write`, whose identifier and private key are stored as secrets of one deployment environment, `framework-release`, and nowhere else (repository secrets are empty, verified 2026-11-17; the only environment today is `github-pages`). That environment SHALL restrict deployments to the single branch `main` and SHALL require approval by a repository administrator (required reviewers, limited to administrator accounts; owner decision 2026-11-18, #2062; an administrator act), so that an actor who can dispatch the workflow without that role (any Write-role account can) cannot reach the App key; the job of R7 is the only job that declares the environment. An administrator who approves a run SHALL first read the stable workflow file and the guard script at the commit being released and compare them with the last released version. A denied or unanswered approval leaves the job without a secret and publishes nothing. A run on any other ref, the release branch included, SHALL be refused before any step starts and SHALL see no secret. Residual risk, accepted: neither `main-protected` nor `release-protected` requires a pull-request review, so an edited stable workflow can reach `main` on green checks, and an administrator who approves its run without the read above gives it the App key; the approval is the control, and it is a human one.

10. **R10 (immutability and administrator delete-and-reuse).** The repository SHALL have immutable releases enabled repository-wide (owner decision 2026-11-17, #2062; `gh api repos/crewrig/crewrig/immutable-releases` → `enabled: false` on 2026-11-17), so that a published release's tag and assets cannot change; the notes of a release MAY be edited to name its successor. A tag that has a published release SHALL NOT be deleted and its name SHALL NOT be reused. A repository administrator MAY delete a `crewrig-v*` tag, and a later run MAY reuse its name, only when no published release exists for it (a tag whose guards failed, or an orphan from a failed run): the administrator SHALL suspend ruleset (c), delete that one tag, re-enable the ruleset, and record on #1822 the tag, the commit it pointed at, the reason and the re-enabled state on the same day. The controls of R8 to R10 outlive the release branch and the prerelease workflow (0288 R29). *Compatibility with extension releases:* the extension publisher creates its release through `@semantic-release/github` with a non-empty `assets` list (`scripts/lib/monorepo-release/releaserc-legs.ts:50-56`), and that plugin then creates a draft, uploads the assets and publishes by an update (`node_modules/@semantic-release/github/lib/publish.js:96-175`, read 2026-11-18), a sequence immutable releases accept; with an empty `assets` list it publishes directly (`:63-84`), which is why the glob must match. After immutable releases are enabled, the next `<ext>-v*` release that `release-monorepo.yml` publishes SHALL succeed with its archive attached; the result SHALL be recorded on #1822 (R14), at the latest before the first stable release. When it fails, no framework tag SHALL be pushed until the administrator and the owner have chosen between the minimal change to the extension publish leg that restores compatibility (the exception of R2) and disabling the setting (which R10 then no longer holds).

11. **R11 (authenticity and picking the pin).** Each framework release job SHALL publish a build-provenance attestation of the archive, signed under the workflow that built it. The notes of every release SHALL list, in order, the checks an author or recorder runs: (1) `gh release verify <tag> --repo crewrig/crewrig`; (2) `gh release verify-asset <tag> <downloaded archive> --repo crewrig/crewrig`, whose digest is the one the author writes into the pin; (3) `gh attestation verify <archive> --repo crewrig/crewrig --signer-workflow <the prerelease or the stable workflow path>`, then a comparison of the attested source commit with the branch: for a prerelease, while the release branch is unmerged, an ancestor of `origin/release/1822-distribution` and not of `origin/main`; for a stable release an ancestor of `origin/main`. After the final merge (0288 R29) every release-branch commit is an ancestor of `main`, so the prerelease form of that comparison no longer applies: an earlier prerelease is then verified by steps 1 and 2 and by an attested source commit that is an ancestor of `origin/release/1822-distribution`, and its recorded acceptance run (0288 R28) stands as made. The author SHALL take the pin digest from step 2 or from the block of R4 once both agree, and SHALL refuse a release where they differ. These checks establish that the release was produced by this repository's workflow from the stated commit; they do not vouch for the commit's content, and no signature by a person is promised (0288 *Out of scope*). The recorder of 0288 R28 SHALL run steps 1 to 3 before the run starts.

12. **R12 (guards testable offline).** The guard and version checks of R1 and R6 SHALL be implemented as one script that takes the tag and the two refs as arguments and writes nothing to the forge, with tests that run in a local temporary git repository and need no network: each guard passing and failing, a malformed tag, an unresolvable ref, a declared version that differs from the tag, a stable-path commit that is not the head of `main`, and an existing tag or release of that name; the same tests SHALL cover the manifest check of R3 (an absent entry fails the build, an unlisted file is not shipped) and a directory named `crewrig` under `extensions/*/*` (refused, R2).

13. **R13 (closing the `security-mcp.yml` gap, 0288 R24).** The implementation pull request of this ticket SHALL add `release/**` to `on.pull_request.branches` of `.github/workflows/security-mcp.yml` on the release branch; the change reaches `main` at the final merge. Until that pull request has merged, a pull request of WP2 to WP4 that changes a `package.json` or `package-lock.json` SHALL run `npm audit --audit-level=critical` locally and record the result on its logbook comment. A pull request that changes none of the paths the workflow lists needs no audit.

14. **R14 (verification record, before any release).** Before any `crewrig-v*-next.*` tag is pushed, a comment on #1822 SHALL record the verification of R8 to R10 on the live repository: the date; for the three tag rulesets and `release-protected`, the id, enforcement, `conditions.ref_name`, rule types and `bypass_actors`; the environment's deployment-branch policy and the names (never the values) of its secrets; the repository secret names; the `immutable-releases` setting; the repository collaborators and their roles; the result of each negative probe of the scenarios below, run with a real Write-role account, and, for the Maintain role, for which no account exists, the explicit statement "verified by configuration" with the ruleset bypass lists read (owner decision 2026-11-17, #2062); the `framework-release` environment's required reviewers, read; the result of the probe that the default `GITHUB_TOKEN` cannot create a stable-form tag (an administrator pushes to a scratch branch, not the release branch, a throwaway workflow file that triggers on `push`, declares `permissions: contents: write` (the repository default is `read`, so without it the probe would pass without testing the ruleset), exists only on that branch and attempts `crewrig-v0.0.0`; ruleset (a) refuses; the branch and file are deleted afterwards); and the result of the extension-release compatibility check of R10, or the statement that it is pending with the static reading of the plugin, to be recorded at the next extension release and before the first stable release. The Write-role dispatch probe of the scenario below cannot run before the final merge, because the stable workflow is not on `main` until then: the first record SHALL state it as pending, and the record re-made before the first stable release SHALL include it, run with a real Write-role account on the merged workflow, the run left waiting and then denied or cancelled by an administrator. The record SHALL be re-made, with the same content, before the first stable release and whenever one of these controls changes. Verification uses read-only calls and the probes; it changes no setting. When the record is missing or older than the last control change, a maintainer or agent SHALL stop and report to a repository administrator (0288 R31).

15. **R15 (first prerelease).** After the record of R14, the first prerelease `crewrig-v1.0.0-next.1` SHALL be pushed on the head of the release branch, published by the workflow of R6, and verified with the three checks of R11; the result SHALL be recorded on #1822. When it fails, the next attempt uses `next.2` (0288 R26).

## Scenarios

**Scenario:** A prerelease is published from the release branch (happy path)

Given the three tag rulesets, the `framework-release` environment and immutable releases are in place, the record of R14 is on #1822, and the head of `origin/release/1822-distribution` declares version `1.0.0`
When a maintainer pushes `crewrig-v1.0.0-next.1` on that head
Then the workflow runs, its guards and version check pass, an unpublished release receives `crewrig-1.0.0-next.1.tgz`, the job-computed digest equals GitHub's, the release is published as prerelease and not latest with the R4 block and the R11 checks in its notes, and the three checks of R11 succeed.

**Scenario:** The stable release runs from `main` (happy path, run after the final merge)

Given the final merge has landed, `main` declares `1.0.0`, and no `crewrig-v1.0.0` tag or release exists
When an administrator dispatches the stable workflow on `main`
Then the job gets the environment secrets, builds and attests `crewrig-1.0.0.tgz`, creates the unpublished release targeting the head of `main`, publishes it so that the tag `crewrig-v1.0.0` appears, and the checks of R11 succeed against `origin/main`.

**Scenario:** A non-maintainer cannot obtain a prerelease

Given an account holding the Write role and no higher
When it pushes `crewrig-v0.0.0-next.1` on any commit
Then the forge refuses the tag creation and no tag, workflow run or release exists.

**Scenario:** A maintainer cannot create a stable-form tag

Given an account holding the Maintain or Admin role
When it pushes `crewrig-v0.0.0` on any commit, to squat the name or by mistake
Then the forge refuses the tag creation and no tag exists.

**Scenario:** A published tag cannot be moved or deleted

Given the published prerelease `crewrig-v1.0.0-next.1`
When any actor, an administrator included, tries to force-update or delete that tag, or to publish a different asset under that tag
Then the forge refuses and the release is unchanged; the only permitted path to a different content is a new version.

**Scenario:** An administrator deletes an orphan tag and reuses its name

Given a tag `crewrig-v1.0.0-next.3` whose guards failed and which has no published release
When an administrator suspends ruleset (c), deletes that tag, re-enables the ruleset and records the four items of R10 on #1822
Then the name may be pushed again, and `crewrig-v1.0.0-next.1` stays untouched.

**Scenario:** A tag with a published release is never deleted

Given the published release `crewrig-v1.0.0-next.1`
When an administrator proposes to delete its tag to reuse the name
Then the request is declined and the next number `next.2` is used.

**Scenario:** A tag on a commit outside the release branch is refused

Given a feature-branch commit that carries the workflow and is not an ancestor of `origin/release/1822-distribution`
When a maintainer pushes `crewrig-v1.0.0-next.2` on it, even with an edited copy of the workflow that omits the guards
Then no stable-form tag, environment secret or App credential is reachable, and when a release is nevertheless published by the edited copy, check 3 of R11 finds the attested source commit outside the release branch and the author refuses it.

**Scenario:** The tag version differs from the declared version

Given a commit that declares `1.0.0`
When a maintainer pushes `crewrig-v1.0.1-next.1` on it
Then the job fails before creating any release and publishes nothing.

**Scenario:** A digest mismatch aborts the release

Given an uploaded asset whose GitHub-computed digest differs from the job-computed digest
When the job reaches the comparison of R4
Then it publishes nothing, leaves no published release, and the next run deletes the leftover draft (R5).

**Scenario:** A re-run finds a published release

Given the published prerelease `crewrig-v1.0.0-next.1`
When its workflow run is re-run
Then the job fails without uploading or overwriting any asset.

**Scenario:** The stable workflow is refused off `main`

Given the stable workflow file is present on the release branch (no run is possible before the final merge, since it is not on the default branch)
When an administrator dispatches it from a branch other than `main` after the final merge
Then the environment refuses the run before any step starts and no secret is exposed.

**Scenario:** An extension is named `crewrig`

Given a directory `extensions/core/crewrig`
When `scripts/monorepo-release.ts` runs
Then it exits non-zero naming the collision and creates no tag; with no such directory its output and tags are unchanged.

**Scenario:** No prerelease before the record

Given the implementation has merged but no comment on #1822 holds the record of R14
When a maintainer is about to push `crewrig-v1.0.0-next.1`
Then no tag is pushed and the missing record is reported to an administrator.

**Scenario:** A Write-role account dispatches the stable workflow

Given the final merge has landed so that the stable workflow is on `main` (this probe is run for the record made before the first stable release, not before the first prerelease), and the `framework-release` environment requires administrator approval
When an account holding the Write role and no higher dispatches it on `main`
Then the job waits for approval and no secret is exposed; when no administrator approves, or one denies, it publishes nothing and the tag does not exist.

**Scenario:** An administrator approves a run of an edited stable workflow

Given a Write-role account has merged an edit of the stable workflow to `main` on green checks, and an administrator approves a run without reading the file
When the job runs
Then it receives the App key, which is the residual risk R9 accepts; an administrator who first read the workflow at that commit, as R9 requires, denies the run.

**Scenario:** The stable job's guards refuse

Given the stable workflow is approved on `main`
When the commit is no longer the head of `main`, or the input version differs from the declared one, or `crewrig-v1.0.0` or a release of that name already exists
Then the job fails before it uses the credential and creates no tag and no release.

**Scenario:** The default token cannot create a stable-form tag

Given a throwaway workflow file triggered by `push`, present only on a scratch branch that is not the release branch and pushed by an administrator, declaring `permissions: contents: write` and running with the default `GITHUB_TOKEN`
When it attempts to create `crewrig-v0.0.0`
Then ruleset (a) refuses and no tag exists; had the tag been created, the administrator deletes it under R10 and R8 is recorded as not met; the branch and file are deleted after the probe.

**Scenario:** The next extension release publishes under immutable releases

Given immutable releases are enabled and a `<ext>-v*` release is due on `main`
When `release-monorepo.yml` publishes it with its archive
Then the release is published with the archive attached and the result is recorded on #1822; if it fails, no `crewrig-v*` tag is pushed until the choice of R10 is made.

**Scenario:** A manifest entry is absent from the build output

Given the manifest lists a path the build output lacks
When the archive is built
Then the build fails and no release or asset is created.

**Scenario:** A prerelease is verified after the final merge

Given `crewrig-v1.0.0-next.4` was published before the final merge and every release-branch commit is now an ancestor of `main`
When an author runs the checks of R11
Then steps 1 and 2 succeed and the attested source commit is an ancestor of `origin/release/1822-distribution`; the comparison "not an ancestor of `origin/main`" is not applied.

**Scenario:** A pull request changing `package.json` on the release branch

Given the pull request of R13 has not merged and a pull request of WP3 changes `package-lock.json`
When it is prepared for merge
Then `npm audit --audit-level=critical` has been run locally and its result is on the logbook comment; once R13 has merged, `security-mcp.yml` runs on the pull request.

## Out of scope

- The launcher, `crewrig init`, the pin file's path and syntax, the base URL names, `build`, `setup` and `update` (WP3, WP4); this spec only places their files in the manifest of R3.
- Running the stable release (0288 R25): it is designed here and runs only after the final merge.
- Signatures made by a person, Sigstore signing of commits, and any promise about a commit's content (0288 *Out of scope*): R11 proves the producing workflow and commit, nothing more.
- A ruleset or approval rule that makes a pull request review mandatory on the release branch or on `main`; neither `release-protected` nor `main-protected` has a `pull_request` rule (verified 2026-11-17: rules `deletion`, `non_fast_forward`, `required_status_checks` only), and this spec does not add one; the consequence for the stable credential is the residual risk of R9. "Reviewed commit" in 0288 R31 is read as: reachable from the release branch, which accepts only commits that passed the required checks.
- Changing `release-protected` or `main-protected` (0288 R17), and deleting the frozen `release/1231-ts-migration` branch.
- Required reviewers on the prerelease path (it has no environment), reproducible builds, npm publication (0288 R11), and the adopter documentation beyond the release notes (WP6).
- Changing the extension flow beyond the name check of R2 and the exception of R10.

## Open questions

None. After the first review pass, the owner decided on 2026-11-18 ([#2062](https://github.com/crewrig/crewrig/issues/2062)) that the `framework-release` environment requires administrator approval (R9). The seven questions of the first draft were answered by the owner on 2026-11-17 ([#2062](https://github.com/crewrig/crewrig/issues/2062)) and are recorded in R3 (asset name, stable digest, no bundled entry point yet), R7 (stable not latest, dispatch shape), R9 (dedicated GitHub App), R10 (immutable releases repository-wide) and R14 (probes with the Write account, Maintain verified by configuration). The one-file delta-spec of 0288 on `main` that corrects its prerelease scenario is pending and is not part of this ticket.
