// store.js — the price derived store: compute, cache-validate, write, and
// read stored prices (spec 0209 R27-R29, R35-R36; PLAN v2 step 7).
//
// R35: the writer here never opens a path under journalRoot() — records are
// read through 0207's own existing read surface (scripts/lib/usage-store/
// query.js's run()), never by this tree constructing a journal path itself;
// the only path this tree ever writes is layout.priceEntry(), under
// pricesRoot(). R36: every price file carries the three timestamps and the
// record id, and is recomputable from those alone.
//
// Cache validity (R28/R29): a stored price is reused by the default
// (non-`--as-of-today`) path only when BOTH its currency and its
// snapshot.sha match the currently requested ones — so a re-run after a
// `--refresh-pricelist` never silently serves a price computed under a
// snapshot that is no longer pinned (R29), and a currency switch always
// recomputes rather than returning the wrong denomination. `--as-of-today`
// always recomputes, re-resolving the fixing through fx's own freshness
// gate and stamping a fresh computedAt, regardless of cache validity (R28).
//
// Uncaptured records (R34): a record whose kind is not `captured` carries no
// modelId and no tokens by contract (docs/usage-record-format.md ->
// Uncaptured), so priceRecord() never hands it to model-id resolution. The
// guard sits here, at the caller, not in resolve.js: R34 counts `uncaptured`
// and `unpriced` as two SEPARATE tallies, and a resolver-level guard would
// silently fold the former into the latter. Such a record gets a non-stored
// marker instead — `uncaptured: true`, `amount: null`, never `unpriced`,
// never a numeric zero — and nothing is written under pricesRoot() for it:
// there is no price to store, and a stored file would later be read back by
// readPrices() as if it were one.

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('../usage-store/layout');
const query = require('../usage-store/query');
const pricelist = require('./pricelist');
const resolveModel = require('./resolve');
const compute = require('./compute');
const copilotModule = require('./copilot');
const fx = require('./fx');

function orgTablePath() {
  return path.resolve(__dirname, '..', '..', '..', 'model-prices.org.json');
}

