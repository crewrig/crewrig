---
id: "0209"
slug: usage-pricing
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1202
version: 1.2.0
---

# Comparative pricing of usage — delta 02: a failed currency conversion is labelled USD and tallied apart

## ADDED

1. **New requirement (R51) — A failed conversion keeps its USD amount,
   labelled USD.** When a price is requested in a currency other than USD
   and its conversion cannot be made — because no European Central Bank
   fixing dated on or before the computation date is available to the
   computation (requirement 22), whether none has been retrieved, the
   retrieval failed, or the computation runs without network access; or
   because the fixing selected under requirement 22 lists no rate for the
   requested currency (requirement 26) — the price SHALL keep its amount in
   USD, SHALL state USD as the currency that amount is denominated in, and
   SHALL carry a conversion status naming which of the two failures
   occurred and which currency was requested. A failed conversion SHALL
   carry, as its fixing date (requirement 27), the date of the fixing it
   consulted when the failure is a missing rate for the requested
   currency, and SHALL carry no fixing date when the failure is that no
   fixing was available. No price SHALL state, as the currency of its
   amount, a currency that amount is not denominated in. A price requested
   in USD needs no conversion, and SHALL NOT carry a failed conversion
   status.
2. **New requirement (R52) — A failed conversion is re-attempted, never
   served from the store.** A stored price whose conversion status names a
   failure is not a price in the currency requested, and SHALL NOT be
   served from the store in answer to any later request for a record's
   price in a currency — USD when the request names none — whatever
   currency that request names, whether the request comes from the
   per-record pricing path, from a rollup of prices, or from spec 0210's
   dashboard; the price SHALL be computed again, so that a request made
   after a fixing dated on or before the computation date has become
   available — for instance after an explicit exchange-rate refresh —
   receives the converted price rather than the earlier failure. This
   applies equally to a stored price written before this delta, whose
   amount is USD but whose stated currency is the one requested. A raw
   read of stored prices, which returns what the store holds and computes
   no price, is not such a request and MAY return a stored failure, since
   requirement 51 already labels it truthfully.
3. **New requirement (R53) — An `unconverted` tally in a price rollup.** A
   rollup of prices SHALL count a record whose price is not `unpriced` and
   whose currency conversion failed (requirement 51) in a separate
   `unconverted` tally, reported in that record's fidelity bucket and, when
   the rollup emits a combined total (requirement 33), in the combined
   total; that record's amount SHALL NOT enter any sum the rollup reports,
   and the record SHALL NOT be counted as a priced record or as a zero-cost
   record. The `unconverted` tally SHALL be distinct from the `uncaptured`
   and `unpriced` tallies of requirement 34, and SHALL be reported even
   when it is zero. A failed conversion SHALL NOT cause the rollup to fail
   as a whole, nor to withhold the sums of the records whose conversion
   succeeded.
4. **New requirement (R54) — Each captured record in exactly one tally.**
   In each fidelity bucket of a rollup of prices, every contributing record
   of kind `captured` SHALL be counted in exactly one of three tallies —
   priced, `unpriced`, or `unconverted` — so that the three sum to the
   bucket's record count; a record whose model identifier resolved to the
   `unpriced` marker SHALL be counted as `unpriced`, never as
   `unconverted`, since it carries no amount to convert; the priced tally
   SHALL count exactly the records whose amount entered the bucket's sum;
   and a record of kind `uncaptured` SHALL remain in the `uncaptured` tally
   and in none of the three.
5. **New requirement (R55) — The failed-conversion rule is documented.**
   The organization-facing documentation of requirement 42 SHALL state what
   a price whose conversion failed carries (its USD amount, labelled USD,
   and the failure status of requirement 51), that a rollup of prices
   counts such a record in its `unconverted` tally and never in a sum, and
   that the conversion is re-attempted on the next request rather than
   served from the store (requirement 52).
