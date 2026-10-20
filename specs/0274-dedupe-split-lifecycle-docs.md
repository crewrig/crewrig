---
id: "0274"
slug: dedupe-split-lifecycle-docs
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1731
version: 1.0.0
---

# Deduplicate and split the lifecycle docs

## Intent

An agent that spawns or acts as one role loads the whole 56,003-byte
`docs/agent-team-protocol.md` to find the few rules that bind that role, and
several rules are stated two or three times across the lifecycle documents.
After this spec, a spawn brief points an agent at the one short file that binds
its role, the original document remains a small index through which every
existing reference still resolves, each duplicated rule has exactly one
canonical statement that the other places link to, and no rule has changed
meaning or been lost. It is work package WP4c of the epic #1724 (sections 3, 4
and 6).

## Requirements

Sizes are bytes as reported by `wc -c`. The **index** is
`docs/agent-team-protocol.md` after the change; **role files** are the files
under `docs/agent-team-protocol/`. A **stub** is a heading plus a one-line
pointer to the role-file location of the same text.

1. The role files SHALL be `orchestrator.md` (the introduction, *When this
   applies*, the CLI-primitive and briefing sections, *Solo work prohibition*
   and *Team Shutdown*; 11,293 bytes measured on `main`), `templates.md`
   (*Standard Team Templates* with *Seated review passes*, *Step 0* and
   Templates 1 to 3, and *Team sizing by complexity*; 10,955 bytes measured),
   `team-communication.md` (*Team Communication*, Rules 1 to 7; 14,219 bytes measured),
   `worktree-isolation.md` (*Worktree Isolation*, including *Session-boundary
   worktree hygiene*; 18,332 bytes measured) and `built-components.md`
   (*Built Components*; 1,204 bytes measured). The sizes are of the text
   assigned to each file on `main`, so the verbatim move already satisfies
   requirement 4. The plan
   stage MAY refine the file boundaries; it SHALL NOT change requirements 2 to
   10.
2. The index SHALL be at most 6,144 bytes and SHALL contain the introduction, a
   table stating which role file a brief for each of `developer`, `tester`,
   `doc-writer`, `architect`, `pr-logbook`, `pr-reviewer` and `security` cites
   (and which anchor within it), and one stub for every heading (H2 and H3) of
   the original file, carrying the original heading text unchanged and in the
   original order.
3. Every pre-existing reference into `docs/agent-team-protocol.md` SHALL keep
   resolving after the change, both by heading name and by GitHub anchor. This
   covers the inbound links in `AGENTS.md`, `docs/reviewer-seat.md`,
   `docs/ticket-ownership.md`, `docs/host-safety-check.md`,
   `docs/adr/0018-forge-assignment-ownership.md`, `docs/cli-matrix.md` and the
   named forms such as *Worktree Isolation → Session-boundary worktree hygiene*
   and *Team Communication → Rule 1* (cited by Templates 1 to 3). It also covers
   `artifacts/core/skills/pr-logbook/SKILL.md`,
   `artifacts/core/skills/pr-reviewer/references/assert-fresh-observation.md`,
   their compiled copies under `.claude/`, `.gemini/`, `.github/` and `.agents/`,
   and `scripts/lib/worktree-claim/gate.ts` with its golden
   `scripts/tests/fixtures/worktree-claim/golden/matrix.json`. These
   artifact sources, compiled copies, script and golden are NOT edited: they
   keep resolving through the index, which is why the index keeps a stub for
   every original heading. The current `scripts/check-markdown-links.ts`
   validates file existence only, not `#anchors`. The change SHALL therefore add
   an automated anchor-resolution test that, for every `docs/agent-team-protocol.md#...`
   link and every `*Section → Subsection*` named form found in the tracked files
   listed here, proves the heading or explicit anchor exists in the index or in
   the role file it points to, and that fails on a deliberately broken anchor.
   The existing file-existence check is also kept green.
