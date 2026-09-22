# Usage pricing

<!-- crewrig-doc: section=reference nav_order=140 published=true title="Usage pricing" -->

A computed price is a comparative reference figure that shows what a period of model consumption would have cost — never an invoice, a vendor reconciliation, or a budget forecast. Every computed price carries the disclaimer: **reference figure, not an invoice**. Prices are useful for understanding consumption patterns across vendors and models, rendered in any currency the framework supports, and persist separately from the usage record they were computed from.

## Primary source

Computed prices are based on LiteLLM's `model_prices_and_context_window.json` price list, published in the [BerriAI/litellm](https://github.com/BerriAI/litellm) repository under the **MIT licence**. The framework pins this list to one identifiable commit SHA, downloaded at that exact commit (never at `HEAD` or a later commit), so prices remain reproducible over time even as the vendor updates rates. The pinned snapshot is stored under `<root>/pricelist/` with `PINNED.json` as the pointer file, recording the SHA, fetch instant, ETag (when available), and entry count. When you refresh the price list, you replace only the pointer and the blob at that SHA; earlier snapshots remain on disk.

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

## Currency conversion

Prices are denominated in USD by the primary source. When you request a price in another currency, the framework converts it using the European Central Bank's daily reference rate for that currency. The conversion uses the most recent published fixing on or before the computation date—never a fixing dated after that date. Because ECB rates are EUR-based (the XML feed carries no EUR row), cross-rates are computed as `rate(target) / rate(USD)` or `1 / rate(USD)` for EUR-to-USD conversions.

Every currency-converted price is attributed to the European Central Bank as the rate of record. Prices can be converted to any ISO 4217 currency code the ECB publishes rates for.

## Cross-check against OpenRouter

The `--cross-check` flag lets you compare a model's price in the primary source against OpenRouter's public list, as a manual sanity check:

```bash
scripts/lib/usage-price/cli.js --cross-check gpt-4-turbo
```

This invokes the fetcher once, in-process, on explicit human command, reaches OpenRouter only after you explicitly request it, and writes nothing—neither cache file nor stored price. The framework ships the fetcher in every fork, but it is never invoked automatically and reaches OpenRouter only on your explicit one-shot human-initiated read, which the OpenRouter Terms of Service section 7 (Prohibited Conduct) permits as a use case outside the ban on *"scripts, robots or any other means or processes … to scrape or copy"*.

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