6. **New requirement (R56) — Continuous-integration acceptance criterion
   for failed conversions.** A continuous-integration suite SHALL verify,
   with no network access and against a pinned fixture price list and a
   fixed fixture exchange rate: that a price requested in a currency the
   fixture fixing does not list, and a price requested in a non-USD
   currency at a computation date on or before which no fixture fixing is
   available, each keep their USD amount labelled USD and carry the failure
   status of requirement 51, the first carrying the consulted fixture
   fixing's date and the second no fixing date; that a rollup of prices in
   such a currency,
   over a fixture period holding at least one priced `per-request` record
   and at least one priced `session-cumulative` session, reports no sum
   containing any of those records' amounts, counts each of them in its
   fidelity bucket's `unconverted` tally and in the combined total's, and
   satisfies requirement 54's partition in every bucket; that the
   `session-cumulative` bucket's `unconverted` count equals spec 0210's
   dashboard's for the same period, selection, currency, and price-list
   snapshot, both surfaces reading the same fixture fixings and each
   record's price carrying the same fixing date on both, as requirement 47
   requires; and that, once the missing fixture fixing is made available,
   a second request for the same record and currency receives the
   converted price rather than the stored failure, while a request in USD
   for a record whose stored price is a failure — on the per-record
   pricing path and in spec 0210's dashboard's USD view alike — receives a
   price carrying no failed conversion status and counts that record as
   priced, with an `unconverted` count of zero.

This delta introduces the following new out-of-scope items:

- The rollup is not required to report, in any form, the USD amounts of
  the records it counts as `unconverted`; requirement 53 forbids only their
  entry into a sum the rollup reports.
- How a fidelity bucket holding no priced record renders its sum is
  unchanged by this delta.

The following restates, for this delta's additions, boundaries the parent
and delta-01 already draw through their requirements:

- Agreement with spec 0210's dashboard for `per-request` and `run-total`
  records stays outside requirement 47, as delta-01 scoped it; this delta
  widens requirement 47 to the `unconverted` count of the
  `session-cumulative` records it already covers, and no further.
- The conversion rule itself — the rate of record, the most-recent-fixing-
  on-or-before rule, and the set of convertible currencies (requirements 22
  through 26) — is unchanged; this delta states only what a failed
  conversion yields and how a rollup counts it.

**Scenario:** A failed conversion is tallied apart, not summed

```text
Given a period holding two priced per-request records, the first whose
      price converts to EUR and the second whose conversion to EUR fails
When  a rollup of prices over that period is computed in EUR
Then  the per-request bucket's sum is the first record's EUR amount alone,
      its priced count is 1, its unconverted count is 1, its unpriced count
      is 0, and the second record's USD amount appears in no sum
```

**Scenario:** A failed conversion is labelled with the currency it is in

```text
Given a captured record priced at 0.42 USD from the pinned price list
When  its price is requested in a currency the fixing lists no rate for
Then  the price states an amount of 0.42 in USD, carries a conversion
      status naming the missing currency, carries as its own fixing date
      (requirement 27) the date of the fixing it consulted, and states no
      other currency as the denomination of its amount
```

**Scenario:** A stored failure is not served after the fixing arrives

```text
Given a record whose EUR price was stored after its conversion failed
      because no fixing dated on or before the computation date was
      available to the computation
When  an explicit exchange-rate refresh makes such a fixing available and
      the record's EUR price is requested again
Then  the conversion is re-attempted and the request receives a price in
      EUR carrying the European Central Bank as its rate of record, not the
      stored failure
```

**Scenario:** A USD rollup never counts a record as unconverted

```text
Given a record whose stored price is a failed conversion to EUR
When  a rollup of prices over its period is computed in USD
Then  the record is counted as priced, its USD amount enters the USD sum,
      and every bucket's unconverted count is 0
```

## MODIFIED

**R34** — the separate-tally obligation SHALL extend to a record whose
currency conversion failed.

> Original R34: *"A record of kind `uncaptured`, and a record whose model
> identifier resolved to the `unpriced` marker, SHALL be counted in a
> rollup separately from priced records, and SHALL NOT be counted as a
> zero-cost record."*

Replacement: A record of kind `uncaptured`, a record whose model
identifier resolved to the `unpriced` marker, and a record whose currency
conversion failed (requirement 51) SHALL each be counted in a rollup
separately from priced records and from one another — in the
`uncaptured`, `unpriced`, and `unconverted` tallies respectively
(requirements 53 and 54) — and SHALL NOT be counted as a zero-cost record.

**R47** (added by delta-01) — the agreement SHALL cover the `unconverted`
count, and failed conversions SHALL no longer be excluded from it.

> Original R47: *"Given an identical period, selection (requirement 45),
> currency, fixing date, and price-list snapshot, a rollup of prices over
> a period SHALL report, for its `session-cumulative` records, the same
> price contribution, the same priced count, and the same `unpriced` count
> as spec 0210's dashboard reports for that same period; this extends to
> the pricing contract's own period rollup the agreement spec 0210
> requirement 2 already requires among the dashboard's three delivery
> forms. A record whose currency conversion failed is outside this
> requirement."*

