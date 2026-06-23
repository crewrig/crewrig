---
id: "0066"
slug: idea-convergence-stage
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 485
version: 1.0.0
---

# IDEA stage — structured idea-convergence workflow

## Intent

Contributors can open a first-class lifecycle stage called IDEA before a
SPECS session begins, whenever multiple competing, overlapping, or
complementary proposals for a problem coexist and must be resolved before
a spec can be written. The stage is optional and explicitly triggered. It
produces one or more new SPECS issues as its output, carries an auditable
record of every proposal and vote on the forge, and supports three
governance modes — solo owner, unanimity, and proportional vote — so the
decision authority is declared upfront and cannot shift mid-session.

## Requirements

R1. The ADR-0010 lifecycle SHALL recognize a new optional stage called
    IDEA, positioned before SPECS. The IDEA stage is entered only when
    explicitly triggered; tickets that do not require convergence MAY
    proceed directly to SPECS.

R2. A skill named `idea` SHALL be defined for all CrewRig-supported CLI
    tools, accepting at minimum the parameters `--mode=<governance-mode>`
    and `--issue=<parent-issue-number>`. Both parameters SHALL be
    mandatory at session-open time.

R3. Three governance modes SHALL be supported:

    - `solo` — a single named owner; the session closes when the owner
      casts an explicit approval.
    - `unanimity` — a set of named owners declared at open time; the
      session closes when every owner has cast `VOTE: APPROVE`.
    - `vote` — a named voter set and a quorum threshold (expressed as
      a percentage, e.g. `60`) declared at open time; the session closes
      when the threshold is reached among cast votes.

R4. The declared governance mode SHALL be immutable for the lifetime of
    the session. No mechanism SHALL allow the mode or its parameters
    (owner list, voter set, quorum threshold) to change after the session
    issue is created.

R5. The `idea` skill SHALL create a dedicated issue on the forge with the
    label `idea-session` and a governance sub-label matching the mode
    (`idea-solo`, `idea-unanimity`, or `idea-vote`). The issue body SHALL
    include the structured opening template defined by the skill, recording
    the governance mode, its parameters, and the parent issue reference.

R6. Each proposal submitted to an IDEA session SHALL conform to a
    structured format containing: title, summary, rationale, trade-offs,
    open questions, and submitter identity.

R7. The session SHALL include a triage phase in which submitted proposals
    are evaluated against three criteria: relevance to the parent issue,
    feasibility, and non-duplication. Proposals that fail triage SHALL be
    documented in a comment prefixed `[TRIAGE-REJECTED]`, with the
    rejection reason stated explicitly.

R8. Proposals that survive triage SHALL be compared across a set of shared
    dimensions. The skill SHALL define a set of default dimensions (at
    minimum: implementation complexity, architectural alignment, and
    reversibility); the session owner MAY declare additional or replacement
    dimensions at open time. The comparison SHALL be documented as a
    structured comment on the session issue.

R9. When two or more proposals are determined to be complementary rather
    than mutually exclusive, the session owner MAY trigger a composition
    phase producing a hybrid proposal. The composed proposal SHALL be
    posted as a new comment prefixed `[COMPOSITION]` and enters the
    governance phase in the same position as any other surviving proposal.

R10. The consensus protocol SHALL use structured vote comments as the
     official vote mechanism. A valid vote comment SHALL match exactly one
     of the following forms: `VOTE: APPROVE`, `VOTE: REJECT`, or
     `VOTE: ABSTAIN`. Emoji reactions on the session issue MAY serve as
     informal signals but SHALL NOT be counted toward governance thresholds.

R11. The consensus protocol SHALL be forge-agnostic at the spec level.
     Forge-specific mechanics are implementation details of the `idea`
     skill and SHALL NOT be mandated by this spec.

R12. When the declared governance threshold is met, the `idea` skill SHALL:

     a. Post a closing comment on the session issue naming the winning
        proposal or composition and the vote tally.
     b. Create one or more new issues for the SPECS stage, each
        pre-populated with the winning proposal as the intent statement.
     c. Close the session issue with the label `idea-resolved`.
     d. Include a cross-reference to the IDEA session issue in the body
        of each newly-created SPECS issue.

R13. The session owner MAY close an IDEA session at any time without
     reaching the governance threshold. To do so, the owner SHALL add
     the label `idea-no-consensus` to the session issue and post a
     mandatory closure comment stating the reason. No SPECS issue SHALL
     be created on this path. The session issue SHALL be closed after
     the closure comment is posted.

R14. Every closed IDEA issue SHALL carry either the label `idea-resolved`
     (linking to the SPECS issue or issues it produced) or the label
     `idea-no-consensus` (with the mandatory closure comment). No other
     terminal state is defined.

## Scenarios

### S1 — Solo session reaches approval

Given a contributor opens an IDEA session with `--mode=solo` referencing
parent issue N,
When the owner submits one proposal and casts `VOTE: APPROVE`,
Then the skill creates a SPECS issue pre-populated with the proposal,
closes the IDEA session issue with label `idea-resolved`, and the IDEA
issue body links to the new SPECS issue.

### S2 — Proportional vote reaches quorum

Given a session is open with `--mode=vote --quorum=60` and three voters
declared,
When two of the three voters cast `VOTE: APPROVE` (67 % ≥ 60 %),
Then the skill identifies the winning proposal, creates a SPECS issue,
and closes the session with label `idea-resolved`.

### S3 — Composition of two complementary proposals

Given a session with two surviving proposals that address non-overlapping
aspects of the same problem,
When the owner triggers the composition phase and the composed proposal
is approved under the declared governance mode,
Then the skill creates a single SPECS issue whose intent combines both
proposals, and the session closes with label `idea-resolved`.

### S4 — No consensus, manual closure

Given a session with `--mode=vote` where no quorum is reached after all
participants have voted,
When the owner adds the label `idea-no-consensus` and posts a closure
comment stating the reason,
Then the session issue is closed, no SPECS issue is created, and the
parent issue remains open for a future attempt.

### S5 — Unanimity blocked by a veto

Given a session with `--mode=unanimity` and two named owners where one
casts `VOTE: APPROVE` and the other casts `VOTE: REJECT`,
Then the session remains open (unanimity threshold not met), and neither
owner's vote triggers automatic closure.

### S6 — Proposal rejected at triage

Given a proposal submitted to an open session that is a duplicate of an
existing proposal in the same session,
When the triage phase evaluates it,
Then the skill posts a `[TRIAGE-REJECTED]` comment stating the duplication
reason, and the proposal does not enter the comparison or governance phase.

## Out of scope

- Automatic expiration or timeout mechanisms — session closure is manual
  only (R13).
- Bot or webhook automation for vote tallying — the skill counts votes
  from comments; background automation is a follow-up.
- Integration with external decision-support tools (Loomio, Pol.is, etc.).
- Changes to the SPECS stage itself — IDEA feeds SPECS; the SPECS contract
  defined in ADR-0010 is unchanged by this spec.
- Forge-specific implementations — the `idea` skill's per-CLI adapters
  (GitHub, GitLab, Gitea) are implementation details and are not specified
  here.
- GitHub Discussions as an alternative session container — standard forge
  issues are the only supported container.
- Reopening a closed IDEA session — a new session MAY be opened against
  the same parent issue; the closed session is immutable.
- Cross-repository IDEA sessions — the session issue and the parent issue
  SHALL reside in the same repository.
- Multi-CLI distribution and build wiring of the `idea` skill — tracked
  separately.

## Open questions

None.
