// filters.js — the one filter vocabulary of the three delivery forms (spec
// 0210 R9/R10; PLAN v2 D6, step 2). Two kinds of predicate:
//
// - selection predicates (--session, --agent+--parent, --task-key, --asset,
//   --cli, --fidelity, --no-ledger) decide which records the
//   session-cumulative pass sees; they keep their 0207/0208 meaning and are
//   parsed by query.parseArgs() itself;
// - placement predicates (--from/--to, --period, --model) decide where a
//   contributing record lands, and are applied only AFTER that pass (D4).
//
// Form B turns its query string into the same argv and calls the same
// parse(), so one vocabulary serves all three forms.

'use strict';

const query = require('../usage-store/query');
const buckets = require('./buckets');

const FIDELITIES = ['per-request', 'run-total', 'session-cumulative'];
const BUCKETS = ['day', 'week', 'month'];
const DEFAULTS = { bucket: 'day', currency: 'USD' };

const SELECTION_VALUE_FLAGS = ['--session', '--agent', '--parent', '--cli', '--task-key', '--asset', '--fidelity'];
const SELECTION_BOOL_FLAGS = ['--no-ledger'];
const REFUSED_FLAGS = ['--undrained', '--pending', '--rollup', '--combined'];
const BIND_FLAGS = ['--host', '--bind', '--address'];

// Query-string parameter name -> flag (form B). --as-of-today, --json,
// --out and --port are deliberately absent: a GET never recomputes, and a
// request never chooses where anything is written or bound.
const PARAM_FLAGS = {
  session: '--session',
  agent: '--agent',
  parent: '--parent',
  cli: '--cli',
  'task-key': '--task-key',
  asset: '--asset',
  fidelity: '--fidelity',
  'no-ledger': '--no-ledger',
  from: '--from',
  to: '--to',
  period: '--period',
  model: '--model',
  bucket: '--bucket',
  currency: '--currency',
};

function isValidDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidMonth(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function takeValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v === '') {
    throw new Error(`${flag} requires a value`);
  }
  return v;
}

// parse(argv) -> {selection, placement, options}.
function parse(argv) {
  const passThrough = [];
  const placement = {};
  const options = { bucket: DEFAULTS.bucket, currency: DEFAULTS.currency, asOfToday: false };
  const given = new Set();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BIND_FLAGS.includes(a)) {
      throw new Error('form B binds 127.0.0.1 only (spec 0210 R14)');
    }
    if (REFUSED_FLAGS.includes(a)) {
      throw new Error(`${a} is not a dashboard filter`);
    }
    if (SELECTION_VALUE_FLAGS.includes(a)) {
      const v = takeValue(argv, i, a);
      if (a === '--fidelity' && !FIDELITIES.includes(v)) {
        throw new Error(`--fidelity must be one of ${FIDELITIES.join(', ')}, got: ${v}`);
      }
      if (a === '--asset' && v.indexOf(':') === -1) {
        throw new Error(`--asset must be <kind>:<ref>, got: ${v}`);
      }
      passThrough.push(a, v);
      i++;
      continue;
    }
    if (SELECTION_BOOL_FLAGS.includes(a)) {
      passThrough.push(a);
      continue;
    }
    switch (a) {
      case '--from':
      case '--to': {
        const v = takeValue(argv, i, a);
        if (!isValidDay(v)) throw new Error(`${a} must be a UTC date YYYY-MM-DD, got: ${v}`);
        placement[a.slice(2)] = v;
        i++;
        break;
      }
      case '--period': {
        const v = takeValue(argv, i, a);
        if (!isValidMonth(v)) throw new Error(`--period must be YYYY-MM, got: ${v}`);
        placement.period = v;
        i++;
        break;
      }
      case '--model':
        placement.model = takeValue(argv, i, a);
        i++;
        break;
      case '--bucket': {
        const v = takeValue(argv, i, a);
        if (!BUCKETS.includes(v)) throw new Error(`--bucket must be one of ${BUCKETS.join(', ')}, got: ${v}`);
        options.bucket = v;
        i++;
        break;
      }
      case '--currency': {
        const v = takeValue(argv, i, a);
        if (!/^[A-Z]{3}$/.test(v)) throw new Error(`--currency must be an ISO 4217 code (three capital letters), got: ${v}`);
        options.currency = v;
        i++;
        break;
      }
      case '--as-of-today':
        options.asOfToday = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--out':
        options.out = takeValue(argv, i, a);
        i++;
        break;
      case '--port': {
        const v = takeValue(argv, i, a);
        if (!/^\d{1,5}$/.test(v) || Number(v) > 65535) throw new Error(`--port must be an integer 0-65535, got: ${v}`);
        options.port = Number(v);
        i++;
        break;
      }
      default:
        throw new Error(`unrecognized argument: ${a}`);
    }
    given.add(a);
  }

  if (placement.from && placement.to && placement.from > placement.to) {
    throw new Error(`--from ${placement.from} is after --to ${placement.to}`);
  }

  const selection = query.parseArgs(passThrough);
  return { selection, placement, options, given: Array.from(given) };
}

