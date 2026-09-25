// model.js — the one view model of the usage dashboard (spec 0210 R1-R8;
// PLAN v2 D1-D5, D7, step 5). Every figure any delivery form shows is
// computed here, once per invocation (per request for form B); the
// renderers only format. group() is the only code in this tree that adds
// numbers, and its token sums come only from 0208's sumTokens().
//
// Placement rule (D4): ONE contributingRecords() pass runs over the
// selection, and only then is each contributing or uncaptured record placed
// by its own requestInstant (and modelId). A session-cumulative session
// therefore counts once, in full, where its last snapshot falls — in every
// bucket, date filter and --period view alike.
//
// tasks[] and assets[] keep 0208's own semantics: one pass per key over the
// selection's records attributed to that key, because attribution can
// differ between records of one session (a ledger {period} entry matches
// month by month — scopeMatchesRecord, scripts/lib/usage-store/ledger.js
// l. 153-162, the period branch at l. 161).

'use strict';

const fs = require('fs');

const layout = require('../usage-store/layout');
const storageRollup = require('../usage-store/rollup');
const pricelist = require('../usage-price/pricelist');
const priceStore = require('../usage-price/store');
const filtersMod = require('./filters');
const buckets = require('./buckets');
const source = require('./source');

const SCHEMA = 'crewrig.usage-dashboard.view/1';
const DISCLAIMER = 'reference figure, not an invoice';
const FIDELITIES = ['per-request', 'run-total', 'session-cumulative'];

function byRecordId(a, b) {
  return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0;
}

// D3's partition of a contributing captured record's price — spec 0209's own
// store.classifyPrice(), the one rule its period rollup also counts by, so the
// two surfaces agree by construction (spec 0209 delta-02 R47).
const classify = priceStore.classifyPrice;

function passAndPlace(records, place) {
  const { byFidelity, uncaptured } = storageRollup.contributingRecords(records);
  const contributing = FIDELITIES.flatMap((f) => byFidelity[f]).filter(place).sort(byRecordId);
  return { contributing, uncaptured: uncaptured.filter(place).sort(byRecordId) };
}

