// layout.js — the path algebra for the usage-store storage contract (spec
// 0207 PLAN v3 step 1), and the only module in this tree that knows the
// on-disk shape. Every other module reaches a path through this file rather
// than joining path segments itself.
//
// This layout departs from the spec's own informative one (spec
// 0207-usage-record-storage.md, "Storage layout (informative)", l. 292-294 —
// non-normative) for two reasons: the informative layout's `.state/`
// directory collides with the directory spec 0206's capture step already
// owns (`usageRoot()/state/<cli>/`, read/written by record.js and
// backfill.js — never touched by this module tree, entry criterion 2), and
// the filesystem-primitive design this ticket uses (one immutable file per
// record, linked into place) discharges R2/R26 without an index or a scan,
// which an appended JSONL file cannot.
//
// `resolveRoot()` honours CREWRIG_USAGE_ROOT (R9's "overridable by the
// adopting organization") and MUST be the only place in this module tree
// that reads that variable.

'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');

function resolveRoot() {
  return process.env.CREWRIG_USAGE_ROOT || path.join(os.homedir(), '.crewrig', 'usage');
}

// --- Journal -----------------------------------------------------------------

function journalRoot() {
  return path.join(resolveRoot(), 'journal');
}

function partitionDir(cli, period) {
  return path.join(journalRoot(), cli, period);
}

function journalEntry(cli, period, recordId) {
  return path.join(partitionDir(cli, period), `${recordId}.json`);
}

// The sidecar (PLAN v3-F1's remedy): the wing a record resolved to at write
// time, durable and beside its entry — never re-derived by a later mirror
// path.
function wingSidecar(cli, period, recordId) {
  return path.join(partitionDir(cli, period), `${recordId}.wing.json`);
}

// Anchored on the schema's own recordId pattern
// (schemas/usage-record/v1.schema.json l. 22, `^[0-9a-f]{64}$`), so an entry
// and its sidecar are disjoint by construction — a sidecar's name also ends
// in `.json` and must never be read back as a record.
const ENTRY_RE = /^[0-9a-f]{64}\.json$/;
const WING_SIDECAR_RE = /^[0-9a-f]{64}\.wing\.json$/;

function isEntry(name) {
  return ENTRY_RE.test(name);
}

function isWingSidecar(name) {
  return WING_SIDECAR_RE.test(name);
}

function entryToRecordId(name) {
  return name.slice(0, name.length - '.json'.length);
}

// The attribution sidecar (spec 0208 PLAN v3 step 1): the channel a record
// resolved through at write time, durable and beside its entry, never
// re-derived. Disjoint from ENTRY_RE and WING_SIDECAR_RE by the same
// argument as the wing sidecar — the schema's recordId pattern plus a
// distinct suffix.
function attributionSidecar(cli, period, recordId) {
  return path.join(partitionDir(cli, period), `${recordId}.attr.json`);
}

const ATTR_SIDECAR_RE = /^[0-9a-f]{64}\.attr\.json$/;

function isAttributionSidecar(name) {
  return ATTR_SIDECAR_RE.test(name);
}

// period(record) — the UTC YYYY-MM of timing.requestInstant, NEVER
// captureInstant: a backfill run today over an August request must land in
// August, or a prune of August leaves it behind (R19).
function period(record) {
  const d = new Date(record.timing.requestInstant);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// --- Declarations (spec 0208 PLAN v3 step 1) --------------------------------
// Hashed-key idiom wingMemo() already uses (l. 112-115 below), so a session
// id or a checkout root carrying '/' or ':' cannot escape the directory.

function declarationsDir() {
  return path.join(resolveRoot(), 'declarations');
}

function sessionDeclaration(sessionId) {
  const key = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  return path.join(declarationsDir(), 'session', `${key}.json`);
}

function projectDeclaration(checkoutRoot) {
  const key = crypto.createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 24);
  return path.join(declarationsDir(), 'project', `${key}.json`);
}

// --- Attribution ledger (spec 0208 PLAN v3 step 1) --------------------------

function ledgerRoot() {
  return path.join(resolveRoot(), 'ledger');
}

function ledgerPeriodDir(per) {
  return path.join(ledgerRoot(), per);
}

function ledgerEntry(per, entryId) {
  return path.join(ledgerPeriodDir(per), `${entryId}.json`);
}

const LEDGER_ENTRY_RE = /^[0-9a-f]{64}\.json$/;

function isLedgerEntry(name) {
  return LEDGER_ENTRY_RE.test(name);
}

// --- Price store (spec 0209 PLAN v2 step 7) ---------------------------------
// Mirrors journalEntry()'s own shape: <root>/prices/<cli>/<YYYY-MM>/, so the
// period-scoped prune that already walks journal/<cli>/<YYYY-MM>/ reaches
// the price partition at the same granularity via derivedStores() below.

function pricesRoot() {
  return path.join(resolveRoot(), 'prices');
}

function pricePartitionDir(cli, per) {
  return path.join(pricesRoot(), cli, per);
}

