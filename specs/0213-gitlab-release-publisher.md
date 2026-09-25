---
id: "0213"
slug: gitlab-release-publisher
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1217
version: 1.0.0
---

# GitLab release publishing for extensions

## Intent

An organization whose repository lives on GitLab can publish versioned
extension releases the same way the upstream GitHub-hosted repository
already does: each extension that changed gets its next version, a release
note restricted to that extension's own changes, a tag, and a GitLab
release carrying the same installable archive a GitHub release carries.
The version, the tag and the release note are decided once, by the one
engine the upstream release path already runs, so a GitHub release and a
GitLab release of the same history can never disagree about what version
an extension is at or what changed in it. A maintainer can also run the
whole release path on any branch in a rehearsal mode that computes and
packages everything and publishes nothing.

## Requirements

1. The repository SHALL offer a release path that publishes extension
   releases to a GitLab-hosted repository — GitLab.com or a self-hosted
   GitLab instance — from a GitLab CI pipeline, without the adopter
   authoring any release automation of their own.
2. Next-version computation, tag naming, the previous-release baseline and
   release-note generation SHALL be produced by the single version-and-notes
   engine the existing release path already uses (the one
   `scripts/monorepo-release.sh` drives today). The GitLab release path MUST
   NOT carry a second, independent derivation of any of the four.
3. For the same repository history, the GitLab release path and the GitHub
   release path SHALL compute the same next version, the same tag name and
   the same release-note content for every extension.
4. Tags SHALL follow the existing per-extension form `<extension>-v<version>`,
   and the previous-release baseline for an extension SHALL be its most
   recent such tag reachable from the released commit; an extension with no
   prior tag SHALL be released from its initial version per the existing
   release path's rules.
5. An extension's release note SHALL list only the changes that touch that
   extension's own directory since its previous release, and SHALL exclude
   merge commits; a change touching no extension directory SHALL appear in
   no extension's release note.
6. An extension with no release-worthy change since its previous release
   SHALL produce no tag, no release, no uploaded archive and no release
   commit on either forge.
7. The archive a GitLab release carries SHALL be produced by
   `scripts/release-package-extension.sh` — the one place the release
   artifact's shape is decided (spec 0183 R17/R21/R22) — and SHALL be
   byte-for-byte the archive the GitHub release path produces for the same
   extension and version. The GitLab release path MUST NOT package the
   extension any other way, and MUST NOT add archives for command-line tools
   the release does not serve (spec 0183 delta-01: a release serves the
   in-place-loading tool alone and carries exactly one asset).
8. The GitLab release path SHALL store the archive in the GitLab project's
   own package registry and SHALL create a GitLab release, on the tag of
   requirement 4, whose description is the release note of requirement 5
   and which links that stored archive as its one asset.
9. The post-release repository state SHALL be identical across forges: the
   extension's manifests carry the released version and its changelog gains
   the release note, committed back in a release commit that does not
   re-trigger the pipeline — the same lockstep guarantee spec 0044 imposes on
   the GitHub path.
10. A single release run SHALL publish to exactly one forge — the forge the
    pipeline runs on. A run MUST NOT publish to GitHub and GitLab at once,
    and a run on a forge the release path does not support SHALL fail before
    publishing anything, naming the forge it detected.
11. Credentials SHALL be taken from the CI environment the pipeline already
    provides or from a masked CI variable the adopter declares; the release
    path MUST NOT require a credential written into any committed file and
    MUST NOT print a credential to the job log.
12. The release path SHALL offer one non-publishing rehearsal mode, shared by
    both forges and selected the same way on each. In that mode it SHALL
    compute each changed extension's next version and release note and
    SHALL produce each archive, reporting all three; it MUST NOT create a
    tag, a release, a stored package, a release commit, or any other
    forge-side or pushed state.
13. The rehearsal mode SHALL be runnable on any branch, including a branch
    other than the release branch, and a rehearsal run SHALL leave the
    working tree and the remote exactly as it found them.
14. When a step fails for one extension — packaging, upload or release
    creation — the run SHALL report that extension and step and SHALL exit
    non-zero, and the other extensions' outcomes SHALL be reported
    independently, as the existing release path does. A failure before any
    publication SHALL leave no tag for that extension. A failure after its
    tag exists SHALL name, in the job log, the tag left without a complete
    release, and the adopter documentation of requirement 18 SHALL state
    how to complete or retract it; a GitLab release MUST NOT link an archive
    that is absent from the package registry.
