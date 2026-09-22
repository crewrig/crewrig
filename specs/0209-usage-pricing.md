---
id: "0209"
slug: usage-pricing
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1172
version: 1.0.0
---

# Comparative pricing of usage — pinned public price list, model-id mapping, three timestamps, any currency

## Intent

This specification defines how a usage record already captured and stored
through the epic's earlier seams becomes a comparative price: a reference
figure, never an invoice, that lets a person see roughly what a period of
model consumption would have cost, computed from a price list the framework
pins to one identifiable snapshot and refreshes only when asked, corrected
where an organization needs its own entries. A person reading a price can
always tell which price-list snapshot, which exchange-rate date, and which
computation instant produced it; a model the price list cannot identify is
marked unpriced rather than silently costing nothing, and a cost a vendor
bills in a shape the price list cannot represent is flagged as an
under-estimate rather than dropped. The figure compares across vendors and
models, renders in whatever currency a person wants to see it in, and never
becomes part of the usage record or the journal entry it was computed from.

## Requirements

1. A computed price SHALL be computed from LiteLLM's
   `model_prices_and_context_window.json` price list as the primary source,
   pinned to one identifiable snapshot — a commit SHA when the source is
   fetched from its version-controlled origin, or a fetch instant paired
   with an ETag when a commit SHA cannot be resolved.
2. The pinned snapshot of requirement 1 SHALL change only in response to an
   explicit refresh action; no scheduled or unattended process SHALL replace
   it.
3. Every price computed from the primary source SHALL carry the identity of
   the pinned snapshot of requirement 1 that produced it, as provenance on
   the price.
4. A price entry's provenance SHALL include the primary source's own
   per-entry source URL when the primary source declares one for that
   entry.
5. OpenRouter's public price list SHALL be usable only as a manual,
   human-initiated cross-check against a price already computed from the
   primary source; no automated or scheduled request SHALL be made to
   OpenRouter's endpoint, and no figure read from OpenRouter SHALL be stored
   or reused as a computed price.
6. An org override table SHALL be able to add a price entry the primary
   source does not declare, or replace one or more fields of a
   primary-source entry, without altering the primary source's own pinned
   content.
7. Where the org override table and the primary source both declare an
   entry for the same model identifier, the org override table's entry
   SHALL be the one a price is computed from.
8. A price computed from an org-declared entry SHALL carry, as provenance,
   that it was sourced from the org override table rather than from the
   primary source.
9. The org override table SHALL be maintained as an artifact distinct from
   the primary source's own file, identifiable by the project's established
   organization-overlay naming convention, so that an organization's
   corrections are never mistaken for the pinned primary source's own
   content.
10. A record's model identifier SHALL be resolved to a priced entry
    through, in this order: a normalization pass accounting for letter
    case, `.`-versus-`-` separators, `-preview`/`-latest`/`:batch`
    suffixes, effort suffixes, and dated snapshots; an exact match against
    the pinned primary source's own identifier, canonical slug, or alias
    target; where the matched entry is an alias, re-resolution of its
    target at the same pinned snapshot; a same-family fallback; the org
    override table; or, failing every prior step, an explicit `unpriced`
    marker.
11. Every computed price SHALL name which step of requirement 10 produced
    it.
12. A record whose model identifier is Antigravity's automatic-selection
    placeholder, the `(unreported)` sentinel, or a display-label string
    that resolves to no entry under requirement 10, SHALL receive the
    `unpriced` marker; none of these three SHALL be resolved through any
    step beyond requirement 10's own pipeline.
13. A price produced by the same-family fallback step of requirement 10
    SHALL be visibly distinguishable, wherever the price is displayed or
    exported, from a price produced by an exact match or an alias
    resolution.
14. Cache-write pricing SHALL be computed from the pinned primary source's
    own per-tier fields when the resolved entry exposes more than one
    cache-write tier; cache-read pricing SHALL be computed from the pinned
    primary source's own cache-read field.
15. A vendor's cache-storage cost that the pinned primary source's schema
    cannot represent SHALL cause the computed price to carry a declared
    under-estimate flag naming the unrepresented cost; that cost SHALL NOT
    be treated as zero or omitted silently.
16. Where the pinned primary source reports a resolved entry's
    reasoning-token field as a duplicate of its completion field, reasoning
    tokens SHALL be priced as output tokens, and SHALL NOT be added as a
    separate cost on top of the completion cost.
