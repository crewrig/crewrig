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

## ADDED

- **R16 (build job and publish job).** Each of the two release workflows (`.github/workflows/release-framework-prerelease.yml` and `.github/workflows/release-framework-stable.yml`) SHALL consist of a `build` job and a `publish` job, the second declaring `needs` on the first. The `build` job SHALL hold the permission `contents: read` only and SHALL declare no environment and read no secret; it SHALL run `npm ci --omit=dev --ignore-scripts`, the guard script of R12, `scripts/build-components.ts` and the archive and digest build, and SHALL hand the archive, its notes and its digest to the `publish` job as a workflow artifact, and the asset name and digest as job outputs. The `publish` job SHALL download that artifact, SHALL recompute the SHA-256 of the archive and SHALL fail before it attests or publishes anything when that digest, the digest file of the artifact or the digest line of the notes differs from the digest the `build` job output; it SHALL re-run the guard script on the refs as they are at that moment, then attest (R11) and publish. In the stable workflow only the `publish` job SHALL declare the environment `framework-release` and mint the App token, and it SHALL mint it after the digest check, the guards and the attestation, so that a run that fails earlier has used no credential. A failed `build` job SHALL leave the `publish` job unstarted, and so the environment unapproved and the release and tag uncreated.

- **R17 (no install or compile where a privilege is held).** No dependency installation and no compile step (`npm ci`, `npm install`, `scripts/build-components.ts` or any build tool) SHALL run in a job that holds a write permission, the `id-token` permission, the environment `framework-release` or the App token. The `publish` job of each release workflow SHALL run only the guard script and the publisher, whose import closure is the Node.js built-in modules and files of the repository, so that no downloaded dependency executes where a privilege is available.

- **R18 (pinned actions in the release workflows).** Every `uses:` line of the two release workflows SHALL name its action by a full 40-character commit SHA with the tag it was resolved from in a trailing comment; a tag, a branch or a short SHA SHALL NOT be accepted. Workflows other than these two keep their `uses:` lines unchanged by this requirement. A test SHALL fail on a `uses:` line of either file that is not so pinned.

**Added scenarios.**

**Scenario:** The build job cannot write or reach a secret

Given a release workflow run
When its `build` job runs the dependency install, the guard, the component build and the archive build
Then its token holds `contents: read` only, it declares no environment, no secret is readable by it, and no release, tag or attestation is created by it.

**Scenario:** The publish job installs and compiles nothing

Given the `publish` job of either release workflow
When it runs
Then its steps contain no `npm ci`, no `npm install` and no `scripts/build-components.ts`, and it runs only the guard script and the publisher with Node.js built-ins.

**Scenario:** A tampered artifact is refused

Given the `build` job output the digest `D1` and the artifact the `publish` job downloads holds an archive whose SHA-256 is `D2`
When the `publish` job reaches its digest check
Then it fails before the attestation and before the App token is minted, and no release or tag exists.

**Scenario:** The stable credential is minted last, in the publish job only

Given an approved stable run on `main`
When the `publish` job passes the digest check, the guards and the attestation
Then the App token is minted in that job and no earlier step, and the `build` job never declared the environment `framework-release`.

**Scenario:** A failed build job leaves the stable run unapproved

Given the stable `build` job fails a guard
When the run ends
Then the `publish` job has not started, the environment has asked no administrator for approval, and no tag or release exists.

**Scenario:** An unpinned action is rejected

Given a `uses: actions/checkout@v4` line in either release workflow
When the test of R18 runs
Then it fails naming the file and the line; a `uses:` line with a full 40-character SHA and a tag comment passes, and a short SHA fails.

**Added out of scope.**

- Pinning the `uses:` lines of any workflow other than the two release workflows.
- Pinning or auditing the runner image, Node.js itself, or the packages `npm ci --omit=dev --ignore-scripts` installs in the `build` job beyond what the lockfile fixes.
- Reproducible archive builds; a changed `build` job image or action is caught by the digest comparison of the publish job only against the same run's `build` output.

## MODIFIED

Original, R6:

> It SHALL run with the repository's default `GITHUB_TOKEN` raised to the permissions it needs (`contents`, `id-token`, `attestations`) and SHALL read no environment secret and no GitHub App credential, so that it can create neither a stable-form tag nor any tag other than the one that triggered it.

Replacement:

> Its `build` job (R16) SHALL run with the repository's default `GITHUB_TOKEN` at `contents: read`; its `publish` job SHALL raise that token to the permissions it needs (`contents`, `id-token`, `attestations`). Neither job SHALL read an environment secret or a GitHub App credential, so that the workflow can create neither a stable-form tag nor any tag other than the one that triggered it.

Original, R7:

> Its single job SHALL declare the deployment environment of R9, which holds the job until an administrator approves it, and SHALL fail, before it uses the credential, unless:

Replacement:

> Its `publish` job (R16) SHALL be the only job that declares the deployment environment of R9, which holds that job until an administrator approves it; its `build` job SHALL run first, read-only, with no environment. The `build` job SHALL run the guards below, and the `publish` job SHALL run them again, and SHALL fail, before it uses the credential, unless:

Original, R7 (sequence after the guards):

> It SHALL then build, attest (R11), create the unpublished release targeting that commit, attach the asset, apply R4, and publish; the tag is created by that publication, so a run that fails earlier leaves no tag.

Replacement:

> The `build` job SHALL build the archive and apply R4 to its notes; the `publish` job SHALL check the digest (R16), attest (R11), create the unpublished release targeting that commit, attach the asset, and publish; the tag is created by that publication, so a run that fails earlier leaves no tag.

Original, R9:

> the job of R7 is the only job that declares the environment.

Replacement:

> the `publish` job of R7 is the only job that declares the environment, and the only job that can read the App key.

Original, R9:

> A run on any other ref, the release branch included, SHALL be refused before any step starts and SHALL see no secret.

Replacement (the sentence is unchanged; its subject is the `publish` job, since the `build` job reads no secret):

> A `publish` run on any other ref, the release branch included, SHALL be refused before any step starts and SHALL see no secret.

## REMOVED

Nothing is removed. The word "single" before "job" in the R7 sentence quoted above is replaced, not deleted as a requirement.

The two changes were decided by the owner on 2026-11-18 and no question remains open.
