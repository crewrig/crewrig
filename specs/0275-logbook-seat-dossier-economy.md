---
id: "0275"
slug: logbook-seat-dossier-economy
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1732
version: 1.0.0
---

# Logbook and seat-dossier economy

## Intent

A standard ticket today posts one logbook comment per obstacle, one full plan
comment per plan revision, and one verdict comment per seated pass, and every
later seated pass re-reads that whole history to rebuild its dossier. After
this spec, a logbook gets one comment per stage transition, each seat keeps a
single in-place ledger comment that its later passes read instead of the
history, plan revisions after v1 are posted as deltas, and plan and verdict
comments have a checked 12 KB ceiling, all without weakening any review
guarantee. It is work package WP5 of the epic #1724 (sections 3, 4 and 6).

## Requirements

1. **R-A1.** `docs/logbook-issues.md` Rule B SHALL require one logbook comment
   per **stage transition** (SPECS to PLAN, PLAN to DEV, DEV to REVIEW, REVIEW to
   merge), posted at the transition and carrying one bullet per obstacle,
   decision, correction or rebase since the previous comment. The incremental
   intent is kept: no end-of-work batch, and nothing is deferred past the next
   transition.
2. **R-A2.** The current "immediate comment" event list (merge conflicts, CI
   failures, friction declarations, scope changes, conflict-resolving rebases,
   inline architectural corrections) SHALL be retained as the list of **bullet
   kinds** a transition comment records, one bullet per event (a rebase bullet
   still summarises conflict and resolution). Only **a blocker that needs a user
   decision** is posted immediately, before work resumes. Rules A and C are
   unchanged.

3. **R-B1.** Each seat `<surface>/<ticket>[#<generation>]` SHALL keep exactly one
   **ledger comment** on the logbook issue, edited in place with
   `gh api -X PATCH repos/<owner>/<repo>/issues/comments/<id>`. Its first line
   is the marker `ledger: <surface>/<ticket>[#<generation>]`, making it
   discoverable by the same style of query that *Reconstructing a dossier*
   uses for the seat line. The second line is `examined: <revision>` (plan
   ordinal, or head commit for a pull-request surface) and the third is
   `rev: <n>`, a counter incremented on every edit.
4. **R-B2.** Every following line SHALL be one finding, in the grammar
   `- <id> | <class> | <blocking> | <status> | <revision> | <ref>` where:
   `<id>` is the per-surface identifier unchanged (`v<N>-F<M>`, `s<N>-F<M>`,
   `i<N>-F<M>`, with sub-finding suffixes); `<class>` is `tech`, `arch` or
   `spec`; `<blocking>` is `yes` or `no`; `<status>` is `open`, `addressed`,
   `superseded`, `withdrawn` or `ledger`; `<revision>` is the revision the
   finding was raised against; `<ref>` is free text with no `|` (the addressing
   commit or revision, the withdrawal reason, or for `ledger` the project
   ledger entry). Any other line is malformed.
5. **R-B3.** From pass 2, a seat SHALL read its ledger plus the diff since the
   revision named by `examined:`, instead of the comment history. Verdict
   comments keep being posted with their `seat:` line as the immutable audit
   trail, and a ledger line is never the only record of a verdict's findings.
6. **R-B4.** Writers: the seat pass reports its new findings in its verdict, and
   the orchestrator applies them and the dispositions of *Prior-finding
   disposition* to the ledger; no other actor edits it. Before each PATCH the
   writer SHALL re-read the comment and abort if `rev:` differs from the value it
   read, then retry from the fresh content (last-writer guard).
7. **R-B5.** `docs/reviewer-seat.md` SHALL be reconciled: the dossier's three
   kinds of content are read through the ledger; *Reconstructing a dossier*
   gains the ledger as the first read path and keeps the verdict query as the
   fallback; a voided pass (*What counts as a dossier entry*) SHALL also have
   its findings removed from the ledger in the same step; *Vacant seat* treats
   "no ledger and no verdicts" as vacant, and "no ledger but verdicts exist" as
   not vacant, the ledger being rebuilt once from the verdicts; generations
   each own a ledger (marker carries `#<generation>`); a replaced artifact
   resets the reading bound, not the ledger. The references-only brief rule in
   *Instantiating a seated pass* is preserved verbatim; the brief MAY name the
   ledger location by reference and SHALL NOT summarise or steer.

8. **R-C1.** The project's deferred-findings ledger (#961, `docs/retroactive-loop.md`
   *Ledger shape and ownership*) is **not reused**, and both documents SHALL say
   so: it is one project-wide, never-closed sink for non-blocking deferred
   findings across tickets, written by append; the seat ledger is per ticket and
   per surface, holds blocking findings too, and is edited in place. A seat
   finding with status `ledger` SHALL carry the project ledger entry in `<ref>`,
   so the *Journalling* line and the seat line stay consistent.

9. **R-D1.** Plan `v2` and later SHALL be posted as a **delta** against the
   previous version: only changed sections, plus a link to the full previous
   version's comment, with each unchanged section named as "unchanged from
   v(N-1)".
10. **R-D2.** The `### Finding traceability` table SHALL be **cumulative and
    complete in every plan version, delta included** (decision: derivation from
    the ledger was rejected because the plan review protocol's countable
    invariant is stated over the plan comment). The `grep -c` invariant in
    `docs/plan-review-protocol.md` stays valid unchanged. The Finding
    Traceability Audit, and "REQUEST CHANGES blocks DEV", are unchanged.
    `docs/plan-format.md` SHALL describe the delta form and state that a delta
    plan is not self-contained except through its link.

