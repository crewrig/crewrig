---
id: "0290"
slug: skill-eval-runner
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1917
version: 3.3.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 07 of `specs/0290-skill-eval-runner.md`, building on delta-01 to delta-06. Source: issue #1917. The runner measures the skill source directory, not the skill as shipped. The build (`scripts/lib/build-components/shared-references.ts`) writes `references/shared-<topic>.md`, a byte copy of `artifacts/core/shared/references/<topic>.md`, into each built skill for every topic its `SKILL.md` body cites (grammar in `scripts/lib/skill-citations/grammar.ts`), and a skill source may not hold a `shared-` file itself. The content hash of R35 and the install of R32 read only the source directory, so a measured run lacks the shared text that adopters receive. The owner's decision (approved through the coordinator): the single in-memory snapshot read once at run start also carries those shared files as virtual files, so hash and install stay byte-identical. The version bump is MINOR (additive requirement). Requirements added: R51. Requirements modified: R32 and R35. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

51. **The snapshot carries the shared references the skill cites.** The single in-memory snapshot of a skill that R35 reads once at run start, from which the content hash is computed and the install of R32 is made, SHALL also hold, as virtual files, `references/shared-<topic>.md` for each topic *T* cited by the body of the skill's `SKILL.md`, whose bytes are those of `artifacts/core/shared/references/<T>.md`. The citation rule is the one the build applies (the grammar of `scripts/lib/skill-citations/grammar.ts`); the frontmatter is excluded, so a topic named only there is not cited. The shared sources are read from `artifacts/core/shared/references/` whatever the layer of the skill. For the head snapshot they are read from the working tree, tracked files only, with the exec flag taken from the git index mode like any other file (normally `0`); for the base snapshot they are read from the merge-base revision (`git ls-tree` and blobs) in the same way. The same scheme applies on both sides, so the head and the base hash identically for identical content, and neither the hash nor the install reads or depends on any built CLI tree, nor on those trees being up to date. A virtual file takes part in the hash record of R35 exactly as a file of the skill directory, under its path `references/shared-<T>.md`, and is installed by R32 at that path. A skill that cites no topic has no virtual file, and its hash is unchanged. The snapshot SHALL be `invalid` (R35: the path or topic is named, no hash is computed and no model call is made) when: (a) a cited topic has no tracked file `artifacts/core/shared/references/<T>.md`; (b) the skill source directory holds, at the top level of `references/`, a tracked file whose name matches `shared-*.md` (the prefix is reserved, the same rule the build applies; the snapshot reads the git index, so a tracked file deleted in the working tree is absent from the snapshot and does not count); (c) a shared source file is an untracked file that is not git-ignored, or a symbolic link (index mode `120000`), by the rules R35 applies to every other hashed file; a git-ignored untracked shared source, and a tracked shared source deleted in the working tree, are treated as absent, case (a). The body of `SKILL.md` is extracted exactly as the build extracts it, line endings normalised to LF before the frontmatter is removed, so a `SKILL.md` stored with CRLF line endings yields the same cited topics in the snapshot as in the build; the implementation SHALL reuse the build's `citedTopics` function. The sibling skills a skill refers to are NOT installed: R32 installs one skill, siblings are separate artifacts that an adopter installs separately, and installing them would make one skill's hash depend on another skill's content.
    Acceptance: for a skill whose body cites topic X, the head snapshot holds `references/shared-X.md` with the bytes of `artifacts/core/shared/references/X.md`, and the snapshot of the merge-base revision holds `references/shared-X.md` with the bytes of that file at the merge-base, even when the working-tree copy differs; editing `artifacts/core/shared/references/X.md` changes the content hash of the skill; the installed `<workspace>/.claude/skills/<name>/references/shared-X.md` is byte-identical to the hashed bytes; a topic named only in the frontmatter, or a topic never cited, adds no file; a skill citing no topic, for instance `pr-logbook`, has the same hash as before this delta; a `SKILL.md` stored with CRLF line endings yields the same cited topics as the build (parity test against `citedTopics`); a cited topic without a source file, a skill source holding `references/shared-<anything>.md` at the top level of `references/`, and an untracked non-ignored or symlinked shared source each make the skill `invalid` with no hash and no model call, naming the path; no file under a CLI build tree is read.

## MODIFIED