function priceEntry(cli, per, recordId) {
  return path.join(pricePartitionDir(cli, per), `${recordId}.price.json`);
}

// Disjoint from ENTRY_RE, WING_SIDECAR_RE and ATTR_SIDECAR_RE by the same
// argument those carry: the schema's recordId pattern plus a distinct
// suffix no other file in a journal or price partition uses.
const PRICE_ENTRY_RE = /^[0-9a-f]{64}\.price\.json$/;

function isPriceEntry(name) {
  return PRICE_ENTRY_RE.test(name);
}

function pricelistDir() {
  return path.join(resolveRoot(), 'pricelist');
}

function pinnedPointer() {
  return path.join(pricelistDir(), 'PINNED.json');
}

function fxDir() {
  return path.join(resolveRoot(), 'fx');
}

// derivedStores() — the registry spec 0207 delta-01 R28 removal walks. One
// key name, arity dispatched by `scope`: dirFor(period) for scope 'period',
// dirFor(cli, period) for scope 'cli-period' (handshake:
// https://github.com/crewrig/crewrig/issues/1172#issuecomment-5774287936).
// DEV 0208 (#1171) registered the ledger; this ticket (#1172) appends the
// price store as a second member — an append, not a redeclaration.
function derivedStores() {
  return [
    {
      id: 'attribution-ledger',
      scope: 'period',
      dirFor: (per) => ledgerPeriodDir(per),
      isEntry: isLedgerEntry,
    },
    {
      id: 'price-store',
      scope: 'cli-period',
      dirFor: (cli, per) => pricePartitionDir(cli, per),
      isEntry: isPriceEntry,
    },
  ];
}

// --- Mirror --------------------------------------------------------------

function mirrorDir() {
  return path.join(resolveRoot(), 'mirror');
}

function mirrorPendingRoot() {
  return path.join(mirrorDir(), 'pending');
}

function mirrorMirroredRoot() {
  return path.join(mirrorDir(), 'mirrored');
}

function pendingMarker(cli, per, recordId) {
  return path.join(mirrorPendingRoot(), cli, per, recordId);
}

function mirroredMarker(cli, per, recordId) {
  return path.join(mirrorMirroredRoot(), cli, per, recordId);
}

function unreachableStamp() {
  return path.join(mirrorDir(), 'unreachable.stamp');
}

// --- Cache (disposable — v2-F1's move out from under mirror/) ------------

function cacheDir() {
  return path.join(resolveRoot(), 'cache');
}

function wingMemo(projectRoot) {
  const key = crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 24);
  return path.join(cacheDir(), 'wings', `${key}.json`);
}

// --- Pruned periods --------------------------------------------------------

function prunedDir() {
  return path.join(resolveRoot(), 'pruned');
}

function prunedMarker(cli, per) {
  return path.join(prunedDir(), cli, `${per}.json`);
}

// --- Locks, temp, spool (0206-owned) ---------------------------------------

function lockPath(name) {
  return path.join(resolveRoot(), 'locks', `${name}.lock`);
}

function tmpDir() {
  return path.join(resolveRoot(), 'tmp');
}

// spoolDir() — 0206-owned (scripts/lib/usage-capture/spool.js), drained by
// journal.js's drainAndSweep() and removed once step 5 lands. Same
// CREWRIG_USAGE_ROOT-relative resolution spool.js's own usageRoot() uses.
function spoolDir() {
  return path.join(resolveRoot(), 'spool');
}

// spool.js's own temp naming (0206, `.${recordId}.${pid}.${Date.now()}.tmp`)
// — a crash between its write and its linkSync strands one of these inside
// spool/, which this ticket owns the sweep of.
const SPOOL_STRAY_RE = /^\.[0-9a-f]{64}\.\d+\.\d+\.tmp$/;

function isSpoolStray(name) {
  return SPOOL_STRAY_RE.test(name);
}

// stateDir() is exported and called by NO code path in this module tree
// (entry criterion 2) — named here only so a caller that needs to assert
// "we never touch it" has a canonical path to assert against.
function stateDir() {
  return path.join(resolveRoot(), 'state');
}

module.exports = {
  resolveRoot,
  journalRoot,
  partitionDir,
  journalEntry,
  wingSidecar,
  attributionSidecar,
  isEntry,
  isWingSidecar,
  isAttributionSidecar,
  entryToRecordId,
  period,
  declarationsDir,
  sessionDeclaration,
  projectDeclaration,
  ledgerRoot,
  ledgerPeriodDir,
  ledgerEntry,
  isLedgerEntry,
  pricesRoot,
  pricePartitionDir,
  priceEntry,
  isPriceEntry,
  pricelistDir,
  pinnedPointer,
  fxDir,
  derivedStores,
  mirrorDir,
  mirrorPendingRoot,
  mirrorMirroredRoot,
  pendingMarker,
  mirroredMarker,
  unreachableStamp,
  cacheDir,
  wingMemo,
  prunedDir,
  prunedMarker,
  lockPath,
  tmpDir,
  spoolDir,
  isSpoolStray,
  stateDir,
};
