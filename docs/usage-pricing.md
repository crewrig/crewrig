# Usage pricing

<!-- crewrig-doc: section=reference nav_order=140 published=true title="Usage pricing" -->

A computed price is a comparative reference figure that shows what a period of model consumption would have cost — never an invoice, a vendor reconciliation, or a budget forecast. Every computed price carries the disclaimer: **reference figure, not an invoice**. Prices are useful for understanding consumption patterns across vendors and models, rendered in any currency the framework supports, and persist separately from the usage record they were computed from.

This page is one stage of the usage feature; the [usage architecture overview](usage-overview.md) shows how the stages fit together.

## Primary source

Computed prices are based on LiteLLM's `model_prices_and_context_window.json` price list, published in the [BerriAI/litellm](https://github.com/BerriAI/litellm) repository under the **MIT licence**. The framework pins this list to one identifiable commit SHA, downloaded at that exact commit (never at `HEAD` or a later commit), so prices remain reproducible over time even as the vendor updates rates. The pinned snapshot is stored under `<root>/pricelist/` with `PINNED.json` as the pointer file, recording the SHA, fetch instant, ETag (when available), and entry count. When you refresh the price list, you replace only the pointer and the blob at that SHA; earlier snapshots remain on disk.

Beyond this snapshot-level identity, an individual price also carries entry-level provenance: when the primary source declares its own source URL for the specific entry a price resolved against, the price's `resolution.sourceUrl` field carries that URL. This is the primary source's own declaration for that entry, never a constructed or guessed link — when the resolved entry declares no such URL, the field is simply absent.

## Adding and correcting entries

To add a price entry the primary source does not declare, or to correct one or more fields of a primary-source entry, maintain a `model-prices.org.json` file at the project root with the structure:

```json
{
  "entries": {
    "model-id-here": { "input_cost_per_token": 0.001, ... },
    "another-model": { ... }
  }
}
```

This org override table is never part of the pinned primary source; it is always your own, maintainable file. When resolving a model identifier to a price, the framework checks both tables in a specific order:

1. **`sentinel`** — If the model identifier is a placeholder like `(unreported)` or Antigravity's automatic-selection label, mark it unpriced without further resolution.
2. **`org-exact`** — If the org table declares the model identifier, use the org entry (takes precedence over primary-source exact matches).
3. **`exact`** — If only the primary source declares it, use that entry.
4. **`alias`** — If either table declares the entry as an alias, follow the target within the same pinned snapshot.
5. **`family`** — If no exact or alias match exists, try a same-family fallback (e.g., `gemini-2-flash` matches vendor family `gemini-2`).
6. **`org-added`** — If still no match, check the org table again for entries only it declares.
7. **`unpriced`** — If no candidate resolves, mark the record as unpriced rather than guessing.

The org table occupies two positions in this ladder: `org-exact` (before primary exact), and `org-added` (after family fallback). This design ensures your corrections always win, and your additions fill gaps after all primary-source strategies are exhausted.

### Declaring a Copilot CLI billing plan

No usage record names the billing plan of the Copilot CLI account that produced it, so the org table declares it, in an optional `copilot` object beside `entries`. Both keys are optional:

```json
{
  "entries": {},
  "copilot": {
    "plan": "legacy-premium-request",
    "aiuRateUsd": 0.04
  }
}
```

- **`copilot.plan`** names the account's billing arrangement: `current-billing` or `legacy-premium-request`.
  - `legacy-premium-request` (spec 0209 R21): every `copilot-cli` price computed from the price list carries the caveat `"copilot": {"legacyPlanReference": true, "caveat": "legacy-plan-reference-price"}` in the price object, naming it a legacy-plan reference price rather than the account's billed cost. A price computed from the CLI's own first-party figures carries no caveat, and neither does an unpriced record.
  - `current-billing` (spec 0209 R20), any other value, or no declaration at all adds no caveat. A current-billing record is priced from the CLI's own first-party figures when its `raw` block carries them, and from the price list otherwise. No capture adapter records first-party figures today, so every Copilot CLI price on `main` comes from the price list.
- **`copilot.aiuRateUsd`** is the US-dollar rate per AIU. It is read only for a record whose `raw` block carries both `total_nano_aiu` and `request_multiplier`, which the first-party path then prices at this rate. The framework never infers a rate from an account's usage. No capture adapter puts those two fields in `raw` today, so on `main` this key changes no price. The `0.04` above is illustrative, not a published rate.

`model-prices.org.json` ships with an empty `copilot` object, so no plan is declared until the adopting organization declares one.

## Refreshing the price list and exchange rates

Use `--refresh-pricelist` to fetch the current primary-source snapshot by its commit SHA:

```bash
scripts/lib/usage-price/cli.js --refresh-pricelist
```

To pin a specific historical snapshot:

```bash
scripts/lib/usage-price/cli.js --refresh-pricelist --sha <commit-sha>
```

Exchange rates (currency conversion) are cached from the European Central Bank. To refresh them:

```bash
scripts/lib/usage-price/cli.js --refresh-fx
```

When the ECB source fails, use `--fx-mirror frankfurter` to fall back to the Frankfurter mirror (`api.frankfurter.dev`), which mirrors the same ECB rates:

```bash
scripts/lib/usage-price/cli.js --refresh-fx --fx-mirror frankfurter
```

To suppress all network refreshes (useful for offline operation or testing), set the environment variable:

```bash
CREWRIG_USAGE_OFFLINE=1 <your-command>
```

When this flag is set, the price engine uses only cached data and skips all refresh attempts. If a cache is missing or stale, the result carries a `fxStaleness` field documenting the staleness.

### Freshness gate and `fxStaleness`

When computing a price in a given currency on a given date, the framework checks whether the newest cached exchange rate is strictly older than that date. If so, it attempts one network refresh to fetch the most recent published rate. If the network is unavailable, the refresh is suppressed (under `CREWRIG_USAGE_OFFLINE=1`), or the refresh fails, the result carries a `fxStaleness` object describing the stale cache:

```json
{
  "fxStaleness": {
    "ageDays": 5,
    "resolvedFixing": "2026-09-17",
    "newestCached": "2026-09-17",
    "reason": "offline" | "network-error" | "mirror-disagreement"
  }
}
```

- **`ageDays`** — How many days between the resolved rate's date and the computation date.
- **`resolvedFixing`** — The date of the rate actually used (the largest cached date ≤ computation date).
- **`newestCached`** — The newest rate in the cache before refresh was attempted.
- **`reason`** — Why the freshness gate fired and the refresh was suppressed or failed: `"offline"` (CREWRIG_USAGE_OFFLINE was set), `"network-error"` (ECB and mirror both failed), or `"mirror-disagreement"` (mirror reported a different date than requested).

The gate makes at most one refresh attempt per computation date per run, whether that run is a `usage:price` invocation or a rollup. A dashboard view never attempts a refresh, since it reads only the fixings already cached, yet it still resolves each computation date at most once per view. Every price a run or view converts on that date uses the same resolved fixing, and the next run sees any fixing written in between.

## Currency conversion

Prices are denominated in USD by the primary source. When you request a price in another currency, the framework converts it using the European Central Bank's daily reference rate for that currency. The conversion uses the most recent published fixing on or before the computation date—never a fixing dated after that date. Because ECB rates are EUR-based (the XML feed carries no EUR row), cross-rates are computed as `rate(target) / rate(USD)` or `1 / rate(USD)` for EUR-to-USD conversions.

Every currency-converted price is attributed to the European Central Bank as the rate of record. Prices can be converted to any ISO 4217 currency code the ECB publishes rates for.

### When a conversion fails

A conversion fails when no fixing dated on or before the computation date is available (none was retrieved, the retrieval failed, or the run is offline), or when the selected fixing lists no rate for the requested currency. The price then carries:

- **`amount`** — The USD amount, unconverted, with **`currency: "USD"`**. No price states a currency its amount is not denominated in.
- **`conversion.status`** — `no-fixing-on-or-before` or `no-such-currency`, naming which failure occurred, and **`conversion.requested`** — the currency that was asked for.
- **`fixingDate`** — The date of the fixing that was consulted on `no-such-currency`, and `null` on `no-fixing-on-or-before`, since no fixing was available.

A failed conversion is never served from the price store. Any later request for the record's price, in any currency, computes it again, so a run after `task usage:price -- --refresh-fx` receives the converted price. The same holds for a failure stored before this rule, whose USD amount is labelled with the requested currency: the next request for the record recomputes it. A raw read of the stored prices (`store.readPrices()`) computes nothing and may still return a stored failure, which carries the truthful USD label.

A period rollup counts such a record in its `unconverted` tally and never adds its amount to a sum (see *Period rollups* below).

## Cross-check against OpenRouter

The `--cross-check` flag lets you compare a model's price in the primary source against OpenRouter's public list, as a manual sanity check:

```bash
scripts/lib/usage-price/cli.js --cross-check gpt-4-turbo
```

This invokes the fetcher once, in-process, on explicit human command, reaches OpenRouter only after you explicitly request it, and writes nothing—neither cache file nor stored price. The framework ships the fetcher in every fork, but it is never invoked automatically and reaches OpenRouter only on your explicit one-shot human-initiated read, which the OpenRouter Terms of Service section 7 (Prohibited Conduct) permits as a use case outside the ban on *"scripts, robots or any other means or processes … to scrape or copy"*.