Replacement: Given an identical period, selection (requirement 45),
currency, and price-list snapshot, and, record by record, the same fixing
date carried by each record's price on both surfaces — no fixing date for
a conversion that failed because no fixing was available (requirement
51) — a rollup of prices over a period SHALL report, for its
`session-cumulative` records, the same price contribution, the same priced count, the same `unpriced` count, and the
same `unconverted` count as spec 0210's dashboard reports for that same
period, a record whose currency conversion failed included; this extends
to the pricing contract's own period rollup the agreement spec 0210
requirement 2 already requires among the dashboard's three delivery forms.

## REMOVED

(none — every obligation of the parent and of delta-01 stands; this delta
only states what a failed currency conversion yields and how a rollup
counts it, a case the parent left unspecified and delta-01 set aside.)

## Notes

**Why this delta exists.** Issue #1202 was surfaced by the cold spec seat
`specs/1193#1` on PR #1200
(<https://github.com/crewrig/crewrig/pull/1200#issuecomment-5813942731>):
on a failed currency conversion, `task usage:price -- --period P --rollup
--currency EUR` adds the record's USD amount into the EUR total, while
spec 0210's dashboard counts the same record as unconverted and keeps it
out of its sum. Three points on `main` @ `3cbe519` combine into the defect:

- `scripts/lib/usage-price/fx.js` `convert()` returns the USD amount
  unchanged, with status `no-fixing-on-or-before` or `no-such-currency`.
- `scripts/lib/usage-price/store.js` `computePriceObject()` then sets the
  price's `currency` to the requested currency on that USD amount.
- `scripts/lib/usage-price/rollup.js` `priceBucket()` sums every amount
  that is not `unpriced`, never reading the conversion status.

A fourth effect follows from the second: `isStoredPriceUsable()` in the
same `store.js` accepts the mislabelled stored price as a price in the
requested currency, so a failure is served from the store even after an
exchange-rate refresh would let the conversion succeed. Delta-01 R47 set
failed conversions aside and deferred them to this ticket (delta-01 →
*Notes* → *Failed conversions*).

**Owner decisions.** Recorded from the SPECS-stage interview on
2026-09-25 at
<https://github.com/crewrig/crewrig/issues/1202#issuecomment-5836039221>:

> 1. **Rollup tally — separate `unconverted` tally.** A record whose
>    currency conversion failed is counted in a separate `unconvertedCount`
>    per fidelity bucket and in the combined total; its amount never enters
>    any sum and is never counted as zero-cost. [...]
> 2. **Per-record price object — USD amount labelled USD.** On a failed
>    conversion the price keeps `amount` = the USD amount with
>    `currency: "USD"`, and `conversion.status` carries the failure. No
>    amount is ever labelled with a currency it is not denominated in; as a
>    consequence the price store no longer serves the failure for the
>    requested currency, so the conversion is retried after an FX refresh.

R53 and R54 realize the first decision, R51 and R52 the second.

**Rejected alternatives.**

- *Refusing the currency outright.* One missing fixing, or one currency
  the fixing does not list, would block the rollup of a whole period, and
  the pricing contract's rollup would diverge from the dashboard, which
  tallies the record and keeps rendering the rest.
- *A null amount labelled with the requested currency.* It removes the
  mislabelled amount, but a stored price stating the requested currency
  would still be served from the store for that currency, keeping the
  stale failure alive after an exchange-rate refresh.
- *No change to the price object.* It keeps a USD amount labelled with a
  currency it is not denominated in, which every consumer of the price
  object — not only the rollup — would have to know to distrust.

**R52 scope — why every currency, and only pricing requests.** The price
store keeps one price per record, whatever currency it was computed in. A
stored failure labelled USD under R51 would otherwise satisfy a later USD
request's currency check and carry its failure status into a USD rollup
or a USD dashboard view — the dashboard prices records through the same
read-through path — where R54 would count as unconverted a record that
needs no conversion at all. R52 therefore refuses a stored failure for
every currency, and R51's last sentence makes the USD case explicit. R52
binds requests for a price, not the raw read of stored prices
(`store.readPrices()`), whose contract is to return what the store holds
and never compute; R51's truthful label is what makes a failure safe to
return there. The same wording lets a price stored
before this delta — USD amount, requested currency — heal on its next
request rather than needing a migration. Re-attempting on every request
may cost an exchange-rate lookup per unconverted record while the fixing
stays missing; bounding that cost within one run is a PLAN concern, not a
change to R52.

**Fixing date of a failed conversion.** Parent R27 attaches a fixing date
to a price only when converted, and `convert()` on `main` omits it on
both failure paths. The two paths differ, though: on a missing rate for
the requested currency, `resolve()` has selected a fixing and `crossRate()`
has consulted it, so that date is a fact about the computation; when no
fixing was available, there is no date to report. R51 records the first
and forbids inventing the second. That is what makes the reworded R47's
precondition checkable from each surface's per-record prices: a record
that fails on the dashboard for want of a fixing (it computes without
network access) but converts on the pricing side (whose freshness gate may
retrieve one) carries different fixing dates on the two surfaces; the
precondition then does not hold for that period, so the period's
comparison as a whole — not only that record — falls outside R47 by its
stated precondition rather than by inference.

**Spec 0210 side.** Spec 0210's own requirements name only the
`uncaptured` and `unpriced` counts; its `unconverted` tally is the
dashboard's implementation of PLAN D3 (`classify()` and `priceGroup()` in
`scripts/lib/usage-dashboard/model.js`, which count a price whose
conversion status is not `ok` as unconverted, keep it out of every sum,
and report `unconvertedCount` per fidelity and overall). R53 and R54 give
the pricing contract's rollup the same partition, and the reworded R47
requires the two to agree on it, without changing spec 0210 — the same
pattern delta-01 R47 used for the placement rule spec 0210 states no
requirement for. No 0210 delta is needed.

