---
id: "0162"
slug: deferred-findings-lane
status: implemented
complexity: standard
interaction-mode: FULL
related-issue: 885
version: 1.0.0
---

# Deferred-findings lane — non-blocking channel with a findings ledger

## Intent

Add a **deferred-findings lane** as a first-class reviewer outcome:
a non-blocking finding that the reviewer (or the orchestrator, in FULL
mode, after a user triage decision) routes to a named, persistent
findings ledger rather than into the retroactive routing loop.

A ledger line is *not* a dropped finding — it is a finding the team
has decided to own at a controlled cost. The ledger is drained by a
named, owned, triggered process so the cost is bounded and visible.

This spec amends:

1. **Spec 0005** (`specs/0005-retroactive-routing-engine.md`) via
   **delta-02** — adds the ledger as a routing target in R10 (non-
   blocking conditional routing) and adjusts the termination condition
   (R8) so that a REVIEW pass with zero *blocking* findings and one or
   more ledger-routed non-blocking findings may still terminate.
2. **`docs/retroactive-loop.md`** — adds a *Deferred-findings ledger*
   section and updates *Non-blocking conditional routing* and
   *Termination* to match.

### Background — conflict with spec 0005 R10 delta-01 (#288)

Spec 0005 R10 (as amended by delta-01 for issue #288) currently reads:

> **INTERMEDIATE / MINIMAL / AUTO** — the orchestrator SHALL route
> every non-blocking finding into the loop using the same matrix as
> blocking findings; in these modes there is no user to defer to, so
> non-blocking findings become blocking by default.

The philosophy behind this amendment was: *termination means "no work
left", not "no work the engine bothered to do"*. An on-demand defer
mechanism without a drain guarantee would launder dropped findings as
deferred ones — strictly worse than the current auto-route rule.

This spec argues the delta-01 rationale *survives* with the ledger in
place, because **the ledger is not on-demand**: it is a named,
ownership-carrying artifact with a defined, triggered drain process.
The argument is:

- **deferred ≠ dropped** — a ledger line is a commitment, not a
  bin. It is visible, owned, and periodically reviewed.
- **on-demand drain means possibly never** (delta-01 risk 1) — so the
  drain SHALL be a **triggered** operation, not a voluntary one. This
  spec mandates the drain trigger contract before any ledger line may
  be written.
- The harness-friction lane (`harness-report` tag → `harness-curator`
  batch triage, currently scoped to harness friction) is the nearest
  existing pattern; this spec either extends it or adopts the same
  shape for product findings.

The prior delta-01 rule treated every non-blocking finding as
effectively blocking, creating loop iterations for findings the
reviewer themselves flagged as non-blocking. The ledger default
preserves the "deferred ≠ dropped" invariant (R1–R3 enforce a drain
cycle) while removing a systematic source of spurious loop iterations.
The two #751 review catches that justified delta-01 (wrong ADR
filename, #880 token-rotation defect) were **blocking** findings and
would not be affected by this routing change.

## Requirements

1. **Ledger shape and ownership.** The project SHALL maintain exactly one **findings ledger**, a pinned
   GitHub issue titled `📋 Findings ledger — deferred non-blocking
   findings` (Gitmoji convention: 📋). The issue SHALL be pinned on
   creation and SHALL never be closed; it SHALL serve as the sink for
   all ledger-routed findings.

2. Each ledger entry SHALL record at minimum: the source PR number, the
   source ticket number, the finding class (`tech` / `arch` / `spec`),
   a one-line summary of the finding, the date routed, and the actor
   who routed it (reviewer, orchestrator, or user).

3. The ledger issue SHALL carry the label `deferred-findings-ledger`
   (created on first use). No other issue SHALL carry this label.

4. **Drain trigger.** The ledger drain SHALL be triggered by the project maintainer at a
   cadence they own. The maintainer SHALL post a `DRAIN` command comment
   on the ledger issue to trigger a drain pass; the orchestrator SHALL
   treat the presence of this comment as the activation signal for the
   drain process.

5. During a drain pass, each open ledger entry SHALL be evaluated
   against one of three dispositions:

   | Disposition | Meaning |
   |---|---|
   | **Promote** | Finding is material; a new ticket SHALL be opened to address it. |
   | **Accept** | Finding is noted but not actionable; the entry SHALL be closed with a recorded rationale. |
   | **Carry** | Finding is still relevant but not yet urgent; the entry SHALL remain open for the next drain. |

6. The maintainer (the user, not an agent) SHALL be the sole
   decision-maker for each disposition. An agent MAY prepare a draft
   recommendation per entry, but SHALL NOT auto-dispose any entry.

7. The findings ledger SHALL NOT grow without bound between drains.
   The orchestrator SHALL emit a visible warning on the logbook issue
   when the open-entry count exceeds **10**, and SHALL page the user
   when it exceeds **20**. When the open-entry count exceeds **20**,
   the orchestrator SHALL additionally block all further ledger-route
   operations for the current ticket until the maintainer posts a
   `DRAIN` comment on the ledger issue and at least one entry is
   disposed.

8. **Routing rule amendments.** The non-blocking routing table (spec 0005 R10) SHALL be amended for
   all modes to introduce **ledger-route** as a third disposition
   alongside *loop-route* and *dismiss*:

   | Mode | Non-blocking finding handling |
   |---|---|
   | **FULL** | The orchestrator SHALL present every non-blocking finding to the user. The user SHALL choose per finding: **loop** (the finding SHALL be routed into the retroactive loop via the blocking matrix per spec 0005 R4), **ledger** (the finding SHALL be routed to the findings ledger), or **dismiss** (the finding SHALL be journalled in the logbook and left unactioned). |
   | **INTERMEDIATE** | The orchestrator SHALL route every non-blocking finding to the **ledger** by default. No user gate SHALL fire. |
   | **MINIMAL** | Same as INTERMEDIATE — the orchestrator SHALL route to the ledger by default; no user gate SHALL fire. |
   | **AUTO** | Same as MINIMAL — the orchestrator SHALL route to the ledger by default; no user gate SHALL fire. |

9. A REVIEW pass SHALL terminate (per spec 0005 R8, as further amended
   by this spec) iff all four conditions hold:

   1. The verdict line SHALL be `### Verdict: APPROVE`.
   2. The pass SHALL surface **zero blocking** findings of any class.
   3. CI SHALL be green on the head commit reviewed.
   4. Every non-blocking finding in the pass SHALL have been disposed
      as **ledger** or **dismiss** (FULL: per user triage; others: auto-
      ledger). Non-blocking findings that the user routes to the loop
      (FULL mode only) SHALL be treated as blocking for termination
      purposes and SHALL be routed through the blocking matrix per
      spec 0005 R4 using their `class:` tag.

10. **Compatibility.** This spec SHALL NOT change the routing of **blocking** findings.
    The routing matrix for blocking findings (tech → DEV, arch → PLAN,
    spec → SPECS) SHALL remain unchanged.

11. The termination condition's "zero findings of any class" (spec 0005
    R8) SHALL be narrowed to "zero blocking findings plus zero
    non-blocking findings loop-routed by the user".