**R32 (skill install contents), as modified by delta-03 and delta-04.** Addition: the files installed under `<workspace>/.claude/skills/<name>/` include the virtual files `references/shared-<topic>.md` of requirement 51, written from the snapshot at the path they carry; they are part of what the install copies from `references/`, so "nothing else" still excludes `evals/` and every other path. Every other clause stands.
    Acceptance: a `with_skill` run of a skill citing topic X finds `references/shared-X.md` under the installed skill, with the shared bytes; no `evals/` path is installed.

**R35 (content hash), as modified by delta-01 and delta-04.** Addition: the selected files are those of the original clause plus the virtual files of requirement 51, sorted and fed together with the others by their relative path in byte order; the clauses on the single read, on the identity of the installed and the hashed files, and on `invalid` (an untracked non-ignored file or a symbolic link) extend to the shared sources of requirement 51 and to its cases (a) and (b). Every other clause stands. The implementation SHALL update `docs/skill-evals.md` wherever it states the installed or hashed content or the `invalid` rule (the install bullet of the run description, the "Content hash" paragraph and the `invalid` status line) to say that the install and the hash also cover the shared references the skill cites, read from `artifacts/core/shared/references/`, and that a skill whose source holds a top-level `references/shared-*.md` file is invalid. It SHALL also set `RUNNER_VERSION` to 2.2.0, so that results written after this change say so (no check compares it).
    Acceptance: as the acceptance of requirement 51; the three places of `docs/skill-evals.md` name the shared references; `RUNNER_VERSION` is 2.2.0.

## REMOVED

None.

## Consequences (intended, not debt)

- The content hash of every skill that cites a shared reference changes: `architect`, `developer`, `doc-writer`, `pr-reviewer`, `spec-author` and `tester`. `pr-logbook` cites none and is unchanged.
- Attestation in CI is checked only for skills whose hash differs between the merge-base and HEAD, computed by the same scheme on both sides. This change therefore selects no skill, invalidates no committed `results.json`, and requires no re-measurement now, no versioning of the hash scheme and no attestation migration. The committed `content_hash` of those six skills, measured without the shared copies, goes stale only at their next change, when a re-measurement is due anyway.
- `RUNNER_VERSION` moves from 2.1.1 to 2.2.0 (MINOR), under R35. No check compares it, so nothing becomes stale.
- The first re-measurement of one of the six skills compares its pass rate with the `base_eval_pass_rate` committed at the merge-base (R19: nothing is run on the base), which was measured without the shared references. A lower figure with the shared text, or a higher one, can then show as a `regression` or an improvement that comes from the changed measure and not from the change under review. The existing tolerance and the author's judgement of the recorded figures handle it, as for any change of the measure; no migration is added.
- A merge-base snapshot that is `invalid` (for example, a shared source missing at the merge-base) is treated as the skill not existing at the merge-base, as `describeSkill` does today for any invalid base, so the skill is selected and measured in full; this adds no new rule.
- Accepted side effect: a pull request that edits a file under `artifacts/core/shared/references/` now selects, and so requires a fresh attestation of, every skill that cites that topic (up to six today), because the shipped skill really changed. Before this change such an edit selected nothing. This is intended behaviour; no follow-up issue is opened.

## Scenarios

**Scenario:** a skill citing a shared topic is measured as shipped

```text
Given a skill whose SKILL.md body cites the topic "finding-class-taxonomy" and whose source holds no references/shared- file
When  the runner reads the snapshot, hashes it and installs it for a with_skill run
Then  the snapshot holds references/shared-finding-class-taxonomy.md with the bytes of artifacts/core/shared/references/finding-class-taxonomy.md
And   the installed skill holds that file with the same bytes, and the hash covers it
```

**Scenario:** a cited topic has no source

```text
Given a skill whose SKILL.md body cites a topic with no tracked file under artifacts/core/shared/references/
When  the runner reads the snapshot
Then  the skill is invalid, the topic is named, no hash is computed and no model call is made
```

## Out of scope

- Installing sibling skills (for instance `pr-reviewer` for `architect`): R32 defines the install of one skill, siblings are installed separately by an adopter, and installing them would change the isolation contract and make one skill's hash depend on another's content. A skill that needs a sibling carries the operative text itself, as #1915 does with one operative sentence beside each shared citation.
- Building the CLI trees, reading them, or any change to the build (`scripts/lib/build-components/`).
- Re-measuring the six affected skills, or any hash-scheme versioning or attestation migration.

## Open questions

None.
