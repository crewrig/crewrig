// sink.js — the spec 0207 storage boundary, and the only thing spec 0206
// ships on the storage side (PLAN v3 step 2). `submit(record)` is a PURE
// INTERFACE: spec 0207 / issue #1170 owns whatever backend sits behind it.
// It now resolves to scripts/lib/usage-store/journal.js's write() (PLAN v3
// step 5) — spool.js's drain-only buffer and its hand-over are history.
// journal.js's own drainAndSweep() keeps draining any leftover
// <root>/spool/*.json files on its first write per process, so a machine
// that ran 0206 before this change loses nothing.
//
// The three outcomes below are frozen against spec 0207 R24 and MUST NOT
// grow a fourth without a spec change:
//   stored     the record was durably handed off.
//   duplicate  the same idempotencyKey was already handed off.
//   rejected   the record could not be handed off (this file's own
//              structural precheck, or the backend's own refusal).
//
// assertRecordShape() here is NOT the schema validation spec 0207 R1 owns —
// ajv/ajv-formats are devDependencies, unavailable to a hook's bare `node`
// process — it is the cheapest check that keeps a malformed record out of
// the hand-off. CI (scripts/tests/test-usage-capture.sh) proves it never
// passes a record the merged schema rejects.

'use strict';

const { assertRecordShape } = require('./record');
const journal = require('../usage-store/journal');

const VALID_STATUSES = new Set(['stored', 'duplicate', 'rejected']);

function submit(record, meta) {
  const shape = assertRecordShape(record);
  if (!shape.ok) {
    return { status: 'rejected', reason: shape.reason };
  }

  const result = journal.write(record, meta);
  if (!VALID_STATUSES.has(result.status)) {
    // A backend that returns a fourth status is a programming error in this
    // module tree, not a runtime condition to swallow silently.
    throw new Error(`sink.submit: backend returned an unrecognized status: ${result.status}`);
  }
  return result;
}

module.exports = { submit };
