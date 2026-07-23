---
id: "0094"
slug: spec-pr-shared-logbook-closing-keyword
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 597
version: 1.0.0
---

# Reconcile the spec-PR Independence rule with the shared-logbook Rule C when the related issue is both

## Intent

After this change, an author writing a spec-PR whose related issue is
also the ticket's shared logbook issue (the common case under Logbook
Issues → Rule A) references that issue without triggering GitHub's
automatic issue-closing behavior on merge. The shared logbook issue
stays open through PLAN, DEV, and REVIEW, and closes only when the
implementation-PR merges, exactly as Rule C already intends. A reader
of the Independence rule finds the shared-logbook case named explicitly,
including the concrete phrasing that avoids an accidental auto-close,
instead of discovering the contradiction only after a spec-PR merge
closes a logbook issue mid-ticket.

## Requirements

1. `docs/spec-pr-workflow.md` → *Independence rule* SHALL state a
   carve-out for the case where the spec's `related-issue` is the same
   issue serving as the ticket's shared logbook issue (the Logbook
   Issues → Rule A common case): the spec-PR body SHALL NOT carry any
   closing-keyword directive for that issue — no `Closes #<N>`,
   `Fixes #<N>`, or `Resolves #<N>`, in any phrasing.
2. The carve-out SHALL state explicitly that rewording the sentence
   around the closing keyword (e.g. a negated sentence such as "this
   spec-PR closes no issue on merge") does not prevent GitHub from
   auto-closing the referenced issue, because GitHub's closing-keyword
   parser matches on the literal adjacent token pattern
   (`close|fix|resolve #<N>`) regardless of the surrounding sentence's
   meaning. The carve-out SHALL cite this as the reason phrasing
   workarounds are rejected outright rather than merely discouraged.
3. The carve-out SHALL prescribe the non-adjacent reference pattern the
   spec-PR body uses instead — for example "Related `#<N>`" or "the
   implementation PR (tracking `#<N>`) will close it on merge" — i.e. any
   phrasing that keeps a closing keyword and the issue number from
   appearing adjacently.
4. The carve-out SHALL state, unchanged from today's rule, that only
   the implementation-PR carries the closing directive for the shared
   logbook issue, consistent with Logbook Issues → Rule C ("close
   immediately after merge" of the implementation-PR).
5. When the spec's `related-issue` is NOT the ticket's shared logbook
   issue (an uncommon case: a dedicated logbook issue exists separately
   per Rule A's second paragraph), the existing Independence rule text
   SHALL continue to apply unchanged — each PR closes its own
   `related-issue` via its own closing directive.
6. `AGENTS.md` → *Spec-PR workflow* SHALL retain its existing one-line
   pointer to `docs/spec-pr-workflow.md` for the Independence rule's
   full text; this spec SHALL NOT duplicate the carve-out's normative
   content into `AGENTS.md` itself.
7. `AGENTS.md` → *Logbook Issues → Rule C* SHALL gain a one-line
   cross-reference pointing to the `docs/spec-pr-workflow.md` →
   *Independence rule* carve-out, so a reader who lands on Rule C first
   discovers the spec-PR-time exception without independently
   rediscovering the contradiction this spec resolves.
8. This spec SHALL NOT introduce, request, or describe any CI check,
   spec linter rule, or pre-commit hook that detects an adjacent
   closing-keyword token in a spec-PR body. That enforcement mechanism
   is explicitly deferred to a separate follow-up ticket.

## Scenarios

**Scenario:** Spec-PR for a shared-logbook ticket merges without
auto-closing the logbook issue

Given a ticket whose GitHub issue `#<N>` is both the spec's
`related-issue` and the ticket's shared logbook issue per Rule A
Given the spec-PR body references issue `#<N>` using the non-adjacent
pattern prescribed by Requirement 3 (e.g. "Related `#<N>`" or "the
implementation PR, tracking `#<N>`, will close it on merge")
When the spec-PR is merged to `main`
Then issue `#<N>` remains open, because no closing-keyword token was
adjacent to `#<N>` anywhere in the merged PR body

**Scenario:** A spec-PR that still carries an adjacent closing-keyword
token is caught before merge

Given a spec-PR body for a shared-logbook ticket that contains a
closing-keyword token adjacent to the issue number — including a
negated-sentence attempt such as "this spec-PR closes no issue on
merge; the implementation PR will close `#<N>`" — which Requirement 2
identifies as still triggering GitHub's auto-close regardless of the
surrounding prose
When a human reviewer checks the spec-PR body against the carve-out
in `docs/spec-pr-workflow.md` → *Independence rule* before approving
Then the reviewer requests changes to remove the adjacent token pattern
before merge; this scenario is a manual-verification check, since an
automated linter for this pattern is out of scope per Requirement 8

## Out of scope

- An automated CI check or spec linter rule that fails a `spec/*` PR
  whose body contains a closing-keyword token adjacent to an issue
  number — a valuable follow-up, tracked as a separate ticket, not
  qualified by this spec.
- Any change to the Independence rule's treatment of the
  implementation-PR's own closing directive — Requirement 4 keeps that
  behavior exactly as it stands today.
- Any change to Logbook Issues → Rule A or → Rule B — this spec touches
  only the cross-reference addition to Rule C described in
  Requirement 7.
- Retroactively auditing or relabeling any already-merged spec-PR that
  may have auto-closed a shared logbook issue under the old,
  contradictory rule text (the three lived instances cited in issue
  #597 among them) — this spec qualifies the go-forward rule, not a
  historical remediation pass.
- Any change to `docs/spec-format.md`'s frontmatter schema or mandatory
  body sections — this ticket is scoped entirely to the Independence
  rule's prose in `docs/spec-pr-workflow.md` and the single
  cross-reference line in `AGENTS.md`.

## Open questions

- None — the resolution (tighten the Independence rule with an explicit
  shared-logbook carve-out, rather than relax Rule C's trigger) was
  decided upstream of this spec-authoring session per the curator's
  consolidated report on issue #597, and the scope is narrow enough
  that no ambiguity survived drafting the Requirements above.
