---
id: "0310"
slug: framework-release-unit-and-integrity
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2062
version: 1.1.0
---

# Framework release unit and release integrity (WP2 of epic 1822)

Delta 01 of [spec 0310](0310-framework-release-unit-and-integrity.md), raised by review finding i1-F4 (seat `review/2062`, pass 2, implementation PR #2069): R7 and R9 say "single job" while the implementation has two. Owner decisions of 2026-11-18, [#2062](https://github.com/crewrig/crewrig/issues/2062): each release workflow is split into a read-only build job and a publish job, and every `uses:` of the two release workflows is pinned to a commit. The implementation (PR #2069, head `0bc7877e`) already meets the stricter reading; this delta records it. The version is MINOR: new requirements and scenarios, and modified wording that tightens R6, R7 and R9 without invalidating the implementation.

**Roles and ids.** This delta speaks of two roles, *the build job* and *the publish job*. At `0bc7877e` of PR #2069 their ids are `release-framework-prerelease-build` and `release-framework-prerelease` in `release-framework-prerelease.yml`, and `release-framework-stable-build` and `release-framework-stable` in `release-framework-stable.yml`. The ids are the implementation's choice; every requirement binds the role. In the base spec and its scenarios, "the job" and "a release job" mean the job that performs the act named: the build job for the version check, the build and the digest computation, the publish job for the release, the asset, the comparison with GitHub's digest and the attestation (see the MODIFIED entries on R1, R4, R5 and R11).

## ADDED

- **R16 (build job and publish job).** Each of the two release workflows SHALL consist of a build job and a publish job, the publish job declaring `needs` on the build job. The build job SHALL hold the permission `contents: read` only and SHALL declare no environment and read no secret. In this order it SHALL: run the guard script of R12 (the stable workflow first lists the published releases the guard reads), failing on any ref or commit the guards refuse, before any dependency installation; then run `npm ci --omit=dev --ignore-scripts` and `scripts/build-components.ts`; then build the archive, its notes and its digest; then hand the archive, the notes and the digest to the publish job as a workflow artifact, and the asset name and digest as job outputs. The publish job SHALL download that artifact, SHALL recompute the SHA-256 of the archive and SHALL fail before it attests or publishes anything when that digest, the digest file of the artifact or the digest line of the notes differs from the digest the build job output; it SHALL re-run the guard script on the refs as they are at that moment, then attest (R11) and publish. In the stable workflow only the publish job SHALL declare the environment `framework-release` and mint the App token, and it SHALL mint it after the digest check, the guards and the attestation, so that a run that fails earlier has used no credential. A failed build job SHALL leave the publish job unstarted, and so the environment unapproved and the release and tag uncreated.

- **R17 (no install or compile where a privilege is held).** No dependency installation and no compile step (`npm ci`, `npm install`, `scripts/build-components.ts` or any build tool) SHALL run in a job that holds a write permission, the `id-token` permission, the environment `framework-release` or the App token. The repository code the publish job of each release workflow runs (the Node.js floor guard, the digest check, the guard script and the publisher) SHALL have an import closure of Node.js built-in modules and files of the repository only; besides that code it MAY run pinned actions (R18) and the `gh` command-line tool of the runner image (for example to list releases), so that no downloaded dependency executes where a privilege is available.

- **R18 (pinned actions in the release workflows).** Every `uses:` line of the two release workflows SHALL have the form `owner/repo@<40 hexadecimal characters>` followed by a trailing comment `# v<X.Y.Z>` naming the tag the SHA was resolved from. A tag, a branch, a short SHA, or a full SHA without that comment SHALL be refused. A local reference (`uses: ./...`) and a `docker://` reference SHALL also be refused in these two files: nothing in them needs either, and none is present at `0bc7877e`; a later need extends this requirement by a delta-spec. Workflows other than these two keep their `uses:` lines unchanged by this requirement. A test SHALL fail on a `uses:` line of either file that does not have this form.

**Added scenarios.**

**Scenario:** The build job cannot write or reach a secret

Given a release workflow run
When its build job runs the guard, the dependency install, the component build and the archive build
Then its token holds `contents: read` only, it declares no environment, no secret is readable by it, and no release, tag or attestation is created by it.

**Scenario:** The build job runs the guards before any install

Given a release workflow run on a ref or a commit the guards refuse (for the stable workflow, any ref other than `main`)
When the build job starts
Then it fails at the guard step before `npm ci` runs, and the publish job does not start.

**Scenario:** A dispatcher without the administrator role runs only the build job

Given the stable workflow is on `main` and an account holding the Write role dispatches it on `main`
When the run starts
Then the build job runs without approval, with a read-only token and no secret, and the publish job waits for an administrator; on any other ref the build job fails at its guard.

**Scenario:** The publish job installs and compiles nothing

Given the publish job of either release workflow
When it runs
Then its steps contain no `npm ci`, no `npm install` and no `scripts/build-components.ts`, and the repository code it runs imports only Node.js built-ins and repository files.

**Scenario:** A tampered artifact is refused

Given the build job output the digest `D1` and the artifact the publish job downloads holds an archive whose SHA-256 is `D2`
When the publish job reaches its digest check
Then it fails before the attestation and before the App token is minted, and no release or tag exists.

**Scenario:** The stable credential is minted last, in the publish job only

Given an approved stable run on `main`
When the publish job passes the digest check, the guards and the attestation
Then the App token is minted in that job and no earlier step, and the build job never declared the environment `framework-release`.

**Scenario:** A failed build job leaves the stable run unapproved

Given the stable build job fails a guard
When the run ends
Then the publish job has not started, the environment has asked no administrator for approval, and no tag or release exists.

**Scenario:** An action reference outside the pin form is rejected

Given a `uses:` line in either release workflow that is `actions/checkout@v4`, or a short SHA, or a full 40-character SHA with no `# v<X.Y.Z>` comment, or `./.github/actions/x`, or `docker://alpine:3`
When the test of R18 runs
Then it fails naming the file and the line; a line `owner/repo@<40 hex> # v<X.Y.Z>` passes.

**Added out of scope.**

- Pinning the `uses:` lines of any workflow other than the two release workflows.
- Pinning or auditing the runner image, Node.js itself, or the packages `npm ci --omit=dev --ignore-scripts` installs in the build job beyond what the lockfile fixes.
- Reproducible archive builds; a changed build-job image or action is caught by the digest comparison of the publish job only against the same run's build output.

## MODIFIED

Original, R1:

> A release job SHALL fail, before it creates a release or uploads an asset, when `X.Y.Z` of its tag differs from the version declared in the tagged commit;

Replacement:

> The build job SHALL fail, before it installs a dependency or builds an archive, and the publish job SHALL fail, before it creates a release or uploads an asset, when `X.Y.Z` of its tag differs from the version declared in the tagged commit;

Original, R4:

> The job SHALL compute that digest from the archive bytes and SHALL compare it with the digest GitHub computes for the uploaded asset (`assets[].digest` of the release API) before it publishes; on a mismatch it SHALL publish nothing.

Replacement:

> The build job SHALL compute that digest from the archive bytes and write the block into the notes; the publish job SHALL recompute it and compare it with the build job's digest (R16), and, once the asset is uploaded, SHALL compare it with the digest GitHub computes for the uploaded asset (`assets[].digest` of the release API) before it publishes; on a mismatch it SHALL publish nothing.

Original, R5:

> The job SHALL fail, publishing nothing, when a published release already exists for the tag.

Replacement:

> The publish job SHALL fail, publishing nothing, when a published release already exists for the tag.

Original, R5:

> A leftover unpublished draft of the same tag from an earlier failed run SHALL be deleted by the job before it creates a new one;

Replacement:

> A leftover unpublished draft of the same tag from an earlier failed run SHALL be deleted by the publish job before it creates a new one;

Original, R11:

> Each framework release job SHALL publish a build-provenance attestation of the archive, signed under the workflow that built it.

Replacement:

> The publish job of each framework release workflow SHALL publish a build-provenance attestation of the archive, signed under the workflow that built it.

Original, R6:

> It SHALL run with the repository's default `GITHUB_TOKEN` raised to the permissions it needs (`contents`, `id-token`, `attestations`) and SHALL read no environment secret and no GitHub App credential, so that it can create neither a stable-form tag nor any tag other than the one that triggered it.

Replacement:

> Its build job (R16) SHALL run with the repository's default `GITHUB_TOKEN` at `contents: read`; its publish job SHALL raise that token to the permissions it needs (`contents`, `id-token`, `attestations`). Neither job SHALL read an environment secret or a GitHub App credential, so that the workflow can create neither a stable-form tag nor any tag other than the one that triggered it.

Original, R7:

> Its single job SHALL declare the deployment environment of R9, which holds the job until an administrator approves it, and SHALL fail, before it uses the credential, unless:

Replacement:

> Its publish job (R16) SHALL be the only job that declares the deployment environment of R9, which holds that job until an administrator approves it; its build job SHALL run first, read-only, with no environment. The build job SHALL run the guards below before any dependency installation, and the publish job SHALL run them again, and SHALL fail, before it uses the credential, unless:

Original, R7:

> It SHALL then build, attest (R11), create the unpublished release targeting that commit, attach the asset, apply R4, and publish; the tag is created by that publication, so a run that fails earlier leaves no tag.

Replacement:

> The build job SHALL then build the archive and write the block of R4 into its notes; the publish job SHALL check the digest (R16), attest (R11), create the unpublished release targeting that commit, attach the asset, compare the digest with GitHub's (R4), and publish; the tag is created by that publication, so a run that fails earlier leaves no tag.

Original, R9:

> the job of R7 is the only job that declares the environment.

Replacement:

> the publish job of R7 is the only job that declares the environment, and the only job that can read the App key.

Original, R9:

> A run on any other ref, the release branch included, SHALL be refused before any step starts and SHALL see no secret.

Replacement:

> A dispatch of the stable workflow on any ref, by any actor who can dispatch it, SHALL start the build job without approval: with a read-only token, no environment and no secret, and with the guards of R7 run before any dependency installation, so that on a ref other than `main` it fails at once and the publish job does not start. The environment, with its administrator approval and its `main`-only branch policy, gates the publish job alone: a publish job on a ref other than `main`, the release branch included, SHALL be refused before any step starts and SHALL see no secret.

Original, R9 (last sentence):

> the approval is the control, and it is a human one.

Replacement:

> the approval is the control, and it is a human one. A dispatcher can also run the build job without approval; on `main` it installs the production dependencies and compiles the trees with a read-only token and no secret, which exposes no credential and publishes nothing.

Original, scenario "The stable release runs from `main`":

> Then the job gets the environment secrets, builds and attests `crewrig-1.0.0.tgz`, creates the unpublished release targeting the head of `main`, publishes it so that the tag `crewrig-v1.0.0` appears, and the checks of R11 succeed against `origin/main`.

Replacement:

> Then the build job, with a read-only token and no secret, builds `crewrig-1.0.0.tgz` and its digest; after an administrator approves, the publish job checks the digest, attests the archive, mints the App token, creates the unpublished release targeting the head of `main`, publishes it so that the tag `crewrig-v1.0.0` appears, and the checks of R11 succeed against `origin/main`.

Original, scenario "A digest mismatch aborts the release":

> When the job reaches the comparison of R4

Replacement:

> When the publish job reaches the comparison of R4

Original, scenario "A Write-role account dispatches the stable workflow":

> Then the job waits for approval and no secret is exposed; when no administrator approves, or one denies, it publishes nothing and the tag does not exist.

Replacement:

> Then the build job runs without approval, read-only and with no secret, and the publish job waits for approval and no secret is exposed; when no administrator approves, or one denies, nothing is published and the tag does not exist.

Original, scenario "The stable workflow is refused off `main`":

> Then the environment refuses the run before any step starts and no secret is exposed.

Replacement:

> Then the build job fails at its guard, the publish job does not start, and the environment refuses it before any step starts if it did; no secret is exposed.

## REMOVED

Nothing is removed. The word "single" before "job" in the R7 sentence quoted above is replaced, not deleted as a requirement.

The two changes were decided by the owner on 2026-11-18 and no question remains open.