17. A regional surcharge SHALL be applied to a computed price only when the
    record names a pinned region; no regional surcharge SHALL be applied
    when the record names none.
18. Where the pinned primary source declares a long-context override
    threshold for a resolved entry and a record's token counts cross that
    threshold, the override rate SHALL be applied to the whole request's
    price, not only to the tokens above the threshold.
19. A price component for which the pinned primary source exposes no field
    SHALL cause the computed price to carry an unpriced-component flag
    naming that component; the component SHALL NOT be treated as zero.
20. A Copilot CLI record from a current-billing account SHALL be priced
    from the CLI's own first-party per-token figures when those figures are
    present for the record's model and instant; the pinned primary source
    SHALL be used for that record only when the CLI's own figures are
    absent.
21. A Copilot CLI record from a legacy premium-request plan SHALL be priced
    from the pinned primary source's reference figures, and every such
    price SHALL carry a prominent caveat naming it a legacy-plan reference
    price rather than the account's own billed cost.
22. A price converted to a currency other than USD SHALL be converted at
    the European Central Bank's daily reference rate whose fixing date is
    the most recent one on or before the computation date; no conversion
    SHALL use a fixing dated after the computation date.
23. Every currency-converted price SHALL carry the European Central Bank as
    its rate of record, with attribution.
24. Frankfurter (`api.frankfurter.dev`) SHALL be usable only as an optional
    mirror of the same European Central Bank fixing used under requirement
    22, never as an independent or alternative rate.
25. The pinned primary source's own prices SHALL be treated as denominated
    in USD.
26. A price SHALL be convertible into any currency for which the European
    Central Bank publishes a daily reference rate, identified by its ISO
    4217 code.
27. Every computed price SHALL carry three timestamps: the identity of the
    price-list snapshot of requirement 1 it was computed from, the fixing
    date of requirement 22 used for its currency conversion when converted,
    and the computation instant in UTC.
28. A request to recompute a price as of today SHALL re-resolve all three
    timestamps of requirement 27 from their live sources; none SHALL be
    carried over from an earlier computation.
29. No default computation path SHALL price a record at a price-list
    snapshot, fixing date, or computation instant other than the one
    currently pinned or currently live, unless a past snapshot, fixing
    date, or instant is explicitly named by the request.
30. A price for a period covering more than one record SHALL be the sum of
    the per-record prices computed from exactly one price-list snapshot; no
    period price SHALL sum prices computed from two different snapshots.
31. Every rendered price SHALL carry a statement that it is a reference
    figure and not an invoice, alongside the three timestamps of
    requirement 27.
32. A rollup of prices over a period SHALL sum the prices of records
    declaring `per-request` fidelity, SHALL sum the prices of records
    declaring `run-total` fidelity, and SHALL take only the price of the
    last snapshot per session for records declaring `session-cumulative`
    fidelity, never a sum of that session's snapshots.
33. A rollup that combines more than one fidelity SHALL carry a mixed
    marker naming every fidelity it combines.
34. A record of kind `uncaptured`, and a record whose model identifier
    resolved to the `unpriced` marker, SHALL be counted in a rollup
    separately from priced records, and SHALL NOT be counted as a
    zero-cost record.
35. A computed price SHALL be stored, when stored at all, outside the usage
    record and outside the journal entry it was computed from; no write of
    a computed price SHALL modify a usage record or a journal entry.
36. A stored price SHALL be recomputable from its own three timestamps of
    requirement 27 and the record it was computed from, with no dependency
    on any other stored state.
37. A stored price for a period SHALL be removed by the same explicit,
    period-scoped prune that removes the usage records of that period, and
    SHALL NOT be removed by any automatic expiry.
38. A continuous-integration suite SHALL verify, against a pinned fixture
    price list and with no network access, every step of the model-id
    resolution pipeline of requirement 10: an exact match, an alias
    re-resolution, a family fallback correctly flagged, an org override
    taking precedence over the fixture list, and an unresolvable identifier
    receiving the `unpriced` marker.
39. That suite SHALL verify the cache-tier arithmetic of requirement 14,
    the reasoning-as-output rule of requirement 16, and the long-context
    override threshold of requirement 18, each against at least one
    fixture entry that exercises it.
40. That suite SHALL verify currency conversion against a fixed fixture
    exchange rate, including the most-recent-fixing-on-or-before-the-
    computation-date rule of requirement 22, exercised against a
    computation date the fixture declares no fixing for.