**Version bump.** MINOR (`1.1.0` → `1.2.0`) per `docs/spec-format.md` →
*Versioning*: new requirements (51 through 56) and new scenarios that
constrain a previously unspecified case — what a failed conversion yields
and how a rollup counts it — plus a reworded R34 and R47 that keep every
obligation of their originals (the `uncaptured` and `unpriced` tallies,
the never-zero-cost rule, and the three agreements R47 already stated) and
add the `unconverted` tally and its agreement. It is not MAJOR: no
requirement the implementation on `main` satisfies is withdrawn. Summing a
USD amount into a total in another currency, and labelling that amount
with the requested currency, were never obligations the parent stated —
they sit uneasily with R25, which denominates the primary source's prices
in USD, and delta-01 R47 left the case explicitly unsettled — so the
implementing diff narrows behavior no requirement protected.

**Seat findings addressed (specs/1202#1).** The first pass of the cold
spec seat on PR #1232
(<https://github.com/crewrig/crewrig/pull/1232#issuecomment-5836154453>)
returned four findings against revision `67205fc`:

- *s1-F1 (blocking).* R51's first failure cause now reads "no fixing dated
  on or before the computation date is available to the computation",
  naming the never-retrieved, failed-retrieval, and no-network cases; R52,
  R56, and the third scenario use the same availability wording, so an
  empty cache, or one holding no fixing dated on or before the computation
  date — the case the offline dashboard hits — falls under R51 and
  therefore under R52 and R53. A cache that holds an older fixing dated on
  or before the computation date is not a failure: requirement 22 converts
  at that fixing, reporting its staleness, as before this delta.
- *s1-F2.* R52 now binds a request for a record's price in a currency
  (USD when none is named) from the per-record pricing path, a rollup of
  prices, or spec 0210's dashboard, and states that a raw read of stored
  prices is not such a request and may return a stored failure; R56 now
  also checks the dashboard's USD view over a stored failure; *Notes* →
  *R52 scope* explains the boundary.
- *s1-F3.* R51 now states the fixing date a failed conversion carries —
  the consulted fixing's date on a missing rate, none when no fixing was
  available; the reworded R47 and R56 state their fixing-date precondition
  record by record, as each record's price carries it on both surfaces;
  the second scenario and *Notes* → *Fixing date of a failed conversion*
  follow.
- *s1-F4 (nit).* The boundary list under `## ADDED` is split: new
  out-of-scope items are labelled as new, the two restated boundaries are
  labelled as drawn by the parent's and delta-01's requirements, and the
  former prohibition on refusing a currency outright moved into R53 as a
  normative sentence.

**Seat findings addressed (specs/1202#1, pass 2).** The second pass
(<https://github.com/crewrig/crewrig/pull/1232#issuecomment-5836224152>)
approved revision `aa6be52` with three non-blocking findings, addressed
editorially: *s2-F1* — the pass-1 mapping above no longer calls a stale
cache a failure, and states that a cache holding an older fixing on or
before the computation date converts at it; *s2-F2* — the second scenario
places the consulted fixing's date on the price's own requirement-27
fixing date, not inside the conversion status; *s2-F3* — *Notes* →
*Fixing date of a failed conversion* now reads R47's precondition as a
whole-period one, as R47 states it.
