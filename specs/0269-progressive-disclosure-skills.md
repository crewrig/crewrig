---
id: "0269"
slug: progressive-disclosure-skills
status: implemented
complexity: standard
interaction-mode: AUTO
related-issue: 1726
version: 1.0.0
---

# Progressive disclosure for skills and agents

## Intent

An agent that activates a skill or agent loads only the part of it that the
current step needs, instead of the whole body. Opt-in material, step-specific
procedure, duplicated cross-skill sections, provenance citations and verbose
descriptions no longer cost tokens on every activation, while every rule keeps
exactly the meaning it has today on all four supported CLIs. This is work
package WP1 of epic #1724 (sections 2.5, 2.6, 4 and 6 of the epic); the
measured effect is the epic's indicator E3 (subagent context growth from
request 1 to request 8).

## Requirements

Paths: `spec-author` and `pr-reviewer` live under
`artifacts/core/skills/<name>/`; `user-validate` and `harness-report` live
under `artifacts/library/skills/<name>/`. Every `references/` path below is
relative to the skill's own directory in that layer.

1. The `user-validate` skill SHALL keep the `plannotator` backend text,
   including its *Contrast-safety and theme support* and *Substance-embedding*
   subsections, in `artifacts/library/skills/user-validate/references/plannotator-backend.md`,
   and its `SKILL.md` SHALL carry only a stub of 3 to 5 lines stating that the
   file is loaded only when `backend=plannotator` was discovered, and giving
   its path.
2. The `spec-author` skill SHALL keep the *Output contract*, *Pre-write
   grounding* and *Interview script* content in separate files under its
   `references/` directory, and its `SKILL.md` SHALL name, for each file, the
   step at which it is loaded.
3. The `spec-author` skill SHALL NOT instruct the agent to re-read
   `docs/spec-format.md` before writing; its self-validation step SHALL
   instruct the agent to run the spec linter and fix what it reports. This
   is the only intended change of meaning in this spec and is an explicit
   exception to requirement 14, justified because the spec linter enforces
   the format mechanically.
4. The `pr-reviewer` skill SHALL keep the detailed *Protocol* sub-steps in
   `references/protocol.md` and SHALL keep the ordered checklist of those
   steps inline in `SKILL.md`.
5. The `harness-report` skill SHALL keep its trigger list and its minimal
   payload inline, and SHALL keep the *Operating mode* details (failure modes
   and forge fallback) in a file under its `references/` directory.
6. The *Finding class taxonomy* and *Grounding discipline* sections, which are
   duplicated across skill and agent sources, SHALL each be replaced in every
   file that carries them by a single-line link to one designated canonical
   source per topic. The canonical source for the taxonomy SHALL be one of
   `docs/plan-review-protocol.md` or `docs/retroactive-loop.md`, the same one
   in every file. The canonical source for grounding discipline SHALL be
   the single full statement of it, retained in
   `artifacts/core/skills/architect/SKILL.md`, which is the only place the
   text is stated in full today; every other file SHALL link to it. Both
   choices SHALL be recorded in the implementation logbook.
7. A spec or R-number citation that is provenance rather than instruction
   SHALL be authored as an HTML comment of the form
   `<!-- provenance: spec 0080 R12 -->`; frontmatter is not a provenance
   carrier. The citations in
   the sources touched by this spec SHALL be relocated by hand, and no
   automated rewrite of prose parentheses SHALL be performed.
8. `scripts/build-components.ts` SHALL strip provenance comments from every
   compiled output for all four CLIs and SHALL leave every other HTML comment
   untouched. A build test SHALL fail when a compiled output still contains
   a `<!-- provenance: ... -->` comment and SHALL fail when a non-provenance
   comment is removed.
9. Before any change to the "read the skill once at the start" instruction in
   an `AGENT.md`, the implementation SHALL verify, for each of Claude Code,
   Gemini CLI, GitHub Copilot CLI and Antigravity CLI, whether an agent can
   have a skill preloaded through its own definition (for Claude Code, the
   subagent frontmatter `skills:` field), and SHALL record the evidence
   (documentation reference or observed behavior) per CLI in
   `docs/cli-matrix.md`.
10. Where requirement 9 shows that preloading exists on a CLI, the agent
    source for that CLI SHALL use it and the "read the skill once" instruction
    SHALL be removed for that CLI. Where it shows that preloading does not
    exist, the instruction SHALL be kept for that CLI and the gap SHALL be
    recorded in `docs/cli-matrix.md` with the evidence of absence, so no
    asymmetry is silent.
11. The `description` of every skill and agent source under `artifacts/` (the
    intended blast radius: all 16 sources currently over the limit, not only
    the four skills above) SHALL be at most 300 characters, in the source and
    in every compiled output, and SHALL retain the trigger words present in
    the current description.
12. After this spec is implemented, the `SKILL.md` body sizes SHALL be at most
    12 KB for `spec-author`, 10 KB for `pr-reviewer`, 8 KB for `user-validate`
    and 5 KB for `harness-report`, measured with `wc -c`. Any reference file
    loaded unconditionally at activation, rather than at a later step or
    under a condition, SHALL count toward its skill's budget.