41. That suite SHALL verify that every computed price carries the three
    timestamps of requirement 27, and that a recompute-as-of-today request
    re-resolves all three per requirement 28.
42. The organization-facing documentation for this pricing contract SHALL
    state what a computed price is and is not, the primary source's
    identity and licence, how to add or correct an entry through the org
    override table, how to trigger an explicit refresh, and the known
    under-estimates named by requirements 15 and 19.

## Scenarios

**Scenario:** Primary price resolved from the pinned snapshot

```text
Given a usage record naming a model present verbatim in the pinned LiteLLM
      price-list snapshot identified by its commit SHA
When  a price is computed for that record
Then  the price is computed from that snapshot's own per-token fields, and
      the price carries the snapshot's commit SHA as provenance
```

**Scenario:** OpenRouter is never queried automatically

```text
Given a scheduled or background process computing prices for a batch of
      records
When  that process runs
Then  no request reaches OpenRouter's price-list endpoint, and any
      OpenRouter-sourced figure used for cross-checking was entered by a
      person rather than fetched by the process
```

**Scenario:** An org override takes precedence over the primary source

```text
Given the primary source prices a model at one rate and the org override
      table declares a different rate for the same model identifier
When  a price is computed for a record naming that model
Then  the computed price uses the org override table's rate, and carries
      provenance naming the org override table as its source
```

**Scenario:** Exact match resolves a model identifier

```text
Given a record's model identifier matches, after normalization, an
      identifier the pinned snapshot declares verbatim
When  the model-id resolution pipeline runs
Then  the price is computed from that exact entry, and the price names the
      exact-match step as the one that produced it
```

**Scenario:** An unresolvable model identifier receives the unpriced marker

```text
Given a record whose model identifier is Antigravity's automatic-selection
      placeholder
When  the model-id resolution pipeline runs
Then  the record's price is set to unpriced, and no fallback or heuristic
      guess is substituted for that marker
```

**Scenario:** A family fallback price is flagged

```text
Given a record's model identifier has no exact match, no alias resolution,
      and no org override, but shares a recognized family with a priced
      entry
When  the model-id resolution pipeline runs
Then  the price is computed from that family's entry, and the resulting
      price is visibly flagged as a family fallback wherever it is
      displayed or exported
```

**Scenario:** Tiered cache-write pricing is applied

```text
Given a record reporting a 1-hour cache write for a model whose pinned
      entry exposes both a 5-minute and a 1-hour cache-write field
When  the price is computed
Then  the 1-hour field's rate is used, not the 5-minute field's rate
```

**Scenario:** An unrepresentable storage cost is flagged, not omitted

```text
Given a record for a model whose vendor bills a per-hour cache-storage cost
      that the pinned primary source's schema exposes no field for
When  the price is computed
Then  the computed price carries a declared under-estimate flag naming the
      unrepresented cost, and the cost itself is not silently treated as
      zero
```

**Scenario:** A current-billing Copilot record is priced from first-party
figures

```text
Given a Copilot CLI record from a current-billing account, and the CLI's
      own usage-output file reporting a per-token price for that record's
      model and instant
When  the price is computed
Then  the CLI's own first-party figure is used, not the pinned primary
      source
```

**Scenario:** A legacy premium-request price carries a caveat

```text
Given a Copilot CLI record from a legacy annual premium-request plan
When  the price is computed
Then  the price is computed from the pinned primary source's reference
      figures, and carries a prominent caveat naming it a legacy-plan
      reference price
```

**Scenario:** A non-USD price is converted at the most recent fixing on or
before the computation date

```text
Given a computation date that falls on a day the European Central Bank
      publishes no fixing
When  a price is converted to a non-USD currency
Then  the conversion uses the most recent fixing dated on or before the
      computation date, not a fixing dated after it
```

**Scenario:** Every computed price carries its three timestamps

```text
Given any computed price
When  the price is inspected
Then  it carries the price-list snapshot identity, the fixing date used
      when converted, and the computation instant in UTC
```

**Scenario:** A period price never mixes two snapshots

```text
Given a period whose records were previously priced under an older
      price-list snapshot, and the primary source has since been refreshed
When  the period's total price is recomputed
Then  every record's price in that total is computed from the same, single
      price-list snapshot, and no total sums prices computed from two
      different snapshots
```

**Scenario:** A mixed-fidelity rollup is marked, not silently summed