function range(values) {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function emptyPriceTallies(absent) {
  const out = { amount: null, pricedCount: 0, unpricedCount: 0, unconvertedCount: 0 };
  if (absent) out.absent = absent;
  return out;
}

function priceGroup(byF, mixed, ctx) {
  const { pricing, prices } = ctx;
  const currency = pricing.currency;

  if (!pricing.available) {
    const byFidelity = {};
    for (const f of FIDELITIES) byFidelity[f] = emptyPriceTallies('no-pinned-pricelist');
    return {
      amount: null,
      absent: 'no-pinned-pricelist',
      currency,
      pricedCount: 0,
      unpricedCount: 0,
      unconvertedCount: 0,
      byFidelity,
      mixed,
      timestamps: { snapshotSha: null, snapshotFetchedAt: null, fixingDate: null, computedAt: null },
      disclaimer: DISCLAIMER,
    };
  }

  const byFidelity = {};
  const fixingDates = [];
  const computedAts = [];
  let pricedCount = 0;
  let unpricedCount = 0;
  let unconvertedCount = 0;

  for (const f of FIDELITIES) {
    const entry = { amount: null, pricedCount: 0, unpricedCount: 0, unconvertedCount: 0 };
    let sum = 0;
    for (const r of byF[f]) {
      const p = prices.get(r.recordId);
      const cls = classify(p);
      if (cls === 'priced') {
        entry.pricedCount += 1;
        sum += p.amount;
      } else if (cls === 'unpriced') {
        entry.unpricedCount += 1;
      } else {
        entry.unconvertedCount += 1;
      }
      if (p.fixingDate) fixingDates.push(p.fixingDate);
      if (p.computedAt) computedAts.push(p.computedAt);
    }
    if (entry.pricedCount > 0) {
      entry.amount = sum;
    } else {
      entry.absent = entry.unconvertedCount > 0 ? 'no-converted-price' : 'no-priced-record';
    }
    pricedCount += entry.pricedCount;
    unpricedCount += entry.unpricedCount;
    unconvertedCount += entry.unconvertedCount;
    byFidelity[f] = entry;
  }

  const out = { amount: null };
  if (pricedCount > 0) {
    // Summed per fidelity in FIDELITIES order, as 0209's combined total is.
    let amount = 0;
    for (const f of FIDELITIES) {
      if (byFidelity[f].amount !== null) amount += byFidelity[f].amount;
    }
    out.amount = amount;
  } else {
    out.absent = unconvertedCount > 0 ? 'no-converted-price' : 'no-priced-record';
  }
  return Object.assign(out, {
    currency,
    pricedCount,
    unpricedCount,
    unconvertedCount,
    byFidelity,
    mixed,
    timestamps: {
      snapshotSha: pricing.snapshot.sha,
      snapshotFetchedAt: pricing.snapshot.fetchedAt,
      fixingDate: range(fixingDates),
      computedAt: range(computedAts),
    },
    disclaimer: DISCLAIMER,
  });
}

// group(records, ctx) — records are already-placed contributing captured
// and uncaptured records. Tallies are never folded into a sum (R8).
function group(records, ctx) {
  const captured = records.filter((r) => r.kind === 'captured');
  const uncaptured = records.filter((r) => r.kind !== 'captured');
  const byF = { 'per-request': [], 'run-total': [], 'session-cumulative': [] };
  for (const r of captured) byF[r.fidelity].push(r);
  const mixed = FIDELITIES.filter((f) => byF[f].length > 0);

  const tokensByFidelity = {};
  for (const f of FIDELITIES) tokensByFidelity[f] = storageRollup.sumTokens(byF[f]);
  const combined = storageRollup.sumTokens(mixed.flatMap((f) => byF[f]));
  combined.mixed = mixed;

  return {
    recordCount: captured.length + uncaptured.length,
    capturedCount: captured.length,
    uncapturedCount: uncaptured.length,
    tokens: { byFidelity: tokensByFidelity, combined },
    price: priceGroup(byF, mixed.slice(), ctx),
  };
}

function placedOf(placement) {
  return placement.contributing.concat(placement.uncaptured).sort(byRecordId);
}

function keyedGroups(records, keyFn, ctx) {
  return buckets.groupBy(records, keyFn).map((e) => ({ key: e.key, ...group(e.records, ctx) }));
}

function buildSessions(placed, ctx) {
  const roots = new Map();
  const agents = new Map();
  const clis = new Map();
  const note = (sid, cli) => {
    if (!clis.has(sid)) clis.set(sid, new Set());
    clis.get(sid).add(cli);
  };
  for (const r of placed) {
    const parent = r.identity.parentSessionId;
    if (parent === null || parent === undefined) {
      const sid = r.identity.sessionId;
      if (!roots.has(sid)) roots.set(sid, []);
      roots.get(sid).push(r);
      note(sid, r.provenance.cli);
    } else {
      if (!agents.has(parent)) agents.set(parent, []);
      agents.get(parent).push(r);
      note(parent, r.provenance.cli);
    }
  }
  const ids = Array.from(new Set([...roots.keys(), ...agents.keys()])).sort(buckets.compareKeys);
  return ids.map((sessionId) => ({
    sessionId,
    cli: Array.from(clis.get(sessionId)).sort().join(','),
    ...group(roots.get(sessionId) || [], ctx),
    agents: buckets
      .groupBy(agents.get(sessionId) || [], (r) => r.identity.agentId || null)
      .map((e) => ({ agentId: e.key, ...group(e.records, ctx) })),
  }));
}

function taskKeyOf(r) {
  return (r.attribution && r.attribution.taskHandoffKey) || null;
}

function assetKeyOf(r) {
  const a = r.attribution && r.attribution.externalAsset;
  return a ? JSON.stringify([a.kind, a.ref]) : null;
}

function perKeyPasses(records, keyFn, place) {
  const keys = Array.from(new Set(records.map(keyFn).filter((k) => k !== null))).sort();
  const out = [];
  for (const key of keys) {
    const placed = placedOf(passAndPlace(records.filter((r) => keyFn(r) === key), place));
    if (placed.length > 0) out.push({ key, placed });
  }
  return out;
}

function loadPricing(currency, asOfToday) {
  const base = { currency, asOfToday, offline: true, disclaimer: DISCLAIMER };
  if (!fs.existsSync(layout.pinnedPointer())) {
    return {
      pricing: { available: false, reason: 'no-pinned-pricelist', hint: 'task usage:price -- --refresh-pricelist', snapshot: null, ...base, fxStaleness: null },
      snapshot: null,
    };
  }
  const snapshot = pricelist.pinned();
  return {
    pricing: {
      available: true,
      snapshot: { sha: snapshot.sha, etag: snapshot.etag || null, fetchedAt: snapshot.fetchedAt },
      ...base,
      fxStaleness: null,
    },
    snapshot,
  };
}

function summariseStaleness(prices) {
  const stale = prices.filter((p) => p.fxStaleness);
  if (stale.length === 0) return null;
  const reasons = Array.from(new Set(stale.map((p) => p.fxStaleness.reason))).sort();
  return {
    reason: reasons.join('+'),
    ageDays: range(stale.map((p) => p.fxStaleness.ageDays)),
    newestCached: range(stale.map((p) => p.fxStaleness.newestCached).filter(Boolean)),
    hint: 'task usage:price -- --refresh-fx',
  };
}

function persistCommand(filters) {
  const s = filters.selection || {};
  const p = filters.placement || {};
  const o = filters.options || {};
  const args = [];
  if (s.session) args.push('--session', s.session);
  else if (s.agent) args.push('--agent', s.agent, '--parent', s.parent);
  else if (s.taskKey) args.push('--task-key', s.taskKey);
  else if (s.asset) args.push('--asset', s.asset);
  else {
    args.push('--period', p.period || '<YYYY-MM>');
    if (s.cli) args.push('--cli', s.cli);
  }
  if (s.fidelity) args.push('--fidelity', s.fidelity);
  if (o.currency && o.currency !== 'USD') args.push('--currency', o.currency);
  args.push('--as-of-today');
  const shell = args.map((a) => (a.startsWith('--') || a === '<YYYY-MM>' ? a : filtersMod.shellQuote(a))).join(' ');
  return `task usage:price -- ${shell}`;
}

function selectionBlock(filters) {
  const o = filters.options || {};
  const argv = filtersMod.toArgv(filters);
  const shell = filtersMod.argvToShell(argv);
  const regenerate = argv.length ? `task usage:dashboard -- ${shell}` : 'task usage:dashboard';
  return {
    filters: { selection: { ...(filters.selection || {}) }, placement: { ...(filters.placement || {}) } },
    args: shell,
    bucket: o.bucket || filtersMod.DEFAULTS.bucket,
    currency: o.currency || filtersMod.DEFAULTS.currency,
    asOfToday: !!o.asOfToday,
    regenerate,
    regenerateAsOfToday: argv.length ? `${regenerate} --as-of-today` : 'task usage:dashboard -- --as-of-today',
    persist: persistCommand(filters),
  };
}

// build(filters, {now}) -> the view model (schema crewrig.usage-dashboard.view/1).
async function build(filters, opts) {
  opts = opts || {};
  // D2: the dashboard never reaches the network; a stale FX cache records
  // fxStaleness.reason "offline" instead of fetching.
  process.env.CREWRIG_USAGE_OFFLINE = '1';

  const now = opts.now || new Date();
  const o = filters.options || {};
  const currency = o.currency || filtersMod.DEFAULTS.currency;
  const asOfToday = !!o.asOfToday;

  const { records, subordinates, storeHasEntries } = source.read(filters);
  const place = filtersMod.placementPredicate(filters.placement);

  const main = placedOf(passAndPlace(records, place));
  const admitted = records.filter(place).length;
  const supersededCount = admitted - main.length;
  // A --session view's drill-down lists the session's subordinate agents
  // exactly as the whole-store view does; they stay out of every other group.
  const agentsOnly = placedOf(passAndPlace(subordinates, place));
  const tasks = perKeyPasses(records, taskKeyOf, place);
  const assets = perKeyPasses(records, assetKeyOf, place);

  const { pricing, snapshot } = loadPricing(currency, asOfToday);
  const prices = new Map();
  if (pricing.available) {
    const org = priceStore.loadOrgTable();
    // One fx memo per build (so per request for form B), never module-level:
    // a re-attempted failed conversion (spec 0209 delta-02 R52) costs one FX
    // resolution per computation date per view, and the next view sees a
    // fixing a later --refresh-fx wrote.
    const fxMemo = new Map();
    const toPrice = [main, agentsOnly, ...tasks.map((t) => t.placed), ...assets.map((a) => a.placed)];
    for (const list of toPrice) {
      for (const r of list) {
        if (r.kind !== 'captured' || prices.has(r.recordId)) continue;
        prices.set(
          r.recordId,
          await priceStore.priceRecord(r, { currency, asOfToday, store: false, pricelistSnapshot: snapshot, org, ctx: { fxMemo } })
        );
      }
    }
    pricing.fxStaleness = summariseStaleness(Array.from(prices.values()));
  }
  const ctx = { pricing, prices };

  let empty = null;
  if (!storeHasEntries) empty = 'store-empty';
  else if (main.length === 0) empty = supersededCount > 0 ? 'superseded-only' : 'no-match';

  return {
    schema: SCHEMA,
    generatedAt: now.toISOString(),
    selection: selectionBlock(filters),
    pricing,
    empty,
    supersededCount,
    totals: group(main, ctx),
    byBucket: {
      day: keyedGroups(main, (r) => buckets.dayKey(r.timing.requestInstant), ctx),
      week: keyedGroups(main, (r) => buckets.isoWeekKey(r.timing.requestInstant), ctx),
      month: keyedGroups(main, (r) => buckets.monthKey(r.timing.requestInstant), ctx),
    },
    byCli: keyedGroups(main, (r) => r.provenance.cli, ctx),
    byModel: keyedGroups(main, (r) => r.modelId || null, ctx),
    sessions: buildSessions(main.concat(agentsOnly), ctx),
    tasks: tasks.map((t) => ({ taskHandoffKey: t.key, ...group(t.placed, ctx) })),
    assets: assets.map((a) => {
      const [kind, ref] = JSON.parse(a.key);
      return { kind, ref, ...group(a.placed, ctx) };
    }),
  };
}

function clone(view) {
  return JSON.parse(JSON.stringify(view));
}

function dropComputedAt(node) {
  if (!node || typeof node !== 'object') return;
  if (node.price && node.price.timestamps) delete node.price.timestamps.computedAt;
  for (const v of Object.values(node)) dropComputedAt(v);
}

// Normalisers for the three-form agreement check (v1-F3).
function NORMALISE_VOLATILE(view) {
  const v = clone(view);
  delete v.generatedAt;
  return v;
}

function NORMALISE_RECOMPUTED(view) {
  const v = NORMALISE_VOLATILE(view);
  dropComputedAt(v);
  return v;
}

module.exports = { SCHEMA, DISCLAIMER, FIDELITIES, build, group, classify, NORMALISE_VOLATILE, NORMALISE_RECOMPUTED };
