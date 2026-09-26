---
id: "0066"
slug: idea-convergence-stage
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1262
version: 1.1.0
---

# IDEA stage — structured idea-convergence workflow

## ADDED

R15. When two or more proposals survive triage (R7) and have not been
     merged into a single proposal via composition (R9), the session
     owner SHALL designate exactly one surviving proposal or composition
     as the current candidate before any vote comment can count toward
     the governance threshold declared under R3/R10. The designation
     SHALL be a top-level comment matching exactly the form
     `[CANDIDATE] Proposal: <title>` — mirroring the bracket-prefix
     convention already established by `[TRIAGE-REJECTED]` (R7) and
     `[COMPOSITION]` (R9) — where `<title>` names a proposal or
     composition already present in the session. A `[CANDIDATE]`
     comment naming a proposal not present in the session is invalid and
     designates nothing.

R16. Every vote comment (R10) cast while more than one surviving,
     non-composed proposal exists in the session SHALL bind to the
     proposal or composition named by the most recently posted valid
     `[CANDIDATE]` comment at the time the vote comment was posted.
     Posting a new valid `[CANDIDATE]` comment voids every vote comment
     posted before it: the governance-threshold calculation defined by
     R3/R10 SHALL count only vote comments posted after the timestamp of
     the current candidate's designation, so re-designation obliges
     eligible voters to recast their vote against the newly designated
     candidate. When exactly one proposal survives triage and no
     `[CANDIDATE]` comment has ever been posted in the session, that
     lone surviving proposal SHALL be treated as the implicit candidate
     from the moment it alone survives triage, and no `[CANDIDATE]`
     comment is required for its votes to count.

**Scenario:** Candidate re-designation voids prior votes in a multi-proposal
vote session

Given a `--mode=vote` session with three mutually exclusive surviving
proposals (Python, TypeScript, Go) and the owner has posted
`[CANDIDATE] Proposal: Python`,
When two voters post `VOTE: APPROVE` against the Python candidacy, and the
owner then posts `[CANDIDATE] Proposal: Go`,
Then the two prior `VOTE: APPROVE` comments no longer count toward the
governance threshold, the current candidate becomes the Go proposal, and
the two voters must recast their vote after the re-designation for it to
be counted.

**Scenario:** Single surviving proposal is the implicit candidate

Given a session in which exactly one proposal survives triage and no
`[CANDIDATE]` comment has been posted,
When a voter posts `VOTE: APPROVE`,
Then the vote binds directly to the lone surviving proposal and counts
toward the governance threshold without requiring a `[CANDIDATE]` comment.

## MODIFIED

## REMOVED
