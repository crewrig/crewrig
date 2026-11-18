# Framework release

<!-- crewrig-doc: published=false -->

How the framework is released as the `crewrig` unit, what an administrator does before approving a stable
run, and how a recorder checks a release before writing the pin. Contract: [spec 0310](../specs/0310-framework-release-unit-and-integrity.md),
parent [spec 0288](../specs/0288-distribution-model.md) and [ADR-0022](adr/0022-distribution-model.md).

## The two workflows

| Workflow | Trigger | Publishes | Runs from |
|---|---|---|---|
| `.github/workflows/release-framework-prerelease.yml` | push of a tag `crewrig-v<X.Y.Z>-next.<N>` | a prerelease, never latest | the release branch only (the file exists there only) |
| `.github/workflows/release-framework-stable.yml` | manual dispatch, input `version` | `crewrig-v<X.Y.Z>`, never latest | `main`, after the final merge (0288 R29) |

Both workflows have two jobs, so no dependency runs where a write permission or the App key is available:

- `build` has `permissions: contents: read` and no environment. It checks out, runs the guard, installs the
  production dependencies (`npm ci --omit=dev --ignore-scripts`, js-yaml only), compiles the skill and agent trees
  (`node scripts/build-components.ts`), builds the archive (`scripts/framework-release-build.ts`) and uploads the
  archive, `notes.md` and `sha256.txt` as the workflow artifact `framework-release`; its outputs are the asset name
  and the digest.
- `publish` (`needs: build`) installs and compiles nothing. It downloads the artifact, recomputes the SHA-256 and
  stops on any difference from the build job's digest (output, `sha256.txt` and the notes block), re-runs the guard
  because the refs may have moved, attests the archive, and publishes (`scripts/framework-release-publish.ts`). In the
  stable workflow only this job declares `environment: framework-release` and mints the App token. The guard and the
  publisher import only Node.js built-ins, so the job needs no `node_modules`.

Every `uses:` of these two workflow files is pinned to a full commit SHA with the tag in a trailing comment
(`@<sha> # vX.Y.Z`); a test enforces it for these two files only. Other workflows keep their major-tag pins. To bump
one, resolve the tag with `gh api repos/<owner>/<action>/git/ref/tags/<tag>`, dereferencing an annotated tag.

The asset is `crewrig-<version>.tgz`, with
`-next.<N>` in the version of a prerelease. Its contents are declared in
`scripts/lib/framework-release/manifest.txt`: one path per line, a file or a directory that stands for every file
beneath it, archived under the same flat repository-relative path. The build fails when an entry is absent; a file
the manifest does not list is not shipped, and a file is shipped only if git tracks it (except beneath `dist/`, the
git-ignored output of `build-components`).

The version lives in one place, `version` in the root `package.json`. A tag whose `X.Y.Z` differs from the declared
version fails its job before any release exists.

## Publishing once

The publisher creates the release unpublished, attaches the asset, compares the SHA-256 GitHub computed for it
(`assets[].digest`, read from the upload response, else from the release) with its own, and only then publishes.
No digest to compare means no publication. A published release of the tag stops the job before any upload. A
leftover unpublished draft of the same tag is deleted and replaced; it is never published as found.

## Approver read duty (R9)

The stable job waits on the `framework-release` environment for an administrator. Approval releases the GitHub App
key to the job, so before approving:

1. Read `.github/workflows/release-framework-stable.yml` and `scripts/framework-release-guard.ts` at the commit
   being released, and the scripts they run (`framework-release-build.ts`, `framework-release-publish.ts`, `scripts/lib/framework-release/`).
2. Compare them with the last released version (`git diff <last release commit>..<this commit> -- <those paths>`).
3. Deny the run when anything is unexplained. A denied or unanswered approval publishes nothing.

Neither `main-protected` nor `release-protected` requires a pull-request review, so this reading is the control.

## Deleting an orphan tag and reusing its name (R10)

Only for a `crewrig-v*` tag that has no published release (its guards failed, or a run failed after the tag
appeared). A tag with a published release is never deleted: use the next number. An administrator suspends
ruleset `crewrig-immutable-tags`, deletes that one tag, re-enables the ruleset, and on the same day records on
issue 1822 the tag, the commit it pointed at, the reason and the re-enabled state.

## What the recorder checks (R11)

The notes of every release list three checks, in order:

1. `gh release verify <tag> --repo crewrig/crewrig`
2. `gh release verify-asset <tag> <archive> --repo crewrig/crewrig`: its digest is the pin digest; it must equal the block of the notes.
3. `gh attestation verify <archive> --repo crewrig/crewrig --signer-workflow crewrig/crewrig/<workflow path>`, then compare the attested
   source commit with the branch (prerelease: an ancestor of `origin/release/1822-distribution`, not of `origin/main`; stable: an ancestor of `origin/main`).

These show the release came from this repository's workflow at the stated commit; they do not vouch for its content.

## Probes for the verification record (R14)

The record on #1822 is made before the first `next` tag and re-made before the first stable release and whenever
a control changes (a ruleset, the environment, its secrets, immutable releases, the collaborators).

- The Write-role probe pushes `crewrig-v0.0.0-next.1`. Put it on a commit that does not carry the prerelease
  workflow, for example the head of `main`: should the ruleset be misconfigured and the push accepted, the tag then
  starts nothing.
- A Maintain or Admin account pushes `crewrig-v0.0.0` and must be refused.
- The default-token probe uses a throwaway `push`-triggered workflow file with `permissions: contents: write` on a
  scratch branch that is not the release branch; it attempts `crewrig-v0.0.0` and must be refused. Delete the branch afterwards.
- The Write-role dispatch probe needs the stable workflow on `main`, so it belongs to the record made before the first stable release.

## Environment settings

`framework-release`: required reviewers limited to administrator accounts; `prevent_self_review: false`, so a sole
administrator can approve their own dispatch; `can_admins_bypass: false`, so approval stays an explicit act; deployment
branch policy limited to `main`; secrets `FRAMEWORK_RELEASE_APP_ID` and `FRAMEWORK_RELEASE_APP_KEY` live there and nowhere else.
