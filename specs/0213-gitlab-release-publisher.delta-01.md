---
id: "0213"
slug: gitlab-release-publisher
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1217
version: 1.1.0
---

# GitLab release publishing for extensions — delta 01: release-note equality is on entries, links follow the publishing forge

## ADDED

1. **New requirement (R19) — What "the same release-note content" means.**
   Two release notes SHALL be said to have the same release-note content
   when they carry the same **entries**: the same sections, in the same
   order, each section listing the same commits in the same order, and
   each commit shown with the same short SHA and the same subject text.
   The note's heading line (its version title and its date) and the
   target of every link inside the note are not part of the entries.
2. **New requirement (R20) — Links resolve on the publishing forge.**
   Every link inside a release note — a commit link, the
   previous-release-to-this-release compare link, and an issue reference
   link — SHALL resolve to the project on the forge the release is
   published on, at that forge's own host, including a self-hosted
   GitLab instance at any host name and a project nested under one or
   more GitLab groups. A GitLab release note SHALL NOT carry a link to
   `github.com` for a commit, a comparison or an issue of the released
   project, and SHALL NOT carry a link whose host is not the publishing
   forge's, such as a protocol-relative link that a renderer resolves to
   another host. A GitLab release note SHALL carry a compare link wherever the GitHub release note of
   the same release carries one.
3. **New requirement (R21) — The GitHub release note is unchanged.**
   For a given repository history and release date, the release note the
   GitHub release path publishes, writes to the changelog and puts in the
   release commit message SHALL be byte-for-byte the note it produces
   before this spec is realised. Requirement 20 SHALL be met on the
   GitLab leg alone and MUST NOT be met by changing the GitHub leg's note
   template, partials or issue-link resolution.

**Scenario:** GitLab notes link to the self-hosted GitLab instance

```text
Given a fork hosted at https://gitlab.example.org/platform/tools/crewrig
      whose extension "foo" has a tag foo-v1.2.0
And   a non-merge commit abc1234 "✨ Add bar (#42)" touching foo since that
      tag
When  the release pipeline runs on the release branch
Then  the GitLab release foo-v1.3.0 description links abc1234 to a commit
      page of platform/tools/crewrig on gitlab.example.org
And   its heading links a comparison of foo-v1.2.0 and foo-v1.3.0 on
      gitlab.example.org
And   its "#42" reference links an issue of platform/tools/crewrig on
      gitlab.example.org
And   no link in the description targets github.com or any host other
      than gitlab.example.org
```

**Scenario:** The GitHub note is untouched by the GitLab leg

```text
Given a repository history and a fixed release date
When  the GitHub release path computes the release note for extension "foo"
      before and after this spec is realised
Then  the two notes are byte-for-byte identical
```

## MODIFIED

**R3** — original:

> For the same repository history, the GitLab release path and the GitHub
> release path SHALL compute the same next version, the same tag name and
> the same release-note content for every extension.

Replacement:

> For the same repository history, the GitLab release path and the GitHub
> release path SHALL compute the same next version, the same tag name and
> the same release-note content (requirement 19) for every extension; the
> links inside each note follow requirement 20, and the notes are
> therefore not required to be byte-identical.

**R9** — original:

> The post-release repository state SHALL be identical across forges: the
> extension's manifests carry the released version and its changelog gains
> the release note, committed back in a release commit that does not
> re-trigger the pipeline — the same lockstep guarantee spec 0044 imposes on
> the GitHub path.

Replacement:

> The post-release repository state SHALL be identical across forges except
> for the link targets requirement 20 governs: the extension's manifests
> carry the released version and its changelog gains the release note —
> the note the release itself carries, with the same entries (requirement
> 19) on either forge — committed back in a release commit that does not
> re-trigger the pipeline — the same lockstep guarantee spec 0044 imposes on
> the GitHub path.

**R17** — original:

> The GitLab release path SHALL be exercised by automated tests that run
> without contacting any live forge, covering at least version and note
> computation for a changed and an unchanged extension, the single
> stored-archive-plus-release request shape, the rehearsal mode's
> no-publication guarantee, and the unsupported-forge refusal.

Replacement:

> The GitLab release path SHALL be exercised by automated tests that run
> without contacting any live forge, covering at least version and note
> computation for a changed and an unchanged extension, the single
> stored-archive-plus-release request shape, the rehearsal mode's
> no-publication guarantee, and the unsupported-forge refusal. The
> cross-forge agreement of requirement 3 SHALL be tested by comparing the
> two notes' entries (requirement 19), not their raw bytes; the same tests
> SHALL assert that every commit, compare and issue link of the GitLab note
> targets the GitLab project's host and path — for a self-hosted host and a
> group-nested project — and that the GitHub note for a fixed history and
> date is byte-for-byte the note the unmodified GitHub path produces
> (requirement 21).

