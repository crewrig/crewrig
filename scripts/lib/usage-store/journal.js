// journal.js — write(record) -> {status, reason?}, the storage contract's
// R24 write path (spec 0207 PLAN v3 step 3), plus drainAndSweep() (step 4).
//
// The journal is one immutable entry file per record
// (<root>/journal/<cli>/<YYYY-MM>/<recordId>.json), written to a temp and
// linkSync'ed — never an appended JSONL. O_EXCL link creation IS the
// idempotency check (R2 — no index, no scan, no consistency window); an
// immutable file IS append-only (R3); writers that never share a file
// cannot interleave (R26 — each writer's own link() return is that
// writer's own outcome).
//
// Order, load-bearing: (a) validate, (b) derive cli/period, (c) refuse a
// pruned period, (d) mkdir the partition, (e) link the entry, (e') link the
// sidecar (AFTER the entry — the entry is the record of truth; BEFORE the
// mirror hand-off — every later mirror path consumes the resolved wing
// instead of re-deriving it), (e'') link the attribution sidecar (spec 0208
// PLAN v3 step 5) — runs on stored and duplicate like (e'), before the
// duplicate early return, (f) the mirror hand-off — entered only on
// `stored`, never on `duplicate` or `rejected`.

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('./layout');
const mirror = require('./mirror');
const validateRecord = require('./validator/validate.js');

function envMs(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) return 'schema validation failed';
  return errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

function tmpName(recordId, tag) {
  return path.join(layout.tmpDir(), `.${recordId}.${tag}.${process.pid}.${process.hrtime.bigint()}.tmp`);
}

// writeInner(record, meta) — the 3(a)-3(f) path with NO drainAndSweep()
// call, so drain() (below) can call it directly without re-entering the
// drain lock. `meta` (spec 0208's attribution resolution — {channel,
// outcome, reason, assetReason, attribution}) is optional: undefined skips
// (e'') rather than throwing, since two merged suites call journal.write()
// with one argument.
function writeInner(record, meta) {
  // (a) validate
  const valid = validateRecord(record);
  if (!valid) {
    return { status: 'rejected', reason: formatValidationErrors(validateRecord.errors) };
  }

  // (b) derive cli/period
  const cli = record.provenance.cli;
  const per = layout.period(record);

  // (c) refuse a pruned period unless explicitly overridden
  const prunedPath = layout.prunedMarker(cli, per);
  if (fs.existsSync(prunedPath) && process.env.CREWRIG_USAGE_ALLOW_PRUNED !== '1') {
    return { status: 'rejected', reason: 'period-pruned' };
  }

  // (d) mkdir the partition
  const dir = layout.partitionDir(cli, per);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(layout.tmpDir(), { recursive: true });

  const recordId = record.recordId;
  const entryPath = layout.journalEntry(cli, per, recordId);

  // (e) link the entry — O_EXCL via linkSync is the idempotency check.
  const entryTmp = tmpName(recordId, 'entry');
  fs.writeFileSync(entryTmp, JSON.stringify(record));
  let status;
  try {
    fs.linkSync(entryTmp, entryPath);
    status = 'stored';
  } catch (err) {
    if (err.code !== 'EEXIST') {
      fs.unlinkSync(entryTmp);
      throw err;
    }
    status = 'duplicate';
  }
  fs.unlinkSync(entryTmp);

  // (e') link the sidecar — runs on BOTH stored and duplicate (a sidecar
  // lost to a kill between (e) and (e') is repaired by the next write of
  // the same recordId). Its own EEXIST is likewise not an error.
  const wingInfo = mirror.resolveWing(record.identity.projectRoot);
  const sidecarPath = layout.wingSidecar(cli, per, recordId);
  const sidecarTmp = tmpName(recordId, 'wing');
  fs.writeFileSync(
    sidecarTmp,
    JSON.stringify({
      wing: wingInfo.wing,
      wingDerivation: wingInfo.wingDerivation,
      projectRoot: record.identity.projectRoot,
      resolvedAt: new Date().toISOString(),
    })
  );
  try {
    fs.linkSync(sidecarTmp, sidecarPath);
    fs.unlinkSync(sidecarTmp);
  } catch (err) {
    fs.unlinkSync(sidecarTmp);
    if (err.code !== 'EEXIST') throw err;
  }

  // (e'') link the attribution sidecar — runs on BOTH stored and duplicate,
  // like (e'). meta === undefined skips this step entirely.
  if (meta !== undefined) {
    const attrPath = layout.attributionSidecar(cli, per, recordId);
    const attrTmp = tmpName(recordId, 'attr');
    fs.writeFileSync(
      attrTmp,
      JSON.stringify({
        channel: meta.channel,
        outcome: meta.outcome,
        reason: meta.reason,
        assetReason: meta.assetReason,
        attribution: meta.attribution,
        resolvedAt: new Date().toISOString(),
      })
    );
    try {
      fs.linkSync(attrTmp, attrPath);
      fs.unlinkSync(attrTmp);
    } catch (err) {
      fs.unlinkSync(attrTmp);
      if (err.code !== 'EEXIST') throw err;
    }
  }

  if (status === 'duplicate') {
    return { status: 'duplicate' };
  }

  // (f) the mirror hand-off — entered only on `stored`.
  mirror.onWrite(record, entryPath, wingInfo);
  return { status: 'stored' };
}

