// mirror.js — the R10-R14/R27 mirror write path (spec 0207 PLAN v3 step 7),
// and the only module in this tree that imports mcp.js.
//
// resolveWing() is the seven-rule cascade (PLAN v3-F3's remedy). Only rule 4
// (git-common-dir, the live checkout) writes the on-disk memo under
// <root>/cache/ — its answer cannot go stale while the directory exists.
// Named edit 6 (plan/1170#3 review) narrows this from the plan text's
// "rules 4, 5 and 7 write the memo": a git-common-dir-ancestor or
// basename-fallback answer persisted to disk would replay stale once the
// removed project root reappears or a non-repository path is later
// `git init`ed. Rule 6 (process-cwd) is a property of the writing process
// rather than of the record and is never memoized in any form.
//
// Every mirror path READS the sidecar a record's journal write already
// resolved and linked (journal.js 3(e')) — none re-derives (v2-F1). The
// only case that derives instead of reading is a missing or unparseable
// sidecar, repaired via readOrRepairSidecar() using rename(2) over the
// existing path (named edit 3 from the plan/1170#3 review) rather than
// journal.js's own temp+linkSync primitive, because the path may already
// exist and be torn.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const layout = require('./layout');
const mcp = require('./mcp');

function envMs(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

// --- Wing resolution (7a) ----------------------------------------------------

const inProcessWingCache = new Map();

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeWingMemo(projectRoot, wingInfo) {
  const memoPath = layout.wingMemo(projectRoot);
  fs.mkdirSync(path.dirname(memoPath), { recursive: true });
  const tmp = `${memoPath}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ wing: wingInfo.wing, wingDerivation: wingInfo.wingDerivation }));
  fs.renameSync(tmp, memoPath);
}

// gitCommonDirWing(dir) — `git -C <dir> rev-parse --path-format=absolute
// --git-common-dir`, then `basename(dirname(realpath(commonDir)))`. Returns
// null (never throws) when `dir` is not inside a git working tree.
function gitCommonDirWing(dir) {
  let out;
  try {
    out = execFileSync(
      'git',
      ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch (err) {
    return null;
  }
  let real;
  try {
    real = fs.realpathSync(out);
  } catch (err) {
    real = out;
  }
  return path.basename(path.dirname(real));
}

// nearestExistingAncestor(p) — walks dirname(p) upward until an existing
// directory is found, stopping at the filesystem root (which always
// exists on a POSIX host).
function nearestExistingAncestor(p) {
  let cur = p;
  for (;;) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
}

function isUsableProjectRoot(projectRoot) {
  return (
    typeof projectRoot === 'string' &&
    projectRoot.length > 0 &&
    projectRoot !== 'unknown' &&
    path.isAbsolute(projectRoot)
  );
}

function resolveWing(projectRoot) {
  // 1. CREWRIG_USAGE_WING — the documented organization override.
  const override = process.env.CREWRIG_USAGE_WING;
  if (override) {
    return { wing: override, wingDerivation: 'env-override' };
  }

  if (!isUsableProjectRoot(projectRoot)) {
    // 6. process-cwd — the writing process's own cwd, never memoized.
    const wing = gitCommonDirWing(process.cwd());
    if (wing) {
      return { wing, wingDerivation: 'process-cwd' };
    }
    return { wing: 'unknown', wingDerivation: 'unknown-residual' };
  }

  // 2. in-process map
  if (inProcessWingCache.has(projectRoot)) {
    return inProcessWingCache.get(projectRoot);
  }

  // 3. on-disk memo
  const memoed = readJsonSafe(layout.wingMemo(projectRoot));
  if (memoed && typeof memoed.wing === 'string' && typeof memoed.wingDerivation === 'string') {
    const result = { wing: memoed.wing, wingDerivation: memoed.wingDerivation };
    inProcessWingCache.set(projectRoot, result);
    return result;
  }

  let result = null;
  if (fs.existsSync(projectRoot)) {
    // 4. live checkout
    const wing = gitCommonDirWing(projectRoot);
    if (wing) result = { wing, wingDerivation: 'git-common-dir' };
  } else {
    // 5. nearest existing ancestor
    const ancestor = nearestExistingAncestor(projectRoot);
    const wing = gitCommonDirWing(ancestor);
    if (wing) result = { wing, wingDerivation: 'git-common-dir-ancestor' };
  }

  if (!result) {
    // 7. basename-fallback
    result = { wing: path.basename(path.resolve(projectRoot)), wingDerivation: 'basename-fallback' };
  }

  // Named edit 6 (plan/1170#3 review): the on-disk memo is written ONLY for
  // the live-checkout derivation (git-common-dir) — its answer cannot go
  // stale while the directory exists. git-common-dir-ancestor and
  // basename-fallback answers are NOT persisted to <root>/cache/: a removed
  // project root that later reappears, or a non-repository path later
  // `git init`ed, must be re-asked rather than replay a stale on-disk
  // answer. The in-process Map still caches every derivation (rule 2), since
  // that cache dies with the process and carries no cross-invocation
  // staleness risk.
  if (result.wingDerivation === 'git-common-dir') {
    writeWingMemo(projectRoot, result);
  }
  inProcessWingCache.set(projectRoot, result);
  return result;
}

// --- Slimming (7b) -----------------------------------------------------------

// slim(record) — for kind:'captured', delete raw and externalize it (R11);
// for kind:'uncaptured', return the record unchanged (R27 — the schema
// forbids both fields on that kind, blocks B/D of
// schemas/usage-record/v1.schema.json).
function slim(record) {
  if (record.kind !== 'captured') {
    return record;
  }
  const { raw, ...rest } = record;
  const cli = record.provenance.cli;
  const per = layout.period(record);
  return {
    ...rest,
    rawStatus: 'externalized',
    rawRef: `${cli}/${per}#${record.recordId}`,
  };
}

// --- Sidecar read-or-repair (used by catchUp()/reconcile() only) -----------

// readOrRepairSidecar(...) — read the sidecar; a missing or unparseable one
// is derived once with resolveWing() and repaired with rename(2) over the
// existing path (atomic replace either way, whether the path was absent or
// torn) — never journal.js's own temp+linkSync, whose EEXIST tolerance
// cannot repair a file that already exists but is corrupt.
function readOrRepairSidecar(cli, per, recordId, record) {
  const sidecarPath = layout.wingSidecar(cli, per, recordId);
  const parsed = readJsonSafe(sidecarPath);
  if (parsed && typeof parsed.wing === 'string' && typeof parsed.wingDerivation === 'string') {
    return { wing: parsed.wing, wingDerivation: parsed.wingDerivation };
  }

  const wingInfo = resolveWing(record.identity.projectRoot);
  const payload = {
    wing: wingInfo.wing,
    wingDerivation: wingInfo.wingDerivation,
    projectRoot: record.identity.projectRoot,
    resolvedAt: new Date().toISOString(),
  };
  fs.mkdirSync(layout.tmpDir(), { recursive: true });
  const tmp = path.join(layout.tmpDir(), `.${recordId}.wing-repair.${process.pid}.${process.hrtime.bigint()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, sidecarPath);
  return wingInfo;
}

// --- Write-time hand-off (7c) -------------------------------------------

// onWrite(record, entryPath, wingInfo) — journal.js 3(f) calls this
// immediately after the entry and sidecar are both linked. In order and
// nothing else: absent token file ⇒ return immediately, no marker, no
// stamp read, no spawn, no probe, not one byte under <root>/mirror/;
// present ⇒ one pending marker, then a detached catch-up unless a fresh
// unreachable stamp or CREWRIG_USAGE_MIRROR=0 forbids it.
//
// The detached spawn passes `--from-write`, which keeps catchUp() on its
// original NON-BLOCKING single lock attempt (contended ⇒ `{ ran: false }`
// immediately — another child already holds the lock and the next write's
// spawn will retry). Whichever child DOES acquire the lock drains pending/
// in a loop (drainPending(), below) rather than a single pass, so markers
// created by sibling writes while it runs are not stranded for "the next
// write" to pick up. An operator or CI invocation of `usage-mirror.sh`
// WITHOUT `--from-write` is treated as explicit (catchUp({ explicit: true
// })): on a contended lock it waits with bounded polling instead of giving
// up (see acquireLockWaiting()), so its post-condition — every marker
// pending at call time has been attempted — actually holds.
function onWrite(record, entryPath, wingInfo) {
  if (!fs.existsSync(mcp.tokenPath())) {
    return;
  }

  const cli = record.provenance.cli;
  const per = layout.period(record);
  const recordId = record.recordId;

  const marker = layout.pendingMarker(cli, per, recordId);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  try {
    fs.closeSync(fs.openSync(marker, 'wx'));
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  const backoffMs = envMs('CREWRIG_USAGE_MIRROR_BACKOFF_MS', 600000);
  let stampAge = Infinity;
  try {
    stampAge = Date.now() - fs.statSync(layout.unreachableStamp()).mtimeMs;
  } catch (err) {
    // no stamp — not backed off
  }
  if (stampAge < backoffMs) {
    return;
  }

  if (process.env.CREWRIG_USAGE_MIRROR === '0') {
    return;
  }

  const scriptPath = path.join(__dirname, '..', '..', 'usage-mirror.sh');
  const child = spawn('bash', [scriptPath, '--from-write'], { detached: true, stdio: 'ignore' });
  child.unref();
}

// --- Locking (mirror.lock — same shape as journal.js's drain.lock) --------

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
    return true; // the lock vanished between our openSync and this statSync
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// acquireLockWaiting(lockFile, staleMs, waitMs) — the explicit entrypoint's
// bounded-polling counterpart to tryAcquireLock(): retries every 100ms
// until either the lock is acquired (the live peer released it, or
// tryAcquireLock's own staleness check reclaimed it once age > staleMs) or
// waitMs elapses. Defaulting waitMs to staleMs (see catchUp()) means this
// always succeeds within ~staleMs in practice — a peer that never releases
// is, by definition, stale by then — so the caller's "every pending marker
// has been attempted" post-condition holds barring a pathological repeat
// steal-race (tryAcquireLock's own single retry-after-unlink loses again on
// every single poll).
async function acquireLockWaiting(lockFile, staleMs, waitMs) {
  const pollMs = 100;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (tryAcquireLock(lockFile, staleMs)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

function touchUnreachableStamp() {
  const stampPath = layout.unreachableStamp();
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  fs.writeFileSync(stampPath, '');
}

function clearUnreachableStamp() {
  try {
    fs.unlinkSync(layout.unreachableStamp());
  } catch (err) {
    // already absent
  }
}

// --- Catch-up (7d) -----------------------------------------------------------

function listMarkers(root) {
  const out = [];
  let clis;
  try {
    clis = fs.readdirSync(root);
  } catch (err) {
    return out;
  }
  for (const cli of clis) {
    const cliDir = path.join(root, cli);
    let periods;
    try {
      periods = fs.readdirSync(cliDir);
    } catch (err) {
      continue;
    }
    for (const per of periods) {
      const perDir = path.join(cliDir, per);
      let ids;
      try {
        ids = fs.readdirSync(perDir);
      } catch (err) {
        continue;
      }
      for (const recordId of ids) {
        out.push({ cli, per, recordId });
      }
    }
  }
  return out;
}

async function mirrorOneMarker(cli, per, recordId) {
  const entryPath = layout.journalEntry(cli, per, recordId);
  const record = readJsonSafe(entryPath);
  if (!record) {
    // The entry is gone — most likely a prune raced ahead of this catch-up.
    // The prune owns removing this marker; leave it for the prune to find.
    return { stop: false };
  }

  const wingInfo = readOrRepairSidecar(cli, per, recordId, record);
  const result = await mcp.addDrawer({
    wing: wingInfo.wing,
    room: 'usage-records',
    content: JSON.stringify(slim(record)),
    source_file: entryPath,
    added_by: `crewrig-usage-store/${wingInfo.wingDerivation}`,
  });

  if (!result.ok) {
    if (result.kind === 'tool-error') {
      // A per-record failure (R13): log and continue, leaving the marker in
      // pending/ for the next catch-up.
      console.error(`usage-store mirror: ${cli}/${per}/${recordId} failed: ${result.message || 'unknown error'}`);
      return { stop: false };
    }
    if (result.kind === 'transport') {
      touchUnreachableStamp();
      return { stop: true };
    }
    // tool-unavailable, or any kind added later (mcp.js header): the daemon
    // answered but cannot serve the tool at all, so every later call would
    // fail the same way. Stop the pass after this one call, without the
    // stamp — the daemon is reachable. Only tool-error continues, so an
    // unknown kind is bounded by default.
    console.error(
      `usage-store mirror: MemPalace cannot serve mempalace_add_drawer (${result.message || 'unknown error'}) — ` +
        `stopping this pass; ${cli}/${per}/${recordId} and every later marker stay pending.`
    );
    return { stop: true };
  }

  clearUnreachableStamp();
  const pendingPath = layout.pendingMarker(cli, per, recordId);
  const mirroredPath = layout.mirroredMarker(cli, per, recordId);
  fs.mkdirSync(path.dirname(mirroredPath), { recursive: true });
  try {
    fs.renameSync(pendingPath, mirroredPath);
  } catch (err) {
    // a racing process already moved it — the drawer exists either way
  }
  return { stop: false };
}

async function walkPending() {
  const markers = listMarkers(layout.mirrorPendingRoot());
  for (const m of markers) {
    const r = await mirrorOneMarker(m.cli, m.per, m.recordId);
    if (r.stop) break;
  }
}

// drainPending() — repeats walkPending() until pending/ is empty or a pass
// makes no progress (a stopping failure breaks walkPending() early, so the
// count is unchanged and this stops rather than spinning). This is what
// lets the lock's winner — write-time detached child or explicit run alike
// — absorb markers created by sibling writes while it was working, instead
// of leaving them for "the next write" to spawn a fresh catch-up for.
async function drainPending() {
  for (;;) {
    const before = listMarkers(layout.mirrorPendingRoot()).length;
    if (before === 0) return;
    await walkPending();
    const after = listMarkers(layout.mirrorPendingRoot()).length;
    if (after === 0 || after >= before) return;
  }
}

// catchUp(opts) — opts.explicit (default false) distinguishes the two
// callers documented at onWrite() above:
//   - explicit: false (write-time detached spawn, `--from-write`) — a
//     single non-blocking lock attempt; contended ⇒ `{ ran: false }`
//     immediately, the peer already in progress owns the drain.
//   - explicit: true (operator/CI run of usage-mirror.sh with no flag, or
//     `--reconcile`) — waits on a contended lock (acquireLockWaiting())
//     instead of giving up, so its post-condition holds: every marker
//     pending at call time gets attempted.
async function catchUp(opts) {
  const explicit = !!(opts && opts.explicit);
  const lockFile = layout.lockPath('mirror');
  const staleMs = envMs('CREWRIG_USAGE_MIRROR_LOCK_STALE_MS', 900000);

  const acquired = explicit
    ? await acquireLockWaiting(lockFile, staleMs, envMs('CREWRIG_USAGE_MIRROR_WAIT_MS', staleMs))
    : tryAcquireLock(lockFile, staleMs);
  if (!acquired) {
    return { ran: false };
  }
  try {
    await drainPending();
    return { ran: true };
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch (err) {
      // already gone
    }
  }
}

// --reconcile: recompute pending = entries − mirrored over the WHOLE
// journal (O(journal), user-triggered, never automatic), then run the
// ordinary catch-up. Because each entry's wing is read from its sidecar,
// this re-mirrors into the SAME wing after mirror/ or cache/ is lost —
// therefore the same content-addressed drawer id, therefore
// already_exists, therefore N drawers, not 2N.
function recreatePendingMarkers() {
  const journalRoot = layout.journalRoot();
  let clis;
  try {
    clis = fs.readdirSync(journalRoot);
  } catch (err) {
    return;
  }
  for (const cli of clis) {
    const cliDir = path.join(journalRoot, cli);
    let periods;
    try {
      periods = fs.readdirSync(cliDir);
    } catch (err) {
      continue;
    }
    for (const per of periods) {
      const perDir = path.join(cliDir, per);
      let names;
      try {
        names = fs.readdirSync(perDir);
      } catch (err) {
        continue;
      }
      for (const name of names) {
        if (!layout.isEntry(name)) continue;
        const recordId = layout.entryToRecordId(name);
        if (fs.existsSync(layout.mirroredMarker(cli, per, recordId))) continue;
        const pendingPath = layout.pendingMarker(cli, per, recordId);
        fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
        try {
          fs.closeSync(fs.openSync(pendingPath, 'wx'));
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
        }
      }
    }
  }
}

async function reconcile(opts) {
  recreatePendingMarkers();
  return catchUp(opts);
}

module.exports = {
  resolveWing,
  slim,
  onWrite,
  catchUp,
  reconcile,
  readOrRepairSidecar,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  // `--from-write` marks the write-time detached spawn (see onWrite() above);
  // its absence means an operator or CI invocation, treated as explicit.
  const explicit = !args.includes('--from-write');
  const run = () => (args.includes('--reconcile') ? reconcile({ explicit }) : catchUp({ explicit }));
  run()
    .then((result) => {
      if (result && result.ran === false) {
        console.log(
          explicit
            ? 'usage-store mirror: gave up waiting for the catch-up lock — a peer still holds it.'
            : 'usage-store mirror: another process already holds the catch-up lock — skipped.'
        );
      } else {
        console.log('usage-store mirror: catch-up complete.');
      }
    })
    .catch((err) => {
      console.error(`FATAL: ${err.message}`);
      process.exit(1);
    });
}