```text
Given a rollup period containing per-request priced records and
      session-cumulative priced records for the same task
When  the rollup computes a total
Then  the total carries a mixed marker naming both fidelities, the
      session-cumulative records contribute only their last snapshot's
      price, and no cumulative price is summed record-by-record
```

**Scenario:** Uncaptured and unpriced records are counted separately, never
as zero

```text
Given a rollup period containing a priced record, an uncaptured record, and
      a record whose model identifier resolved to unpriced
When  the rollup is computed
Then  the priced record contributes its price, and the uncaptured and
      unpriced records are each counted in a separate tally rather than
      contributing a zero to the price total
```

**Scenario:** A stored price never modifies its source record

```text
Given a usage record already written to the journal
When  a price is computed and stored for that record
Then  the journal entry for the record is unchanged, and the stored price
      lives in a location distinct from the record and the journal entry
```

**Scenario:** Pruning a period removes its stored prices with it

```text
Given a period holding both usage records and their stored computed prices
When  an explicit prune is requested for that period
Then  the period's stored prices are removed together with its usage
      records, and no automatic expiry removes a stored price on its own
```

## Out of scope

- The dashboard and tracked-asset navigation surface — seam (f), issue
  #1173.
- Attribution semantics themselves — the declaration channel and its
  precedence, the retroactive attribution ledger, and the per-fidelity
  rollup rule's own definition — seam (d), issue #1171; this specification
  consumes that per-fidelity rollup rule for price aggregation only
  (requirements 32 through 34).
- Invoicing, budget alerts, or any spend-limit enforcement.
- Vendor billing reconciliation — verifying a computed price against an
  actual vendor invoice or account statement.
- Any change to MemPalace itself, or to the storage or mirroring behavior
  defined by spec 0207.
- Any change to the usage record contract defined by spec 0205, including
  the prohibition on a price field within a record (spec 0205 requirement
  15).
- A written permission request to OpenRouter for automated, scheduled
  access, and any change to the primary source that request's outcome
  might warrant; pursuing it is independent of this specification, and
  switching the primary source on a granted permission is an adapter
  change, not a change to this specification's contract.
- Historical backfill of prices for usage records captured before this
  specification's implementation lands.
- The concrete file format, directory layout, or query interface of the
  stored-price artifact of requirements 35 through 37; this specification
  constrains only its observable behavior.
- Any change to the four CLIs' own behavior, output format, or billing
  display.

## Open questions

(none)

## Price source alternatives (informative)

This section is informative and non-normative — it records why the primary
source of requirements 1 through 9 was chosen over two alternatives the
epic's research digest identified, so a future reader does not re-litigate
a choice already made. The owner approved the primary-source decision
recorded here at the `user-validate` gate (logbook comment on issue #1172,
"Price-source decision: option B", approved without annotation).

**Rejected — OpenRouter's public price list as the primary, automatically
refreshed source.** OpenRouter's Terms of Service, section 7 (Prohibited
Conduct), verified against the live page, bans:

> "software, devices, scripts, robots or any other means or processes (such
> as crawlers, browser plugins, add-ons or any other automated technology)
> to scrape or copy any information on the Site or the Services"

with no carve-out for the public, unauthenticated `/api/v1/models`
endpoint. A scheduled or unattended poll of that endpoint is exposed to a
literal reading of that clause even though the endpoint is documented and
requires no key; requirement 5 above keeps every use of OpenRouter manual
and human-initiated for exactly this reason.

**Rejected — manually committing periodic OpenRouter snapshots into the
repository.** This shares the same Terms-of-Service exposure as the first
alternative for the one-time copy, and additionally grows stale as soon as
it is committed, with no mechanism to keep a committed snapshot current; it
was judged grey and stale-prone rather than a durable primary source.

**Not rejected, deferred.** A written request for permission to poll
OpenRouter automatically may be pursued independently of this
specification. If granted, switching the primary source to OpenRouter is an
adapter change against the contract this specification defines, not a
change to the contract itself.

**Resolved at the content gate — prune reconciliation with spec 0207.**
Requirement 37 asks the explicit period-scoped prune to remove a period's
stored prices, while spec 0207's requirements 18 through 20 name only
journal entries and their mirrored drawers. The owner settled the
reconciliation at the `user-validate` gate (approved without annotation):
a **delta-spec of spec 0207** (`0207-delta-01`) extends the prune to the
derived stores that later seams declare; it is opened at the PLAN stage of
this specification and merges before its implementation starts. The
implementation realizing this specification does not extend spec 0207's
prune behavior without that delta.
