// source.js — the dashboard's one read of the journal (spec 0210 R1/R21;
// PLAN v2 D7, step 4). Reads only through 0207's query module (run() and
// readWindow(), which itself reads through run()); layout.js
// supplies the journal root and the entry-name predicate, never a path this
// module then opens as a record.
//
// query.run() honours only the first selector of its if/else chain, so one
// primary run() is issued and every other selection predicate is an AND
// post-filter. Placement predicates are never applied here (D4).
//
// 1. A walking selector (--session, --agent+--parent, --task-key, --asset, in
//    that priority) already reads every partition: one run(), no widening.
// 2. Otherwise the records are query.readWindow()'s over the store's months
//    (the sorted union of journalRoot()/<cli>/<YYYY-MM> names), from
//    month(lower) to month(upper) plus the later captured session-cumulative
//    records of sessions touched in range. The period rollups of
//    usage:query and usage:price read the same window (spec 0209 delta-01),
//    so the dashboard and both commands share one lookahead.

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

function byRecordId(a, b) {
  return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0;
}

// readSubordinates(sel, months, base) — for a --session S selection, the
// records of S's subordinate agents: they carry their own sessionId with
// parentSessionId = S, so query.run({session}) never returns them. Every
// other selection predicate still applies. They feed the drill-down only
// (spec 0210 R6), never the selection's totals.
function readSubordinates(sel, months, base) {
  const rest = filtersMod.selectionPredicate({ ...sel, session: undefined });
  const out = [];
  for (const month of months) {
    for (const r of query.run({ period: month, cli: sel.cli, ...base })) {
      if (r.identity.parentSessionId === sel.session && rest(r)) out.push(r);
    }
  }
  return out.sort(byRecordId);
}

// read(filters) -> {records, subordinates, monthsInStore, storeHasEntries}.
// Records are sorted by recordId so every subset a grouping takes sums in
// one order.
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
    records = query.readWindow({
      fromMonth: lowerMonth,
      toMonth: upperMonth,
      inRange,
      admit: pred,
      cli: sel.cli,
      noLedger: sel.noLedger,
      months: store.months,
    });
  }

  records.sort(byRecordId);
  const subordinates = sel.session ? readSubordinates(sel, store.months, base) : [];
  return { records, subordinates, monthsInStore: store.months, storeHasEntries: store.hasEntries };
}

module.exports = { read, scanStore };
