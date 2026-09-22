// rollup.js — R20-R24's per-fidelity rollup (spec 0208 PLAN v3 step 7), and
// the module issue #1172 imports. Exports lastSnapshots() and
// contributingRecords() in the order that seam needs them.

'use strict';

const FIDELITIES = ['per-request', 'run-total', 'session-cumulative'];

function isLaterSnapshot(a, b) {
  if (a.timing.requestInstant !== b.timing.requestInstant) {
    return a.timing.requestInstant > b.timing.requestInstant;
  }
  if (a.timing.captureInstant !== b.timing.captureInstant) {
    return a.timing.captureInstant > b.timing.captureInstant;
  }
  return a.recordId > b.recordId;
}

// lastSnapshots(records) — for fidelity 'session-cumulative', one record per
// identity.sessionId: the last by timing.requestInstant, ties broken by
// timing.captureInstant then recordId (R22 — no delta is ever derived,
// because the earlier snapshots never enter the bucket).
function lastSnapshots(records) {
  const bySession = new Map();
  for (const r of records) {
    if (r.fidelity !== 'session-cumulative') continue;
    const sessionId = r.identity.sessionId;
    const current = bySession.get(sessionId);
    if (!current || isLaterSnapshot(r, current)) {
      bySession.set(sessionId, r);
    }
  }
  return Array.from(bySession.values());
}

// contributingRecords(records) -> { byFidelity: {...}, uncaptured: [] }.
// `kind: 'captured'` only ever lands in the fidelity buckets; every
// `uncaptured` record lands in its own bucket, counted but never summed.
function contributingRecords(records) {
  const captured = records.filter((r) => r.kind === 'captured');
  const uncaptured = records.filter((r) => r.kind !== 'captured');

  const byFidelity = {
    'per-request': captured.filter((r) => r.fidelity === 'per-request'),
    'run-total': captured.filter((r) => r.fidelity === 'run-total'),
    'session-cumulative': lastSnapshots(captured),
  };

  return { byFidelity, uncaptured };
}

// sumTokens(records) — the five token classes summed across `records`.
// cacheWrite sums to a number, unless any record's cacheWrite is a per-tier
// map, in which case the bucket sums per tier and cacheWriteTiered is true
// (a plain-number contribution folds into an 'untiered' tier so no class is
// silently dropped when records mix shapes).
function sumTokens(records) {
  const sum = { netInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  let tiered = false;
  const tierSums = {};
  let untieredCacheWrite = 0;

  for (const r of records) {
    const t = (r && r.tokens) || {};
    sum.netInput += t.netInput || 0;
    sum.cacheRead += t.cacheRead || 0;
    sum.output += t.output || 0;
    sum.reasoning += t.reasoning || 0;
    if (t.cacheWrite && typeof t.cacheWrite === 'object') {
      tiered = true;
      for (const [tier, v] of Object.entries(t.cacheWrite)) {
        tierSums[tier] = (tierSums[tier] || 0) + (v || 0);
      }
    } else {
      untieredCacheWrite += t.cacheWrite || 0;
    }
  }

  if (tiered) {
    if (untieredCacheWrite > 0) tierSums.untiered = (tierSums.untiered || 0) + untieredCacheWrite;
    sum.cacheWrite = tierSums;
  } else {
    sum.cacheWrite = untieredCacheWrite;
  }
  sum.cacheWriteTiered = tiered;

  return sum;
}

// rollup(records, {combined}) — byFidelity's three sums always; combined
// present only when requested and only carrying mixed: [<every fidelity it
// combines>] (R21); uncapturedCount always present, zero included, never
// folded into a token sum (R24).
function rollup(records, opts) {
  opts = opts || {};
  const { byFidelity, uncaptured } = contributingRecords(records);

  const result = {
    byFidelity: {
      'per-request': sumTokens(byFidelity['per-request']),
      'run-total': sumTokens(byFidelity['run-total']),
      'session-cumulative': sumTokens(byFidelity['session-cumulative']),
    },
    uncapturedCount: uncaptured.length,
  };

  if (opts.combined) {
    const mixed = FIDELITIES.filter((f) => byFidelity[f].length > 0);
    const combinedRecords = mixed.flatMap((f) => byFidelity[f]);
    const combined = sumTokens(combinedRecords);
    combined.mixed = mixed;
    result.combined = combined;
  }

  return result;
}

module.exports = { lastSnapshots, contributingRecords, sumTokens, rollup };
