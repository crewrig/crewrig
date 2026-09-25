// query.js — R15-R17's read surface (spec 0207 PLAN v3 step 9), plus spec
// 0208 R15's read-time ledger application and R20-R24's rollup surface
// (PLAN v3 step 8). Every journal walk enumerates with layout.isEntry() and
// nothing else, so a sidecar is never opened, parsed or returned. Output is
// JSONL, one record per line — verbatim unless a ledger override applies;
// --no-ledger returns the entry verbatim.
//
// Selectors compose (#1205): selectionPredicate() is the one definition of
// the selection, the AND of every selector given, and the dashboard
// (scripts/lib/usage-dashboard/filters.js) delegates to it. --period is not
// a clause of that AND. For a listing it is the primary read: a --period
// listing (with --cli) opens exactly one partition directory (R6), and
// without --period the journal is walked and streamed, O(records in the
// retained window).
//
// For a --period P --rollup the period is a placement bound instead, the
// exception to R6 (spec 0209 delta-01, R43-R45): rollupInput() reads every
// month >= P through readWindow(), the one cross-period lookahead the
// dashboard (scripts/lib/usage-dashboard/source.js) also reads through, so
// each session-cumulative session's last snapshot is chosen over the whole
// selection and only then placed in P or not.

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('./layout');
const ledger = require('./ledger');
const rollup = require('./rollup');

function readEntry(full) {
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readPartition(cli, per) {
  const dir = layout.partitionDir(cli, per);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!layout.isEntry(name)) continue;
    const record = readEntry(path.join(dir, name));
    if (record) out.push(record);
  }
  return out;
}

function walkAllEntries() {
  const out = [];
  const journalRoot = layout.journalRoot();
  let clis;
  try {
    clis = fs.readdirSync(journalRoot);
  } catch (err) {
    return out;
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
      out.push(...readPartition(cli, per));
    }
  }
  return out;
}

function applyFidelity(records, fidelity) {
  if (!fidelity) return records;
  return records.filter((r) => r.fidelity === fidelity);
}

function matchAsset(record, kind, ref) {
  const asset = record.attribution && record.attribution.externalAsset;
  return !!asset && asset.kind === kind && asset.ref === ref;
}

function splitAsset(spec) {
  const idx = spec.indexOf(':');
  if (idx === -1) {
    throw new Error(`--asset must be <kind>:<ref>, got: ${spec}`);
  }
  return [spec.slice(0, idx), spec.slice(idx + 1)];
}

function walkMarkerTree(root) {
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

function listPending() {
  const out = [];
  for (const m of walkMarkerTree(layout.mirrorPendingRoot())) {
    const record = readEntry(layout.journalEntry(m.cli, m.per, m.recordId));
    if (record) out.push(record);
  }
  return out;
}

// listUndrained() — spooled records the drain left behind AND the spool/
// .tmp dotfiles the sweep has not yet reclaimed, labelled distinctly so an
// operator can tell a rejected record from a 0206-side crash remnant.
function listUndrained() {
  const dir = layout.spoolDir();
  const out = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return out;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (layout.isEntry(name)) {
      out.push({ class: 'spooled-record', file: full, record: readEntry(full) });
    } else if (layout.isSpoolStray(name)) {
      out.push({ class: 'spool-stray', file: full });
    }
  }
  return out;
}

function applyLedgerOverrides(records) {
  const overrides = ledger.overridesFor(records);
  if (overrides.size === 0) return records;
  return records.map((r) => {
    const entry = overrides.get(r.recordId);
    if (!entry) return r;
    const attribution = {};
    if (entry.taskHandoffKey) attribution.taskHandoffKey = entry.taskHandoffKey;
    if (entry.externalAsset) attribution.externalAsset = entry.externalAsset;
    return Object.assign({}, r, { attribution });
  });
}

// selectionPredicate(sel) — the one definition of "the selection" (#1205):
// the AND of --session, --agent+--parent, --task-key, --asset, --cli and
// --fidelity, each clause active only when given. --period is not a clause.
// The --asset spec is split once, here, so a malformed value throws before
// any read. The task-key and asset clauses test the attribution a record
// carries, so callers apply them to ledger-applied records unless
// --no-ledger (spec 0208 R15).
function selectionPredicate(sel) {
  const s = sel || {};
  const asset = s.asset ? splitAsset(s.asset) : null;
  return (r) => {
    if (s.session && r.identity.sessionId !== s.session) return false;
    if (s.agent && (r.identity.agentId !== s.agent || r.identity.parentSessionId !== s.parent)) return false;
    if (s.taskKey && !(r.attribution && r.attribution.taskHandoffKey === s.taskKey)) return false;
    if (asset && !matchAsset(r, asset[0], asset[1])) return false;
    if (s.cli && r.provenance.cli !== s.cli) return false;
    if (s.fidelity && r.fidelity !== s.fidelity) return false;
    return true;
  };
}

// readPeriod(per, cli) — a --period listing's partition read: one partition
// with --cli (R6), else that month's partition of every CLI.
function readPeriod(per, cli) {
  if (cli) return readPartition(cli, per);
  const records = [];
  let clis;
  try {
    clis = fs.readdirSync(layout.journalRoot());
  } catch (err) {
    clis = [];
  }
  for (const c of clis) {
    records.push(...readPartition(c, per));
  }
  return records;
}

