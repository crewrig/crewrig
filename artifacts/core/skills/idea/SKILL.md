---
name: idea
description: "IDEA stage lifecycle skill for structured idea-convergence. Activate
  before a SPECS session whenever multiple competing, overlapping, or complementary
  proposals must be resolved first. Supports three governance modes (solo, unanimity,
  vote) and produces one or more SPECS issues as output."
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.0.0"
claude:
  allowed-tools:
    - Read
    - Bash
    - Write
  user-invocable: true
---

# Idea

The `idea` skill opens and manages a structured idea-convergence session — the
optional IDEA stage that sits before SPECS in the ADR-0010 lifecycle. Use it when
two or more competing, overlapping, or complementary proposals for a problem coexist
and must be converged before a spec can be written.

The skill is forge-agnostic: it operates on forge issues (GitHub, GitLab, Gitea)
using the host CLI's native commands and does not call any forge-specific API
directly.

## When to activate

- Explicit user invocation: the user types `/idea` (or the equivalent CLI activation
  phrase). Required flags: `--mode=solo|unanimity|vote`, `--issue=<parent-issue-number>`.
  Optional governance parameters vary by mode (see *Governance modes* below).
- Any situation where multiple independent proposals address the same parent issue
  and a structured decision record is needed before the SPECS stage begins.

Do **not** activate on a ticket where a single clear intent already exists — proceed
directly to `spec-author` instead.

## Inputs

The skill requires two mandatory parameters at open time:

| Parameter | Description |
|---|---|
| `--mode=<governance-mode>` | One of `solo`, `unanimity`, or `vote`. |
| `--issue=<N>` | The parent issue number the convergence is anchored to. |

Additional governance parameters depend on the mode:

| Mode | Additional parameters |
|---|---|
| `solo` | `--owner=<identity>` — the single decision authority (defaults to the invoking user if omitted). |
| `unanimity` | `--owners=<identity>[,<identity>…]` — the exhaustive list of identities who must all approve. |
| `vote` | `--voters=<identity>[,<identity>…]`, `--quorum=<pct>` (integer, e.g. `60` for 60 %). Both required. |

All governance parameters are **immutable** after the session issue is created.
No mechanism exists to change the mode, the owner list, the voter set, or the
quorum threshold mid-session.

## Opening a session

1. **Create the session issue** on the forge.
   - Title: `[IDEA] <brief description> (parent #<N>)`.
   - Labels: `idea-session` plus the governance sub-label (`idea-solo`,
     `idea-unanimity`, or `idea-vote`).
   - Body follows the *Session issue template* below.
2. **Log the session opening** on the parent issue as a cross-reference comment.

### Session issue template

```markdown
## IDEA Session — <brief description>

**Parent issue:** #<N>
**Governance mode:** <mode>
**<Mode-specific parameters>**

---

### Proposals

_Proposals are submitted as comments on this issue using the structured
format defined by the `idea` skill. Each accepted proposal is listed here
by the session owner after the triage phase._

### Comparison

_Populated by the session owner after triage._

### Vote tally

_Populated after the governance phase opens._
```

## Proposal format (R6)

Every proposal submitted to an IDEA session SHALL be posted as a comment on the
session issue and conform to the following structure:

```markdown
## Proposal: <title>

**Submitter:** <identity>

### Summary
<One-to-three-sentence description of the proposed approach.>

### Rationale
<Why this approach addresses the parent issue.>

### Trade-offs
<Advantages and disadvantages. Be explicit about costs.>

### Open questions
<Unresolved points that may affect feasibility or design.>
```

## Triage phase (R7)

After the proposal submission window, the session owner evaluates each proposal
against three criteria:

1. **Relevance** — does the proposal address the parent issue?
2. **Feasibility** — is the proposal realizable within reasonable constraints?
3. **Non-duplication** — is the proposal substantively distinct from an already-
   accepted proposal in the same session?

Proposals that fail any criterion are documented in a comment prefixed
`[TRIAGE-REJECTED]` with the criterion and rejection reason stated explicitly.
Rejected proposals do not advance to the comparison or governance phase.

Example rejection comment:

```markdown
[TRIAGE-REJECTED] Proposal: <title>

**Criterion failed:** Non-duplication
**Reason:** This proposal is substantively identical to "Proposal: <existing title>"
submitted by <identity> on <date>. The key mechanism (X) is the same; the
difference in wording does not constitute a distinct approach.
```

## Comparison phase (R8)

Proposals that survive triage are compared across a shared set of dimensions.

**Default dimensions:**

| Dimension | Description |
|---|---|
| Implementation complexity | Estimated effort and structural impact on the codebase. |
| Architectural alignment | Degree of fit with the project's existing architecture, ADRs, and stated constraints. |
| Reversibility | Ease of undoing or replacing the decision if requirements change later. |

The session owner MAY declare additional or replacement dimensions at open time
by listing them in the session issue body. Declared dimensions apply for the
lifetime of the session and cannot be changed mid-session.

The comparison SHALL be documented as a structured comment on the session issue,
presenting each surviving proposal against every declared dimension. The comment
is authored by the session owner after triage completes.

## Composition phase (R9)

When two or more surviving proposals are complementary rather than mutually
exclusive, the session owner MAY trigger a composition phase. A composed
(hybrid) proposal:

- Is posted as a new comment on the session issue prefixed `[COMPOSITION]`.
- Names the source proposals it synthesizes.
- Conforms to the same *Proposal format* (R6) as any other proposal.
- Enters the governance phase in the same position as any surviving proposal.

