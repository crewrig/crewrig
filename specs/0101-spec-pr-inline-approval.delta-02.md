---
id: "0101"
slug: spec-pr-inline-approval
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1984
version: 1.2.0
---

# 0101 — spec-pr-inline-approval (delta-02)

This delta adds a second, narrow carve-out to the merge-authorization gate
for ticket #1984: a **standing merge authorisation** the owner gives in
advance. On multi-ticket runs the just-before ask costs one owner round trip
per pull request; delta-01 made the gate "un-waived" outside its own
carve-out, so a standing authorisation contradicts the written rule. The bump
is **MINOR** (`1.1.0` → `1.2.0`): additive, and the gate stays mandatory
without such an authorisation. It ADDS requirements R15-R19, four scenarios
and one out-of-scope bullet, MODIFIES delta-01 R10 and R13, removes nothing.

## ADDED

1. **R15 — the standing authorisation.** `docs/interaction-modes.md` →
   *User-gate definition* SHALL state that a merge MAY proceed with no
   just-before ask when the owner gave, in advance, an explicit **standing
   merge authorisation** naming the tickets or batch it covers, for the
   current run only. It SHALL never be implied, never carry to another run,
   and never cover a ticket the owner did not name.

2. **R16 — the conditions.** Three minimum conditions SHALL always apply,
   whether or not the owner restates them: the latest review pass has no
   blocking finding, every required check is green, the branch is up to date
   with `main`. The owner MAY add conditions, never remove one. The merge
   SHALL proceed only when every condition holds at merge time; if any is
   unmet, the just-before ask applies to that merge.

3. **R17 — relay and denial.** The coordinator SHALL relay the authorisation
   verbatim in the worker brief, without widening or adding to it; that relay
   is not permission laundering, because the owner authored the scope. A
   denied merge SHALL be retried once, then escalated to the owner, never
   delegated.

4. **R18 — no authorisation, no change.** Absent such an authorisation the
   just-before rule SHALL apply unchanged in every mode, `AUTO` included;
   `AUTO` SHALL NOT itself imply one. The normative text SHALL be
   tool-agnostic and name no orchestration tool.

5. **R19 — playbook and ADR.** `docs/agent-team-protocol/orchestrator.md`
   (*Batch merge approvals*, which says standing authorisation is out of
   scope and tracked in #1984) SHALL describe the pre-authorised path and
   point to `docs/interaction-modes.md` for the normative text. A short ADR
   SHALL record the decision and the rejected alternatives: a per-PR
   just-before permission and a batched just-before permission.

6. **Scenarios.**

   ```text
   **Scenario:** A merge covered by a standing authorisation proceeds

   Given the owner authorised tickets A and B for this run on condition of no
         blocking finding, green checks and a branch up to date with main
   And   the coordinator relayed that text verbatim in the worker brief
   When  the PR for ticket A meets all three conditions at merge time
   Then  it merges with no just-before ask

   **Scenario:** An unmet condition restores the just-before ask

   Given a standing authorisation covering ticket A under the three conditions
   When  the PR for ticket A is behind main
   Then  the authorisation does not apply and the coordinator asks the owner
         just before merging

   **Scenario:** AUTO mode alone never authorises a merge

   Given a run in AUTO mode and no standing authorisation from the owner
   When  a PR is ready to merge
   Then  the just-before ask fires unchanged

   **Scenario:** A denied authorised merge is retried once then escalated

   Given a merge covered by a standing authorisation is denied
   When  the single retry is denied again
   Then  the coordinator escalates to the owner and delegates the merge to no
         other agent
   ```

7. **Out of scope.** Any CI check or hook enforcing the authorisation; any
   change to the delta-01 R9 discharge. Spec `0006` R3 defines the user gate
   as the request "JUST BEFORE every merge"; it needs **no reconciliation**:
   it names the gate, *when* it fires is owned by `docs/interaction-modes.md`
   (as already with R9), and `0006` is immutable.

## MODIFIED

1. **Delta-01 R10 is replaced** to admit two carve-outs.

   - Original: "they SHALL continue to state that the merge-authorization
     gate is mandatory and un-waived for every merge the carve-out does not
     cover, … The reconciliation SHALL NOT present the carve-out as a general
     waiver of the gate."

   - Replacement: the notes SHALL state that the gate is mandatory and
     un-waived for every merge the two carve-outs do not cover, admitting
     only (a) the R9 discharge of a one-file spec-PR and (b) the R15 standing
     authorisation under its R16 conditions. The reconciliation SHALL NOT
     present either carve-out, or both together, as a general waiver.

2. **Delta-01 R13 is replaced** so `AGENTS.md` keeps a pointer only.

   - Original: "`AGENTS.md` → *Branching Strategy* … SHALL carry a
     cross-reference to the `docs/interaction-modes.md` → *User-gate
     definition* carve-out, … discovers the narrow one-file spec-PR
     exception."

   - Replacement: `AGENTS.md` → *Branching Strategy* SHALL carry a pointer
     only to the `docs/interaction-modes.md` → *User-gate definition*
     carve-outs, so a reader finds both the one-file spec-PR exception and
     the standing authorisation; the normative text lives in the `docs/`
     file.

## REMOVED

(None.)