## Period rollups

`task usage:query -- --period P --rollup` and `task usage:price -- --period P --rollup` sum a calendar month. `per-request`, `run-total`, and `uncaptured` records count in the month of their own `timing.requestInstant`. A `session-cumulative` session counts once, through its last snapshot, and only in one month:

- The last snapshot is chosen over every snapshot of the session that the selection admits, in every month, not only among those inside `P`. The last is the one with the latest `timing.requestInstant`, ties broken by the latest `timing.captureInstant`, then by the greatest `recordId`.
- The selection (`--session`, `--agent` with `--parent`, `--task-key` and `--asset` on the ledger-applied attribution, `--cli`, and `--fidelity`; `usage:query` alone lets you skip the attribution ledger with `--no-ledger`) applies before that choice. The period applies after it.
- The session counts in the month holding its last snapshot's `timing.requestInstant`, and in no other month. A month that holds only earlier snapshots of the session receives nothing from it: no price, no priced count, and no `unpriced` count.

A session with a 700-token snapshot on the last evening of September and a 900-token snapshot early on 1 October counts 900 tokens in October and nothing in September. Summing the months therefore counts each session exactly once, and a month's figures agree with the dashboard's for the same month and the same selection (see [Usage dashboard](usage-dashboard.md)). Both commands AND every selector given with `--period`, as the dashboard does, and the period only places the result ([#1205](https://github.com/crewrig/crewrig/issues/1205)). Each `usage:price --rollup` fidelity bucket reports `sum`, `pricedCount`, `unpricedCount`, `unconvertedCount`, and `count`. Every captured record in a bucket is counted in exactly one of the three tallies, so `pricedCount + unpricedCount + unconvertedCount = count`. `pricedCount` counts exactly the records whose amount entered `sum`. A record whose conversion failed is counted in `unconvertedCount` and its amount never enters a sum. An `unpriced` record stays in `unpricedCount`, and an `uncaptured` record stays in the top-level `uncapturedCount`. The combined total reports `sum`, `unpricedCount`, `unconvertedCount`, and `mixed`.

The figures are computed from the snapshots in the store at the time of the rollup and are never frozen, so an ended month's `session-cumulative` figure can still move in two ways:

1. **A straddling session keeps recording.** A session that was active when the month ended records a later snapshot in the next month. It then leaves the ended month and counts in the later one.
2. **A later month is pruned.** An explicit `task usage:prune` of a later month removes the snapshot that was a session's last. The session's last *surviving* snapshot then counts, which can bring it back into the ended month.

## Known under-estimates

Computed prices may be under-estimates in the following cases, each flagged in the price object:

1. **Context-cache storage costs** (spec R15) — Google model entries in the primary source do not expose a schema field for cache-storage cost, so any vendor cache-storage charge for those models is not included in the computed price. The price carries an `underEstimate` flag naming `"context-cache-storage-per-hour"`.

2. **Tiered pricing** (spec R19) — A few entries in the primary source describe their rates only through a banded `tiered_pricing` schema and carry no flat `input_cost_per_token`. This arithmetic does not represent bands, so no field matches the affected token class, the class contributes no money, and it lands in `unpricedComponents` under its own name (`netInput` for such an entry). This is the general R19 rule — any non-zero token class with no corresponding field on the resolved entry — applied to a whole entry at once, with no special-casing in the code. It is unrelated to the `_above_<N>_tokens` long-context fields, which are priced.

3. **Reasoning-token divergence** (spec R16) — When a resolved entry declares both `output_cost_per_token` and a different `output_cost_per_reasoning_token`, the framework prices reasoning tokens at the output rate and does not apply the separate reasoning rate. The price then carries `unpricedComponents: ["reasoning-rate-divergence"]` because the schema does not declare whether `tokens.reasoning` is a subset of `tokens.output`, and the adapters genuinely disagree on this boundary.

4. **Regional surcharges** (spec R17) — The regional uplift is never applied. No adapter emits a region today, and pinning a region on a record is out of scope. When a resolved entry declares one of `regional_endpoint_uplift_multiplier`, `regional_processing_uplift_multiplier_eu`, or `regional_processing_uplift_multiplier_us`, the price carries an informational `regionalUpliftAvailable` array naming those unapplied fields, marking them for potential use when an adapter later emits a region.

These under-estimates are documented so you know where computed prices may differ from actual vendor invoices. They are never treated as zero or omitted silently.

## See also

- [Usage storage](usage-storage.md) — The storage contract for usage records and derived prices.
- [Usage attribution](usage-attribution.md) — How records are attributed to CrewRig tasks and external assets.
