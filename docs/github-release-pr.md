# GitHub release PR

<!-- crewrig-doc: section=reference nav_order=149 published=true title="GitHub release PR" -->

On GitHub, the monorepo release (`.github/workflows/release-monorepo.yml`,
driver `scripts/monorepo-release.sh`) never pushes to `main`. It proposes
each release in a **release PR**, and publishes it once that PR is merged
(issue #1379).

## Why

The `main-protected` ruleset requires the `ratchet` and `lint-typescript`
checks on every commit that reaches `main`. A version commit made inside the
release runner carries no check, so the push is rejected (`GH013`), and the
GitHub Actions integration cannot be a ruleset bypass actor. A release PR is
checked and merged like any other PR: no bypass, no deploy key, no extra
secret.

## Flow

Every push to `main` runs the release workflow, which classifies each
extension from the release engine's dry run on the pushed commit:

| Classification | Condition | Action |
| --- | --- | --- |
| `UNCHANGED` | no releasable commit since the extension's last tag | nothing |
| `PENDING` | a release is due, its version is not committed yet | proposed in the release PR |
| publish | the committed `package.json` version **is** the computed next version | tagged and published now |

1. **Publish.** An extension whose committed version equals the computed one
   has had its release PR merged. The engine packages it, tags the merged
   commit `<ext>-v<version>`, pushes that tag (never a branch) and creates
   the GitHub release with the archive. It prints
   `PUBLISHED <ext> tag=<t> archive=<file> sha256=<hex>`.
2. **Prepare.** Every pending extension is released for real inside a
   throwaway clone of the pushed commit, against a throwaway mirror, with no
   credential and no publish step: the changelog is written, both manifests
   are bumped, and one `🔖 <ext>-v<version>` commit is made per extension.
   Those commits are force-pushed to `release-pr/main`.
3. **Release PR.** `scripts/release-pr.ts` opens the release PR
   `release-pr/main` → `main` (or updates the open one), titled
   `🔖 Release <tag>, …`, with one folded release note per extension. When
   nothing is pending it closes a stale release PR.
4. **Checks.** Events made with `GITHUB_TOKEN` start no workflow run, so the
   branch push and the PR it opens get no check on their own. The driver
   dispatches `build.yml` (`workflow_dispatch`) on `release-pr/main`; its
   `ratchet` and `lint-typescript` jobs are the ruleset's required contexts.

Merging the release PR (squash, merge or rebase) pushes to `main`, which
runs step 1 for its extensions. They are no longer pending, so no new
release PR is opened for them: there is no loop. A new release PR appears
only when new releasable commits land.

Do not push to `release-pr/main`: it is regenerated from `main` on every
push. The driver refuses to publish from a `release-pr/*` branch (its
versions are committed but unmerged), so running the release workflow by
hand on that branch exits with an error instead of tagging it. The release commits carry no `[skip ci]`, since that token on the
merged head commit would suppress the very run that publishes them.

## When the PR cannot be opened automatically

`GITHUB_TOKEN` may open pull requests only when the repository setting
**Allow GitHub Actions to create and approve pull requests** is on (and the
organisation permits it). When it is off, the create call answers 403 and
the run stays green: the branch is pushed, the checks are dispatched, and
the run prints `RELEASE-PR-MANUAL <compare-url>` plus a warning annotation
and a job-summary link. Open the PR from that link once; every later run
updates it.

## Output lines

- `PENDING <ext> version=<v> tag=<t>` — proposed in the release PR.
- `RELEASE-PR-BRANCH release-pr/main` — the release branch was pushed.
- `RELEASE-PR opened|updated #<n> <url>`, `RELEASE-PR closed #<n>`,
  `RELEASE-PR none`, `RELEASE-PR-MANUAL <url>`.
- `RELEASE-PR-CHECKS dispatched build.yml ref=release-pr/main`.
- `RELEASE-FAILED release-pr step=push|pr` — the branch push or the PR/API
  call failed; the run fails.

A run in which an extension could not be classified or prepared, and which
is left with nothing to propose, fails without touching an open release PR.

## GitLab

The GitLab `release` job keeps the direct flow described in
[GitLab release publishing](gitlab-release-publishing.md): a GitLab
protected branch can allow pushes by a role (such as Maintainer) that a
project access token holds, so the release
commit (with `[skip ci]`) and its tag are pushed by the job itself. The
asymmetry is the forge's own: GitHub offers no ruleset bypass for the
Actions token and starts no workflow from its events.
