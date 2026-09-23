// source.js — the dashboard's one read of the journal (spec 0210 R1/R21;
// PLAN v2 D7, step 4). Reads only through 0207's query.run(); layout.js
// supplies the journal root and the entry-name predicate, never a path this
// module then opens as a record.
//
// query.run() honours only the first selector of its if/else chain, so one
// primary run() is issued and every other selection predicate is an AND
// post-filter. Placement predicates are never applied here (D4).
//
// 1. A walking selector (--session, --agent+--parent, --task-key, --asset, in
//    that priority) already reads every partition: one run(), no widening.
// 2. Otherwise the months are the sorted union of journalRoot()/<cli>/<YYYY-MM>
//    names, each read with run({period, cli?}). Months before month(lower)
//    are skipped: a record sits in its own requestInstant month, and an
//    earlier record can never be the last snapshot of a session that has an
//    in-range one. Past month(upper), only captured session-cumulative
//    records of sessions touched in range are kept — the only later records
//    that can supersede an in-range snapshot — up to the newest month.

'use strict';

const fs = require('fs');
const path = require('path');

const query = require('../usage-store/query');
const layout = require('../usage-store/layout');
const filtersMod = require('./filters');
const buckets = require('./buckets');

const MONTH_RE = /^\d{4}-\d{2}$/;

function readdir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
}

// scanStore() -> {months, hasEntries}. hasEntries tests for a real journal
// entry, not for a month directory: usage-prune.sh removes the entries of a
// period but leaves its empty partition directory behind (v2-F2).
function scanStore() {
  const root = layout.journalRoot();
  const months = new Set();
  let hasEntries = false;
  for (const cli of readdir(root)) {
    for (const per of readdir(path.join(root, cli))) {
      if (!MONTH_RE.test(per)) continue;
      months.add(per);
      if (!hasEntries && readdir(path.join(root, cli, per)).some((n) => layout.isEntry(n))) {
        hasEntries = true;
      }
    }
  }
  return { months: Array.from(months).sort(), hasEntries };
}

function walkingSelector(sel) {
  if (sel.session) return { session: sel.session };
  if (sel.agent) return { agent: sel.agent, parent: sel.parent };
  if (sel.taskKey) return { taskKey: sel.taskKey };
  if (sel.asset) return { asset: sel.asset };
  return null;
}

function isSessionCumulative(r) {
  return r.kind === 'captured' && r.fidelity === 'session-cumulative';
}

// read(filters) -> {records, monthsInStore, storeHasEntries}. Records are
// sorted by recordId so every subset a grouping takes sums in one order.
function read(filters) {
  const sel = filters.selection || {};
  const pred = filtersMod.selectionPredicate(sel);
  const base = sel.noLedger ? { noLedger: true } : {};
  const store = scanStore();
  let records = [];

  const walking = walkingSelector(sel);
  if (walking) {
    records = query.run({ ...walking, ...base }).filter(pred);
  } else {
    const { lower, upper } = filtersMod.placementBounds(filters.placement);
    const lowerMonth = lower ? lower.slice(0, 7) : null;
    const upperMonth = upper ? upper.slice(0, 7) : null;
    const inRange = (r) => {
      const day = buckets.dayKey(r.timing.requestInstant);
      return (!lower || day >= lower) && (!upper || day <= upper);
    };
    const touched = new Set();

    for (const month of store.months) {
      if (lowerMonth && month < lowerMonth) continue;
      if (upperMonth && month > upperMonth && touched.size === 0) break;
      const got = query.run({ period: month, cli: sel.cli, ...base }).filter(pred);
      if (!upperMonth || month <= upperMonth) {
        for (const r of got) {
          records.push(r);
          if (isSessionCumulative(r) && inRange(r)) touched.add(r.identity.sessionId);
        }
      } else {
        for (const r of got) {
          if (isSessionCumulative(r) && touched.has(r.identity.sessionId)) records.push(r);
        }
      }
    }
  }

  records.sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0));
  return { records, monthsInStore: store.months, storeHasEntries: store.hasEntries };
}

module.exports = { read, scanStore };
