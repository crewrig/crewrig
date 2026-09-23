// compute.js — the arithmetic (spec 0209 R14-R19; PLAN v2 step 5), against
// the REAL LiteLLM field names measured on the pinned snapshot, never
// plausible-looking ones.
//
// Cache write (R14): tokens.cacheWrite is an integer or a per-tier map. A
// tier key matching 1h|1hr|3600 prices at cache_creation_input_token_cost_
// above_1hr; every other tier and the integer form prices at
// cache_creation_input_token_cost. Cache read: cache_read_input_token_cost.
//
// Reasoning (R16): NEVER add a reasoning term on top of the output term.
// Reasoning tokens are always priced at the output rate (no separate cost);
// when the resolved entry's output_cost_per_reasoning_token differs from
// output_cost_per_token, the divergence is flagged in unpricedComponents
// rather than charged — the schema and the adapters disagree on whether
// tokens.reasoning is a subset of tokens.output, so charging the divergent
// rate risks double-counting and charging only output cannot.
//
// Long-context override (R18): the comparand is netInput + cacheRead +
// sum(cacheWrite) — the whole request's input side. The LARGEST threshold
// the resolved entry declares AND the comparand crosses wins, and every
// component then switches to its own `_above_<N>_tokens` SIBLING where one
// exists — the sibling of the R14-selected field, never of the base field
// (e.g. cache_creation_input_token_cost_above_1hr_above_200k_tokens is the
// sibling of the 1-hour tier field, not of the plain cache-write field).
//
// Regional (R17): never applied — no adapter emits a region (raw is open,
// not evidence either way; grounded on the five raw: assignments instead,
// none of which carries one today). A resolved entry declaring an uplift
// field adds an informational `regionalUpliftAvailable` note.
//
// Google storage (R15): a gemini-*/vertex_ai* entry with
// supports_prompt_caching and a non-zero cache class gets underEstimate:
// ["context-cache-storage-per-hour"] — the snapshot exposes no per-hour
// context-cache storage field.
//
// Unknown component (R19): any non-zero token class with no corresponding
// field on the resolved entry contributes no money and lands in
// unpricedComponents — this is also what makes a tiered_pricing-only entry
// (no flat input_cost_per_token) land netInput there wholesale, with no
// special-casing needed.

'use strict';

const THRESHOLD_SUFFIXES = [
  [128000, '128k'],
  [200000, '200k'],
  [256000, '256k'],
  [272000, '272k'],
  [512000, '512k'],
];

function suffixFor(n) {
  const found = THRESHOLD_SUFFIXES.find(([num]) => num === n);
  return found ? found[1] : null;
}

function declaredThresholds(entry) {
  const declared = new Set();
  for (const key of Object.keys(entry)) {
    for (const [n, suffix] of THRESHOLD_SUFFIXES) {
      if (key.indexOf(`_above_${suffix}_tokens`) !== -1) declared.add(n);
    }
  }
  return declared;
}

// selectThreshold — the LARGEST threshold the entry declares AND the
// comparand crosses (R18: "the largest crossed threshold wins").
function selectThreshold(entry, comparand) {
  const declared = declaredThresholds(entry);
  let chosen = null;
  for (const [n] of THRESHOLD_SUFFIXES) {
    if (declared.has(n) && comparand >= n && (chosen === null || n > chosen)) {
      chosen = n;
    }
  }
  return chosen;
}

function siblingField(baseField, threshold) {
  return `${baseField}_above_${suffixFor(threshold)}_tokens`;
}

// rateFor — the sibling of baseField at `threshold` when one exists on the
// entry, else baseField itself, else null (R19: an absent field prices at
// nothing and is flagged, never treated as zero silently).
function rateFor(entry, baseField, threshold) {
  if (threshold !== null) {
    const sibling = siblingField(baseField, threshold);
    if (entry[sibling] !== undefined) return { field: sibling, rate: entry[sibling] };
  }
  if (entry[baseField] !== undefined) return { field: baseField, rate: entry[baseField] };
  return null;
}

function cacheWriteBaseField(tierKey) {
  if (tierKey && /^(1h|1hr|3600)$/i.test(tierKey)) return 'cache_creation_input_token_cost_above_1hr';
  return 'cache_creation_input_token_cost';
}

function normalizeCacheWrite(cacheWriteRaw) {
  if (cacheWriteRaw && typeof cacheWriteRaw === 'object') {
    return Object.entries(cacheWriteRaw).map(([tier, count]) => ({ tier, count: count || 0 }));
  }
  return [{ tier: undefined, count: cacheWriteRaw || 0 }];
}

