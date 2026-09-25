# GitLab release publishing

<!-- crewrig-doc: section=reference nav_order=150 published=true title="GitLab release publishing" -->

A GitLab-hosted fork publishes extension releases the same way the
upstream GitHub-hosted repository does: one shared engine computes each
changed extension's next version, tag, and release note, so a GitHub
release and a GitLab release of the same history never disagree about
what version an extension is at or what changed in it (spec 0213 +
delta-01). No adopter-authored release automation is required — the two
generated pipeline jobs below are the whole surface.

This page covers only the GitLab side. The underlying engine, the
per-extension archive shape, and the GitHub release path are unchanged
and are not repeated here.

## Enabling the pipeline jobs

The generated `.gitlab-ci.yml` at the repository root already carries the
`release` and `release-rehearsal` jobs once it is in sync with
`ci/ci-capabilities.yml` (`bash scripts/build-ci.sh --check`). A fork that
uses that file as its GitLab project's pipeline configuration as-is needs
no pipeline-file change at all.

A fork whose GitLab project points at a different top-level pipeline file
can pull the two jobs in with GitLab's own `include:` keyword instead of
replacing that file wholesale:

```yaml
include:
  - local: ".gitlab-ci.yml"
```

The `release` job runs on push to `main` — the release branch, unchanged
from the GitHub path. The `release-rehearsal` job is manual
(`when: manual`) and carries no branch restriction; see *Running a
rehearsal* below. A third generated job, `release-tests`, exercises the
release tooling itself on a change to the scripts that implement it; it
is not part of the publish-or-rehearse flow and needs no adopter action.

## Variables

