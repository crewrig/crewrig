---
name: idea
description: "Runs a structured idea-convergence session on a forge issue: opens the session, triages and compares competing proposals, tallies votes under the solo, unanimity or vote governance mode, and closes with one or more SPECS issues or a no-consensus record. Use when several competing, overlapping or complementary proposals address the same parent issue and must converge before a spec is written, or when asked to open, tally or close an IDEA session. Trigger terms: IDEA session, converge proposals, competing designs, candidate, VOTE comment, quorum, unanimity, no consensus. Not for a ticket whose intent is already clear (spec-author), reviewing a pull request (pr-reviewer) or open-ended brainstorming."
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts) and the forge CLI (gh for GitHub; glab or tea users export the issue JSON and translate the printed commands)."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.2.0"
---


# Idea

An IDEA session settles which of several proposals becomes the spec's intent, and leaves an auditable record on a forge issue: proposals, triage, comparison, votes and outcome are all comments on one session issue. It sits before SPECS and is optional. When a single clear intent exists, go straight to `spec-author`.

Mechanical steps are scripts; you supply the judgement (clustering ideas, comparing, composing, designating the candidate). Run each as `node <skill-dir>/scripts/<name>.ts`. All take `--json` for `{ok, data, findings}` and `--help`; exit `2` means a wrong invocation and `3` a failed environment (usually `gh` unavailable or unauthenticated), never a verdict on the session.

| When | Command | Exit `1` means |
|---|---|---|
| Opening | `idea-open.ts --mode <m> --issue <N> --description <t>` plus the governance options of the mode | Never used. `--dry-run` prints the `gh` commands and the issue body and runs nothing. |
| Before any decision to close | `idea-tally.ts --issue <N>` (or `--comments-file <exported.json>`) | No usable candidate: `candidate-required` (two or more proposals survive and none is designated) or `no-proposals`. Designate a candidate first. |
| Closing | `idea-close.ts --issue <S> --outcome resolved\|no-consensus --parent <N> ...` | Refused: `threshold-not-met` or `winner-mismatch`. Do not close as resolved. |

Read `data` of the tally, not only the exit code: `threshold_met` is the verdict, `missing` names who has not voted, `ignored` and the warning findings say which comments were not counted and why. Pass the tally's `--json` output to `idea-close.ts --tally-file` so the closing comment carries the real counts.

## Governance modes

The mode and its parameters are fixed when the session issue is created, and are written into its body by `idea-open.ts` (the tally reads them back from there). Changing them mid-session would let the outcome be steered after the votes are visible, so the only recourse is to close the session as no-consensus and open a new one.

| Mode | Parameters | Threshold |
|---|---|---|
| `solo` | `--owner <login>`: one decision authority. Default to the invoking user's login when the user gives none. | The owner posts `VOTE: APPROVE`. A `REJECT` is a veto that leaves the session open. |
| `unanimity` | `--owners <a,b,...>` | Every owner has approved. One `REJECT` blocks, and the session stays open. |
| `vote` | `--voters <a,b,...>` and `--quorum <pct>` (1-100) | Approvals are at least `quorum` percent of the approve and reject votes, with at least one such vote. `ABSTAIN` is left out of the denominator. |

Optional `--dimensions "a;b"` replaces the default comparison dimensions at open time; they cannot change later.

## Session workflow

1. **Open.** Run `idea-open.ts`. It creates `[IDEA] <description> (parent #N)` with the labels `idea-session` and `idea-<mode>` and comments on the parent issue. On a forge other than GitHub, run it with `--dry-run` and translate the commands.
2. **Collect proposals** as comments on the session issue, each in this shape, so they compare cleanly:

   ```markdown
   ## Proposal: <title>

   **Submitter:** <identity>

   ### Summary
   <one to three sentences>

   ### Rationale
   <why this addresses the parent issue>

   ### Trade-offs
   <advantages and costs, explicit>

   ### Open questions
   <unresolved points that may affect feasibility or design>
   ```

3. **Triage.** Judge each proposal on relevance (does it address the parent issue), feasibility (realizable within reasonable constraints) and non-duplication (a distinct mechanism from an accepted proposal, not merely different wording; the earlier submission is the one kept). Reject with a comment whose first line is exactly `[TRIAGE-REJECTED] Proposal: <title>`, followed by `**Criterion failed:**` and a `**Reason:**` grounded in the proposal. Rejected proposals take no further part.
4. **Compare.** Post one comment presenting every survivor against every dimension. Defaults: implementation complexity, architectural alignment (existing architecture, ADRs, constraints), reversibility.
5. **Compose (optional).** When survivors are complementary rather than exclusive, post a hybrid as `[COMPOSITION] Proposal: <title>` naming its sources (`**Composed from:**`), in the standard proposal format. It then competes like any survivor.
6. **Designate the candidate.** With two or more survivors, post a top-level comment whose first line is exactly `[CANDIDATE] Proposal: <title>`, naming a surviving proposal or composition. Votes bind to the latest valid designation, and a new valid designation voids every earlier vote because voters approved something else; they must recast. A designation naming an unknown title designates nothing and voids nothing. With exactly one survivor and no designation ever posted, that survivor is the implicit candidate.
7. **Vote.** Eligible identities post a top-level comment that is exactly `VOTE: APPROVE`, `VOTE: REJECT` or `VOTE: ABSTAIN` (reactions and replies do not count; a voter's latest vote stands). Run `idea-tally.ts` as often as useful.
8. **Close.** Close only on a tally with `threshold_met: true`, or when the owner decides to stop.
   - Resolved: create the SPECS issues first, each seeded with the winner's summary as its intent and linking the session issue; then run `idea-close.ts --outcome resolved --spec <N:description> ... --tally-file <tally.json>`.
   - No consensus (allowed at any time, no SPECS issue is created, the parent stays open): `idea-close.ts --outcome no-consensus --reason "<why>"`. The reason is the useful part of the record; state what blocked convergence.

   Every closed session carries exactly one terminal label (`idea-resolved` or `idea-no-consensus`); the script adds it, so do not close a session by hand.

## Retroactive review loop

The session is the audit record of how an intent was chosen. A review finding of class `spec` that traces to an inadequately converged set of proposals may justify a new session on the parent issue; the orchestrator decides, it is not automatic. Finding classes: `references/shared-finding-class-taxonomy.md`.

## Friction

Report workflow friction as described in `references/shared-friction-reporting.md`.