15. Every shell script this spec introduces or modifies SHALL conform to the
    Bash 3.2 portability rules of `docs/scripting-conventions.md` (spec 0111)
    and pass `scripts/check-bash32-portability.sh`.
16. The CI capability reference SHALL describe the release capability's
    GitLab realisation truthfully: the `release` entry of
    `ci/ci-capabilities.yml`, whose recorded exception currently states that
    the release tooling has no GitLab equivalent, SHALL be updated so that no
    statement in it is false once this spec is realised, and the GitLab form
    of the release job SHALL be traceable to that capability per ADR-0012.
17. The GitLab release path SHALL be exercised by automated tests that run
    without contacting any live forge, covering at least version and note
    computation for a changed and an unchanged extension, the single
    stored-archive-plus-release request shape, the rehearsal mode's
    no-publication guarantee, and the unsupported-forge refusal.
18. Adopter-facing documentation SHALL state how a GitLab-hosted organization
    enables the release path: the pipeline job to include, the variables and
    permissions it needs, how to run a rehearsal, and how to publish.

## Scenarios

**Scenario:** A changed extension is released on GitLab

```text
Given a GitLab-hosted fork whose extension "foo" has a tag foo-v1.2.0
And   two non-merge commits touching extensions/*/foo since that tag, one of
      them a new feature, plus one commit touching only docs/
When  the release pipeline runs on the release branch
Then  a tag foo-v1.3.0 exists on the released commit
And   the project's package registry holds exactly one archive for foo 1.3.0,
      identical to the archive the GitHub release path would produce
And   a GitLab release foo-v1.3.0 exists whose description lists the two foo
      commits and not the docs/ commit, and whose one asset links that archive
And   foo's manifests read 1.3.0 and its changelog carries the same note,
      committed back without re-triggering the pipeline
```

**Scenario:** Both forges agree on the same history

```text
Given the same repository history pushed to a GitHub remote and a GitLab
      remote
When  each forge's release path computes the next release for every
      extension in rehearsal mode
Then  both report identical next versions, tag names and release notes
```

**Scenario:** Rehearsal on a feature branch publishes nothing

```text
Given a GitLab pipeline running on a branch that is not the release branch
And   extension "foo" has release-worthy changes since foo-v1.2.0
When  the release path runs in rehearsal mode
Then  the job log reports foo's next version 1.3.0, its release note, and the
      archive it produced
And   no new tag, release, stored package or pushed commit exists on the
      project afterwards
```

**Scenario:** An unchanged extension is left alone

```text
Given extension "bar" has no release-worthy change since bar-v0.4.1
When  the release pipeline runs on the release branch
Then  no tag, release, stored archive or release commit is created for bar
```

**Scenario:** Upload failure is reported and leaves no dangling asset link

```text
Given extension "foo" has release-worthy changes
And   the package registry rejects the archive upload
When  the release pipeline runs on the release branch
Then  the job fails, naming foo and the upload step
And   no GitLab release links an archive absent from the package registry
And   if the tag foo-v1.3.0 was already created, the job log names it as a
      tag left without a complete release
```

**Scenario:** An unsupported forge is refused

```text
Given the release path runs in a CI environment it identifies as neither
      GitHub nor GitLab
When  the release path starts
Then  it exits non-zero before any publication, naming the detected forge
```

## Out of scope

- **A release serving any command-line tool other than the in-place-loading
  one.** Spec 0183 delta-01 (Ruling A, 2026-08-25) fixes a release at one
  asset for that tool; the issue's "tarballs for all 4 CLIs" reading is not
  adopted here. A multi-tool release remains its own spec question.
