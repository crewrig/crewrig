// ledger.js — the append-only attribution ledger (spec 0208 R13-R19, PLAN v3
// step 6). One immutable file per entry at <root>/ledger/<YYYY-MM>/
// <entryId>.json, entryId = sha256(canonical JSON of the entry), written
// temp + linkSync — the journal's own append-only primitive, so an
// identical re-append is an EEXIST no-op and the sequence can never be
// rewritten in place. The period is the period of the entry's own
// `timestamp` (R17: "recorded within that same period").

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const layout = require('./layout');

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeys(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalize(entry) {
  return JSON.stringify(sortKeys(entry));
}

function entryIdFor(entry) {
  return crypto.createHash('sha256').update(canonicalize(entry)).digest('hex');
}

function scopeShapeOk(scope) {
  if (!scope || typeof scope !== 'object') return false;
  const keys = Object.keys(scope);
  if (keys.length === 1 && keys[0] === 'session') return true;
  if (keys.length === 1 && keys[0] === 'period') return true;
  if (keys.length === 2 && keys.includes('agent') && keys.includes('parent')) return true;
  return false;
}

function tmpName(entryId) {
  return path.join(layout.tmpDir(), `.ledger.${entryId}.${process.pid}.${process.hrtime.bigint()}.tmp`);
}

// append(entry) — {scope, taskHandoffKey?, externalAsset?, timestamp,
// author, reason}. scope exactly one of {session}, {agent, parent},
// {period} (R14); a missing reason is a hard error.
function append(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('append() requires an entry object');
  }
  if (!scopeShapeOk(entry.scope)) {
    throw new Error(`entry.scope must be exactly one of {session}, {agent, parent}, {period}, got: ${JSON.stringify(entry.scope)}`);
  }
  if (!entry.taskHandoffKey && !entry.externalAsset) {
    throw new Error('entry requires taskHandoffKey and/or externalAsset');
  }
  if (!entry.timestamp) {
    throw new Error('entry.timestamp is required');
  }
  if (!entry.author) {
    throw new Error('entry.author is required');
  }
  if (!entry.reason) {
    throw new Error('entry.reason is required');
  }

  const per = entry.timestamp.slice(0, 7); // the entry's own YYYY-MM (R17)
  const entryId = entryIdFor(entry);
  const target = layout.ledgerEntry(per, entryId);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(layout.tmpDir(), { recursive: true });
  const tmp = tmpName(entryId);
  fs.writeFileSync(tmp, canonicalize(entry));
  try {
    fs.linkSync(tmp, target);
  } catch (err) {
    fs.unlinkSync(tmp);
    if (err.code !== 'EEXIST') throw err;
    return { entryId, period: per, entry };
  }
  fs.unlinkSync(tmp);
  return { entryId, period: per, entry };
}

function readEntryFile(full) {
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readPeriod(per) {
  const dir = layout.ledgerPeriodDir(per);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!layout.isLedgerEntry(name)) continue;
    const entry = readEntryFile(path.join(dir, name));
    if (entry) out.push({ ...entry, entryId: name.slice(0, name.length - '.json'.length), period: per });
  }
  return out;
}

function walkAll() {
  const out = [];
  const root = layout.ledgerRoot();
  let periods;
  try {
    periods = fs.readdirSync(root);
  } catch (err) {
    return out;
  }
  for (const per of periods) {
    out.push(...readPeriod(per));
  }
  return out;
}

// list({session, agent, parent, period}) — R18's filters. A `period` filter
// reads exactly that period's directory; `session` and `agent`+`parent`
// filters walk the whole ledger.
function list(filters) {
  filters = filters || {};
  const entries = filters.period && !filters.session && !filters.agent ? readPeriod(filters.period) : walkAll();

  return entries.filter((e) => {
    if (filters.session !== undefined && e.scope.session !== filters.session) return false;
    if (filters.agent !== undefined && (e.scope.agent !== filters.agent || e.scope.parent !== filters.parent)) return false;
    if (filters.period !== undefined && e.period !== filters.period) return false;
    return true;
  });
}

function specificityRank(scope) {
  if (scope.agent !== undefined) return 2;
  if (scope.session !== undefined) return 1;
  return 0; // period
}

function scopeMatchesRecord(scope, record) {
  if (scope.agent !== undefined) {
    return record.identity.agentId === scope.agent && record.identity.parentSessionId === scope.parent;
  }
  if (scope.session !== undefined) {
    return record.identity.sessionId === scope.session;
  }
  return layout.period(record) === scope.period;
}

