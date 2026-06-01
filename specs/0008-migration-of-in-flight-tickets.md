---
id: "0008"
slug: migration-of-in-flight-tickets
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 175
version: 1.0.0
---

# Migration of in-flight tickets to the SPECS → PLAN → DEV → REVIEW lifecycle

## Intent

Contributors gain a documented cutoff policy and a single audited
classification table that places every ticket open at the time of
the ADR-0010 lifecycle merge into one of three deterministic buckets
(keep-legacy, retrofit, close), so the new SPECS → PLAN → DEV →
REVIEW lifecycle has a defined boundary against the legacy
"ticket → team spawn → PR" flow that preceded it and downstream
agents never have to guess which contract a given ticket operates
under.

## Requirements

1. `AGENTS.md` SHALL gain a new top-level annex section titled
   "Legacy ticket policy" that documents (a) the cutoff rule and
   (b) the legacy contract that keep-legacy tickets continue to
   operate under.
2. The cutoff rule SHALL be stated as: tickets opened before the
   merge of PR #176 (which introduced ADR-0010, the SPECS → PLAN →
   DEV → REVIEW lifecycle) on `main` (literal date for the human
   reader: 2026-05-31) are eligible for migration triage under
   this spec; tickets opened on or after that date SHALL follow
   the new lifecycle by default.
3. The legacy contract section SHALL be explicit and self-contained
   — a roughly five-line summary stating that legacy tickets run
   under: the team protocol defined in `AGENTS.md` *Standard Team
   Templates*, a direct implementation pull request closing the
   issue, NO SPECS stage (no `/specs/` file), NO PLAN comment, NO
   spec-PR / delta-spec ordering, NO retroactive review-loop
   class-tagging discipline. The summary SHALL NOT point readers
   at git history; it SHALL stand on its own so a freshly spawned
   agent picking up a keep-legacy ticket can act without further
   research.