4. Each role file SHALL be smaller than 20,480 bytes, anchors included, at
   the move commit and at the trim commit, and SHALL give each section a stable
   explicit anchor that does not depend on the heading text. Rules 1 to 7 of
   *Team Communication* are bold paragraphs, not headings: `team-communication.md`
   SHALL give each of them an explicit anchor (`<a id="rule-1"></a>` through
   `rule-7`), and the index SHALL carry, under its *Team Communication* stub, a
   list of the seven rule names each linking to its anchor, so that
   *Team Communication → Rule 1* still resolves by name and by anchor.
5. The text SHALL first be moved verbatim, in one commit that changes no
   sentence, and only afterwards deduplicated and trimmed, in a separate commit.
6. A mechanical check SHALL prove that no content was lost: every non-heading
   paragraph of the original file (as on `main` before the change) is found
   verbatim in exactly one location among the index and the role files after the
   move commit, and after the trim commit in exactly one location except the
   paragraphs listed in requirements 7 and 8, each of which is accounted for
   one by one. The check SHALL be committed as an automated test and SHALL fail
   when a paragraph is dropped.
7. Duplication (a): the ordering constraint between `pr-logbook` and
   `pr-reviewer`, which is currently repeated in Templates 1, 2 and 3, SHALL be
   stated once in a subsection shared by the three templates, together with the
   *REVIEW is a looping stage* sentence and the shared-identity workaround
   paragraph, which already applies to every template; each template SHALL link
   to it. The statement SHALL keep the same obligations (`MUST` open the PR
   before `pr-reviewer` is spawned, no parallelisation, PR number taken from
   the `pr-logbook` result message).
8. Duplication (b): the canonical statement of the references-only brief rule
   SHALL be `docs/reviewer-seat.md`. The protocol's *Seated review passes*
   subsection, `docs/retroactive-loop.md` and `AGENTS.md` SHALL keep at most a
   one-line pointer to it, apart from the sentence that a seated pass's brief
   carries neither the `handoff_key` nor the drawer id, which stays because
   `AGENTS.md` relies on it. Duplication (c): ADR-0010 → *Complexity tiers and
   team sizing* SHALL remain canonical for tier names and compositions; the
   protocol's *Team sizing by complexity* SHALL keep only the operational rules
   the ADR does not state (the trivial-tier ticket pickup check, the selection
   rule, the independence from interaction mode, the spec-reviewer obligation)
   and SHALL link to the ADR for the table, and before the table is cut each of
   its cells SHALL be shown to be present in the ADR or kept.
9. Each of the duplications (a), (b) and (c) SHALL, after the change, have
   exactly one canonical statement; the logbook SHALL record a search (the
   command and its output) showing the remaining occurrences are pointers.
10. The orchestrator's briefing rules in `orchestrator.md` SHALL state that a
    spawn brief cites `docs/agent-team-protocol/<role-file>.md#<anchor>` for the
    role it spawns and not the whole document. Inbound links in `docs/` and
    `AGENTS.md` SHALL be re-pointed at the role files where that is a
    one-line edit; the links that are not re-pointed keep working through the
    index (requirement 3). The `AGENTS.md` change SHALL be limited to the
    *Agent Team Protocol* pointer lines and to the other links to the protocol,
    and `AGENTS.md` SHALL NOT grow in size nor have its threshold in
    `scripts/check-agents-size.ts` raised.
11. No rule SHALL change meaning: every `MUST`, `SHALL`, and `MUST NOT` obligation
    of the original file is present after the change with the same subject,
    condition and consequence. Rule semantics, ADR-0010 and
    `artifacts/core/rules/` are not edited.
