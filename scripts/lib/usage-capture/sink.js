// sink.js — the spec 0207 storage boundary, and the only thing spec 0206
// ships on the storage side (PLAN v3 step 2). `submit(record)` is a PURE
// INTERFACE: spec 0207 / issue #1170 owns whatever backend eventually sits
// behind it. Until 0207 merges, it resolves to spool.js (step 3) — a
// drain-only buffer, never a storage backend, write format or retention
// policy (R25).
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
const spool = require('./spool');

const VALID_STATUSES = new Set(['stored', 'duplicate', 'rejected']);

function submit(record) {
  const shape = assertRecordShape(record);
  if (!shape.ok) {
    return { status: 'rejected', reason: shape.reason };
  }

  const result = spool.submit(record);
  if (!VALID_STATUSES.has(result.status)) {
    // A backend that returns a fourth status is a programming error in this
    // module tree, not a runtime condition to swallow silently.
    throw new Error(`sink.submit: backend returned an unrecognized status: ${result.status}`);
  }
  return result;
}

module.exports = { submit };