Example composition prefix:

```markdown
[COMPOSITION] Proposal: <hybrid title>

**Composed from:** "Proposal: <A>" and "Proposal: <B>"
**Submitter:** <session owner identity>

### Summary
...
```

## Consensus protocol (R10)

The official vote mechanism is structured vote comments on the session issue.
A valid vote comment matches exactly one of the following forms:

```text
VOTE: APPROVE
VOTE: REJECT
VOTE: ABSTAIN
```

- Each eligible voter (per the declared governance parameters) casts exactly one
  vote comment per session.
- Emoji reactions on the session issue MAY serve as informal signals but are
  **not** counted toward any governance threshold.
- Only votes posted as top-level comments (not as replies to other comments) count.

### Threshold calculation

| Mode | Threshold |
|---|---|
| `solo` | The declared owner posts `VOTE: APPROVE`. |
| `unanimity` | Every declared owner has posted `VOTE: APPROVE` (not `REJECT` or `ABSTAIN`). |
| `vote` | `(APPROVE count / total cast non-ABSTAIN votes) × 100 ≥ quorum` AND at least one non-ABSTAIN vote was cast. `ABSTAIN` votes are excluded from the denominator. |

## Success path (R12)

When the declared governance threshold is met:

1. Post a **closing comment** on the session issue naming:
   - The winning proposal (or composition).
   - The final vote tally.
   - The parent issue reference.
2. **Create one or more SPECS issues**, each:
   - Pre-populated with the winning proposal's summary as the intent statement.
   - Cross-referencing the IDEA session issue in its body.
3. **Close the session issue** with the label `idea-resolved`.

Example closing comment:

```markdown
## IDEA Session — Resolved

**Winning proposal:** <title>
**Vote tally:** APPROVE: N, REJECT: M, ABSTAIN: K

The session is closed. The following SPECS issue(s) have been created:
- #<specs-issue-number>: <brief description>

**Parent issue:** #<parent-N>
**IDEA session:** this issue (closed `idea-resolved`)
```

## Failure path (R13)

The session owner MAY close an IDEA session at any time without reaching the
governance threshold. To do so:

1. Add the label `idea-no-consensus` to the session issue.
2. Post a **mandatory closure comment** stating the reason the session is being
   closed without consensus.
3. Close the session issue.

No SPECS issue is created on this path. The parent issue remains open for a
future attempt (which MAY open a new IDEA session).

Example closure comment:

```markdown
## IDEA Session — Closed Without Consensus

**Reason:** <explicit statement of why no consensus was reached>

No SPECS issue has been created. The parent issue #<N> remains open.
A new IDEA session may be opened against the same parent issue.
```

## Terminal state contract (R14)

Every closed IDEA session issue SHALL carry exactly one of the two terminal
labels:

- `idea-resolved` — the session produced one or more SPECS issues.
- `idea-no-consensus` — the session closed without consensus and no SPECS
  issues were created.

No other terminal state is defined. An IDEA session issue that is closed
without one of these labels is a protocol violation.

## Governance modes (R3)

### `solo`

A single named decision authority. The session closes the moment the owner
casts `VOTE: APPROVE` on the winning proposal.

- One owner only. Multiple owners are not supported in `solo` mode —
  use `unanimity` instead.
- The owner may post `VOTE: REJECT` to veto without closing the session.
  The session remains open until the owner approves or manually closes it
  via the failure path.

### `unanimity`

A declared set of owners. The session closes only when **every** declared owner
has posted `VOTE: APPROVE`. A single `VOTE: REJECT` from any owner blocks
consensus; the session remains open (it does not auto-close on a veto). Manual
closure via the failure path is the only alternative exit.

### `vote`

A named voter set and a quorum threshold (integer percentage, 1–100). The
session closes when the percentage of APPROVE votes among all non-ABSTAIN
votes reaches or exceeds the declared threshold. `VOTE: ABSTAIN` is excluded
from the denominator (it neither advances nor blocks quorum).

## Immutability rule (R4)

The declared governance mode and all its parameters (owner identity, owner list,
voter set, quorum threshold) are immutable for the lifetime of the session. They
are recorded in the session issue body at open time and cannot be changed by
any subsequent comment, label, or edit.

A request to change governance parameters mid-session SHALL be rejected. The
only recourse is to close the current session via the failure path and open a
new session with the corrected parameters.

## Forge-agnostic operation (R11)

The consensus protocol operates on forge issues and comments. The skill does not
call any forge-specific API directly. All forge interactions (issue creation,
comment posting, label management, issue closure) are performed via the host
CLI's existing forge tooling (e.g., `gh` for GitHub, `glab` for GitLab).

## Finding class taxonomy

When invoked as part of the retroactive review loop (per
[`docs/retroactive-loop.md`](../../../docs/retroactive-loop.md) → *Routing
matrix*), this skill participates as follows:

- **As author.** Every IDEA session produces an auditable record of proposals,
  triage decisions, comparisons, votes, and the closing outcome — all as
  comments on the session issue.
- **As re-spawn target.** The IDEA stage is pre-SPECS. REVIEW findings of class
  `spec` that reveal a requirements conflict arising from an inadequately
  converged set of proposals MAY prompt a new IDEA session against the parent
  issue. The decision to re-enter IDEA is the orchestrator's, not automatic.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` → *Friction Reporting →
Recognition signals*), invoke the `harness-report` skill
(`artifacts/library/skills/harness-report/SKILL.md`) rather than reimplementing
the protocol inline.