// computeUsd(record, entry) — the per-record USD breakdown against a
// resolved (non-unpriced) primary- or org-sourced entry.
function computeUsd(record, entry) {
  const tokens = (record && record.tokens) || {};
  const netInput = tokens.netInput || 0;
  const cacheRead = tokens.cacheRead || 0;
  const output = tokens.output || 0;
  const reasoning = tokens.reasoning || 0;
  const cacheWriteTiers = normalizeCacheWrite(tokens.cacheWrite);
  const cacheWriteTotal = cacheWriteTiers.reduce((sum, t) => sum + t.count, 0);

  const comparand = netInput + cacheRead + cacheWriteTotal;
  const threshold = selectThreshold(entry, comparand);

  const unpricedComponents = [];
  const underEstimate = [];
  const components = {};
  let amountUsd = 0;

  if (netInput > 0) {
    const picked = rateFor(entry, 'input_cost_per_token', threshold);
    if (picked) {
      const amt = netInput * picked.rate;
      amountUsd += amt;
      components.netInput = { field: picked.field, rate: picked.rate, count: netInput, amountUsd: amt };
    } else {
      unpricedComponents.push('netInput');
    }
  }

  if (cacheRead > 0) {
    const picked = rateFor(entry, 'cache_read_input_token_cost', threshold);
    if (picked) {
      const amt = cacheRead * picked.rate;
      amountUsd += amt;
      components.cacheRead = { field: picked.field, rate: picked.rate, count: cacheRead, amountUsd: amt };
    } else {
      unpricedComponents.push('cacheRead');
    }
  }

  if (cacheWriteTotal > 0) {
    const tierBreakdown = [];
    let cacheWriteAmount = 0;
    let anyUnpriced = false;
    for (const t of cacheWriteTiers) {
      if (t.count <= 0) continue;
      const baseField = cacheWriteBaseField(t.tier);
      const picked = rateFor(entry, baseField, threshold);
      if (picked) {
        const amt = t.count * picked.rate;
        cacheWriteAmount += amt;
        tierBreakdown.push({ tier: t.tier || 'untiered', field: picked.field, rate: picked.rate, count: t.count, amountUsd: amt });
      } else {
        anyUnpriced = true;
      }
    }
    if (tierBreakdown.length > 0) {
      amountUsd += cacheWriteAmount;
      components.cacheWrite = tierBreakdown;
    }
    if (anyUnpriced) unpricedComponents.push('cacheWrite');
  }

  // Reasoning is NEVER charged as a separate term (R16) — output is priced
  // once, for output count alone; reasoning contributes no additional line
  // whether or not the source counts it as a subset of output.
  if (output > 0) {
    const picked = rateFor(entry, 'output_cost_per_token', threshold);
    if (picked) {
      const amt = output * picked.rate;
      amountUsd += amt;
      components.output = { field: picked.field, rate: picked.rate, count: output, amountUsd: amt };
    } else {
      unpricedComponents.push('output');
    }
  }

  const reasoningRate = entry.output_cost_per_reasoning_token;
  const outputRate = entry.output_cost_per_token;
  if (reasoning > 0 && reasoningRate !== undefined && outputRate !== undefined && reasoningRate !== outputRate) {
    unpricedComponents.push('reasoning-rate-divergence');
  }

  const provider = entry.litellm_provider || '';
  const isGoogle = provider === 'gemini' || provider.indexOf('vertex_ai') === 0;
  if (isGoogle && entry.supports_prompt_caching && (cacheRead > 0 || cacheWriteTotal > 0)) {
    underEstimate.push('context-cache-storage-per-hour');
  }

  const regionalUpliftAvailable = [];
  if (entry.regional_endpoint_uplift_multiplier !== undefined) regionalUpliftAvailable.push('regional_endpoint_uplift_multiplier');
  if (entry.regional_processing_uplift_multiplier_eu !== undefined) regionalUpliftAvailable.push('regional_processing_uplift_multiplier_eu');
  if (entry.regional_processing_uplift_multiplier_us !== undefined) regionalUpliftAvailable.push('regional_processing_uplift_multiplier_us');

  const result = { amountUsd, components, unpricedComponents, underEstimate };
  if (threshold !== null) result.longContextThreshold = threshold;
  if (regionalUpliftAvailable.length > 0) result.regionalUpliftAvailable = regionalUpliftAvailable;
  return result;
}

module.exports = { computeUsd, selectThreshold, declaredThresholds, siblingField, rateFor };