| Variable | Required | Purpose |
|---|---|---|
| `GITLAB_TOKEN` | Yes, for the `release` job | Masked CI/CD variable holding a **project access token** with the `api` and `write_repository` scopes. Its role must be allowed to push to the protected `main` branch and to create tags — check the project's branch and tag protection rules; typically this means at least the Maintainer role. |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | No | Overrides the release commit's author identity. Unset, the release commit is authored as `semantic-release-bot` (GitLab has no equivalent of the GitHub path's `github-actions[bot]` identity, and none is assumed). |
| `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` | No | Overrides the release commit's committer identity, independently of the author identity above. |

Declare `GITLAB_TOKEN` under **Settings → CI/CD → Variables**, marked
**Masked**. The job reads it through a reference environment key the
generated pipeline sets for you (`RELEASE_TOKEN`) — there is nothing else
to name or wire up.

**`GITLAB_TOKEN` is the only credential that pushes the release commit and
tag.** Before running the engine, the `release` job explicitly resets git's
credential helper list for the process
(`GIT_CONFIG_KEY_n=credential.helper` set to an empty value). This also
neutralizes a GitLab Runner configured with the `FF_GIT_URLS_WITHOUT_TOKENS`
feature flag, which would otherwise inject the CI job token through a
credential helper and let it authenticate the push instead — silently, and
with a different identity and permission set than the token you declared.

`release-rehearsal` needs none of these: it never publishes, so it never
resolves a credential (see below).

## Running a rehearsal

The rehearsal computes each changed extension's next version, release
note, and archive, and reports all three — without creating a tag, a
release, a stored package, or a release commit, and without touching the
remote.

1. Trigger it from a **branch pipeline** for the branch you want to
   rehearse — for example, a `Run pipeline` for that branch, or a push
   pipeline that reaches the manual job. Triggered from a merge-request
   or a tag pipeline, it refuses with `not a branch pipeline
   (merge-request or tag): run the release from a branch pipeline`;
   neither pipeline kind carries the running branch the rehearsal reports
   against.
2. Set `RELEASE_DRY_RUN=true` (`DRY_RUN=true` is also accepted, kept for
   compatibility with the switch name the existing local `DRY_RUN` flow
   used). If both are set and disagree, `true` wins. Any value other than
   `true`, `false`, or empty is refused.
3. Run the job manually from the pipeline's job list.

No token is needed or read in this mode.

## Publishing

Push to `main`. The `release` job runs automatically, computes every
changed extension's next version and release note, uploads its archive to
the project's own package registry, and creates the GitLab release —
identical in scope to what the GitHub path does on its own `main`.

## Reading the job log

| Line | Mode | Meaning |
|---|---|---|
| `REHEARSAL <ext> version=<v> tag=<t> baseline=<tag\|none> archive=<name> sha256=<h>` | Rehearsal | The extension's next release, computed and packaged but not published. The release note follows this line. |
| `UNCHANGED <ext>` | Either | No release-worthy change since the extension's previous release; nothing was produced. |
| `PUBLISHED <ext> tag=<t> archive=<name> sha256=<h>` | Publish | The extension was released; the tag, archive name, and archive checksum are as reported. |
| `RELEASE-FAILED <ext> step=<step>` | Publish | A step failed for that extension (see below); the run exits non-zero. Other extensions are still reported independently. |
| `RELEASE-INCOMPLETE-TAG <tag>` | Publish | Printed alongside `RELEASE-FAILED` when the failure happened after the tag was already created — see *Completing or retracting an incomplete tag*. |
| `NOTICE remote branch has advanced; rehearsing HEAD` | Rehearsal | Informational: the remote branch has moved past the commit the rehearsal is computing against, which is still the pipeline's own `HEAD`. |

`step=<step>` in a `RELEASE-FAILED` line is one of:

| `step` | What failed | Tag exists afterward? |
|---|---|---|
| `verify` | A pre-flight check (forge detection, branch, credential) | No |
| `package` | Building the extension's archive | No |
| `commit` | Writing the version-bump / changelog commit | No |
| `upload` | Uploading the archive to the package registry (GitLab only) | Yes — `RELEASE-INCOMPLETE-TAG` follows |
| `release` | Creating the GitLab (or GitHub) release object | Yes — `RELEASE-INCOMPLETE-TAG` follows |
| `engine` | Any other engine failure | Check the job log |

Because the upload always completes before the release object is
created, `step=release` means the archive is already stored in the
package registry and only the release is missing; `step=upload` means
neither exists yet.

## Completing or retracting an incomplete tag

**Re-running the release job does not fix an incomplete tag on its own.**
Once a tag exists, the engine treats it as the extension's last release
and computes the *next* one from there — it never goes back to finish a
prior attempt.

### Completing it

Use this when you want the tag `<ext>-v<version>` (from
`RELEASE-INCOMPLETE-TAG`) to end up with a real release, matching what
the failed run would have produced.

1. Check what already exists: `glab release view <ext>-v<version>` — not
   found means no release object exists yet. Check **Packages and
   registries → Package registry** in the project for
   `<ext>-<version>.tar.gz` to see whether the archive was already
   stored (it was, if the failure's `step` was `release` rather than
   `upload`).
2. If the archive is not stored yet, rebuild it at the release commit:

   ```sh
   git checkout <ext>-v<version>
   bash scripts/release-package-extension.sh <ext> --version <version> --out dist/release/<ext>
   ```

3. Create the release with that archive attached:

   ```sh
   glab release create <ext>-v<version> dist/release/<ext>/<ext>-<version>.tar.gz \
     --notes-file <path-to-the-release-note>
   ```

   `glab release create` creates the release if none exists yet, or
   updates it in place if one does — the same command covers both
   `step=upload` and `step=release`.

### Retracting it

Use this when you would rather discard the attempt and let the next
release run compute the version from scratch.

1. Remove the release and its tag together, if a release exists:

   ```sh
   glab release delete <ext>-v<version> --with-tag -y
   ```

   If no release exists yet (a `step=upload` failure), there is nothing
   for `glab release delete` to remove — delete the tag directly instead:

   ```sh
   git push origin --delete <ext>-v<version>
   ```

2. Revert the release commit the failed run pushed:

   ```sh
   git revert <release-commit-sha>
   git push
   ```

   Do not skip this step. The failed run already wrote the extension's
   manifest and changelog for the retracted version; leaving that commit
   in place makes the next release run add a **second, duplicated**
   changelog section for the same version once it recomputes and
   re-releases.
3. Re-run the release job.

## Installing an extension released on GitLab

The archive a GitLab release carries is byte-for-byte the same archive a
GitHub release carries for the same extension and version. Whether Gemini
CLI's own `extensions install` command resolves a GitLab release URL the
way it resolves a GitHub one is **unmeasured** — the install-from-release
behavior pinned in
[`docs/runbooks/extension-release-install-probe.md`](runbooks/extension-release-install-probe.md)
was observed against GitHub releases only. Do not assume
`gemini extensions install <gitlab-url>` works until that measurement
exists; a follow-up ticket owns it.

Until then, use one of the install paths already documented for any
fork — see [Extension authoring](extension-authoring.md) → *Delivery
paths*: download the release's archive and extract it locally, or run
`bash scripts/install-extension.sh install <name>` from a checkout of the
fork.

## Known limitation — a cross-project issue reference two or more groups deep gets no link

An issue reference inside a commit subject that points at a **different**
project nested two or more GitLab groups deep — for example
`(acme/sub/other#5)` — is not recognized as an issue reference at all: the
upstream `semantic-release-gitmoji` dependency's own issue-detection regex
requires the character right before an `owner/repo#N` reference to not
itself be part of a path, so a second `/` immediately before the match
rejects it outright. The reference gets **no link** on either forge — it
is neither dropped nor misrouted to a wrong project; the text
`acme/sub/other#5` stays in the note exactly as written in the commit
subject. A single-level cross-project reference (`acme/other#5`) is
unaffected and links normally, and a reference to an issue in the released
project itself is unaffected whatever that project's own nesting depth.
This is a pre-existing limitation of the upstream dependency, present on
the GitHub path too — it is not introduced by the GitLab leg.