// --- drainAndSweep() (step 4) ------------------------------------------

let drainedThisProcess = false;

function tryAcquireLock(lockFile, staleMs) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    fs.closeSync(fs.openSync(lockFile, 'wx'));
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  let age = Infinity;
  try {
    age = Date.now() - fs.statSync(lockFile).mtimeMs;
  } catch (err) {
    return true; // vanished between our openSync and this statSync
  }
  if (age <= staleMs) {
    return false; // a live peer holds it
  }
  try {
    fs.unlinkSync(lockFile);
  } catch (err) {
    // raced away — fine
  }
  try {
    fs.closeSync(fs.openSync(lockFile, 'wx'));
    return true;
  } catch (err) {
    return false; // another process won the retry
  }
}

// drain() — for each spooled record (0206's <recordId>.json layout), run
// the 3(a)-3(f) path and unlink the spooled file ONLY on `stored` or
// `duplicate`. A `rejected` spooled record is left in place — destroying it
// would lose the only copy of a record 0206 already accepted — which is
// what keeps spool/ non-empty and the drain re-running; query.js's
// --undrained surfaces those. Budgeted: stops once
// CREWRIG_USAGE_DRAIN_BUDGET_MS elapses, leaving the rest for the next
// process (0 = unbounded).
function drain() {
  const dir = layout.spoolDir();
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return; // spool absent — steady state
  }

  const budgetMs = envMs('CREWRIG_USAGE_DRAIN_BUDGET_MS', 2000);
  const start = Date.now();

  for (const name of names) {
    if (!layout.isEntry(name)) continue; // dotfile strays are sweep()'s job
    if (budgetMs !== 0 && Date.now() - start >= budgetMs) break;

    const full = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      continue; // unreadable — leave in place, never destroy
    }

    const result = writeInner(record);
    if (result.status === 'stored' || result.status === 'duplicate') {
      try {
        fs.unlinkSync(full);
      } catch (err) {
        // already gone
      }
    }
  }
}

// sweep() — unlink every file under tmpDir() whose mtime is older than
// CREWRIG_USAGE_TMP_STALE_MS (reclaims a temp stranded by a crash between
// (e)'s write and its linkSync, or between (e) and (e')), and the same rule
// over spool/'s own `.${recordId}.${pid}.${ms}.tmp` dotfiles (0206's own
// temp naming — a crash between its write and its linkSync strands one
// inside spool/, which this ticket owns the sweep of). spoolDir()'s removal
// is best-effort: a throw would surface on the hook's path for a
// housekeeping step allowed to fail.
function sweepStale(dir, staleMs, predicate) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!predicate(name)) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      continue;
    }
    if (now - stat.mtimeMs > staleMs) {
      try {
        fs.unlinkSync(full);
      } catch (err) {
        // raced away
      }
    }
  }
}

function sweep() {
  const staleMs = envMs('CREWRIG_USAGE_TMP_STALE_MS', 3600000);
  sweepStale(layout.tmpDir(), staleMs, () => true);
  sweepStale(layout.spoolDir(), staleMs, layout.isSpoolStray);
  try {
    fs.rmdirSync(layout.spoolDir());
  } catch (err) {
    // ENOTEMPTY/ENOENT swallowed — best-effort
  }
}

// drainAndSweep() — invoked by write() before its own write path, once per
// process, single-flighted across processes on locks/drain.lock. A `wx`
// failure whose lock is older than CREWRIG_USAGE_DRAIN_LOCK_STALE_MS is
// reclaimed and retried once; a second failure means a live peer holds it,
// and this process skips the drain and the sweep and proceeds to its own
// write (never blocked — R4).
function drainAndSweep() {
  if (drainedThisProcess) return;
  drainedThisProcess = true;

  const lockFile = layout.lockPath('drain');
  const staleMs = envMs('CREWRIG_USAGE_DRAIN_LOCK_STALE_MS', 900000);
  if (!tryAcquireLock(lockFile, staleMs)) {
    return;
  }

  try {
    drain();
    sweep();
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch (err) {
      // already gone
    }
  }
}

function write(record, meta) {
  drainAndSweep();
  return writeInner(record, meta);
}

module.exports = { write, drainAndSweep };

if (require.main === module) {
  drainAndSweep();
  console.log('usage-store: drain and sweep complete.');
}