12. Audit results SHALL be recorded in the logbook and in the plan, verified
    against `main` at implementation time:
    (d) the per-skill *Finding class taxonomy* sections under
    `artifacts/core/skills/` (spec-author, developer, pr-reviewer, architect,
    idea, tester) are role-specific participation rules that already link to
    `docs/plan-review-protocol.md` and `docs/retroactive-loop.md`, the
    canonical sources; they are audited and intentionally left unchanged.
    (e) the seated-pass bootstrap exemption no longer exists after spec 0271 (a
    search for `steps 3 and 6` outside `specs/` returns nothing on current
    `main`); `docs/reviewer-seat.md` stays canonical for the seat bootstrap and
    nothing is removed.
13. Files under `artifacts/` (skills, agents, rules) SHALL NOT be edited, so no
    `metadata.provenance.version` bump and no rebuild of components is needed.
    The pr-reviewer agent and skill keep their references-only wording. If the
    plan finds a link inside `artifacts/` that the change would break, that link
    alone MAY be edited together with its version bump and regenerated outputs,
    and the logbook SHALL name it; requirement 3 makes this case not expected.
14. `docs/cli-matrix.md` and `docs/cli-matrix-maintenance.md` SHALL NOT be
    edited by this change, because it touches no CLI integration point and
    work package WP4a (#1729) rewrites the matrix in parallel. Specs tooling
    (WP4b, #1730) is not touched either.
15. The logbook SHALL record the byte sizes before and after of the original
    file (56,003 before), of the index and of each role file, and the
    token-effect indicators of epic section 4, as measured at implementation
    time.
16. The spec linter, the markdown-link check, the version-bump check, the
    typecheck, the test suite and every `*-ci-wiring` test SHALL pass, none
    disabled or loosened, and the change SHALL NOT ship in the same pull request
    as any other work package of epic #1724.

## Scenarios

**Scenario:** An old reference still resolves

Given a document that links to `docs/agent-team-protocol.md` with the anchor of
*Session-boundary worktree hygiene*
When the anchor-resolution test and `check-markdown-links` run after the change
Then the link resolves to the stub in the index, which points to the text in
`worktree-isolation.md`, and the check passes.

**Scenario:** A Team Communication rule resolves by name

Given a template cites *Team Communication → Rule 1*
When the anchor-resolution test runs after the change
Then the index lists *Rule 1* linking to `rule-1` in `team-communication.md`,
and the anchor exists there.

**Scenario:** A brief cites a role anchor

Given the orchestrator spawns a `developer` for a ticket that edits `artifacts/`
When it writes the brief
Then the brief cites an anchor in `worktree-isolation.md` and one in
`built-components.md`, and not `docs/agent-team-protocol.md` as a whole.

**Scenario:** Verbatim move loses nothing

Given the move commit is applied
When the no-content-lost check compares the original file with the index and
the role files
Then every non-heading paragraph is found exactly once and the check passes.

**Scenario:** A dropped paragraph is caught

Given a paragraph is deleted from a role file after the move commit and is not
listed in requirement 7 or 8
When the no-content-lost check runs
Then it fails and names the missing paragraph.

**Scenario:** Ordering constraint stated once

Given the trim commit is applied
When the logbook search for the `pr-logbook` before `pr-reviewer` ordering
statement runs over `docs/`
Then exactly one canonical statement is found and Templates 1, 2 and 3 each
link to it.

**Scenario:** Oversized index or role file is rejected

Given the index reaches 6,145 bytes, or a role file reaches 20,480 bytes
When the size check runs
Then it fails.

## Out of scope

- Any edit of `docs/cli-matrix*` (WP4a, #1729) or of specs tooling (WP4b, #1730).
- Any change of rule semantics, of ADR-0010, or of rules under
  `artifacts/core/rules/`.
- Edits to skills or agents under `artifacts/`, their provenance versions and a
  component rebuild, except the single-link exception of requirement 13.
- The per-skill *Finding class taxonomy* sections (audited, requirement 12).
- Changes to `AGENTS.md` beyond links and pointer lines (requirement 10).
- Splitting any document other than `docs/agent-team-protocol.md`.

## Open questions

- None.