**Scenario "Both forges agree on the same history"** — original:

```text
Given the same repository history pushed to a GitHub remote and a GitLab
      remote
When  each forge's release path computes the next release for every
      extension in rehearsal mode
Then  both report identical next versions, tag names and release notes
```

Replacement:

```text
Given the same repository history pushed to a GitHub remote and a GitLab
      remote
When  each forge's release path computes the next release for every
      extension in rehearsal mode
Then  both report identical next versions and tag names
And   both release notes carry the same entries: the same sections, commits,
      order, short SHAs and subjects
And   the GitHub note's links target github.com and the GitLab note's links
      target the GitLab remote's host
```

## REMOVED

None.

## Notes

**Why this delta exists.** PLAN v1 cold review on issue #1217
(<https://github.com/crewrig/crewrig/issues/1217#issuecomment-5829487717>,
finding v1-F3, class `spec`) showed that the parent's R3 cannot hold as
worded: the note engine R2 mandates renders forge-specific links, so a
GitLab note produced by the unchanged engine either carries wrong-host
links or differs from the GitHub note. Making both notes byte-identical
would require changing the GitHub note, which the parent's Out of scope
forbids.

**Facts this delta was checked against** (`semantic-release-gitmoji`
1.6.9, the version `package.json` resolves; `scripts/monorepo-release.sh`
overrides only `releaseRules`, so every default below is in force):

- `lib/assets/templates/commit-template.hbs` hard-codes every commit link
  as `https://github.com/{{owner}}/{{repo}}/commit/{{commit.short}}`,
  whatever the repository's host.
- `lib/helper/get-cmp-link.js` builds a compare link only when the host is
  `github.com` and returns an empty string otherwise, so the default
  template's heading loses its link on any other host.
- `lib/helper/resolve-issue-ref.js` resolves an issue reference to
  `https://github.com/...` on `github.com` and to
  `{baseUrl}//{owner}/{repo}/issues/{ref}` otherwise; with the empty
  default `baseUrl` that yields the protocol-relative
  `//{owner}/{repo}/issues/{ref}`, which a renderer resolves with
  `{owner}` as the host (`https://{owner}/{repo}/issues/{ref}`), so the
  link targets the wrong host.
- `lib/assets/templates/default-template.hbs` puts the run date
  (`UTC:yyyy-mm-dd`) in the heading, so two runs of the same history on
  different days never produce byte-identical notes; requirement 19
  therefore leaves the heading out of the entries, and requirement 21 and
  the byte-identity test fix the release date.

**Ruling.** Equality across forges is on what a reader of the note learns
— the version, the tag and the entries — and every link must work where
the note is published. The GitHub note stays byte-identical to today's, so
the parent's Out of scope ("Changing the GitHub release path's observable
behavior") stands unchanged. How the GitLab leg reaches host-correct links
(a GitLab-only template and partial, an issue-resolution setting, or a
post-processing step over the engine's output) is a PLAN-stage choice; R2
still forbids a second derivation of the entries themselves.

**Rejected alternative — (b) GitLab notes keep the `github.com` links.**
Minimal change, and byte-identity across forges on the commit lines. But
every commit link on a GitLab-only adopter's release points at a
repository that does not exist, the compare link disappears, and issue
references resolve to the wrong host. A note whose links are broken for the
exact adopter the parent spec serves fails R1's intent.

**Rejected alternative — (c) one forge-neutral template for both forges.**
Would restore a single template and byte-identity modulo host. But it
changes the GitHub note, its changelog and its release commit message,
which the parent's Out of scope forbids, and it moves the upstream
repository's published output to fix a problem only the new leg has.

**Requirements left as they are.** R5 (which changes a note lists) and R8
(the GitLab release description is the R5 note) are unaffected: this delta
constrains how entries are compared and where links point, not which
entries a note holds.

**Version bump.** MINOR (`1.0.0` → `1.1.0`) per `docs/spec-format.md` →
*Versioning*: three requirements and two scenarios are added, and R3, R9,
R17 and one scenario are reworded to relax byte-equality to entry-equality
and add link obligations. No implementation is in flight — the ticket is
at PLAN — so no in-flight work is invalidated.
