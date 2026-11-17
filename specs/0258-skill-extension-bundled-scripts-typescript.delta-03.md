---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1850
version: 1.3.0
---

# Skill- and extension-bundled scripts in TypeScript

*Delta 03 of `specs/0258-skill-extension-bundled-scripts-typescript.md`. Source: issue
GitHub issue 1850. Requirement 34 of the base spec records, as an existing asymmetry that it "SHALL NOT
change", that the Copilot CLI user-scope install places only the `SKILL.md` of a skill.
That sentence is superseded: a skill that tells the model to run a bundled script would
point at a file that does not exist in `~/.copilot/skills/<name>/`, and every script the
epic #1856 moves into a skill widens the gap. The implementation lands on `main`
directly: this delta does not run under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR and implementation
pull request target `origin/main`. The version is a MINOR bump: the install behaviour of
one CLI is extended, no requirement of another CLI changes. This delta opens no
question.*

## ADDED

<!-- markdownlint-disable MD029 -->

41. **Copilot user-scope install places the whole skill directory.** For each built
    skill of a tier, `installCopilotSkills` of `scripts/lib/setup/tier-install.ts` SHALL
    place the whole staged skill directory (`SKILL.md`, `scripts/`, `references/`,
    `assets/` and any other file the skill carries) at `~/.copilot/skills/<name>/`, through
    the existing `installDir` placement of `scripts/lib/setup/files.ts`: a copy or a link
    according to the setup mode, as for every other directory the setup places. File mode
    bits (the executable bit of a script) SHALL be preserved. Any prior install of that
    skill (a copy or a link, including the former `SKILL.md`-only copy) SHALL be replaced,
    so a file removed from the skill upstream does not linger. The skills that exist under
    `~/.copilot/skills/` for another reason and are not part of the tier SHALL NOT be
    touched.

42. **Setup output line.** The line printed per skill SHALL change from
    `Copied: <tier>/<name>/SKILL.md -> ~/.copilot/skills/<name>/SKILL.md` to
    `Copied dir: <tier>/<name> -> ~/.copilot/skills/<name>` (`Linked dir:` when the
    placement is a link). The golden fixtures of the setup output
    (`scripts/tests/fixtures/setup-golden/copilot/*/stdout.golden`) SHALL be updated in
    the same diff. Copilot agents remain skipped on purpose, as before: this delta does not
    install `~/.copilot/agents`, whose naming stays unverified.

43. **Install test.** A test of the Copilot tier install
    (`scripts/tests/setup-tier-install.test.ts`) SHALL run the install against a temporary
    `HOME` and SHALL NEVER read or write the real `~/.copilot`. Over a staged skill that
    bundles `scripts/` and `references/`, it SHALL assert that: (a) `scripts/<file>` and
    `references/<file>` exist under `<HOME>/.copilot/skills/<name>/`; (b) the executable bit
    of a script is preserved (on a POSIX host; skipped on `win32`, where mode bits carry no
    meaning); (c) a file present in a prior install of that skill and absent from the
    staged skill is gone after the install.

44. **Parity rows.** In the same diff, `docs/cli-matrix/rows/3.md`, `4d.md` and `37g.md`
    (the three rows that state the asymmetry) SHALL be updated to say that the Copilot CLI
    user-scope install places the whole skill directory under `~/.copilot/skills/<name>/`,
    and `docs/cli-matrix.md` SHALL be rebuilt from the row sources
    (`AGENTS.md`, *CLI Matrix Maintenance*). No row SHALL keep the sentence that the Copilot
    CLI installs `SKILL.md` only.

45. **Base-spec statements superseded.** Every statement of the base spec and of its deltas
    that the Copilot CLI user-scope install places only `SKILL.md`, never `scripts/`, as an
    asymmetry to keep, is superseded by requirements 41 to 44. The base spec is not edited
    (its normative content is frozen); a reader resolves the conflict in favour of this
    delta. The parity statement of requirement 34, that the four CLIs consume the same skill
    scripts, now holds for the user-scope install too.

<!-- markdownlint-enable MD029 -->

**Scenario:** A skill's scripts reach the Copilot user-scope install

Given a built skill `pr-reviewer` whose staging holds `SKILL.md`, an executable
`scripts/<file>` and `references/<file>`, and a temporary `HOME`
When the Copilot tier install runs
Then `<HOME>/.copilot/skills/pr-reviewer/scripts/<file>` and
`<HOME>/.copilot/skills/pr-reviewer/references/<file>` exist, the script is still
executable, and the output holds `Copied dir: library/pr-reviewer -> ~/.copilot/skills/pr-reviewer`.

**Scenario:** A stale file does not linger

Given a prior install of the skill that holds `scripts/old.ts`, which the staged skill no
longer carries
When the Copilot tier install runs again
Then `scripts/old.ts` no longer exists under `<HOME>/.copilot/skills/<name>/`.

**Scenario:** The parity rows no longer claim the asymmetry

Given the row sources `3.md`, `4d.md` and `37g.md`
When `docs/cli-matrix.md` is rebuilt
Then no row states that the Copilot CLI installs `SKILL.md` only, and the rebuilt file is
committed with the row sources.

## MODIFIED

Requirement 34 of the base spec, the final clause:

> the Copilot CLI installs only `SKILL.md` of a skill, never its `scripts/`
> (`scripts/lib/setup/tier-install.ts`), an existing asymmetry that this row SHALL record
> and SHALL NOT change.

is replaced by:

> the Copilot CLI user-scope install places the whole skill directory, `scripts/`
> included, under `~/.copilot/skills/<name>/` (requirement 41 of delta 03); no asymmetry
> remains to record, and the Copilot agents stay skipped.

## REMOVED

The sentence quoted under MODIFIED, in requirement 34, is removed as a normative statement
(superseded by requirement 45). Nothing else is removed.
