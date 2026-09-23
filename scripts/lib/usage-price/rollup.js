// rollup.js — R30, R32-R34's per-fidelity price rollup (PLAN v2 step 8).
// Imports contributingRecords() and lastSnapshots() from spec 0208's own
// scripts/lib/usage-store/rollup.js — NEVER its rollup() — so 0208 keeps
// owning which records contribute at which fidelity and this module owns
// only the number it computes from them (spec 0209 "Out of scope", bullet
// 2). The tie-break for session-cumulative's last snapshot is not restated
// here; it lives in 0208's module, and restating it is how two trees drift
// apart.

'use strict';

const query = require('../usage-store/query');
const storageRollup = require('../usage-store/rollup');
const pricelist = require('./pricelist');
const store = require('./store');

const FIDELITIES = ['per-request', 'run-total', 'session-cumulative'];

// rollup(selector, opts) — reads PINNED.json ONCE at entry and threads that
// ONE snapshot through every per-record computation (R30): a stored price
// whose snapshot.sha differs is recomputed, never summed — store.
// priceRecord()'s own cache-validity check is what makes this true rather
// than merely asserted. Sums each fidelity bucket; emits a combined total
// only when opts.combined, carrying `mixed: [<every fidelity combined>]`
// (R33); `uncaptured` and `unpriced` are two separate tallies, neither
// contributing a zero to any total (R34).
async function rollup(selector, opts) {
  opts = opts || {};
  const records = query.run(selector);
  const { byFidelity, uncaptured } = storageRollup.contributingRecords(records);

  const pricelistSnapshot = opts.pricelistSnapshot || pricelist.pinned();
  const org = opts.org || store.loadOrgTable();
  const currency = opts.currency || 'USD';

  async function priceBucket(bucketRecords) {
    let sum = 0;
    let unpricedCount = 0;
    for (const record of bucketRecords) {
      const price = await store.priceRecord(record, { ...opts, pricelistSnapshot, org, currency });
      if (price.unpriced) {
        unpricedCount += 1;
      } else {
        sum += price.amount;
      }
    }
    return { sum, unpricedCount, count: bucketRecords.length };
  }

  const result = {
    snapshot: { sha: pricelistSnapshot.sha },
    currency,
    byFidelity: {
      'per-request': await priceBucket(byFidelity['per-request']),
      'run-total': await priceBucket(byFidelity['run-total']),
      'session-cumulative': await priceBucket(byFidelity['session-cumulative']),
    },
    uncapturedCount: uncaptured.length,
    disclaimer: 'reference figure, not an invoice',
  };

  if (opts.combined) {
    const mixed = FIDELITIES.filter((f) => result.byFidelity[f].count > 0);
    const sum = mixed.reduce((acc, f) => acc + result.byFidelity[f].sum, 0);
    const unpricedCount = mixed.reduce((acc, f) => acc + result.byFidelity[f].unpricedCount, 0);
    result.combined = { sum, unpricedCount, mixed };
  }

  return result;
}

module.exports = { rollup };
