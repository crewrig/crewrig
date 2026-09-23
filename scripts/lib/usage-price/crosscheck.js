// crosscheck.js — R5's manual, human-initiated OpenRouter cross-check (PLAN
// v2 step 10). crossCheck() fetches OpenRouter's public price list ONCE,
// in-process, on an explicit invocation; prints a side-by-side diff against
// the primary-source resolution already computed by the caller; and WRITES
// NOTHING — no cache file, no store write, no return value another module
// consumes. No scheduler, no timer, no retry loop.
//
// The OpenRouter host string appears in EXACTLY this one file across
// scripts/lib/usage-price/**, and this module is require()'d from EXACTLY
// one place — the CLI's --cross-check branch (cli.js) — both asserted
// structurally by the suite (R5). See docs/usage-pricing.md for why a
// one-shot, human-initiated read here stays outside OpenRouter's ToS §7 ban
// on automated scraping.

'use strict';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// crossCheck(modelId, {resolved, fetchImpl}) — prints the diff to stdout
// and returns nothing.
async function crossCheck(modelId, { resolved, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(OPENROUTER_MODELS_URL, { headers: { 'User-Agent': 'crewrig-usage-price' } });
  if (!res.ok) {
    throw new Error(`OpenRouter models endpoint returned ${res.status}`);
  }
  const body = await res.json();
  const models = Array.isArray(body.data) ? body.data : [];
  const match = models.find((m) => m.id === modelId || m.canonical_slug === modelId) || null;

  const primary =
    resolved && !resolved.unpriced
      ? {
          step: resolved.step,
          entryKey: resolved.entryKey,
          inputCostPerToken: resolved.entry.input_cost_per_token,
          outputCostPerToken: resolved.entry.output_cost_per_token,
        }
      : { unpriced: true };

  const openrouter =
    match && match.pricing
      ? { id: match.id, inputCostPerToken: Number(match.pricing.prompt), outputCostPerToken: Number(match.pricing.completion) }
      : { matched: false };

  process.stdout.write(`${JSON.stringify({ modelId, primary, openrouter }, null, 2)}\n`);
}

module.exports = { crossCheck };