13. Text SHALL be moved verbatim from `SKILL.md` into its destination in one
    commit, and trimmed or reworded only in a later, separate commit, so a
    reviewer can diff the moved text against the original.
14. Except for the exception stated in requirement 3, no rule, obligation, prohibition or condition in any touched skill or
    agent SHALL change meaning; every rule present before the change SHALL be
    reachable from the touched `SKILL.md` or `AGENT.md` through an explicit
    load instruction naming its new location.
15. Every modified shipped skill or agent source SHALL bump
    `metadata.provenance.version` per `docs/version-bump-convention.md`, and
    the commit SHALL include the outputs regenerated by
    `node scripts/build-components.ts` after `node scripts/lib/node-floor-guard.js`.
16. Every change SHALL ship symmetrically for Claude Code, Gemini CLI, GitHub
    Copilot CLI and Antigravity CLI; any parity gap SHALL carry concrete
    evidence that the mechanism is missing in the target CLI.
17. The deterministic checks `check-skill-versions.ts`, `check-skill-mirrors.ts`,
    the spec linter, the markdown-link check, the typecheck and the test suite
    SHALL pass, and none SHALL be disabled or loosened. A new check,
    `scripts/check-description-length.ts`, SHALL fail on any source or
    compiled description over 300 characters and SHALL run in CI.
18. The implementation logbook SHALL record the epic's indicators Q1 to Q4 and
    E1 to E4 before and after the change, with E3 measured on comparable
    tickets per section 4.4 of the epic.

## Scenarios

**Scenario:** Default backend skips the plannotator text

Given `~/.crewrig/validation.conf` is absent so `backend=internal` applies
When  an agent activates `user-validate`
Then  the loaded `SKILL.md` is at most 8 KB and `references/plannotator-backend.md` is not read

**Scenario:** Opt-in backend loads the reference

Given the discovered configuration is `backend=plannotator`
When  an agent follows the stub in `user-validate/SKILL.md`
Then  it reads `references/plannotator-backend.md` and the invocation is identical to the pre-change behavior

**Scenario:** Spec authoring runs the linter instead of re-reading the format

Given a `spec-author` run has written a spec file
When  it reaches self-validation
Then  it runs the spec linter, fixes the reported findings, and does not read `docs/spec-format.md` unless the linter output requires it

**Scenario:** Provenance comments are stripped from compiled outputs

Given a source `SKILL.md` containing `<!-- provenance: spec 0080 R12 -->` and an unrelated `<!-- note -->`
When  `node scripts/build-components.ts` runs
Then  no compiled output for any CLI contains the provenance comment and every compiled output still contains `<!-- note -->`

**Scenario:** Preloading is available on one CLI only

Given verification shows Claude Code supports the `skills:` field and another CLI shows no equivalent
When  the agent sources are updated
Then  the Claude Code output drops the "read the skill once" instruction, the other CLI keeps it, and `docs/cli-matrix.md` records the evidence of absence

**Scenario:** A body exceeds its budget

Given the trimmed `pr-reviewer/SKILL.md` measures 10,400 bytes
When  the size check runs
Then  the acceptance check fails and the implementation moves more detail to `references/` before merging

**Scenario:** A moved rule changed meaning

Given the verbatim-move commit and the trim commit are diffed
When  a reviewer finds a rule whose obligation differs from the original
Then  the finding is `tech` class and the trim commit is corrected before merge

## Out of scope

- Slimming `AGENTS.md`, the deployed rules or `docs/cli-matrix.md` (epic WP2 and WP4).
- The memory-sweep changes of WP3 and the ceremony changes of WP6.
- Skills outside the four named in requirements 1 to 5, except for the taxonomy and grounding link replacement (requirement 6), the provenance convention (requirement 7) and description shortening (requirement 11).
- Rewording any rule for style; only relocation, link replacement and trimming that preserves meaning are in scope.
- Changing the spec linter or the format in `docs/spec-format.md`.
- Introducing a skill-loading mechanism on a CLI that lacks one.

## Open questions

- [AUTO-PARKED] Which of `docs/plan-review-protocol.md` and `docs/retroactive-loop.md` is the single canonical taxonomy source? Default: `docs/retroactive-loop.md`, since it covers all three classes and their loop targets; the plan stage records the final choice.
- Resolved (AUTO): grounding discipline has no doc home; its canonical source is the architect skill section (requirement 6). The plan stage MAY instead extract it to a new doc if it records why.
- Resolved (AUTO): the 300-character cap applies to the source and every compiled output, enforced by a new check (requirements 11 and 17).
- [AUTO-PARKED] The outcome of requirement 9 per CLI is unknown at authoring time; requirement 10 is deliberately conditional and the plan stage records the verified result.
- Decision (AUTO): issue line references were checked against the current tree. The `plannotator` backend is at lines 77 to 297 of `user-validate/SKILL.md` and the self-check at `spec-author/SKILL.md` line 526, both still accurate; sizes (30,739, 19,663, 19,008 and 11,841 bytes) match.
