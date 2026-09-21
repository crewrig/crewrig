// spool.js — the default resolution of sink.js's boundary until spec 0207
// merges (PLAN v3 step 3). Explicitly NOT a storage backend: it writes the
// record verbatim to a temp file under ~/.crewrig/usage/spool/
// (CREWRIG_USAGE_ROOT-relative — named edit 2), then fs.linkSync()s it to
// <recordId>.json and unlinks the temp — an atomic create that yields
// `stored` on success and `duplicate` on EEXIST, and never `rejected` (it
// validates nothing; sink.js already ran the only check spec 0206 owns).
//
// It holds no index, no partition scheme, no retention policy and no prune
// ledger. HAND-OVER REQUIREMENT FOR #1170'S PLAN: the spec 0207
// implementation SHALL drain this directory as its FIRST act, before its own
// write path is exercised, deleting each spooled file only after that
// record's journal write returned `stored` or `duplicate`. Once that lands,
// this file is deleted and sink.js re-points at the journal — no adapter,
// hook, cursor or fixture touched.
//
// spec 0207's prune-by-period command SHALL NOT touch
// ~/.crewrig/usage/state/ (cursor.js's own directory) — resetting a cursor
// would make the next backfill re-derive pruned records (0207 R20).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function usageRoot() {
  return process.env.CREWRIG_USAGE_ROOT || path.join(os.homedir(), '.crewrig', 'usage');
}

function spoolDir() {
  return path.join(usageRoot(), 'spool');
}

function submit(record) {
  const dir = spoolDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${record.recordId}.json`);
  const tmp = path.join(dir, `.${record.recordId}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  try {
    fs.linkSync(tmp, target);
    fs.unlinkSync(tmp);
    return { status: 'stored' };
  } catch (err) {
    fs.unlinkSync(tmp);
    if (err.code === 'EEXIST') {
      return { status: 'duplicate' };
    }
    throw err;
  }
}

module.exports = { submit, spoolDir, usageRoot };