// run(opts) — one primary read (the --period partitions, else a journal
// walk), narrowed on the ledger-invariant clauses (identity, --cli,
// --fidelity) before the ledger is applied, then filtered by the whole
// selection. The ledger replaces only attribution, and resolves each record
// on its own, so the early narrowing cannot change which records match.
function run(opts) {
  if (opts.undrained) return listUndrained();
  if (opts.pending) return applyFidelity(listPending(), opts.fidelity);

  if (!opts.period && !opts.session && !opts.agent && !opts.taskKey && !opts.asset) {
    throw new Error(
      'no selector given — one of --session, --agent+--parent, --period, --task-key, --asset, --undrained, --pending is required'
    );
  }

  const pred = selectionPredicate(opts);
  let records = opts.period ? readPeriod(opts.period, opts.cli) : walkAllEntries();
  records = records.filter(selectionPredicate({ ...opts, taskKey: undefined, asset: undefined }));

  if (opts.noLedger !== true) {
    records = applyLedgerOverrides(records);
  }

  return records.filter(pred);
}

const MONTH_RE = /^\d{4}-\d{2}$/;

// listMonths() — the sorted union of journalRoot()/<cli>/<YYYY-MM> names.
function listMonths() {
  const months = new Set();
  const journalRoot = layout.journalRoot();
  let clis;
  try {
    clis = fs.readdirSync(journalRoot);
  } catch (err) {
    return [];
  }
  for (const cli of clis) {
    let periods;
    try {
      periods = fs.readdirSync(path.join(journalRoot, cli));
    } catch (err) {
      continue;
    }
    for (const per of periods) {
      if (MONTH_RE.test(per)) months.add(per);
    }
  }
  return Array.from(months).sort();
}

function isSessionCumulative(r) {
  return r.kind === 'captured' && r.fidelity === 'session-cumulative';
}

// readWindow({fromMonth, toMonth, inRange, admit, cli, noLedger, months}) —
// the records a placement window [fromMonth, toMonth] needs, each month read
// with run({period, cli?}) and filtered by admit(r), the selection, BEFORE
// the touched test. Months before fromMonth are skipped: a record sits in its
// own requestInstant month, and an earlier record can never be the last
// snapshot of a session that has an in-range one. Months up to toMonth are
// kept whole. Past toMonth, only captured session-cumulative records of
// sessions touched in range (inRange(r)) are kept — the only later records
// that can supersede an in-range snapshot — up to the newest month. A null
// bound is open. Placement is never applied here: the caller places after
// the per-fidelity choice (rollup.contributingRecords(records, place)).
function readWindow(opts) {
  const lowerMonth = opts.fromMonth || null;
  const upperMonth = opts.toMonth || null;
  const inRange = opts.inRange || (() => true);
  const admit = opts.admit || (() => true);
  const base = opts.noLedger ? { noLedger: true } : {};
  const months = opts.months || listMonths();
  const records = [];
  const touched = new Set();

  for (const month of months) {
    if (lowerMonth && month < lowerMonth) continue;
    if (upperMonth && month > upperMonth && touched.size === 0) break;
    const got = run({ period: month, cli: opts.cli, ...base }).filter(admit);
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
  return records;
}

// rollupInput(opts) -> {records, place}. A --period P rollup reads the
// readWindow() of P, admitting only what selectionPredicate(opts) admits
// (every selector given, on ledger-applied attribution unless --no-ledger),
// and returns the placement predicate "requestInstant in P", which the
// rollup applies after the last-snapshot choice (R45): filter by the
// selection, choose the last snapshot, then place. Every other rollup reads
// what run() reads and places nothing.
function rollupInput(opts) {
  if (!opts.period || opts.undrained || opts.pending) return { records: run(opts), place: null };
  const period = opts.period;
  const place = (r) => layout.period(r) === period;
  const records = readWindow({
    fromMonth: period,
    toMonth: period,
    inRange: place,
    admit: selectionPredicate(opts),
    cli: opts.cli,
    noLedger: opts.noLedger === true,
  });
  return { records, place };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--session':
        opts.session = argv[++i];
        break;
      case '--agent':
        opts.agent = argv[++i];
        break;
      case '--parent':
        opts.parent = argv[++i];
        break;
      case '--period':
        opts.period = argv[++i];
        break;
      case '--cli':
        opts.cli = argv[++i];
        break;
      case '--task-key':
        opts.taskKey = argv[++i];
        break;
      case '--asset':
        opts.asset = argv[++i];
        break;
      case '--fidelity':
        opts.fidelity = argv[++i];
        break;
      case '--undrained':
        opts.undrained = true;
        break;
      case '--pending':
        opts.pending = true;
        break;
      case '--no-ledger':
        opts.noLedger = true;
        break;
      case '--rollup':
        opts.rollup = true;
        break;
      case '--combined':
        opts.combined = true;
        break;
      default:
        throw new Error(`unrecognized argument: ${a}`);
    }
  }
  if ((opts.agent && !opts.parent) || (opts.parent && !opts.agent)) {
    throw new Error('--agent and --parent are required together (R15)');
  }
  return opts;
}

module.exports = { run, parseArgs, listMonths, readWindow, rollupInput, selectionPredicate };

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
  let results;
  let place = null;
  try {
    if (opts.rollup) {
      const input = rollupInput(opts);
      results = input.records;
      place = input.place;
    } else {
      results = run(opts);
    }
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
  if (opts.rollup) {
    const summary = rollup.rollup(results, { combined: opts.combined, place });
    if (opts.taskKey) summary.taskHandoffKey = opts.taskKey;
    if (opts.asset) summary.asset = opts.asset;
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    for (const r of results) {
      process.stdout.write(`${JSON.stringify(r)}\n`);
    }
  }
}