// loadOrgTable() — ships empty when the org file is absent or malformed, so
// the org override channel is inert by default (spec 0209 R6-R9).
function loadOrgTable() {
  try {
    const raw = fs.readFileSync(orgTablePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { entries: parsed.entries || {}, copilot: parsed.copilot || {} };
  } catch (err) {
    return { entries: {}, copilot: {} };
  }
}

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function isStoredPriceUsable(stored, { currency, pricelistSha }) {
  if (!stored) return false;
  const storedCurrency = (stored.conversion && stored.conversion.currency) || stored.currency || 'USD';
  if (storedCurrency !== currency) return false;
  if (!stored.snapshot || stored.snapshot.sha !== pricelistSha) return false;
  return true;
}

// computePriceObject(record, opts) — the pure computation (no cache read,
// always writes when opts.store !== false). Never call directly for the
// default read-through path; use priceRecord().
async function computePriceObject(record, opts) {
  opts = opts || {};
  const pricelistSnapshot = opts.pricelistSnapshot || pricelist.pinned();
  const org = opts.org || loadOrgTable();
  const currency = opts.currency || 'USD';
  const ctx = opts.ctx || {};

  const computedAt = new Date().toISOString();
  const computationDate = computedAt.slice(0, 10);
  const cli = record.provenance.cli;

  let resolution;
  let unpriced = false;
  let amountUsd = 0;
  let breakdown = { unpricedComponents: [], underEstimate: [] };
  let copilotInfo = null;

  if (cli === 'copilot-cli') {
    const firstParty = copilotModule.firstPartyCopilot(record, org);
    if (firstParty) {
      amountUsd = firstParty.amountUsd;
      resolution = { step: 'copilot-first-party' };
      copilotInfo = { firstParty: true, source: firstParty.source };
    }
  }

  if (!resolution) {
    const resolved = resolveModel.resolve(record.modelId, { pricelist: pricelistSnapshot, org });
    if (resolved.unpriced) {
      unpriced = true;
      resolution = { step: resolved.step, reason: resolved.reason };
    } else {
      resolution = { step: resolved.step, entryKey: resolved.entryKey, family: resolved.family };
      // R4: the primary source's own per-entry source URL, when it declares
      // one for the resolved entry — absent (never fabricated) otherwise.
      const sourceUrl = pricelist.entryUrl(resolved.entry);
      if (sourceUrl) resolution.sourceUrl = sourceUrl;
      const computed = compute.computeUsd(record, resolved.entry);
      amountUsd = computed.amountUsd;
      breakdown = computed;
      if (cli === 'copilot-cli' && copilotModule.legacyPlanCaveat(org)) {
        copilotInfo = { legacyPlanReference: true, caveat: 'legacy-plan-reference-price' };
      }
    }
  }

  const price = {
    recordId: record.recordId,
    cli,
    modelId: record.modelId,
    snapshot: { sha: pricelistSnapshot.sha, etag: pricelistSnapshot.etag || null, fetchedAt: pricelistSnapshot.fetchedAt },
    fixingDate: null,
    computedAt,
    resolution,
    amountUsd: unpriced ? null : amountUsd,
    amount: unpriced ? null : amountUsd,
    currency: 'USD',
    conversion: { status: 'ok', currency: 'USD' },
    unpricedComponents: breakdown.unpricedComponents || [],
    underEstimate: breakdown.underEstimate || [],
    disclaimer: 'reference figure, not an invoice',
  };
  if (unpriced) {
    price.unpriced = true;
    price.conversion = { status: 'not-applicable' };
  } else if (currency !== 'USD') {
    const converted = await fx.convert(amountUsd, currency, computationDate, ctx);
    price.amount = converted.amount;
    price.currency = currency;
    price.conversion = converted.conversion;
    price.fixingDate = converted.conversion.fixingDate || null;
    if (converted.fxStaleness) price.fxStaleness = converted.fxStaleness;
  }
  if (breakdown.regionalUpliftAvailable) price.regionalUpliftAvailable = breakdown.regionalUpliftAvailable;
  if (copilotInfo) price.copilot = copilotInfo;
  if (resolution.family) price.priceLabel = `~${resolution.entryKey}`;

  return price;
}

// uncapturedMarker(record, currency) — the non-stored R34 marker a record of
// kind `uncaptured` receives in place of a price (see the file-top note):
// field names match a priced object's, with no amount, no snapshot and no
// timestamps, because nothing was computed.
function uncapturedMarker(record, currency) {
  return {
    recordId: record.recordId,
    cli: record.provenance.cli,
    kind: 'uncaptured',
    uncaptured: true,
    amount: null,
    amountUsd: null,
    currency,
    resolution: { step: 'uncaptured' },
    disclaimer: 'reference figure, not an invoice',
  };
}

// priceRecord(record, opts) — the read-through entry point every caller
// (the CLI, rollup.js) uses. opts: {currency, asOfToday, store, ctx,
// pricelistSnapshot, org}. A record whose kind is not `captured` returns
// uncapturedMarker() before any cache read, resolution or write (R34).
async function priceRecord(record, opts) {
  opts = opts || {};
  const currency = opts.currency || 'USD';
  if (record.kind !== 'captured') return uncapturedMarker(record, currency);
  const asOfToday = !!opts.asOfToday;
  const doStore = opts.store !== false;
  const pricelistSnapshot = opts.pricelistSnapshot || pricelist.pinned();
  const org = opts.org || loadOrgTable();

  const cli = record.provenance.cli;
  const per = layout.period(record);
  const filePath = layout.priceEntry(cli, per, record.recordId);

  if (!asOfToday && fs.existsSync(filePath)) {
    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      stored = null;
    }
    if (isStoredPriceUsable(stored, { currency, pricelistSha: pricelistSnapshot.sha })) {
      return stored;
    }
  }

  const price = await computePriceObject(record, { ...opts, pricelistSnapshot, org, currency });
  if (doStore) atomicWriteJson(filePath, price);
  return price;
}

// priceSelector(selector, opts) — computes (and by default stores) a price
// for every record the selector matches (0207's own read surface); an
// uncaptured record yields its non-stored marker in the same position (R34).
async function priceSelector(selector, opts) {
  const records = query.run(selector);
  const results = [];
  for (const record of records) {
    results.push(await priceRecord(record, opts));
  }
  return results;
}

// readPrices(selector) — a PURE read of already-stored prices for the
// selector's matching records; never computes, never writes. The shape
// seam (f) (#1173) consumes.
function readPrices(selector) {
  const records = query.run(selector);
  const prices = [];
  for (const record of records) {
    const cli = record.provenance.cli;
    const per = layout.period(record);
    const filePath = layout.priceEntry(cli, per, record.recordId);
    if (fs.existsSync(filePath)) {
      try {
        prices.push(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch (err) {
        // a partially-written or corrupt file — skip rather than throw.
      }
    }
  }
  return prices;
}

module.exports = {
  loadOrgTable,
  orgTablePath,
  computePriceObject,
  priceRecord,
  priceSelector,
  readPrices,
};
