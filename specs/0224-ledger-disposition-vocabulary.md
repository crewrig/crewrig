---
id: "0224"
slug: ledger-disposition-vocabulary
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1269
version: 1.0.0
---

# 📝 Ledger disposition vocabulary

## Intent

A reviewer seat reading its own dossier can recognize `ledger` as a valid, expected disposition value for a prior finding, instead of encountering a value the contract never named.

## Requirements

1. [`docs/reviewer-seat.md`](../docs/reviewer-seat.md) → *Prior-finding disposition* SHALL list `ledger` as a fourth admissible disposition value, alongside `addressed`, `superseded`, and `withdrawn`.
2. The `ledger` disposition entry SHALL state that it is the value a non-blocking finding routed to the deferred-findings ledger carries, and SHALL cross-reference [`docs/retroactive-loop.md`](../docs/retroactive-loop.md) → *Journalling* as the recording mechanism, rather than introducing a second, competing recording location.
3. The requirement above SHALL NOT change the recording location, format, or trigger of the `ledger`-disposition journal line that [`docs/retroactive-loop.md`](../docs/retroactive-loop.md) → *Journalling* already mandates.
4. No behavioral, procedural, or vocabulary change SHALL be made to [`docs/retroactive-loop.md`](../docs/retroactive-loop.md) — that document already names `ledger` correctly; only [`docs/reviewer-seat.md`](../docs/reviewer-seat.md)'s enumeration is incomplete.

## Scenarios

**Scenario:** Prior-finding audit encounters a ledger-routed finding

Given a seat's dossier contains a finding whose recorded disposition is `ledger`, naming the findings-ledger entry
When the seat performs its prior-finding audit on pass N+1
Then the seat recognizes `ledger` as one of the contract's admissible disposition values
And the audit proceeds without treating the recorded disposition as a contract violation

**Scenario:** A reviewer reads the enumeration cold

Given a reviewer reads [`docs/reviewer-seat.md`](../docs/reviewer-seat.md) → *Prior-finding disposition* without also having read [`docs/retroactive-loop.md`](../docs/retroactive-loop.md)
When the reviewer reaches the list of admissible disposition values
Then the reviewer sees `ledger` listed with enough context (the finding-on-an-unchanged-surface routing, and the retroactive-loop.md cross-reference) to know where its record lives, without needing to accept it "by reference" from a separate document

## Out of scope

- Any change to `docs/retroactive-loop.md`. It already records the `ledger` disposition correctly under *Journalling*; this spec only closes the vocabulary gap on the `docs/reviewer-seat.md` side.
- Introducing a machine-readable schema or linter for disposition values. This is a prose-contract fix, not a new validation mechanism.
- Renaming or restructuring the *Prior-finding disposition* section beyond the single added bullet and its cross-reference.

## Open questions

None.