12. The existing "journal in the logbook and leave unactioned"
    disposition (FULL mode only, prior to this spec) SHALL be
    superseded by **dismiss** (same semantics, clearer name). The
    dismiss disposition SHALL be recorded on the logbook issue, not on
    the findings ledger.

13. **Documentation.** `docs/retroactive-loop.md` SHALL be amended to:
    - Add a *Deferred-findings ledger* section documenting R1–R7 of
      this spec (ledger shape, drain trigger, disposition table,
      growth guardrail).
    - Update the *Non-blocking conditional routing* section (table and
      prose) to reflect the amended R10 table (R8 above).
    - Update the *Termination* section to reflect the amended R8 /
      R9 of this spec.

14. A delta-spec file `specs/0005-retroactive-routing-engine.delta-02.md`
    SHALL be authored per `docs/spec-format.md` → *Delta-spec
    convention*, stating the ADDED, MODIFIED, and REMOVED sections
    with reference to the R-numbers above.

15. The findings ledger issue SHALL be opened on GitHub by the
    implementation PR as its first deliverable (before any doc change
    is committed), so the ledger exists as a live artifact before the
    first possible ledger-route is made.

16. The orchestrator SHALL journal every ledger-route disposition on the
    active logbook issue — one line per finding routed, recording the
    finding reference, the disposition chosen (ledger), and the actor.
    This journalling SHALL be distinct from the ledger entry itself (R2);
    the logbook issue SHALL remain the single source of truth for the
    ticket's review history.

