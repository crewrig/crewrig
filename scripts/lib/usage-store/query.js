// query.js — R15-R17's read surface (spec 0207 PLAN v3 step 9), plus spec
// 0208 R15's read-time ledger application and R20-R24's rollup surface
// (PLAN v3 step 8). Every journal walk enumerates with layout.isEntry() and
// nothing else, so a sidecar is never opened, parsed or returned. A
// --period read (with --cli) opens exactly one partition directory (R6);
// every other selector walks and streams, O(records in the retained
// window). Output is JSONL, one record per line — verbatim unless a ledger
// override applies; --no-ledger returns the entry verbatim.

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

function run(opts) {
  if (opts.undrained) return listUndrained();
  if (opts.pending) return applyFidelity(listPending(), opts.fidelity);

  let records;
  let postFilter = null;

  if (opts.period) {
    if (opts.cli) {
      records = readPartition(opts.cli, opts.period);
    } else {
      records = [];
      const journalRoot = layout.journalRoot();
      let clis;
      try {
        clis = fs.readdirSync(journalRoot);
      } catch (err) {
        clis = [];
      }
      for (const cli of clis) {
        records.push(...readPartition(cli, opts.period));
      }
    }
  } else if (opts.session) {
    records = walkAllEntries().filter((r) => r.identity.sessionId === opts.session);
  } else if (opts.agent) {
    records = walkAllEntries().filter(
      (r) => r.identity.agentId === opts.agent && r.identity.parentSessionId === opts.parent
    );
  } else if (opts.taskKey) {
    records = walkAllEntries();
    postFilter = (r) => r.attribution && r.attribution.taskHandoffKey === opts.taskKey;
  } else if (opts.asset) {
    const [kind, ref] = splitAsset(opts.asset);
    records = walkAllEntries();
    postFilter = (r) => matchAsset(r, kind, ref);
  } else {
    throw new Error(
      'no selector given — one of --session, --agent+--parent, --period, --task-key, --asset, --undrained, --pending is required'
    );
  }

  if (opts.noLedger !== true) {
    records = applyLedgerOverrides(records);
  }

  if (postFilter) {
    records = records.filter(postFilter);
  }

  return applyFidelity(records, opts.fidelity);
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

module.exports = { run, parseArgs };

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
  let results;
  try {
    results = run(opts);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
  if (opts.rollup) {
    const summary = rollup.rollup(results, { combined: opts.combined });
    if (opts.taskKey) summary.taskHandoffKey = opts.taskKey;
    if (opts.asset) summary.asset = opts.asset;
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    for (const r of results) {
      process.stdout.write(`${JSON.stringify(r)}\n`);
    }
  }
}