- **A second, script-owned version, tag or changelog derivation** (the
  issue's proposed `git log` baseline and bullet list); see `## Notes`.
- **Gitea, or any forge other than GitHub and GitLab.** Requirement 10's
  refusal covers them; a Gitea leg is a later spec.
- **Changing the GitHub release path's observable behavior.** Its versions,
  tags, notes, single asset and release commit stay as they are; only the
  structure shared with the GitLab leg may move.
- **Running the GitLab release on a live GitLab instance in this
  repository.** The canonical forge stays GitHub (spec 0048 Out of scope);
  verification here is offline per requirement 17.
- **Installing an extension from a GitLab release on the adopter side**
  (see `## Open questions`).
- **Publishing to any registry other than the GitLab project's own package
  registry** (npm, container, or external artifact stores).
- **Changing the release-rule mapping** from Gitmoji to bump levels.

## Open questions

- **Adopter-side install from a GitLab release.** The
  in-place-loading tool's install-from-release resolution was measured
  against GitHub releases only (spec 0183 delta-01, Gemini CLI 0.46.0). It
  is unverified whether that tool resolves a GitLab release asset, or falls
  back to cloning the repository. This spec obliges the release to exist
  and be correct; whether `gemini extensions install <gitlab-url>` consumes
  it, or the adopter installs from the downloaded archive, must be measured
  before the adopter documentation of requirement 18 names an install
  command.
- **Protected-branch release commit on GitLab.** Requirement 9
  needs the pipeline to push a release commit and a tag to a protected
  branch. Whether the default job token suffices on the target GitLab
  versions, or the adopter must provision a project access token with
  repository-write scope, is a PLAN-stage measurement; requirement 18's
  documentation depends on the answer.
- **Name of the rehearsal switch.** The existing path uses
  `DRY_RUN=true`; the issue proposes `TEST_EXTENSION_RELEASE=true`.
  Requirement 12 fixes one shared switch; PLAN picks the name, and SHOULD
  keep `DRY_RUN` accepted if it renames it. Note that the engine's own
  dry-run does not run the packaging step, so the rehearsal mode of
  requirement 12 is broader than the engine's dry-run as it stands.

## Notes

### The versioning-engine decision

Requirement 2 is the one WHAT-level choice this spec makes. Three options
were weighed against multi-CLI parity, a single source of versioning truth,
sovereignty (no new lock-in), and testability.

| Option | What it buys | At the cost of | Verdict |
|---|---|---|---|
| **(a) One engine, two publishing legs** — keep semantic-release (with `semantic-release-gitmoji` and `semantic-release-monorepo`) as the only version/tag/notes engine and add a GitLab publishing leg beside the GitHub one (the official `@semantic-release/gitlab` plugin, which targets GitLab.com and self-hosted instances and stores assets in the generic package registry, or a thin publish step consuming the engine's outputs) | One derivation for both forges, so requirement 3 holds by construction; reuses the per-extension tag form, the Gitmoji release rules, the lockstep manifest sync and the one packager unchanged; the dependency set grows by at most one MIT plugin of the same project already in use | The rehearsal mode needs work beyond the engine's `--dry-run`, which skips the packaging step (open question 3); the GitHub-specific release config in `scripts/monorepo-release.sh` must become forge-selected | **Recommended** |
| **(b) The standalone script of issue #1217** — `git log` from the previous `<ext>-v*` tag, a hand-formatted bullet list, `curl` to the Generic Packages and Releases APIs | Self-contained; no Node toolchain in the GitLab job | Re-implements next-version computation, previous-tag discovery and note generation a second time, so GitHub and GitLab releases of the same history can diverge (version bumps, merge handling, Gitmoji mapping); the issue's own text does not say how the next version is computed at all; leaves the lockstep manifest sync and the release commit to be rebuilt; two derivations to test and keep in sync forever | Rejected |
| **(c) Mirror GitHub releases to GitLab** — release on GitHub only, then copy tags and releases across | No new release logic | Presupposes a GitHub remote, which a GitLab-only adopter (the case the issue reports) does not have; entrenches GitHub as a dependency against the sovereignty promise | Rejected |

Option (a) wins on every axis except toolchain weight in the GitLab job,
and that weight is already paid by the generated `.gitlab-ci.yml` jobs that
run `npm install` on a `node:22` image. Option (b) is the smallest diff to
state and the largest to keep correct: its value — "no Node on the runner"
— does not survive contact with a repository whose build capability already
requires Node, and its cost — a second source of versioning truth — is
exactly what requirement 3 exists to forbid.

### Facts this spec was checked against

- `ADR-0020`, cited by issue #1217, does not exist; the forge-strategy
  decision is [ADR-0015](../docs/adr/0015-forge-access-cli-only.md)
  (forge access CLI-only, GitLab and Gitea first-class), and the CI
  reference contract is [ADR-0012](../docs/adr/0012-ci-reference-contract.md).
- `scripts/release-package-extension.sh` renders and packages the
  `--target gemini` tree alone and writes exactly one archive per call; it
  does not package for four command-line tools.
- The `release` capability in `ci/ci-capabilities.yml` is `portability:
  specific` with a GitHub-Actions-only exception, so `scripts/build-ci.sh`
  emits no GitLab release job today; requirement 16 addresses the
  exception's now-false evidence.
