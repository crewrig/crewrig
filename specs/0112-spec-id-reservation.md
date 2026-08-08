---
id: "0112"
slug: spec-id-reservation
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 726
version: 1.0.0
---

# Two tickets picked up at the same moment never receive the same spec id

## Intent

A session that picks up a ticket walks away with a spec id no other session can
walk away with, decided at pickup time and before anything is written down. Two
maintainers, two agents, two machines, or two command-line interfaces starting
work at the same instant end up with two different ids. The failure this
replaces is not a lint error but a misdirected one: today the collision is
discovered by an unrelated third pull request, after both offending specs have
already merged, and repairing it means renaming a file whose id is by then
carried by an issue, a branch name, a pull-request title, and a logbook.

## Requirements

1. Two sessions allocating an id concurrently SHALL obtain distinct ids.
   Exactly one session SHALL win any given id; there SHALL be no interval
   during which both observe success, and the losing session SHALL be able to
   retry without human intervention.
2. The id SHALL be secured before the spec file is written and before the spec
   branch is created, so that the branch name, the filename, and the
   frontmatter `id` agree from the first commit.
3. The set of unavailable ids SHALL be the union of the ids already present on
   the reference branch and the ids secured by sessions whose spec has not yet
   merged. Allocation SHALL read that union, never the merged ids alone.
4. The mechanism SHALL operate identically on GitHub, GitLab, and Gitea, and
   SHALL NOT require any credential beyond those the contributor already holds
   for `git` and for the forge's own command-line tool, consistent with
   `AGENTS.md` → *Forge Access*.
5. An abandoned reservation SHALL be harmless. No expiry, no reclamation pass,
   and no release protocol SHALL be required, and a gap in the numeric sequence
   SHALL be an accepted outcome — `docs/spec-format.md` → *Naming convention*
   already states that spec ids are never reused.
6. `artifacts/core/skills/spec-author/SKILL.md` → *ID allocation* SHALL stop
   prescribing an unsynchronised `max(existing) + 1` computation over the local
   working tree, and SHALL instead consume an id obtained under requirement 1.
   The corresponding agent source SHALL be updated in the same change.
7. A check SHALL run in continuous integration on every pull request that adds
   or renames a non-delta spec file, and SHALL fail when that spec's id was
   never secured, or was secured for a different ticket. The check SHALL read
   the authoritative record of secured ids rather than any local copy that may
   lag behind it.
8. `task spec:lint` SHALL remain executable offline and SHALL NOT acquire a
   network dependency. The cross-file duplicate-id guard introduced by
   `specs/0098-spec-linter-cross-file-id-uniqueness.md` SHALL remain in place
   as a backstop and SHALL NOT be weakened by this change.
9. When the author holds no write access to the reference repository — working
   offline, or contributing from a forked repository — the author SHALL be able
   to allocate an id locally and proceed, and the resulting spec SHALL carry an
   explicit, machine-readable mark stating that its id is unsecured.
10. The check of requirement 7 SHALL discriminate by pull-request origin: a
    pull request opened from the reference repository SHALL fail when its id is
    unsecured, whereas a pull request opened from a forked repository SHALL
    report the condition without blocking. A maintainer SHALL secure the id
    before merging such a pull request, and the mark of requirement 9 SHALL be
    removed in the same act.
11. Delta-specs SHALL be exempt. A delta-spec reuses its parent's id by
    construction, secures nothing, and SHALL NOT be failed by the check of
    requirement 7.
12. The allocation tool SHALL be invocable directly by a human contributor with
    no agent involved, and SHALL print the id it secured on success and the
    reason on failure.
13. Any continuous-integration capability added by this change SHALL be
    declared in `ci/ci-capabilities.yml` so that the GitLab pipeline generated
    from it stays in agreement, and any script added SHALL be reflected in
    `docs/cli-matrix.md` per `AGENTS.md` → *CLI Matrix Maintenance*.

## Scenarios

**Happy path — concurrent pickup.**
Given the reference branch carries specs `0001` through `0111` and no id beyond
`0111` is secured, when two sessions pick up two different tickets within the
same second and each requests an id, then one session receives `0112` and the
other receives `0113`, neither session is left waiting on the other, and both
proceed to write their spec file immediately.

**Happy path — offline authoring.**
Given a contributor with no network access, when that contributor authors a
spec, then allocation succeeds locally, the spec carries the unsecured-id mark
of requirement 9, and the contributor is told plainly that the id must be
secured before the pull request can merge.

**Failure path — unsecured id from the reference repository.**
Given a pull request opened from a branch of the reference repository that adds
`specs/0114-<slug>.md`, and given `0114` was never secured, when continuous
integration runs, then the check of requirement 7 fails, and its message names
the offending file, the unsecured id, and the command that secures one.

**Failure path — id secured by another ticket.**
Given `0114` was secured for issue #800, when a pull request for issue #801
adds `specs/0114-<slug>.md`, then the check fails and its message names both
the ticket holding the id and the ticket attempting to use it, so the collision
is attributed to the right author before merge rather than after.

**Failure path — fork contribution.**
Given a pull request opened from a forked repository whose author cannot write
to the reference repository, and given the spec carries the unsecured-id mark,
when continuous integration runs, then the check reports the unsecured id
without failing the pipeline, and the pull request remains mergeable only after
a maintainer secures the id and the mark is removed.

## Out of scope

- Deriving the spec id from the issue number. Rejected: the forge already
  allocates unique integers atomically, but adopting them breaks the compact,
  contiguous, four-digit sequence that `0001`–`0111` establishes and that
  branch names, filenames, and cross-references depend on.
- A reservation registry tracked in the repository, such as a `specs/RESERVED.md`
  file. Rejected: two pull requests each adding their own line both merge, which
  reproduces exactly the race this spec exists to remove.
- Replacing the numeric primary key with the slug so that nothing needs
  allocating at all. Rejected: it dissolves the problem but requires migrating
  111 specs, their branch names, and every cross-reference.
- The concrete carrier of a reservation, its naming, and its visibility in the
  forge interface. That is a PLAN-stage decision, bounded by requirements 1
  through 5.
- Retroactively securing ids `0001` through `0111`. Requirement 3 makes the
  merged corpus authoritative on its own, so no back-fill is needed.
- Securing delta-spec sequence numbers, issue numbers, or pull-request numbers.
- Enabling the forge's "require branches to be up to date before merging"
  setting. It is a detection aid, not an allocation mechanism, and it is
  neither required nor precluded by this spec.

## Open questions

- [GROUNDING:] No spec on the reference branch carries any frontmatter field
  denoting an unsecured id, and `docs/spec-format.md` → *Frontmatter schema*
  defines no such field while stating that unknown fields SHOULD NOT be
  introduced without amending that document first. Requirement 9 mandates the
  mark. Responsibility: the implementation pull request for this spec SHALL
  amend `docs/spec-format.md` to define the field as optional, and SHALL NOT
  back-fill it into existing specs — the field is absent by default and carries
  meaning only in the fallback case of requirement 9.
