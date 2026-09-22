// cursor.js — per-source high-water state (PLAN v3 step 4), at
// ~/.crewrig/usage/state/<cli>/<sourceKey>.json (CREWRIG_USAGE_ROOT-relative
// — named edit 2), holding { byteOffset, headDigest, pendingUnitIds,
// maxRowId, lastSnapshotDigest }. A headDigest mismatch (rotation /
// truncation) resets byteOffset to 0 — callers detect the mismatch and
// choose to reset before deriving.
//
// sourceKey(sourcePath) IS THE CANONICAL DERIVATION shared with
// hooks/usage-capture.sh's own `source_key()` bash function (named edit 2):
// sha256 hex digest of the source's own absolute path (or, for a source with
// no path — Copilot's fixed store, a fixed literal), no salt. Keep the two
// definitions in sync; the shim's own comment points back here.
//
// touchStamp() maintains the stamp sidecar hooks/usage-capture.sh's own fast
// path reads: after a successful pass, a zero-byte <sourceKey>.stamp is set
// to the SOURCE's own mtime, so a pure-bash `-nt` test can decide "nothing
// new" without spawning Node and without parsing JSON.
//
// spec 0207's prune-by-period command SHALL NOT touch this directory (see
// spool.js's own header) — resetting a cursor would make the next backfill
// re-derive pruned records (0207 R20).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function usageRoot() {
  return process.env.CREWRIG_USAGE_ROOT || path.join(os.homedir(), '.crewrig', 'usage');
}

function stateDir(cli) {
  return path.join(usageRoot(), 'state', cli);
}

function sourceKey(sourcePath) {
  return crypto.createHash('sha256').update(sourcePath).digest('hex');
}

function cursorPath(cli, sourcePath) {
  return path.join(stateDir(cli), `${sourceKey(sourcePath)}.json`);
}

function stampPath(cli, sourcePath) {
  return path.join(stateDir(cli), `${sourceKey(sourcePath)}.stamp`);
}

function defaultCursor() {
  return { byteOffset: 0, headDigest: null, pendingUnitIds: [], maxRowId: 0, lastSnapshotDigest: null };
}

function readCursor(cli, sourcePath) {
  const file = cursorPath(cli, sourcePath);
  try {
    return { ...defaultCursor(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultCursor();
    }
    throw err;
  }
}

function writeCursor(cli, sourcePath, cursor) {
  const dir = stateDir(cli);
  fs.mkdirSync(dir, { recursive: true });
  const file = cursorPath(cli, sourcePath);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cursor, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// headDigestFor(buffer, length) — a cheap rotation/truncation fingerprint
// over the first `length` bytes of a source, so a cursor can detect the file
// it last read from was replaced rather than appended to.
function headDigestFor(buffer, length) {
  const slice = buffer.subarray(0, Math.min(length, buffer.length));
  return crypto.createHash('sha256').update(slice).digest('hex');
}

function touchStamp(cli, sourcePath, sourceMtimeMs) {
  const dir = stateDir(cli);
  fs.mkdirSync(dir, { recursive: true });
  const file = stampPath(cli, sourcePath);
  if (!fs.existsSync(file)) {
    fs.closeSync(fs.openSync(file, 'w'));
  }
  // Math.ceil, not a bare Date(sourceMtimeMs): a source mtime read from a
  // sub-millisecond-precision filesystem (APFS) carries a fractional
  // millisecond that a `Date` (integer-ms) silently rounds — sometimes
  // DOWN, which would make the stamp compare OLDER than an unchanged
  // source under bash's `-nt`, defeating the fast path on every firing.
  // Rounding UP guarantees the stamp is never older than the source it
  // was just derived from, while staying tight enough that a genuine next
  // write (at least one real filesystem write later) still compares newer.
  const mtime = new Date(Math.ceil(sourceMtimeMs));
  fs.utimesSync(file, mtime, mtime);
}

module.exports = {
  usageRoot,
  stateDir,
  sourceKey,
  cursorPath,
  stampPath,
  defaultCursor,
  readCursor,
  writeCursor,
  headDigestFor,
  touchStamp,
};