11. **R-E1.** A plan comment or verdict comment SHALL be at most 12 KB (12,288
    bytes, UTF-8) in docs and in the citing skills.
12. **R-E2.** A new `scripts/check-comment-size.ts` (no existing plan or verdict
    format check measures size; verified by listing `scripts/`) SHALL accept a
    file path or stdin, print `OK: <n> bytes (budget: 12288 bytes)` or an error,
    and exit non-zero over budget or on an unreadable input. It follows the
    shape of `scripts/check-agents-size.ts` with its logic in a `scripts/lib/`
    module, a unit test, a `task` target, and a CI job wired as the sibling
    size checks are (including the paths filter and a `*-ci-wiring` test).
13. **R-E3.** Overflow behaviour: the author SHALL cut the comment under budget
    by moving bulk (long evidence, command output) to a linked artifact (PR
    description or file in the diff) and keeping a reference. No continuation
    comments, because they would multiply the round-trips this spec removes.

14. **R-F1.** A deterministic parser module under `scripts/lib/` SHALL parse a
    ledger into findings (`id`, `class`, `blocking`, `status`, `revision`,
    `ref`) and parse verdict fixtures into the same shape, and expose a function
    reconstructing the finding set from the ledger alone.
15. **R-F2.** Tests with fixtures SHALL prove that, for each fixture ticket, the
    ledger reconstruction yields exactly the finding set (ids, class, blocking,
    status) that a full read of its verdict fixtures yields. Cases: nominal
    multi-pass, malformed line, duplicate id (rejected), voided pass, missing
    ledger with verdicts (rebuild once), missing ledger and no verdicts
    (vacant), and the three id schemes. This replaces a live multi-pass ticket
    as proof.

16. **R-G1.** Components that restate Rule B, the dossier read path, plan
    posting or comment sizes SHALL be updated and their
    `metadata.provenance.version` bumped (PATCH for wording, MINOR for the new
    ledger step): `artifacts/core/skills/pr-reviewer/SKILL.md` and its
    `references/step-3-fetch.md`, `step-5-compose.md`,
    `spec-review-obligation.md`, `artifacts/core/agents/pr-reviewer/AGENT.md`,
    `artifacts/core/skills/architect/SKILL.md` and
    `artifacts/core/skills/spec-author/SKILL.md`, where they do. Compiled outputs
    are rebuilt (`node scripts/lib/node-floor-guard.js`, then
    `node scripts/build-components.ts`) and staged with the change.
17. **R-G2.** `docs/agent-team-protocol/` role files and `AGENTS.md` change only
    where they restate the above, minimally; `AGENTS.md` stays under its cap
    (`scripts/check-agents-size.ts`).

18. **R-H1.** No rule semantics are weakened: cold independent reviewer,
    references-only brief, finding traceability audit, per-surface identifiers,
    bounded scope from pass 2, user approval before merge. All four CLIs behave
    alike, and setup goldens and the CLI matrix are rebuilt if affected.
19. **R-H2.** The implementation SHALL record a before/after measure on this
    issue's logbook: comment count and total bytes of a synthetic
    standard-ticket transcript fixture (stage transitions, two plan versions,
    three seated passes, five obstacles) under the old rules and the new rules.
    Target: at least 50% fewer logbook-and-dossier bytes, against the epic
    section 2.4 evidence. A live ticket is not required.

## Scenarios

**Scenario:** A later pass reads the ledger, not the history

Given a `plan/1732` seat with a ledger whose `examined:` is plan ordinal 2 and
two earlier verdict comments
When a fresh pass 3 is instantiated with a references-only brief naming the
ledger location
Then it reconstructs its prior findings from the ledger and the diff since
ordinal 2, and the result equals the finding set of a full verdict read.

**Scenario:** A comment over budget fails the check

Given a plan comment file of 12,289 bytes
When `scripts/check-comment-size.ts` runs on it, by path or on stdin
Then it exits non-zero; at 12,288 bytes it exits 0.

**Scenario:** A delta plan keeps the traceability invariant

Given a `v2` delta plan whose traceability table is cumulative
When the `grep -c` row count of `docs/plan-review-protocol.md` runs on it
Then the count equals the findings raised across prior review comments.

**Scenario:** Ledger lost, verdicts present

Given a seat whose ledger comment is missing and whose verdicts carry the seat line
When a pass is instantiated
Then the ledger is rebuilt once from the verdicts and the seat is not vacant.

**Scenario:** Economy is measured

Given the synthetic standard-ticket transcript fixture under old and new rules
When the implementation records comment count and bytes
Then logbook-and-dossier bytes drop by at least 50%.

**Scenario:** Spec and gates pass

Given this spec and the implementation
When `task spec:lint`, the parser and size tests, `scripts/check-skill-versions.ts`
and `scripts/check-agents-size.ts` run
Then all pass.

## Out of scope

- No change to complexity tiers, plan-loop caps, ADR-0010, or the routing in
  `docs/retroactive-loop.md` (finding classes, termination, 5-iteration cap).
- No change to the project deferred-findings ledger or its drain protocol.
- No new store for dossiers: the ledger lives on the forge, on the logbook issue.
- No retroactive rewrite of logbooks or ledgers of tickets already in flight;
  they resolve through the *Vacant seat* path.

## Open questions

- None. Decisions taken in AUTO mode:

- Traceability table stays cumulative in deltas (R-D2) rather than derived from
  the ledger.
- Overflow moves bulk to a linked artifact, no continuation comments (R-E3).
- The deferred-findings ledger is not reused (R-C1), with `ledger` status as the
  bridge.
- `rev:` counter chosen as the concurrency guard (R-B4), as forge comment edits
  have no native compare-and-swap.