## Scenarios

### Happy path — non-blocking finding routed to ledger under FULL mode

Given an implementation PR with two findings: one blocking `class:
tech` and one non-blocking `class: tech`  
When the orchestrator presents the findings to the user in FULL mode  
Then the user routes the blocking finding to the loop (DEV re-spawn)
and the non-blocking finding to the ledger  
And the orchestrator appends a ledger entry (source PR, class, summary,
date, actor=user) to the findings ledger issue  
And the orchestrator journals the ledger-route on the logbook issue  
And on the next REVIEW pass, the verdict is APPROVE with zero blocking
findings and zero non-blocking findings loop-routed  
And the orchestrator terminates the loop and requests merge
authorization.

### Happy path — INTERMEDIATE auto-ledger

Given an implementation PR with one non-blocking `class: arch` finding  
When the REVIEW pass completes under INTERMEDIATE mode  
Then the orchestrator auto-routes the finding to the ledger (no user
gate)  
And appends a ledger entry (actor=orchestrator)  
And journals the ledger-route on the logbook issue  
And the pass termination check: verdict APPROVE + zero blocking + zero
loop-routed non-blocking → terminates.

### Edge case — ledger entry count hits warning threshold

Given the findings ledger has 10 open entries  
When the orchestrator is about to append an 11th entry  
Then the orchestrator appends the entry and posts a visible warning
on the active logbook issue: "⚠️ Findings ledger has reached 10 open
entries — consider scheduling a drain."

### Edge case — user loop-routes a non-blocking finding in FULL mode

Given an implementation PR with one non-blocking `class: spec` finding  
When the orchestrator presents it to the user in FULL mode  
And the user routes it to the loop (chooses "loop" disposition)  
Then the finding is treated as blocking for the current pass  
And the orchestrator routes it through the blocking matrix per
spec 0005 R4 (spec class → SPECS → spec-author in delta-spec mode)  
And termination is not reached on this pass.

### Failure path — ledger grows past the hard guardrail (20 entries)

Given the findings ledger has 20 open entries  
When the orchestrator is about to append a 21st entry  
Then the orchestrator appends the entry  
And posts a page-level alert on the active logbook issue:
"🚨 Findings ledger has exceeded 20 open entries — drain is overdue.
No further ledger-routes are executed until a DRAIN pass reduces
the open-entry count below 20."  
And blocks all subsequent ledger-route operations for the current
ticket until the maintainer posts a `DRAIN` comment on the ledger issue
and at least one entry is disposed.

## Out of scope

- Scripted automation for drain (batch triage of ledger entries via an
  agent). A manual-trigger, maintainer-decided drain is sufficient for
  the current scale. Automation is a candidate follow-up if friction
  surfaces.
- Changes to the `harness-report` / `harness-curator` harness-friction
  lane. The two lanes are independent; this spec does not touch harness
  tooling.
- Changes to the blocking finding routing matrix (R10 of this spec is
  explicit: blocking findings are unaffected).
- Multi-CLI distribution of any new skill or agent. This spec ships no
  new skill or agent source.
- The `spec-author`, `pr-reviewer`, `architect`, `developer`, `tester`
  skill sources — no `class:` field changes are needed for the ledger
  routing; the reviewer's existing blocking/non-blocking flag drives the
  disposition.

## Open questions

- (none — all questions from the ticket were resolved during SPECS)