// fromSearchParams(URLSearchParams) — form B's request parameters, mapped to
// the same argv. Empty values (an unfilled form field) are skipped.
function fromSearchParams(params) {
  const argv = [];
  for (const [name, value] of params) {
    const flag = PARAM_FLAGS[name];
    if (!flag) throw new Error(`unrecognized parameter: ${name}`);
    if (value === '') continue;
    if (flag === '--no-ledger') {
      if (value !== '0') argv.push(flag);
      continue;
    }
    argv.push(flag, value);
  }
  return parse(argv);
}

function shellQuote(v) {
  if (/^[A-Za-z0-9._:/@%+=,-]+$/.test(v)) return v;
  return `'${String(v).replace(/'/g, "'\\''")}'`;
}

// toArgv(filters) — the canonical, sorted argv of a selection: every
// selection and placement filter, plus --bucket/--currency when they differ
// from their defaults. --as-of-today is never included (the footer states
// that variant separately).
function toArgv(filters) {
  const s = filters.selection || {};
  const p = filters.placement || {};
  const o = filters.options || {};
  const pairs = [];
  if (s.session) pairs.push(['--session', s.session]);
  if (s.agent) pairs.push(['--agent', s.agent]);
  if (s.parent) pairs.push(['--parent', s.parent]);
  if (s.cli) pairs.push(['--cli', s.cli]);
  if (s.taskKey) pairs.push(['--task-key', s.taskKey]);
  if (s.asset) pairs.push(['--asset', s.asset]);
  if (s.fidelity) pairs.push(['--fidelity', s.fidelity]);
  if (s.noLedger) pairs.push(['--no-ledger']);
  if (p.from) pairs.push(['--from', p.from]);
  if (p.to) pairs.push(['--to', p.to]);
  if (p.period) pairs.push(['--period', p.period]);
  if (p.model) pairs.push(['--model', p.model]);
  if (o.bucket && o.bucket !== DEFAULTS.bucket) pairs.push(['--bucket', o.bucket]);
  if (o.currency && o.currency !== DEFAULTS.currency) pairs.push(['--currency', o.currency]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.flat();
}

function argvToShell(argv) {
  return argv.map((a) => (a.startsWith('--') ? a : shellQuote(a))).join(' ');
}

// selectionPredicate(selection) — D7's AND post-filter over every selection
// predicate, on the ledger-applied attribution query.run() returns. It is
// query.selectionPredicate() itself (#1205): the dashboard and usage:query /
// usage:price share one definition of the selection, so they cannot drift.
function selectionPredicate(selection) {
  return query.selectionPredicate(selection);
}

// placementBounds(placement) -> {lower, upper}: the inclusive UTC day range
// the date filters and --period jointly admit (either side may be null).
function placementBounds(placement) {
  const p = placement || {};
  let lower = p.from || null;
  let upper = p.to || null;
  if (p.period) {
    const first = `${p.period}-01`;
    const last = buckets.lastDayOfMonth(p.period);
    if (!lower || first > lower) lower = first;
    if (!upper || last < upper) upper = last;
  }
  return { lower, upper };
}

// placementPredicate(placement) — D4's post-pass filter.
function placementPredicate(placement) {
  const p = placement || {};
  return (r) => {
    const day = buckets.dayKey(r.timing.requestInstant);
    if (p.from && day < p.from) return false;
    if (p.to && day > p.to) return false;
    if (p.period && day.slice(0, 7) !== p.period) return false;
    if (p.model && (r.modelId || null) !== p.model) return false;
    return true;
  };
}

module.exports = {
  DEFAULTS,
  FIDELITIES,
  PARAM_FLAGS,
  parse,
  fromSearchParams,
  toArgv,
  argvToShell,
  shellQuote,
  selectionPredicate,
  placementBounds,
  placementPredicate,
};
