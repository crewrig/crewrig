---
id: "0162"
slug: deferred-findings-lane
status: draft
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

## Background — conflict with spec 0005 R10 delta-01 (#288)

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

## Requirements

### Ledger shape and ownership

1. The project SHALL maintain exactly one **findings ledger**, a pinned
   GitHub issue titled `📋 Findings ledger — deferred non-blocking
   findings` (Gitmoji convention: 📋). The issue is pinned on creation
   and never closed; it is the sink for all ledger-routed findings.

2. Each ledger entry SHALL record at minimum: the source PR number, the
   source ticket number, the finding class (`tech` / `arch` / `spec`),
   a one-line summary of the finding, the date routed, and the actor
   who routed it (reviewer, orchestrator, or user).

3. The ledger issue SHALL carry the label `deferred-findings-ledger`
   (created on first use). No other issue SHALL carry this label.

### Drain trigger

4. The ledger drain SHALL be triggered by the project maintainer at a
   cadence they own. The trigger is explicit and documented — the
   maintainer posts a `DRAIN` command comment on the ledger issue,
   which activates the drain process.

5. During a drain pass, each open ledger entry SHALL be evaluated
   against one of three dispositions:

   | Disposition | Meaning |
   |---|---|
   | **Promote** | Finding is material; open a new ticket to address it. |
   | **Accept** | Finding is noted but not actionable; close the entry with a rationale. |
   | **Carry** | Finding is still relevant but not yet urgent; leave open for the next drain. |

6. The maintainer (the user, not an agent) is the decision-maker for
   each disposition. An agent MAY prepare a draft recommendation per
   entry, but SHALL NOT auto-dispose any entry.

7. The findings ledger SHALL NOT grow without bound between drains.
   The orchestrator SHALL emit a visible warning on the logbook issue
   when the open-entry count exceeds **10**, and SHALL page the user
   when it exceeds **20**.

### Routing rule amendments

8. The non-blocking routing table (spec 0005 R10) is amended for all
   modes to introduce **ledger-route** as a third disposition alongside
   *loop-route* and *journal-and-leave-unactioned*:

   | Mode | Non-blocking finding handling |
   |---|---|
   | **FULL** | The orchestrator presents every non-blocking finding to the user. The user chooses per finding: **loop** (routes into the retroactive loop), **ledger** (routes to the findings ledger), or **dismiss** (journalled in the logbook and left unactioned). |
   | **INTERMEDIATE** | The orchestrator routes every non-blocking finding to the **ledger** by default. No user gate fires. |
   | **MINIMAL** | Same as INTERMEDIATE — ledger by default, no user gate. |
   | **AUTO** | Same as MINIMAL — ledger by default, no user gate. |

   **Rationale for the INTERMEDIATE/MINIMAL/AUTO default change:**
   the prior delta-01 rule ("route into the loop using the same matrix
   as blocking findings") treated every non-blocking finding as
   effectively blocking, creating loop iterations for findings the
   reviewer themselves flagged as non-blocking. The ledger default
   preserves the "deferred ≠ dropped" invariant (R1–R3 enforce a drain
   cycle) while removing a systematic source of spurious loop
   iterations. The two #751 review catches that justified delta-01
   (wrong ADR filename, #880 token-rotation defect) were **blocking**
   findings — they would not be affected by this routing change.

9. A REVIEW pass under the amended rule terminates (per spec 0005 R8,
   as further amended by this spec) iff:

   1. The verdict line is `### Verdict: APPROVE`.
   2. The pass surfaces **zero blocking** findings of any class.
   3. CI is green on the head commit reviewed.
   4. Every non-blocking finding in the pass has been disposed as
      **ledger** or **dismiss** (FULL: per user triage; others: auto-
      ledger). Non-blocking findings that the user routes to the loop
      (FULL mode only) are treated as blocking for termination purposes.

### Compatibility

10. This spec does NOT change the routing of **blocking** findings.
    The routing matrix for blocking findings (tech → DEV, arch → PLAN,
    spec → SPECS) is unchanged.

11. The termination condition's "zero findings of any class" (spec 0005
    R8) is narrowed to "zero blocking findings plus zero non-blocking
    findings loop-routed by the user" — the intent is preserved (every
    finding has a disposition; none are silently dropped) while the
    mechanism is corrected (ledger-routed findings are fully disposed,
    not in-flight).

12. The existing "journal in the logbook and leave unactioned"
    disposition (FULL mode only, prior to this spec) is superseded by
    **dismiss** (same semantics, clearer name). The dismiss disposition
    is recorded on the logbook issue, not on the findings ledger.

### Documentation

13. `docs/retroactive-loop.md` SHALL be amended to:
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
And the pass termination check: verdict APPROVE + zero blocking + zero
loop-routed non-blocking → terminates.

### Edge case — ledger entry count hits warning threshold

Given the findings ledger has 10 open entries  
When the orchestrator is about to append an 11th entry  
Then the orchestrator SHALL append the entry AND post a visible warning
on the active logbook issue: "⚠️ Findings ledger has reached 10 open
entries — consider scheduling a drain."

### Edge case — user loop-routes a non-blocking finding in FULL mode

Given an implementation PR with one non-blocking `class: spec` finding  
When the orchestrator presents it to the user in FULL mode  
And the user routes it to the loop (chooses "loop" disposition)  
Then the finding is treated as blocking for the current pass  
And the pass routing follows the blocking matrix (spec class → SPECS →
spec-author in delta-spec mode)  
And termination is not reached on this pass.

## Open questions

(None — all questions from the ticket were resolved during SPECS.)

**Q: Ledger shape — extend harness-friction lane vs pinned issue?**  
Resolved: pinned issue (R1). Extension of the harness-friction lane
would mix harness tooling friction with product-findings semantics.
The pinned issue is simpler, immediately usable, and requires no new
infrastructure.

**Q: Drain trigger — owner, cadence, and promotion rule?**  
Resolved: maintainer-owned explicit trigger (R4–R6). Cadence is at the
maintainer's discretion; the growth guardrail (R7) provides an implicit
forcing function. Promotion is one of three dispositions (R5).

**Q: Who classifies blocking vs non-blocking?**  
Resolved: the reviewer classifies at finding authorship time. The
existing `class:` tagging discipline (spec 0005 R2–R3) is unchanged;
the reviewer tags the finding as blocking or non-blocking in the verdict
comment. The orchestrator consumes the tag; it does not re-classify.

**Q: Reversibility — what happens to accumulated ledger entries on
delta-spec revert?**  
Resolved: a revert of this delta-spec does not delete ledger entries;
existing entries carry their own paper trail. On revert, the ledger
issue is unpinned and archived (locked, labelled `archived`). Any
Promote dispositions already raised as tickets are unaffected — they
stand on their own.

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