// overridesFor(records) — a Map from recordId to the winning ledger entry
// (R15). Precedence: most specific subject wins ({agent,parent} > {session}
// > {period}); within one specificity the later timestamp wins, an exact
// tie going to the lexicographically greatest entryId.
function overridesFor(records) {
  const allEntries = walkAll();
  const result = new Map();

  for (const record of records) {
    let winner = null;
    for (const entry of allEntries) {
      if (!scopeMatchesRecord(entry.scope, record)) continue;
      if (!winner) {
        winner = entry;
        continue;
      }
      const winnerRank = specificityRank(winner.scope);
      const entryRank = specificityRank(entry.scope);
      if (entryRank !== winnerRank) {
        if (entryRank > winnerRank) winner = entry;
        continue;
      }
      if (entry.timestamp !== winner.timestamp) {
        if (entry.timestamp > winner.timestamp) winner = entry;
        continue;
      }
      if (entry.entryId > winner.entryId) winner = entry;
    }
    if (winner) result.set(record.recordId, winner);
  }

  return result;
}

// explain({cli, period, recordId}) — the per-record channel diagnostic
// (spec 0208 R7), read back from the .attr.json sidecar journal.js writes.
function explain({ cli, period: per, recordId }) {
  try {
    return JSON.parse(fs.readFileSync(layout.attributionSidecar(cli, per, recordId), 'utf8'));
  } catch (err) {
    return null;
  }
}

module.exports = { append, list, overridesFor, explain };

// --- CLI: scripts/usage-attribute.sh add|list|explain -----------------------

function parseAssetArg(spec) {
  const idx = spec.indexOf(':');
  if (idx === -1) {
    throw new Error(`--asset must be <kind>:<ref>, got: ${spec}`);
  }
  return { kind: spec.slice(0, idx), ref: spec.slice(idx + 1) };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
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
      case '--task-key':
        opts.taskKey = argv[++i];
        break;
      case '--asset':
        opts.asset = argv[++i];
        break;
      case '--author':
        opts.author = argv[++i];
        break;
      case '--reason':
        opts.reason = argv[++i];
        break;
      case '--cli':
        opts.cli = argv[++i];
        break;
      case '--record':
        opts.record = argv[++i];
        break;
      default:
        throw new Error(`unrecognized argument: ${argv[i]}`);
    }
  }
  return opts;
}

function scopeFromArgs(opts) {
  if (opts.agent || opts.parent) {
    if (!opts.agent || !opts.parent) throw new Error('--agent and --parent are required together');
    return { agent: opts.agent, parent: opts.parent };
  }
  if (opts.session) return { session: opts.session };
  if (opts.period) return { period: opts.period };
  throw new Error('one of --session, --agent+--parent, --period is required');
}

function printHelp() {
  console.log(`Usage: bash scripts/usage-attribute.sh add (--session <id> | --agent <id> --parent <id> | --period <YYYY-MM>) (--task-key <key> | --asset <kind>:<ref>) --reason <text> [--author <name>]
       bash scripts/usage-attribute.sh list [--session <id> | --agent <id> --parent <id> | --period <YYYY-MM>]
       bash scripts/usage-attribute.sh explain --record <recordId> --cli <cli> --period <YYYY-MM>

Appends to, lists, or inspects the append-only attribution ledger (spec 0208
R13-R19). 'explain' prints the .attr.json sidecar recording the declaration
channel a record resolved through at write time (R7).`);
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === '--help') {
    printHelp();
    process.exit(sub ? 0 : 2);
  }

  const opts = parseArgs(rest);

  if (sub === 'add') {
    const author = opts.author || process.env.GIT_AUTHOR_NAME || process.env.USER || '';
    if (!author) {
      throw new Error('author could not be resolved — pass --author or set GIT_AUTHOR_NAME/USER');
    }
    if (!opts.reason) {
      throw new Error('add requires --reason');
    }
    const entry = {
      scope: scopeFromArgs(opts),
      timestamp: new Date().toISOString(),
      author,
      reason: opts.reason,
    };
    if (opts.taskKey) entry.taskHandoffKey = opts.taskKey;
    if (opts.asset) entry.externalAsset = parseAssetArg(opts.asset);
    console.log(JSON.stringify(append(entry)));
  } else if (sub === 'list') {
    const filters = {};
    if (opts.session) filters.session = opts.session;
    if (opts.agent) {
      filters.agent = opts.agent;
      filters.parent = opts.parent;
    }
    if (opts.period) filters.period = opts.period;
    for (const e of list(filters)) {
      process.stdout.write(`${JSON.stringify(e)}\n`);
    }
  } else if (sub === 'explain') {
    const result = explain({ cli: opts.cli, period: opts.period, recordId: opts.record });
    console.log(result ? JSON.stringify(result) : 'no sidecar found');
  } else {
    printHelp();
    process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
}
