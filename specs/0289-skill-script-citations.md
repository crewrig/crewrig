---
id: "0289"
slug: skill-script-citations
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1846
version: 1.0.0
---

# Skill script citations resolve or are repo-scoped

## Intent

A skill installed in an adopter repository never tells the agent to run a script that does not exist there. Every script a skill's instructions point to either ships with that skill and runs from the installed skill directory on every supported CLI, or is visibly marked as a step for the CrewRig repository only, with a manual equivalent where one exists. A maintainer who adds a new unresolved script citation is stopped by an automated check before the change ships.

## Requirements

1. **R1 (resolvable citations).** Every `scripts/...` path cited in the body of a core or library skill's `SKILL.md` or in any Markdown file under its `references/` directory SHALL either resolve to a file inside that same skill's directory after build, or be located inside a CrewRig-repository-only fence (R2).
2. **R2 (repo-only fence).** A CrewRig-repository-only fence SHALL be a region delimited by the exact lines `<!-- crewrig-repo-only:start -->` and `<!-- crewrig-repo-only:end -->`. The region SHALL be preceded or accompanied by visible prose stating that the enclosed step applies to the CrewRig repository only. The markers SHALL NOT be the only signal a human reader gets.
3. **R3 (comment-size check ships with the reviewer).** The `pr-reviewer` skill SHALL ship a self-contained comment-size check that measures a comment body against the 12288-byte budget and fails when it is exceeded. The check SHALL run from the installed skill directory without any file outside that directory.
4. **R4 (single source for the check).** The repository-root comment-size check, and every existing task, CI job and test that invokes it, SHALL keep working with unchanged invocation and unchanged exit behaviour, and SHALL execute the same logic as the skill's bundled copy, so that the two cannot diverge.
5. **R5 (architect budget guidance).** The `architect` skill SHALL state the 12288-byte comment budget and give a portable byte-count check that works in any repository. Any citation of the repository's comment-size script there SHALL sit inside a repo-only fence.
6. **R6 (spec-author citations).** The `spec-author` output-contract SHALL present the ticket-pickup check, the spec-id reservation and the spec linter as CrewRig-repository-only steps inside repo-only fences, and SHALL state for each the manual equivalent an adopter without those scripts follows.
7. **R7 (harness-report citation).** The `harness-report` skill SHALL NOT cite a CrewRig source-tree path for the curator script. It SHALL instead instruct the agent, conditionally on the `harness-curator` skill being installed, to run that skill's own curate script from its installed location.
8. **R8 (enforcement).** The skill linter bundled with `pr-reviewer` SHALL fail, naming the file, line and cited path, on any `scripts/...` citation in `SKILL.md` or a `references/**/*.md` file that neither resolves inside the citing skill's directory nor lies inside a repo-only fence. It SHALL pass when every such citation resolves or is fenced, and it SHALL remain runnable from the installed skill directory without any file outside it.
9. **R9 (checked behaviour).** The enforcement of R8 SHALL be covered by automated tests with fixtures for at least: a resolving citation (pass), an unresolved unfenced citation (fail), an unresolved fenced citation (pass), a citation in a `references/` file (fail when unfenced), and an unterminated fence (fail).
10. **R10 (versions and build).** Every skill source modified by this work SHALL carry a bumped `metadata.provenance.version`, and the built outputs SHALL be regenerated in the same change so that the drift check passes.
11. **R11 (no regression).** After the change, the linter SHALL pass on every skill currently in the repository.

## Scenarios

**Scenario:** adopter runs the reviewer's size check

```text
Given the pr-reviewer skill is installed in a repository that has no CrewRig scripts/ directory
When  the agent runs the comment-size check cited by the skill on a 20000-byte comment body
Then  the check runs from the installed skill directory
And   it fails reporting the body exceeds 12288 bytes
```

**Scenario:** repo-only step is visibly scoped

```text
Given an adopter reads the spec-author output contract
When  they reach the spec-id reservation step
Then  the step is inside a repo-only fence with visible prose naming it CrewRig-repository-only
And   a manual equivalent is stated beside it
```

**Scenario:** unresolved citation is rejected

```text
Given a skill body cites scripts/missing-tool.ts, which is not in that skill's directory, outside any fence
When  the skill linter runs
Then  it exits non-zero naming the file, the line and scripts/missing-tool.ts
```

**Scenario:** fenced citation is accepted

```text
Given the same citation sits between the repo-only start and end markers
When  the skill linter runs
Then  it does not report that citation
```

**Scenario:** unterminated fence is rejected

```text
Given a skill file opens a repo-only fence and never closes it
When  the skill linter runs
Then  it exits non-zero reporting the unterminated fence
```

**Scenario:** repository-root callers are unaffected

```text
Given the repository-root comment-size check is invoked by an existing task with its current arguments
When  the task runs after this change
Then  it produces the same result and exit code as before
```

## Out of scope

- File layout and mechanism: the exact location of the bundled check, how the repository-root entry point reuses it, and the linter's internal structure belong to the PLAN stage (architect decision on issue #1846: bundled copy in `pr-reviewer/scripts/` with a repository-root delegator).
- Skills outside core and library layers, and citations of paths that do not begin with `scripts/`.
- Reworking the content of the scripts cited by repo-only steps, or bundling ticket-pickup, spec-id reservation or the spec linter into any skill.
- The future `check-skill-quality.ts`; this work extends the existing skill linter only.

## Open questions