4. The audit table SHALL be the one defined in this spec under
   *Audit table* below and SHALL be reproduced verbatim as a
   comment on the logbook issue (#175) by the implementation team
   at DEV time. The audit table is normative content of this spec;
   the implementation team SHALL NOT reclassify a ticket without
   producing a delta-spec amendment first.
5. For each ticket classified `keep-legacy`, the implementation
   team SHALL post a single logbook pin comment on that ticket
   (one comment per ticket) whose header is
   `## Legacy ticket — operating under pre-#176 contract` and
   whose body cites `AGENTS.md` → *Legacy ticket policy*. The
   comment SHALL be the first thing a sibling agent sees when
   reading the issue body and comments.
6. For each ticket classified `retrofit`, the implementation team
   SHALL NOT itself author the retrofit specs in this PR; the
   retrofit is a separate ticket-by-ticket follow-up. The
   implementation team SHALL post a single logbook comment on
   each retrofit ticket whose header is
   `## Retrofit — qualified under spec 0008 audit` indicating the
   declared retrofit tier (per the audit table) and pointing at
   `AGENTS.md` → *Legacy ticket policy*.
7. For each ticket classified `close`, the implementation team
   SHALL NOT close the ticket as part of this PR; the audit
   merely declares the classification. Closure is a separate
   maintainer action driven by the ticket's own resolution.
8. Tickets opened on or after the cutoff date SHALL NOT appear
   in the audit table EXCEPT to record an explicit "NA —
   post-cutoff" verdict for traceability; this prevents a future
   reader from wondering why a known open issue is absent from
   the audit.
9. When a `retrofit`-classified ticket reveals at SPECS time that
   its scope decomposes into two or more sub-specs (i.e. its
   complexity tier is `large` per ADR-0010), the implementation
   team SHALL acknowledge the decomposition in this spec's audit
   table by recording the declared tier alongside the verdict
   (e.g. "retrofit (large)"); the actual sub-spec decomposition
   is the retrofit ticket's own SPECS-stage work, not this
   migration spec's.
10. The cap on retrofit volume SHALL be qualitative — when more
    than five tickets are classified `retrofit` in a single
    migration pass, the implementation team SHALL stop the audit
    and surface the count to the user before continuing. The
    current audit (this spec) classifies two tickets as
    `retrofit`, well within the cap.

## Audit table

The following table is the normative audit of every issue open at
the time of this spec's authoring (2026-06-01). Re-classification
requires a delta-spec amendment per R4.

| Issue | Title (truncated) | Verdict | Retrofit tier | Rationale |
|---|---|---|---|---|
| #132 | Back-port `set -x` suppression to claude-code.sh | keep-legacy | — | Two-line shell change; cost of authoring a retrofit spec is disproportionate to the change's surface. Finishes under the legacy contract with the pin comment from R5. |
| #144 | GenIA Quality Sentinel (Global STOP hook) | retrofit | large | Substantial cross-CLI feature (global STOP hook for Claude + Gemini, system-prompt-injection mechanism). The canonical example of an EPIC #165 ticket that decomposes into sub-specs at SPECS time. Retrofit work is its own ticket. |
| #146 | `setup-claude-interactive` rejects unmodified SOUL.md | keep-legacy | — | UX-clarification bug whose fix is a small shell-script change once the customization-mandatory question is decided. Specs would add ceremony without changing the decision surface. Finishes under the legacy contract. |
| #159 | Add nightly CI workflow for e2e suite | retrofit | standard | Non-trivial infrastructure feature with an open architectural question (authentication strategy in CI) explicit in the ticket body. The SPECS stage forces that question to be answered in a persistent artefact before implementation begins, which is exactly the value the lifecycle adds. Created the day before the cutoff but firmly pre-merge of #176. |
| #162 | Investigate `copilot/01-layered-context` intermittent flake | keep-legacy | — | Investigation, not implementation. A SPECS document has nothing to qualify (the WHAT is "diagnose"). Finishes under the legacy contract; may resolve to "cannot reproduce" or spawn a separate fix ticket that itself follows the new lifecycle. |
| #178 | Spec format linter (post-#167 follow-up) | NA — post-cutoff | — | Opened during this very migration's authoring session, after PR #176 merged. Automatically operates under the new SPECS → PLAN → DEV → REVIEW lifecycle. Listed here for traceability only; no action required by this spec's implementation team. |

## Scenarios

### Happy path — audit lands as the single source of truth

Given the implementation team picks up this spec after its spec-PR merges
When the team reads the audit table (R4) and posts the per-ticket
  logbook pin comments (R5, R6)
Then a future agent reading any of `#132`, `#146`, `#162` sees the pin
  comment as the first sibling-agent-visible artefact and immediately
  operates under the legacy contract documented in `AGENTS.md` →
  *Legacy ticket policy*
And a future agent reading `#144` or `#159` sees the retrofit pin and
  knows to open a new SPECS-stage ticket before resuming work
And a future agent reading `#178` finds no pin (post-cutoff) and
  defaults to the new lifecycle.

### Failure path — a retrofit decomposes into multiple sub-specs

Given the retrofit of issue `#144` is picked up after this spec merges
When the `spec-author` skill runs on `#144` and discovers that the
  ticket's scope spans multiple independent sub-features (a Claude
  hook surface, a Gemini hook surface, and a shared analysis layer)
Then the SPECS-stage author SHALL declare `complexity: large` in the
  retrofit spec's frontmatter (which matches the tier this audit
  pre-recorded under R9)
And the architect SHALL decompose the retrofit work into one or more
  child tickets per `AGENTS.md` → *Team sizing by complexity* →
  *large*
And no implementation work SHALL start on `#144` until each child
  ticket has its own merged spec-PR
And the migration audit in this spec SHALL NOT be re-edited to
  reflect the decomposition (R4 forbids reclassification without a
  delta-spec); the audit captured a snapshot at migration time, and
  the child tickets are the live SPECS-stage records.

## Out of scope

- The lifecycle definition itself (spec 0001 → 0007 family; tracked
  under EPIC #165 sub-tickets #166 / #167 / #168 / #169 / #170 /
  #172 / #173 / #174 — all merged). This spec is the migration
  bridge, not the lifecycle.
- The `spec-author` skill behaviour beyond reading the
  `complexity` and `interaction-mode` fields from the retrofit
  specs that this audit triggers — that behaviour is already
  shipped via issue #168.
- The actual retrofit work for `#144` and `#159`. Each retrofit is
  its own ticket-by-ticket SPECS entry; this spec only authorises
  and tier-pre-records them.
- Closure of any audited ticket. Classifications are declared here;
  closure is a separate maintainer action.
- Migration of issues opened after the cutoff date. Only the `#178`
  row exists, and it carries an "NA — post-cutoff" verdict
  precisely to make the boundary explicit (R8).
- A retroactive audit at every subsequent SPECS authoring (i.e.
  re-running the audit periodically). The migration is a one-time
  pass; the cutoff rule in R2 is the steady-state contract that
  replaces any future migration pass.

## Open questions

(none — all interview questions and the per-ticket audit verdicts
were resolved at SPECS time.)
