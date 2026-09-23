// copilot.js — R20/R21's Copilot CLI handling (PLAN v2 step 6).
//
// Measured: no record schema v1 produces today carries a first-party price.
// The sqlite adapter's raw is exactly {initiator, parent_tool_call_id,
// finish_reason, copilot_usage_model} (adapters/copilot-cli.js); the
// headless envelope carries token counts only. R20's own condition is
// therefore false for every record today, and its fallback clause governs:
// the pinned primary source prices every Copilot record. firstPartyCopilot()
// is a DEFENSIVE reader over record.raw — the adapters' own idiom —
// recognizing a first-party price shape when one is present without
// asserting a shape no record has, so R20 stays live and fixture-tested
// without touching spec 0206 or inventing a record field.

'use strict';

// firstPartyCopilot(record, org) -> {amountUsd, source} | null. Recognizes,
// in order: raw.pricing.amountUsd; raw.modelMetrics[<model>].pricing.
// amountUsd; or a total_nano_aiu + request_multiplier pair, priced against
// an AIU rate the org table declares under copilot.aiuRateUsd (inferring
// the rate from the pair's own presence would be a guess about an
// account's billing arrangement — R12 forbids exactly that class of
// heuristic for model ids, and the same discipline applies here).
function firstPartyCopilot(record, org) {
  const raw = (record && record.raw) || {};

  if (raw.pricing && typeof raw.pricing === 'object' && typeof raw.pricing.amountUsd === 'number') {
    return { amountUsd: raw.pricing.amountUsd, source: 'raw.pricing' };
  }

  const model = record && record.modelId;
  if (model && raw.modelMetrics && raw.modelMetrics[model] && raw.modelMetrics[model].pricing) {
    const p = raw.modelMetrics[model].pricing;
    if (typeof p.amountUsd === 'number') {
      return { amountUsd: p.amountUsd, source: `raw.modelMetrics.${model}.pricing` };
    }
  }

  if (typeof raw.total_nano_aiu === 'number' && typeof raw.request_multiplier === 'number') {
    const aiuRateUsd = org && org.copilot && typeof org.copilot.aiuRateUsd === 'number' ? org.copilot.aiuRateUsd : null;
    if (aiuRateUsd !== null) {
      const amountUsd = (raw.total_nano_aiu / 1e9) * raw.request_multiplier * aiuRateUsd;
      return { amountUsd, source: 'raw.total_nano_aiu+request_multiplier' };
    }
  }

  return null;
}

// legacyPlanCaveat(org) — R21: nothing in a record names the account's
// plan, so model-prices.org.json declares it (copilot.plan). When it reads
// "legacy-premium-request", every copilot-cli price carries a prominent
// caveat naming it a legacy-plan reference price. Undeclared -> no caveat.
function legacyPlanCaveat(org) {
  return !!(org && org.copilot && org.copilot.plan === 'legacy-premium-request');
}

module.exports = { firstPartyCopilot, legacyPlanCaveat };
