#!/usr/bin/env bash
# test-usage-dashboard.sh — the no-daemon, no-network suite for the usage
# dashboard (spec 0210 R26-R30; PLAN v2 step 13, cases 13.1-13.20,
# https://github.com/crewrig/crewrig/issues/1173#issuecomment-5800147638),
# with the approving review's three named edits folded in
# (https://github.com/crewrig/crewrig/issues/1173#issuecomment-5800259630):
# v2-F1 (the `superseded-only` empty state, case 13.11c), v2-F2 (a pruned
# store still reads `store-empty`, case 13.11b) and v2-F3 (case 13.3 maps
# 0209's real `combined` shape, which has no `count`).
#
# Fully offline: every case copies a seeded fixture root into a fresh
# `mktemp -d` CREWRIG_USAGE_ROOT, with MEMPALACE_PALACE_PATH on a fresh temp
# path, CREWRIG_USAGE_OFFLINE=1, CREWRIG_USAGE_CAPTURE_TEST=1 and
# CREWRIG_USAGE_MIRROR=0. No daemon is contacted, HOME is never overridden,
# and form B binds 127.0.0.1 on an ephemeral port and is torn down on every
# exit path (trap).
#
# Fixtures: scripts/tests/fixtures/usage-dashboard/records/*.json (20 records,
# recordId = sha256(sessionId + U+001F + idempotencyKey)), records-unconverted/
# (the two records of case 13.5a) and expected.json (hand-derived values). The
# price list and the FX fixings are the pricing suite's own fixtures,
# reused by path (scripts/tests/fixtures/usage-pricing/).
#
# Mutation discipline (case 13.20). The mutations M1-M13 are NEVER applied to
# the checkout: each one is applied to a throwaway copy of scripts/ and
# schemas/ under `mktemp -d`, the named case is re-run against that copy
# (DASH_REPO), and the mutation passes only when the case goes red. A
# mutation whose anchor no longer matches the module FAILs loudly rather
# than passing vacuously. Set USAGE_DASHBOARD_SKIP_MUTATIONS=1 to skip the
# phase while iterating locally; CI never sets it.
#
# HOME safety: a marker of $HOME/.crewrig/usage is captured before anything
# runs and re-asserted unchanged at the end.
#
# Usage:
#   bash scripts/tests/test-usage-dashboard.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Preflight ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: a Node.js runtime is required to run this suite — install Node and re-run \`npm install\`." >&2
  exit 2
fi
if [ ! -d "$REPO_DIR/node_modules/ajv" ]; then
  echo "FATAL: node_modules/ajv is missing — run \`npm install\` first." >&2
  exit 2
fi
if [ ! -f "$REPO_DIR/scripts/usage-dashboard.sh" ] || [ ! -d "$REPO_DIR/scripts/lib/usage-dashboard" ]; then
  echo "FATAL: scripts/usage-dashboard.sh or scripts/lib/usage-dashboard/ is missing — nothing to test." >&2
  exit 2
fi

pass=0
fail=0

ok() {
  echo "PASS  $1"
  pass=$((pass + 1))
}

bad() {
  echo "FAIL  $1"
  if [ -n "${2:-}" ]; then
    printf '%s\n' "$2" | sed 's/^/      /'
  fi
  fail=$((fail + 1))
}

# --- HOME marker: capture BEFORE anything runs ------------------------------
REAL_HOME_USAGE_DIR="$HOME/.crewrig/usage"
if [ -e "$REAL_HOME_USAGE_DIR" ]; then
  if [ ! -r "$REAL_HOME_USAGE_DIR" ]; then
    echo "FATAL: $REAL_HOME_USAGE_DIR exists but is not readable — refusing to assume it is empty." >&2
    exit 2
  fi
  HOME_USAGE_MARKER_BEFORE="$(find "$REAL_HOME_USAGE_DIR" -type f 2>/dev/null | LC_ALL=C sort)"
else
  HOME_USAGE_MARKER_BEFORE="<absent>"
fi

# --- Sandbox -------------------------------------------------------------
HELPERS_DIR="$(mktemp -d)"
CASE_ROOTS=""
BG_PIDS=""

# shellcheck disable=SC2329  # invoked via trap cleanup EXIT, not dead
cleanup() {
  for p in $BG_PIDS; do
    kill "$p" 2>/dev/null || true
  done
  for p in $BG_PIDS; do
    wait "$p" 2>/dev/null || true
  done
  rm -rf "$HELPERS_DIR" 2>/dev/null || true
  for d in $CASE_ROOTS; do
    rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

unset CREWRIG_USAGE_ROOT 2>/dev/null || true
export CREWRIG_USAGE_OFFLINE=1
export CREWRIG_USAGE_CAPTURE_TEST=1
export CREWRIG_USAGE_MIRROR=0
unset CREWRIG_USAGE_WING 2>/dev/null || true
unset CREWRIG_USAGE_ALLOW_PRUNED 2>/dev/null || true

FIXTURES_DIR="$SCRIPT_DIR/tests/fixtures/usage-dashboard"
PRICING_FIXTURES_DIR="$SCRIPT_DIR/tests/fixtures/usage-pricing"
EXPECTED="$FIXTURES_DIR/expected.json"
VIEWS_DIR="$HELPERS_DIR/views"
mkdir -p "$VIEWS_DIR"

# DASH_REPO is the tree under test: the checkout for the main pass, a
# mutated throwaway copy during case 13.20. Every helper below reads it.
DASH_REPO="$REPO_DIR"
IN_MUTATION=0

# --- Node driver -----------------------------------------------------------
DRIVER="$HELPERS_DIR/driver.js"
cat > "$DRIVER" <<'NODE_EOF'
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const os = require('os');
const crypto = require('crypto');

const REPO = process.env.USAGE_TEST_REPO_DIR;
if (!REPO) {
  console.error('FATAL: USAGE_TEST_REPO_DIR not set');
  process.exit(2);
}
function req(rel) {
  return require(path.join(REPO, rel));
}
const FIDS = ['per-request', 'run-total', 'session-cumulative'];
const TALLIES = ['pricedCount', 'unpricedCount', 'unconvertedCount'];
const COUNTS = ['recordCount', 'capturedCount', 'uncapturedCount'];
const TOKEN_CLASSES = ['netInput', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function fail(msg) {
  console.log(msg);
  process.exit(1);
}

// --- Seeding -------------------------------------------------------------
function pin(pricingDir) {
  const layout = req('scripts/lib/usage-store/layout.js');
  const blob = readJson(path.join(pricingDir, 'pricelist', 'fixture.json'));
  const pointer = readJson(path.join(pricingDir, 'pricelist', 'PINNED.json'));
  fs.mkdirSync(layout.pricelistDir(), { recursive: true });
  fs.writeFileSync(path.join(layout.pricelistDir(), `${pointer.sha}.json`), JSON.stringify(blob));
  fs.writeFileSync(layout.pinnedPointer(), JSON.stringify(pointer, null, 2));
}
function seedFx(pricingDir) {
  const layout = req('scripts/lib/usage-store/layout.js');
  const dir = path.join(layout.fxDir(), 'ecb');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(path.join(pricingDir, 'fx')).sort()) {
    const fixing = readJson(path.join(pricingDir, 'fx', name));
    fs.writeFileSync(path.join(dir, `${fixing.date}.json`), JSON.stringify(fixing));
  }
}
function writeRecords(dir) {
  const journal = req('scripts/lib/usage-store/journal.js');
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const result = journal.write(readJson(path.join(dir, name)));
    if (result.status !== 'stored') fail(`seed: ${name} -> ${JSON.stringify(result)}`);
  }
}

// --- View extraction and normalisers -------------------------------------
function extractEmbedded(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m);
  if (blocks.length !== 1) fail(`expected exactly one <script> block, found ${blocks.length}`);
  if (!/type="application\/json"/.test(blocks[0][1])) fail(`the one <script> block is not type="application/json": ${blocks[0][1]}`);
  return JSON.parse(blocks[0][2]);
}
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
function walk(v, fn) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
  else if (v && typeof v === 'object') {
    fn(v);
    Object.values(v).forEach((x) => walk(x, fn));
  }
}
// The suite's OWN normalisers (PLAN v2 step 5): the implementation's
// exported NORMALISE_* are checked against these, never trusted in place of
// them, so a normaliser that drops too much cannot hide a disagreement.
function normVolatile(v) {
  const c = clone(v);
  delete c.generatedAt;
  return c;
}
function normRecomputed(v) {
  const c = normVolatile(v);
  walk(c, (o) => {
    if (o.price && o.price.timestamps && typeof o.price.timestamps === 'object') delete o.price.timestamps.computedAt;
  });
  return c;
}
function firstDiff(a, b, p) {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${p || '<root>'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: array vs object`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k);
    if (d) return d;
  }
  return null;
}

// --- Group algebra ---------------------------------------------------------
function zeroTokens() {
  return { netInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cacheWriteTiered: false };
}
function zeroGroup() {
  const byFidelity = {};
  const priceBy = {};
  for (const f of FIDS) {
    byFidelity[f] = zeroTokens();
    priceBy[f] = { amount: null, pricedCount: 0, unpricedCount: 0, unconvertedCount: 0 };
  }
  return {
    recordCount: 0, capturedCount: 0, uncapturedCount: 0,
    tokens: { byFidelity, combined: { ...zeroTokens(), mixed: [] } },
    price: { amount: null, pricedCount: 0, unpricedCount: 0, unconvertedCount: 0, byFidelity: priceBy, mixed: [] },
  };
}
function addTokens(a, b) {
  const out = { ...a };
  for (const k of ['netInput', 'cacheRead', 'output', 'reasoning']) out[k] = (a[k] || 0) + (b[k] || 0);
  const ta = typeof a.cacheWrite === 'object';
  const tb = typeof b.cacheWrite === 'object';
  if (!ta && !tb) out.cacheWrite = (a.cacheWrite || 0) + (b.cacheWrite || 0);
  else {
    const m = {};
    for (const [side, t] of [[a.cacheWrite, ta], [b.cacheWrite, tb]]) {
      if (t) for (const [k, v] of Object.entries(side)) m[k] = (m[k] || 0) + v;
      else if (side) m.untiered = (m.untiered || 0) + side;
    }
    out.cacheWrite = m;
  }
  out.cacheWriteTiered = !!(a.cacheWriteTiered || b.cacheWriteTiered);
  return out;
}
function addAmount(a, b) {
  if (a === null || a === undefined) return b === undefined ? null : b;
  if (b === null || b === undefined) return a;
  return a + b;
}
function addGroups(a, b) {
  const out = clone(a);
  for (const k of COUNTS) out[k] = a[k] + b[k];
  for (const f of FIDS) {
    out.tokens.byFidelity[f] = addTokens(a.tokens.byFidelity[f], b.tokens.byFidelity[f]);
    const pa = a.price.byFidelity[f];
    const pb = b.price.byFidelity[f];
    out.price.byFidelity[f].amount = addAmount(pa.amount, pb.amount);
    for (const t of TALLIES) out.price.byFidelity[f][t] = pa[t] + pb[t];
  }
  const mixed = FIDS.filter((f) => (a.tokens.combined.mixed || []).includes(f) || (b.tokens.combined.mixed || []).includes(f));
  const { mixed: _m1, ...ca } = a.tokens.combined;
  const { mixed: _m2, ...cb } = b.tokens.combined;
  out.tokens.combined = { ...addTokens(ca, cb), mixed };
  out.price.amount = addAmount(a.price.amount, b.price.amount);
  for (const t of TALLIES) out.price[t] = a.price[t] + b.price[t];
  return out;
}
// Price amounts compare EXACTLY by default: a bucket and the view filtered
// to it sum the same records in the same (recordId) order, and so does
// 0209's rollup. Only `sums` (13.6) re-associates the additions — Σ of
// per-bucket sums against one sum over all records — so it alone sets a
// relative tolerance of 1e-12 (measured drift: ~2e-18 on the fixture).
let AMOUNT_TOLERANCE = 0;
function amountEq(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
  if (AMOUNT_TOLERANCE === 0) return a === b;
  return Math.abs(a - b) <= AMOUNT_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}
function tokensDiff(a, b, p) {
  for (const k of TOKEN_CLASSES) {
    const d = firstDiff(a[k], b[k], `${p}.${k}`);
    if (d) return d;
  }
  return null;
}
// groupDiff(a, b) — per fidelity: tokens, price amounts and the six tallies.
function groupDiff(a, b) {
  a = a || zeroGroup();
  b = b || zeroGroup();
  for (const k of COUNTS) if (a[k] !== b[k]) return `${k}: ${a[k]} != ${b[k]}`;
  for (const f of FIDS) {
    const d = tokensDiff(a.tokens.byFidelity[f], b.tokens.byFidelity[f], `tokens.byFidelity.${f}`);
    if (d) return d;
    const pa = a.price.byFidelity[f];
    const pb = b.price.byFidelity[f];
    if (!amountEq(pa.amount, pb.amount)) return `price.byFidelity.${f}.amount: ${pa.amount} != ${pb.amount}`;
    for (const t of TALLIES) if (pa[t] !== pb[t]) return `price.byFidelity.${f}.${t}: ${pa[t]} != ${pb[t]}`;
  }
  const d = tokensDiff(a.tokens.combined, b.tokens.combined, 'tokens.combined');
  if (d) return d;
  const dm = firstDiff(a.tokens.combined.mixed, b.tokens.combined.mixed, 'tokens.combined.mixed');
  if (dm) return dm;
  if (!amountEq(a.price.amount, b.price.amount)) return `price.amount: ${a.price.amount} != ${b.price.amount}`;
  for (const t of TALLIES) if (a.price[t] !== b.price[t]) return `price.${t}: ${a.price[t]} != ${b.price[t]}`;
  return null;
}
// Entries of byCli / byModel / byBucket carry their key under `key`
// (PLAN v2 D5); `cli` / `modelId` are accepted as the same key.
function entryKey(e) {
  if (Object.prototype.hasOwnProperty.call(e, 'key')) return e.key;
  if (Object.prototype.hasOwnProperty.call(e, 'cli')) return e.cli;
  if (Object.prototype.hasOwnProperty.call(e, 'modelId')) return e.modelId;
  return undefined;
}
function findEntry(list, key) {
  return (list || []).find((e) => entryKey(e) === key);
}
function isGroup(o) {
  return o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, 'recordCount') && o.price && o.tokens;
}
function groupsOf(view) {
  const out = [];
  function visit(o, p) {
    if (Array.isArray(o)) o.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (o && typeof o === 'object') {
      if (isGroup(o)) out.push([p, o]);
      for (const [k, v] of Object.entries(o)) visit(v, p ? `${p}.${k}` : k);
    }
  }
  visit(view, '');
  return out;
}

// --- ISO week (the suite's own implementation, independent of buckets.js) --
function isoWeekKey(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d.getTime() + (3 - dow) * 86400000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
  const week = Math.floor((thursday - week1Monday) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
function isoWeekBounds(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - dow * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}
function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// --- HTML figure hooks -----------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');
}
function textOf(inner) {
  return decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
function resolvePath(view, p) {
  const segs = [];
  const re = /([^.[\]]+)|\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(p)) !== null) segs.push(m[1] !== undefined ? m[1] : m[2]);
  let cur = view;
  for (const s of segs) {
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur)) {
      if (/^\d+$/.test(s)) cur = cur[Number(s)];
      else cur = findEntry(cur, s);
    } else cur = cur[s];
  }
  return cur;
}
function parentPath(p) {
  return p.replace(/(\.[^.[\]]+|\[[^\]]*\])$/, '');
}
function htmlCells(html) {
  const cells = [];
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\sdata-k="([^"]*)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1];
    const openEnd = m.index + m[0].length;
    const close = html.indexOf(`</${tag}>`, openEnd);
    if (close === -1) continue;
    const closeEnd = close + tag.length + 3;
    cells.push({ tag, path: decodeEntities(m[3]), text: textOf(html.slice(openEnd, close)), after: html.slice(closeEnd, closeEnd + 4000) });
  }
  return cells;
}
function nextStatement(after) {
  const m = /^\s*<span\b([^>]*)>([\s\S]*?)<\/span>/.exec(after);
  if (!m) return null;
  const attrs = m[1];
  if (!/class="[^"]*\bprice-statement\b[^"]*"/.test(attrs)) return null;
  const s = /data-s="([^"]*)"/.exec(attrs);
  return { path: s ? decodeEntities(s[1]) : null, text: textOf(m[2]) };
}
function loadFormat() {
  try {
    return req('scripts/lib/usage-dashboard/format.js');
  } catch (err) {
    return null;
  }
}
function isMoneyPath(p) {
  return /(^|\.)amount$/.test(p) && /price/.test(p);
}
function checkCellText(view, cell, fmt) {
  const v = resolvePath(view, cell.path);
  if (v === undefined) return `data-k="${cell.path}" does not resolve in the view model`;
  if (isMoneyPath(cell.path)) {
    const price = resolvePath(view, parentPath(cell.path));
    const group = resolvePath(view, parentPath(parentPath(cell.path).replace(/\.byFidelity$/, '')));
    if (v === null) {
      const absent = (price && price.absent) || (group && group.price && group.price.absent);
      if (!/\u2014/.test(cell.text)) return `data-k="${cell.path}" is null but its text "${cell.text}" carries no em dash`;
      if (absent && !cell.text.includes(absent)) return `data-k="${cell.path}" is null but its text "${cell.text}" does not name the absence "${absent}"`;
      return null;
    }
    const currency = (price && price.currency) || view.pricing.currency || view.selection.currency;
    if (!cell.text.includes(v.toFixed(6))) return `data-k="${cell.path}" text "${cell.text}" does not carry ${v.toFixed(6)}`;
    if (currency && !cell.text.includes(currency)) return `data-k="${cell.path}" text "${cell.text}" does not carry the currency ${currency}`;
    if (fmt && typeof fmt.money === 'function' && fmt.money(v, currency) !== cell.text) return `data-k="${cell.path}" text "${cell.text}" != format.money() "${fmt.money(v, currency)}"`;
    return null;
  }
  if (typeof v === 'number') {
    if (cell.text !== String(v)) return `data-k="${cell.path}" text "${cell.text}" != ${v}`;
    return null;
  }
  if (Array.isArray(v)) {
    for (const f of v) if (!cell.text.includes(f)) return `data-k="${cell.path}" text "${cell.text}" does not name ${f}`;
    if (fmt && typeof fmt.mixed === 'function' && !cell.text.includes(fmt.mixed(v))) return `data-k="${cell.path}" text "${cell.text}" does not carry format.mixed() "${fmt.mixed(v)}"`;
    return null;
  }
  if (v && typeof v === 'object') {
    // a tiered cacheWrite renders as tier=n;... (PLAN v2 step 6)
    const parsed = {};
    for (const part of cell.text.split(';')) {
      const [k, n] = part.split('=');
      if (k !== undefined && n !== undefined) parsed[k.trim()] = Number(n);
    }
    const d = firstDiff(parsed, v, cell.path);
    return d ? `data-k="${cell.path}" text "${cell.text}" does not parse back: ${d}` : null;
  }
  if (typeof v === 'string') return cell.text === v ? null : `data-k="${cell.path}" text "${cell.text}" != "${v}"`;
  if (v === null) return /\u2014/.test(cell.text) || cell.text === '' ? null : `data-k="${cell.path}" null rendered as "${cell.text}"`;
  return null;
}
function statementExpected(view, pricePath, fmt) {
  const price = resolvePath(view, pricePath);
  if (!price) return { err: `price path ${pricePath} does not resolve` };
  if (fmt && typeof fmt.priceStatement === 'function') return { text: fmt.priceStatement(price), price };
  return { text: null, price };
}
function checkStatementText(text, price) {
  if (!/reference figure, not an invoice/.test(text)) return 'the statement lacks "reference figure, not an invoice"';
  const ts = price.timestamps || {};
  if (ts.snapshotSha && !text.includes(ts.snapshotSha)) return `the statement lacks the snapshot sha ${ts.snapshotSha}`;
  if (ts.snapshotFetchedAt && !text.includes(ts.snapshotFetchedAt)) return `the statement lacks the snapshot fetchedAt ${ts.snapshotFetchedAt}`;
  if (ts.computedAt && ts.computedAt.max && !text.includes(ts.computedAt.max)) return `the statement lacks computedAt ${ts.computedAt.max}`;
  return null;
}

// --- Form C parsing ---------------------------------------------------------
const TEXT_COLUMNS = ['key', 'records', 'uncaptured', 'netInput', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'fidelity', 'price', 'priced', 'unpriced', 'unconverted'];
function splitRow(line) {
  return line.split('|').map((c) => c.trim());
}
function parseText(txt) {
  const lines = txt.split('\n');
  const rows = [];
  let section = null;
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) {
      const h = /^==\s*(.*?)\s*==$/.exec(line.trim());
      if (h) section = h[1];
      continue;
    }
    const cells = splitRow(line);
    if (cells[0] === 'key' && cells[1] === 'records') {
      header = cells;
      continue;
    }
    if (!header || cells.length !== header.length) continue;
    const row = { section, line: i, next: lines[i + 1] === undefined ? '' : lines[i + 1] };
    header.forEach((h, j) => { row[h] = cells[j]; });
    rows.push(row);
  }
  return { lines, rows, headers: lines.filter((l) => /^\s*key\s*\|\s*records\b/.test(l)).map(splitRow) };
}

// --- HTTP ------------------------------------------------------------------
function httpReq(method, url, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.request({ host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method, headers: headers || {}, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', (err) => resolve({ status: err.code || 'ERROR', headers: {}, body: String(err.message) }));
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (body !== undefined && body !== null) r.write(body);
    r.end();
  });
}

function manifest(root) {
  const out = [];
  function visit(d) {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) visit(full);
      else out.push(`${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}  ${path.relative(root, full)}`);
    }
  }
  visit(root);
  return out.join('\n');
}

function requireClosure(dir) {
  const seen = new Set();
  const stack = fs.readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => path.join(dir, n));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      let target = path.resolve(path.dirname(f), m[1]);
      if (!target.endsWith('.js')) target += '.js';
      if (fs.existsSync(target)) stack.push(target);
    }
  }
  return [...seen].map((f) => path.relative(REPO, f)).sort();
}

// --- Commands ----------------------------------------------------------------
const cmds = {
  seed(fixturesDir, pricingDir) {
    pin(pricingDir);
    seedFx(pricingDir);
    writeRecords(path.join(fixturesDir, 'records'));
  },
  // prime-usd <recordsDir> — stores a USD price for every fixture record
  // through 0209's own priceRecord() (store: true). An uncaptured fixture
  // gets priceRecord()'s non-stored R34 marker, so only the captured ones
  // land under <root>/prices/**.
  async 'prime-usd'(dir) {
    const store = req('scripts/lib/usage-price/store.js');
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      await store.priceRecord(readJson(path.join(dir, name)), { currency: 'USD' });
    }
  },
  'pin-only'(pricingDir) {
    pin(pricingDir);
  },
  'seed-fx'(pricingDir) {
    seedFx(pricingDir);
  },
  'write-dir'(dir) {
    writeRecords(dir);
  },
  'write-one'(file) {
    const journal = req('scripts/lib/usage-store/journal.js');
    const result = journal.write(readJson(file));
    if (result.status !== 'stored') fail(`write-one: ${JSON.stringify(result)}`);
  },
  // clone-record <src> <dst> <idempotencyKey> <requestInstant> — a fresh
  // record for the "re-read on every request" check.
  'clone-record'(src, dst, key, at) {
    const r = readJson(src);
    r.idempotencyKey = key;
    r.recordId = crypto.createHash('sha256').update(`${r.identity.sessionId}\x1F${key}`).digest('hex');
    r.timing.requestInstant = at;
    r.timing.captureInstant = at;
    fs.writeFileSync(dst, JSON.stringify(r));
  },
  extract(htmlFile) {
    process.stdout.write(JSON.stringify(extractEmbedded(fs.readFileSync(htmlFile, 'utf8'))));
  },
  // equal <volatile|recomputed> <file>... — deep-equal under the suite's normaliser.
  equal(mode, ...files) {
    const norm = mode === 'recomputed' ? normRecomputed : normVolatile;
    const base = norm(readJson(files[0]));
    for (const f of files.slice(1)) {
      const d = firstDiff(base, norm(readJson(f)), '');
      if (d) fail(`${path.basename(files[0])} vs ${path.basename(f)}: ${d}`);
    }
    console.log('EQUAL');
  },
  // normalisers <file> — the implementation's exported normalisers agree with the suite's.
  normalisers(file) {
    const model = req('scripts/lib/usage-dashboard/model.js');
    const v = readJson(file);
    for (const [name, mine] of [['NORMALISE_VOLATILE', normVolatile], ['NORMALISE_RECOMPUTED', normRecomputed]]) {
      const theirs = model[name];
      if (typeof theirs !== 'function') fail(`model.js does not export ${name} as a function`);
      const d = firstDiff(mine(v), theirs(clone(v)), '');
      if (d) fail(`${name} disagrees with the suite's normaliser: ${d}`);
    }
    console.log('OK');
  },
  get(file, expr) {
    const find = findEntry;
    const v = readJson(file);
    // eslint-disable-next-line no-eval
    const r = eval(expr);
    console.log(typeof r === 'string' ? r : JSON.stringify(r));
  },
  // partition <file> — D3's identities in every group, all six tallies present.
  partition(file) {
    const v = readJson(file);
    const errs = [];
    const groups = groupsOf(v);
    for (const [p, g] of groups) {
      for (const k of [...COUNTS]) if (!Number.isInteger(g[k])) errs.push(`${p}.${k} is not an integer: ${g[k]}`);
      for (const k of TALLIES) if (!Number.isInteger(g.price[k])) errs.push(`${p}.price.${k} is not an integer: ${g.price[k]}`);
      if (g.capturedCount + g.uncapturedCount !== g.recordCount) errs.push(`${p}: captured ${g.capturedCount} + uncaptured ${g.uncapturedCount} != records ${g.recordCount}`);
      if (v.pricing && v.pricing.available !== false) {
        const s = g.price.pricedCount + g.price.unpricedCount + g.price.unconvertedCount;
        if (s !== g.capturedCount) errs.push(`${p}: priced+unpriced+unconverted ${s} != captured ${g.capturedCount}`);
      }
      for (const t of TALLIES) {
        let s = 0;
        for (const f of FIDS) {
          const e = g.price.byFidelity && g.price.byFidelity[f];
          if (!e || !Number.isInteger(e[t])) errs.push(`${p}.price.byFidelity.${f}.${t} missing`);
          else s += e[t];
        }
        if (s !== g.price[t]) errs.push(`${p}: sum over fidelities of ${t} ${s} != ${g.price[t]}`);
      }
      if (g.price.pricedCount === 0 && g.price.amount !== null) errs.push(`${p}: pricedCount 0 but amount ${g.price.amount} (R4: never a zero standing in for a price)`);
      if (g.price.amount === null && !g.price.absent) errs.push(`${p}: amount null without an absent reason`);
    }
    if (groups.length === 0) errs.push('no group found in the view');
    if (errs.length) fail(errs.slice(0, 8).join('\n'));
    console.log(`OK ${groups.length}`);
  },
  // group-eq <fileA> <exprA> <fileB> <exprB> — exprs over `v`, `find`; undefined = zero group.
  'group-eq'(fa, ea, fb, eb) {
    const find = findEntry;
    let v = readJson(fa);
    // eslint-disable-next-line no-eval
    const a = eval(ea);
    v = readJson(fb);
    // eslint-disable-next-line no-eval
    const b = eval(eb);
    const d = groupDiff(a, b);
    if (d) fail(d);
    console.log('OK');
  },
  // sums <file> — Σ day = Σ week = Σ month = Σ byCli = Σ byModel = totals.
  sums(file) {
    AMOUNT_TOLERANCE = 1e-12;
    const v = readJson(file);
    const errs = [];
    const dims = [['byBucket.day', v.byBucket.day], ['byBucket.week', v.byBucket.week], ['byBucket.month', v.byBucket.month], ['byCli', v.byCli], ['byModel', v.byModel]];
    for (const [name, list] of dims) {
      if (!Array.isArray(list) || list.length === 0) {
        errs.push(`${name} is empty or missing`);
        continue;
      }
      const s = list.reduce((acc, e) => addGroups(acc, e), zeroGroup());
      const d = groupDiff(s, v.totals);
      if (d) errs.push(`Σ ${name} != totals: ${d}`);
      const keys = list.map(entryKey);
      if (name.startsWith('byBucket') && keys.join('\n') !== [...keys].sort().join('\n')) errs.push(`${name} keys are not ascending: ${keys.join(',')}`);
    }
    if (errs.length) fail(errs.join('\n'));
    console.log('OK');
  },
  // session-subtree <unfilteredView> <filteredView> <sessionId> — i1-F1: the
  // --session X view's sessions[X] group lists the same agents, with equal
  // tokens, prices and tallies, as the unfiltered view's sessions[X].
  'session-subtree'(fa, fb, sid) {
    const a = readJson(fa).sessions.find((s) => s.sessionId === sid);
    const b = readJson(fb).sessions.find((s) => s.sessionId === sid);
    if (!a) fail(`the unfiltered view has no session ${sid}`);
    if (!b) fail(`the --session ${sid} view has no session ${sid}`);
    if (a.agents.length === 0) fail(`fixture precondition: ${sid} has no agent in the unfiltered view`);
    const errs = [];
    const d = groupDiff(a, b);
    if (d) errs.push(`sessions[${sid}]: ${d}`);
    const ia = a.agents.map((x) => x.agentId);
    const ib = b.agents.map((x) => x.agentId);
    if (JSON.stringify(ia) !== JSON.stringify(ib)) errs.push(`agents ${JSON.stringify(ib)} != unfiltered ${JSON.stringify(ia)}`);
    for (const x of a.agents) {
      const y = b.agents.find((z) => z.agentId === x.agentId);
      if (!y) continue;
      const dd = groupDiff(x, y);
      if (dd) errs.push(`agent ${JSON.stringify(x.agentId)}: ${dd}`);
    }
    if (errs.length) fail(errs.join('\n'));
    console.log(`OK ${ia.length} agents`);
  },
  // session-block <htmlFile|txtFile> <sessionId> — the rendered drill-down
  // block of one session (HTML <details> or the text "session X" block).
  'session-block'(file, sid) {
    const src = fs.readFileSync(file, 'utf8');
    let block = null;
    if (/<details>/.test(src)) {
      const re = /<details><summary>Session <code>([\s\S]*?)<\/code>[\s\S]*?<\/details>/g;
      let m;
      while ((m = re.exec(src)) !== null) if (decodeEntities(m[1]) === sid) block = m[0];
    } else {
      const lines = src.split('\n');
      const i = lines.findIndex((l) => l.startsWith(`session ${sid} `));
      if (i !== -1) {
        let j = i + 1;
        while (j < lines.length && !/^session /.test(lines[j]) && !/^== /.test(lines[j])) j += 1;
        block = lines.slice(i, j).join('\n');
      }
    }
    if (block === null) fail(`no drill-down block for session ${sid}`);
    process.stdout.write(block);
  },
  'iso-week'(day) {
    console.log(isoWeekKey(day));
  },
  'week-bounds'(day) {
    console.log(isoWeekBounds(day).join(' '));
  },
  'last-day'(month) {
    console.log(lastDayOfMonth(month));
  },
  // fixture-axes <recordsDir> — every UTC day, ISO week (Monday), month, model and CLI holding a record.
  'fixture-axes'(dir, axis) {
    const recs = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => readJson(path.join(dir, n)));
    const days = [...new Set(recs.map((r) => r.timing.requestInstant.slice(0, 10)))].sort();
    let out;
    if (axis === 'day') out = days;
    else if (axis === 'week') out = [...new Set(days.map((d) => `${isoWeekKey(d)} ${isoWeekBounds(d).join(' ')}`))].sort();
    else if (axis === 'month') out = [...new Set(days.map((d) => d.slice(0, 7)))].sort();
    else if (axis === 'model') out = [...new Set(recs.filter((r) => r.modelId).map((r) => r.modelId))].sort();
    else if (axis === 'cli') out = [...new Set(recs.map((r) => r.provenance.cli))].sort();
    console.log(out.join('\n'));
  },
  // cells <htmlFile> <viewFile> — every data-k cell equals format(<value at path>);
  // every .price.amount cell is immediately followed by its price statement (13.2).
  cells(htmlFile, viewFile) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const v = readJson(viewFile);
    const fmt = loadFormat();
    const cells = htmlCells(html);
    const errs = [];
    let priceCells = 0;
    for (const c of cells) {
      const e = checkCellText(v, c, fmt);
      if (e) errs.push(e);
      // and the one shared formatter both renderers use (PLAN v2 step 6)
      if (!e && fmt && typeof fmt.cell === 'function') {
        const want = String(fmt.cell(v, c.path)).replace(/\s+/g, ' ').trim();
        if (c.text !== want) errs.push(`data-k="${c.path}" text "${c.text}" != format.cell() "${want}"`);
      }
      if (/\.price\.amount$/.test(c.path)) {
        priceCells += 1;
        const st = nextStatement(c.after);
        const pricePath = parentPath(c.path);
        const groupPath = parentPath(pricePath);
        if (!st) {
          errs.push(`data-k="${c.path}" is not immediately followed by a <span class="price-statement" data-s>`);
          continue;
        }
        if (st.path !== groupPath && st.path !== pricePath) errs.push(`data-k="${c.path}" is followed by data-s="${st.path}", not its own group path "${groupPath}"`);
        const exp = statementExpected(v, pricePath, fmt);
        if (exp.err) errs.push(exp.err);
        else {
          if (exp.text !== null && st.text !== textOf(exp.text)) errs.push(`statement after ${c.path}: "${st.text}" != format.priceStatement() "${exp.text}"`);
          const e2 = checkStatementText(st.text, exp.price);
          if (e2) errs.push(`statement after ${c.path}: ${e2}`);
        }
      }
    }
    const statements = (html.match(/<span\b[^>]*class="[^"]*\bprice-statement\b[^"]*"[^>]*data-s="/g) || []).length +
      (html.match(/<span\b[^>]*data-s="[^"]*"[^>]*class="[^"]*\bprice-statement\b/g) || []).length;
    if (cells.length === 0) errs.push('no data-k cell found');
    if (priceCells === 0) errs.push('no .price.amount cell found');
    if (statements !== priceCells) errs.push(`${priceCells} .price.amount cells but ${statements} data-s price statements`);
    for (const need of ['totals.recordCount', 'totals.uncapturedCount', 'totals.price.unpricedCount', 'totals.price.amount']) {
      if (!cells.some((c) => c.path === need)) errs.push(`no data-k="${need}" cell (R8: the count is never omitted)`);
    }
    if (errs.length) fail(errs.slice(0, 10).join('\n'));
    console.log(`OK ${cells.length} cells, ${priceCells} prices`);
  },
  // text-check <txtFile> <viewFile> — C's rows parse back to the view model's
  // figures; every price row is followed by its note: statement line.
  // mode 'recomputed': the text and --json runs are two invocations whose
  // prices were each recomputed, so the statement's computedAt tail differs.
  'text-check'(txtFile, viewFile, mode) {
    const txt = fs.readFileSync(txtFile, 'utf8');
    const v = readJson(viewFile);
    const fmt = loadFormat();
    const parsed = parseText(txt);
    const errs = [];
    if (/\x1b/.test(txt)) errs.push('the text report contains an ESC byte');
    if (parsed.headers.length === 0) errs.push('no header row "key | records | …" found');
    for (const h of parsed.headers) if (h.join('|') !== TEXT_COLUMNS.join('|')) errs.push(`header columns ${h.join(',')} != ${TEXT_COLUMNS.join(',')}`);
    // Rows map onto the view model's groups by (section, key). The first row
    // of a group is its combined figure; when several fidelities are
    // present, one row per fidelity follows it (records, uncaptured and price
    // print "-" there: those are group-level figures).
    const noModel = '(no model: uncaptured)';
    function groupFor(r) {
      const sec = r.section || '';
      if (/^Totals$/.test(sec)) return v.totals;
      let m = /^By (day|week|month)\b/.exec(sec);
      if (m) return findEntry(v.byBucket[m[1]], r.key);
      if (/^By CLI$/.test(sec)) return findEntry(v.byCli, r.key);
      if (/^By model$/.test(sec)) return findEntry(v.byModel, r.key === noModel ? null : r.key);
      if (/^Sessions/.test(sec)) {
        const sessionRow = v.sessions.find((x) => x.sessionId === r.key);
        if (sessionRow) return sessionRow;
        for (const x of v.sessions) {
          const a = (x.agents || []).find((y) => y.agentId === r.key);
          if (a) return a;
        }
        return undefined;
      }
      if (/^Tasks$/.test(sec)) return v.tasks.find((x) => x.taskHandoffKey === r.key);
      if (/^Assets$/.test(sec)) return v.assets.find((x) => `${x.kind}:${x.ref}` === r.key || x.ref === r.key);
      return undefined;
    }
    let checkedRows = 0;
    let sawTotals = false;
    for (const r of parsed.rows) {
      const g = groupFor(r);
      if (!g) {
        if (/^(Totals|By |Tasks$)/.test(r.section || '')) errs.push(`row "${r.key}" in section "${r.section}" maps to no group of the view model`);
        continue;
      }
      if (r.section === 'Totals') sawTotals = true;
      checkedRows += 1;
      const f = FIDS.includes(r.fidelity) && r.records === '-' ? r.fidelity : null;
      const tok = f ? g.tokens.byFidelity[f] : g.tokens.combined;
      const pr = f ? g.price.byFidelity[f] : g.price;
      const where = `${r.section} row "${r.key}"${f ? ` (${f})` : ''}`;
      if (!f) {
        if (r.records !== String(g.recordCount)) errs.push(`${where} records "${r.records}" != ${g.recordCount}`);
        if (r.uncaptured !== String(g.uncapturedCount)) errs.push(`${where} uncaptured "${r.uncaptured}" != ${g.uncapturedCount}`);
        const mixed = g.tokens.combined.mixed || [];
        if (fmt && typeof fmt.mixed === 'function' && mixed.length > 1 && r.fidelity !== fmt.mixed(mixed)) errs.push(`${where} fidelity "${r.fidelity}" != format.mixed() "${fmt.mixed(mixed)}"`);
        if (mixed.length === 1 && r.fidelity !== mixed[0]) errs.push(`${where} fidelity "${r.fidelity}" != ${mixed[0]}`);
        if (pr.amount === null) {
          if (!/\u2014/.test(r.price) || (pr.absent && !r.price.includes(pr.absent))) errs.push(`${where} price "${r.price}" is not the explicit absence "${pr.absent}"`);
        } else {
          if (!r.price.includes(pr.amount.toFixed(6))) errs.push(`${where} price "${r.price}" does not carry ${pr.amount.toFixed(6)}`);
          if (fmt && typeof fmt.money === 'function' && r.price !== fmt.money(pr.amount, g.price.currency)) errs.push(`${where} price "${r.price}" != format.money() "${fmt.money(pr.amount, g.price.currency)}"`);
        }
      }
      for (const k of ['netInput', 'cacheRead', 'output', 'reasoning']) {
        if (r[k] !== String(tok[k])) errs.push(`${where} ${k} "${r[k]}" != ${tok[k]}`);
      }
      const cw = typeof tok.cacheWrite === 'object'
        ? Object.fromEntries(r.cacheWrite.split(';').map((x) => x.split('=')).map(([a, b]) => [a, Number(b)]))
        : Number(r.cacheWrite);
      const dcw = firstDiff(cw, tok.cacheWrite, 'cacheWrite');
      if (dcw) errs.push(`${where} ${dcw}`);
      if (r.priced !== String(pr.pricedCount)) errs.push(`${where} priced "${r.priced}" != ${pr.pricedCount}`);
      if (r.unpriced !== String(pr.unpricedCount)) errs.push(`${where} unpriced "${r.unpriced}" != ${pr.unpricedCount}`);
      if (r.unconverted !== String(pr.unconvertedCount)) errs.push(`${where} unconverted "${r.unconverted}" != ${pr.unconvertedCount}`);
    }
    if (!sawTotals) errs.push('no row under the Totals section');
    // every row that prints a price is immediately followed by its note: line (R20)
    for (const r of parsed.rows) {
      if (r.price === undefined || r.price === '' || r.price === '-') continue;
      if (!/^\s*note: /.test(r.next)) errs.push(`row "${r.key}" (section ${r.section}) with a price is not followed by a "note: " line`);
      else if (!/reference figure, not an invoice/.test(r.next)) errs.push(`note after row "${r.key}" lacks the reference-figure statement`);
    }
    if (fmt && typeof fmt.priceStatement === 'function') {
      const mask = (l) => (mode === 'recomputed' ? l.replace(/computed \S+( to \S+)?$/, 'computed <recomputed>') : l).trim();
      const want = `note: ${fmt.priceStatement(v.totals.price)}`;
      if (!parsed.lines.some((l) => mask(l) === mask(want))) errs.push(`no note line equals the totals price statement "${want}"`);
    }
    if (errs.length) fail(errs.slice(0, 10).join('\n'));
    console.log(`OK ${checkedRows} rows`);
  },
  // http <method> <url> <outPrefix> [headersJson] [body]
  async http(method, url, out, headersJson, body) {
    const r = await httpReq(method, url, headersJson ? JSON.parse(headersJson) : {}, body);
    fs.writeFileSync(`${out}.status`, String(r.status));
    fs.writeFileSync(`${out}.headers`, JSON.stringify(r.headers));
    fs.writeFileSync(`${out}.body`, r.body);
  },
  // connect <host> <port> — prints CONNECTED or the error code.
  connect(host, port) {
    const s = net.connect({ host, port: Number(port), timeout: 3000 });
    s.on('connect', () => { console.log('CONNECTED'); s.destroy(); });
    s.on('timeout', () => { console.log('TIMEOUT'); s.destroy(); });
    s.on('error', (e) => console.log(e.code || 'ERROR'));
  },
  'non-internal-ipv4'() {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) {
        if ((a.family === 'IPv4' || a.family === 4) && !a.internal) {
          console.log(a.address);
          return;
        }
      }
    }
    console.log('');
  },
  // hold-port — a foreign listener on 127.0.0.1:<ephemeral>; prints PORT=<n>.
  'hold-port'() {
    const s = http.createServer((q, r) => { r.end('held-by-test-listener'); });
    s.listen(0, '127.0.0.1', () => console.log(`PORT=${s.address().port}`));
  },
  manifest(root) {
    console.log(manifest(root));
  },
  'require-closure'(dir) {
    console.log(requireClosure(dir).join('\n'));
  },
  // rollup0209 <taskKey> — spec 0209's own rollup, store:false, USD, combined.
  async rollup0209(taskKey) {
    const priceRollup = req('scripts/lib/usage-price/rollup.js');
    const r = await priceRollup.rollup({ taskKey }, { store: false, combined: true, currency: 'USD' });
    console.log(JSON.stringify(r));
  },
  // cross0209 <viewFile> <rollupFile> — v1-F5/v2-F3's explicit mapping.
  cross0209(viewFile, rollupFile) {
    const v = readJson(viewFile);
    const r = readJson(rollupFile);
    const errs = [];
    const p = v.totals.price;
    for (const f of FIDS) {
      const d = p.byFidelity[f];
      const o = r.byFidelity[f];
      if (!amountEq(d.amount === null ? 0 : d.amount, o.sum)) errs.push(`${f}: amount ?? 0 = ${d.amount} != sum ${o.sum}`);
      if (d.pricedCount + d.unpricedCount + d.unconvertedCount !== o.count) errs.push(`${f}: tally sum != count ${o.count}`);
      if (d.unpricedCount !== o.unpricedCount) errs.push(`${f}: unpricedCount ${d.unpricedCount} != ${o.unpricedCount}`);
      if (d.unconvertedCount !== 0) errs.push(`${f}: unconvertedCount ${d.unconvertedCount} != 0 under USD`);
    }
    // v2-F3: 0209's combined is {sum, unpricedCount, mixed} — no count row.
    if (!amountEq(p.amount === null ? 0 : p.amount, r.combined.sum)) errs.push(`combined: amount ?? 0 = ${p.amount} != sum ${r.combined.sum}`);
    if (p.unpricedCount !== r.combined.unpricedCount) errs.push(`combined: unpricedCount ${p.unpricedCount} != ${r.combined.unpricedCount}`);
    const dm = firstDiff(p.mixed, r.combined.mixed, 'mixed');
    if (dm) errs.push(`combined: ${dm}`);
    if (v.totals.uncapturedCount !== r.uncapturedCount) errs.push(`uncapturedCount ${v.totals.uncapturedCount} != ${r.uncapturedCount}`);
    if (errs.length) fail(errs.join('\n'));
    console.log('OK');
  },
  // tokens-eq <viewExprFile> <expr> <queryRollupFile> — tokens vs usage:query --rollup --combined.
  'tokens-eq'(viewFile, expr, rollupFile) {
    const find = findEntry;
    const v = readJson(viewFile);
    // eslint-disable-next-line no-eval
    const g = eval(expr);
    const r = readJson(rollupFile);
    if (!g) fail(`${expr} does not resolve`);
    const errs = [];
    for (const f of FIDS) {
      const d = firstDiff(g.tokens.byFidelity[f], r.byFidelity[f], `tokens.byFidelity.${f}`);
      if (d) errs.push(d);
    }
    const d = firstDiff(g.tokens.combined, r.combined, 'tokens.combined');
    if (d) errs.push(d);
    if (g.uncapturedCount !== r.uncapturedCount) errs.push(`uncapturedCount ${g.uncapturedCount} != ${r.uncapturedCount}`);
    if (errs.length) fail(errs.join('\n'));
    console.log('OK');
  },
  // offline-guard — M8's guard: CREWRIG_USAGE_OFFLINE unset, fetch stubbed.
  async 'offline-guard'() {
    delete process.env.CREWRIG_USAGE_OFFLINE;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('network forbidden in this suite');
    };
    const filters = req('scripts/lib/usage-dashboard/filters.js');
    const model = req('scripts/lib/usage-dashboard/model.js');
    const view = await model.build(filters.parse(['--currency', 'EUR']), { now: new Date() });
    const reasons = [];
    walk(view, (o) => { if (o.fxStaleness && o.fxStaleness.reason) reasons.push(o.fxStaleness.reason); });
    console.log(`FETCH_CALLS=${calls}`);
    console.log(`PRICED=${view.totals.price.pricedCount}`);
    console.log(`STALENESS=${[...new Set(reasons)].join(',')}`);
  },
  // stored-computed-max <root> — the newest computedAt among stored price files.
  'stored-computed-max'(root) {
    let max = '';
    function visit(d) {
      if (!fs.existsSync(d)) return;
      for (const n of fs.readdirSync(d)) {
        const full = path.join(d, n);
        if (fs.statSync(full).isDirectory()) visit(full);
        else if (n.endsWith('.price.json')) {
          const c = readJson(full).computedAt;
          if (c > max) max = c;
        }
      }
    }
    visit(path.join(root, 'prices'));
    console.log(max);
  },
  'stored-amount'(root, recordId) {
    function visit(d) {
      for (const n of fs.readdirSync(d)) {
        const full = path.join(d, n);
        if (fs.statSync(full).isDirectory()) {
          const r = visit(full);
          if (r !== undefined) return r;
        } else if (n === `${recordId}.price.json`) return readJson(full);
      }
      return undefined;
    }
    const p = visit(path.join(root, 'prices'));
    console.log(p ? JSON.stringify({ amount: p.amount, currency: p.currency, status: p.conversion && p.conversion.status }) : 'null');
  },
  // form-token <htmlFile> — the per-process POST token the served page carries.
  'form-token'(htmlFile) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const m = /name="token"[^>]*value="([^"]+)"/.exec(html) || /value="([^"]+)"[^>]*name="token"/.exec(html);
    console.log(m ? m[1] : '');
  },
  // qs <argv...> — the query string form B receives for the same argv (D6).
  qs(...argv) {
    const params = new URLSearchParams();
    for (let i = 0; i < argv.length; i++) {
      const name = argv[i].replace(/^--/, '');
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) params.append(name, '');
      else {
        params.append(name, next);
        i += 1;
      }
    }
    const s = params.toString();
    console.log(s ? `?${s}` : '');
  },
};

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmds[cmd]) {
    console.error(`unknown driver command: ${cmd}`);
    process.exit(2);
  }
  await cmds[cmd](...args);
})().catch((err) => {
  console.log(`DRIVER-ERROR ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
NODE_EOF

drv() {
  USAGE_TEST_REPO_DIR="$DASH_REPO" node --disable-warning=ExperimentalWarning "$DRIVER" "$@"
}

dash() {
  bash "$DASH_REPO/scripts/usage-dashboard.sh" "$@"
}

expect() {
  # $1 = a JS expression over `v` (the parsed expected.json)
  node -e "const v = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); const r = eval(process.argv[2]); console.log(typeof r === 'string' ? r : JSON.stringify(r))" "$EXPECTED" "$1"
}

vget() {
  # $1 = view JSON file, $2 = JS expression over `v`
  drv get "$1" "$2"
}

# label for a check: prefixed during case 13.20 so a mutated run never reads
# like a main-pass result.
L() {
  if [ "$IN_MUTATION" = "1" ]; then echo "[mutated] $1"; else echo "$1"; fi
}

# record_view <file> — every view model the main pass produces is re-checked
# for D3's partition identities at the end (case 13.4, "in every run").
VIEW_SEQ=0
record_view() {
  if [ "$IN_MUTATION" = "1" ]; then return 0; fi
  VIEW_SEQ=$((VIEW_SEQ + 1))
  cp "$1" "$VIEWS_DIR/$VIEW_SEQ-$(basename "$1")"
}

# --- Seeded fixture root, built once and copied per case ---------------------
GOLDEN_ROOT="$(mktemp -d)"
CASE_ROOTS="$CASE_ROOTS $GOLDEN_ROOT"
seed_golden() {
  local palace
  palace="$(mktemp -d)"
  CASE_ROOTS="$CASE_ROOTS $palace"
  (
    export CREWRIG_USAGE_ROOT="$GOLDEN_ROOT"
    export MEMPALACE_PALACE_PATH="$palace/palace"
    drv seed "$FIXTURES_DIR" "$PRICING_FIXTURES_DIR"
    bash "$REPO_DIR/scripts/usage-attribute.sh" add --period 2026-11 --task-key task-split-b \
      --reason "usage-dashboard suite: a ledger {period} entry splits sess-split across two task keys" \
      --author "test-suite" >/dev/null
    # Prime the price store in USD (stored), so USD views are served from it
    # and their computedAt is identical across forms (PLAN v2 13.1).
    drv prime-usd "$FIXTURES_DIR/records"
  )
}

# fresh_root_into <var> [golden|empty] — a fresh case root in the CURRENT shell.
fresh_root_into() {
  local __var="$1" kind="${2:-golden}" d p
  d="$(mktemp -d)"
  p="$(mktemp -d)"
  CASE_ROOTS="$CASE_ROOTS $d $p"
  if [ "$kind" = "golden" ]; then
    cp -R "$GOLDEN_ROOT/." "$d/"
  fi
  export CREWRIG_USAGE_ROOT="$d"
  export MEMPALACE_PALACE_PATH="$p/palace"
  eval "$__var=\"\$d\""
}

new_out_dir() {
  local d
  d="$(mktemp -d "$HELPERS_DIR/out.XXXXXX")"
  echo "$d"
}

# --- Form B lifecycle ----------------------------------------------------
SERVER_PID=""
SERVER_PORT=""
SERVER_LOG=""

# start_server [args...] — foreground `serve --port 0` put in the background
# by the suite; waits for its LISTENING line. Returns 1 if it never listens.
start_server() {
  SERVER_LOG="$(mktemp "$HELPERS_DIR/serve.XXXXXX")"
  bash "$DASH_REPO/scripts/usage-dashboard.sh" serve --port 0 "$@" >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  BG_PIDS="$BG_PIDS $SERVER_PID"
  SERVER_PORT=""
  local i=0 line
  while [ $i -lt 150 ]; do
    line="$(sed -n 's#^LISTENING http://127\.0\.0\.1:\([0-9][0-9]*\)/.*#\1#p' "$SERVER_LOG" | head -n 1)"
    if [ -n "$line" ]; then
      SERVER_PORT="$line"
      return 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}

# http_to <out> <method> <path> [headersJson] [body]
http_to() {
  local out="$1" method="$2" p="$3"
  drv http "$method" "http://127.0.0.1:$SERVER_PORT$p" "$out" "${4:-}" "${5:-}"
}

# run_bounded <secs> <outfile> <cmd...> — runs cmd, kills it past the bound;
# prints the exit status (124 when killed).
run_bounded() {
  local secs="$1" out="$2" pid i=0 rc
  shift 2
  "$@" >"$out" 2>&1 &
  pid=$!
  BG_PIDS="$BG_PIDS $pid"
  while [ $i -lt $((secs * 10)) ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rc=0
      wait "$pid" || rc=$?
      echo "$rc"
      return 0
    fi
    sleep 0.1
    i=$((i + 1))
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  echo 124
}

# three_forms <outDir> <label> [filters...] — A (page, embedded JSON), C
# (report --json and text) for one selection; B is queried by the caller
# against a running server with forms_b.
three_forms() {
  local out="$1" label="$2"
  shift 2
  dash page --out "$out/$label.A.html" "$@" >"$out/$label.A.stdout" 2>"$out/$label.A.stderr" || true
  if [ -f "$out/$label.A.html" ]; then
    drv extract "$out/$label.A.html" >"$out/$label.A.json" 2>"$out/$label.A.extract.err" || true
  fi
  dash report --json "$@" >"$out/$label.C.json" 2>"$out/$label.C.stderr" || true
  dash report "$@" >"$out/$label.C.txt" 2>"$out/$label.C.txt.stderr" || true
}

# forms_b <outDir> <label> [filters...] — B's page (embedded JSON) and /view.json.
forms_b() {
  local out="$1" label="$2" qs
  shift 2
  qs="$(drv qs "$@")"
  http_to "$out/$label.Bpage" GET "/$qs"
  http_to "$out/$label.Bview" GET "/view.json$qs"
  cp "$out/$label.Bpage.body" "$out/$label.B.html"
  drv extract "$out/$label.B.html" >"$out/$label.B.json" 2>"$out/$label.B.extract.err" || true
  cp "$out/$label.Bview.body" "$out/$label.Bv.json"
}

json_ok() {
  [ -s "$1" ] && node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$1" >/dev/null 2>&1
}

echo "=== usage-dashboard suite (spec 0210 R26-R30) ==="
echo "FIXTURES_DIR=$FIXTURES_DIR"
seed_golden

# =============================================================================
# Case 13.1 — the four renderings of one view agree (R2, R26), and every
# rendered figure equals format(<model value>) — explicit normalisers (v1-F3).
# 13.2 — a price statement sits next to every price (R20, v1-F6).
# Run together: they read the same outputs.
# =============================================================================
# agreement_run <out> <label> <volatile|recomputed> [filters...]
agreement_run() {
  local out="$1" label="$2" mode="$3" rc msg f missing=""
  shift 3
  three_forms "$out" "$label" "$@"
  forms_b "$out" "$label" "$@"
  for f in A C B Bv; do
    json_ok "$out/$label.$f.json" || missing="$missing $f"
  done
  if [ -n "$missing" ]; then
    bad "$(L "13.1 [$label] every form yields a view model")" "missing or unparsable:$missing
A: $(cat "$out/$label.A.stderr" "$out/$label.A.extract.err" 2>/dev/null | head -5)
C: $(head -5 "$out/$label.C.stderr" 2>/dev/null)
B: $(cat "$out/$label.Bpage.status" 2>/dev/null) $(head -c 300 "$out/$label.Bpage.body" 2>/dev/null)"
    return 0
  fi
  for f in A C B Bv; do record_view "$out/$label.$f.json"; done
  rc=0
  msg="$(drv equal "$mode" "$out/$label.A.json" "$out/$label.C.json" "$out/$label.B.json" "$out/$label.Bv.json")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L "13.1 [$label] A, B page, B /view.json and C --json are deep-equal ($mode)")"
  else
    bad "$(L "13.1 [$label] A, B page, B /view.json and C --json are deep-equal ($mode)")" "$msg"
  fi
  for f in A B; do
    rc=0
    msg="$(drv cells "$out/$label.$f.html" "$out/$label.$f.json")" || rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "$(L "13.1/13.2 [$label] form $f: every data-k cell equals format(value), a statement follows every price ($msg)")"
    else
      bad "$(L "13.1/13.2 [$label] form $f: every data-k cell equals format(value), a statement follows every price")" "$msg"
    fi
  done
  rc=0
  msg="$(drv text-check "$out/$label.C.txt" "$out/$label.C.json" "$mode")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L "13.1/13.2 [$label] form C rows parse back to the view model, a note: line follows every price ($msg)")"
  else
    bad "$(L "13.1/13.2 [$label] form C rows parse back to the view model, a note: line follows every price")" "$msg"
  fi
}

case_agreement() {
  local root out rc msg
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.1 form B starts on --port 0 and prints LISTENING')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  # Primed USD runs are compared strictly (their prices come from the store,
  # so computedAt must match); runs whose prices are recomputed per
  # invocation drop price.timestamps.computedAt (NORMALISE_RECOMPUTED).
  agreement_run "$out" whole volatile
  agreement_run "$out" mixed volatile --task-key task-mixed
  agreement_run "$out" ranged volatile --from 2026-10-01 --to 2026-10-31 --model claude-sonnet-5
  agreement_run "$out" eur recomputed --currency EUR
  agreement_run "$out" xxx recomputed --currency XXX

  # The implementation's exported normalisers match the suite's own.
  rc=0
  msg="$(drv normalisers "$out/whole.C.json")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L '13.1 model.js exports NORMALISE_VOLATILE / NORMALISE_RECOMPUTED matching their definition')"
  else
    bad "$(L '13.1 model.js exports NORMALISE_VOLATILE / NORMALISE_RECOMPUTED matching their definition')" "$msg"
  fi

  # A primed USD run is served from the store: the strict comparison must
  # also hold between two separate C invocations.
  dash report --json >"$out/whole.C2.json" 2>/dev/null || true
  rc=0
  msg="$(drv equal volatile "$out/whole.C.json" "$out/whole.C2.json")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L '13.1 two USD runs over a primed store agree exactly, computedAt included')"
  else
    bad "$(L '13.1 two USD runs over a primed store agree exactly, computedAt included')" "$msg"
  fi

  # The EUR run converts at the computation date with the fixture fixings
  # cached, so nothing is unconverted there (13.5 covers that path).
  if [ "$(vget "$out/eur.C.json" 'v.totals.price.unconvertedCount')" = "0" ] && [ "$(vget "$out/eur.C.json" 'v.totals.price.currency')" = "EUR" ]; then
    ok "$(L '13.1 [eur] priced in EUR with unconvertedCount 0')"
  else
    bad "$(L '13.1 [eur] priced in EUR with unconvertedCount 0')" "$(vget "$out/eur.C.json" 'v.totals.price')"
  fi

  # --as-of-today: form B has no GET parameter for it — its as-of-today form
  # is the live POST /recompute action (R16) — so A's and C's
  # `--as-of-today` are compared with B's recompute response.
  three_forms "$out" aot --as-of-today
  http_to "$out/tok" GET "/"
  local token
  token="$(drv form-token "$out/tok.body")"
  http_to "$out/recompute" POST "/recompute" "{\"Content-Type\":\"application/x-www-form-urlencoded\",\"Origin\":\"http://127.0.0.1:$SERVER_PORT\"}" "token=$token"
  cp "$out/recompute.body" "$out/aot.B.html"
  drv extract "$out/aot.B.html" >"$out/aot.B.json" 2>/dev/null || true
  if json_ok "$out/aot.A.json" && json_ok "$out/aot.C.json" && json_ok "$out/aot.B.json"; then
    for f in A C B; do record_view "$out/aot.$f.json"; done
    rc=0
    msg="$(drv equal recomputed "$out/aot.A.json" "$out/aot.C.json" "$out/aot.B.json")" || rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "$(L '13.1 [aot] page --as-of-today, report --json --as-of-today and B POST /recompute are deep-equal (recomputed)')"
    else
      bad "$(L '13.1 [aot] page --as-of-today, report --json --as-of-today and B POST /recompute are deep-equal (recomputed)')" "$msg"
    fi
    for f in A B; do
      rc=0
      msg="$(drv cells "$out/aot.$f.html" "$out/aot.$f.json")" || rc=$?
      if [ "$rc" -eq 0 ]; then
        ok "$(L "13.1/13.2 [aot] form $f: every data-k cell equals format(value), a statement follows every price ($msg)")"
      else
        bad "$(L "13.1/13.2 [aot] form $f: every data-k cell equals format(value), a statement follows every price")" "$msg"
      fi
    done
    rc=0
    msg="$(drv text-check "$out/aot.C.txt" "$out/aot.C.json" recomputed)" || rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "$(L "13.1/13.2 [aot] form C rows parse back to the view model ($msg)")"
    else
      bad "$(L '13.1/13.2 [aot] form C rows parse back to the view model')" "$msg"
    fi
  else
    bad "$(L '13.1 [aot] A, C and B POST /recompute each yield a view model')" "recompute status $(cat "$out/recompute.status"): $(head -c 300 "$out/recompute.body")"
  fi
  stop_server
}

# =============================================================================
# Case 13.3 — 0209 cross-check through the explicit mapping (v1-F5, v2-F3).
# USD is pinned because 0209's priceBucket adds every non-unpriced amount,
# unconverted ones included (usage-price/rollup.js), whereas a USD price is
# always status 'ok' — so unconvertedCount = 0 by construction here.
# --task-key is used, not --period, because 0209's period rollup filters
# first and diverges from D4 for a straddling session (case 13.8). v2-F3:
# 0209's `combined` is {sum, unpricedCount, mixed} — it has no `count`, so
# the combined mapping is amount ?? 0 <-> sum, unpricedCount <-> unpricedCount
# and mixed <-> mixed, with no count row.
# =============================================================================
case_0209() {
  local root out rc msg key
  fresh_root_into root
  out="$(new_out_dir)"
  for key in task-mixed task-split-b; do
    dash report --json --task-key "$key" --currency USD >"$out/$key.json" 2>"$out/$key.err" || true
    if ! json_ok "$out/$key.json"; then
      bad "$(L "13.3 [$key] report --json yields a view model")" "$(head -5 "$out/$key.err")"
      continue
    fi
    record_view "$out/$key.json"
    drv rollup0209 "$key" >"$out/$key.0209.json"
    rc=0
    msg="$(drv cross0209 "$out/$key.json" "$out/$key.0209.json")" || rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "$(L "13.3 [$key] totals.price maps onto usage-price rollup() per fidelity and combined (no count row)")"
    else
      bad "$(L "13.3 [$key] totals.price maps onto usage-price rollup() per fidelity and combined (no count row)")" "$msg"
    fi
    bash "$DASH_REPO/scripts/usage-query.sh" --task-key "$key" --rollup --combined >"$out/$key.query.json"
    rc=0
    msg="$(drv tokens-eq "$out/$key.json" "find(v.tasks.map((t) => ({ key: t.taskHandoffKey, ...t })), '$key')" "$out/$key.query.json")" || rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "$(L "13.3 [$key] tasks[$key].tokens equals usage:query --task-key $key --rollup --combined")"
    else
      bad "$(L "13.3 [$key] tasks[$key].tokens equals usage:query --task-key $key --rollup --combined")" "$msg"
    fi
  done
  # D4's per-key pass, pinned by hand: the split session contributes 400 to
  # task-split-a and 600 (+ sess-2m's 1800) to task-split-b.
  dash report --json >"$out/whole.json" 2>/dev/null || true
  local a b
  a="$(vget "$out/whole.json" "(v.tasks.find((t) => t.taskHandoffKey === 'task-split-a') || {tokens:{byFidelity:{'session-cumulative':{}}}}).tokens.byFidelity['session-cumulative'].netInput")"
  b="$(vget "$out/whole.json" "(v.tasks.find((t) => t.taskHandoffKey === 'task-split-b') || {tokens:{byFidelity:{'session-cumulative':{}}}}).tokens.byFidelity['session-cumulative'].netInput")"
  if [ "$a" = "$(expect "v.splitTasks['task-split-a'].sessionCumulativeNetInput")" ] && [ "$b" = "$(expect "v.splitTasks['task-split-b'].sessionCumulativeNetInput")" ]; then
    ok "$(L '13.3 tasks[] are per-key passes: task-split-a = 400, task-split-b = 2400 (ledger {period} split)')"
  else
    bad "$(L '13.3 tasks[] are per-key passes: task-split-a = 400, task-split-b = 2400 (ledger {period} split)')" "got a=$a b=$b"
  fi
}

# =============================================================================
# Case 13.4 — tallies and partition (R8, R27, R4). The identity check over
# every view the suite produced runs at the end of the main pass.
# =============================================================================
case_tallies() {
  local root out rc msg f
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.4 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  # (a) one uncaptured + one unpriced + one priced record.
  three_forms "$out" gaps --session sess-gaps
  forms_b "$out" gaps --session sess-gaps
  for f in A B C; do
    if ! json_ok "$out/gaps.$f.json"; then
      bad "$(L "13.4 [gaps] form $f yields a view model")"
      continue
    fi
    record_view "$out/gaps.$f.json"
    local got want
    got="$(vget "$out/gaps.$f.json" '[v.totals.recordCount, v.totals.capturedCount, v.totals.uncapturedCount, v.totals.price.pricedCount, v.totals.price.unpricedCount, v.totals.price.unconvertedCount, v.totals.tokens.combined.netInput, v.totals.tokens.combined.output].join(",")')"
    want="$(expect '[v.gapsScope.recordCount, v.gapsScope.capturedCount, v.gapsScope.uncapturedCount, v.gapsScope.pricedCount, v.gapsScope.unpricedCount, v.gapsScope.unconvertedCount, v.gapsScope.combinedNetInput, v.gapsScope.combinedOutput].join(",")')"
    if [ "$got" = "$want" ]; then
      ok "$(L "13.4 [gaps] form $f: uncaptured 1, unpriced 1, both counted apart from the sums")"
    else
      bad "$(L "13.4 [gaps] form $f: uncaptured 1, unpriced 1, both counted apart from the sums")" "got  $got
want $want"
    fi
    got="$(vget "$out/gaps.$f.json" 'Math.abs(v.totals.price.amount - '"$(expect 'v.gapsScope.amountUsd')"') < 1e-12')"
    if [ "$got" = "true" ]; then
      ok "$(L "13.4 [gaps] form $f: price sum is the priced record alone (0.00045 USD)")"
    else
      bad "$(L "13.4 [gaps] form $f: price sum is the priced record alone (0.00045 USD)")" "$(vget "$out/gaps.$f.json" 'v.totals.price.amount')"
    fi
  done
  # (b) neither: explicit zeros, cells present in A and B, columns in C.
  three_forms "$out" clean --session sess-alpha
  forms_b "$out" clean --session sess-alpha
  for f in A B C; do
    if json_ok "$out/clean.$f.json" && [ "$(vget "$out/clean.$f.json" '[v.totals.uncapturedCount, v.totals.price.unpricedCount].join(",")')" = "0,0" ]; then
      record_view "$out/clean.$f.json"
      ok "$(L "13.4 [clean] form $f: uncaptured 0 and unpriced 0 are explicit zeros")"
    else
      bad "$(L "13.4 [clean] form $f: uncaptured 0 and unpriced 0 are explicit zeros")" "$(vget "$out/clean.$f.json" 'v.totals' 2>&1 | head -c 400)"
    fi
  done
  for f in A B; do
    local html="$out/clean.$f.html"
    if grep -Eq 'data-k="totals\.uncapturedCount"[^>]*>[[:space:]]*0[[:space:]]*<' "$html" && grep -Eq 'data-k="totals\.price\.unpricedCount"[^>]*>[[:space:]]*0[[:space:]]*<' "$html"; then
      ok "$(L "13.4 [clean] form $f renders the zero counts in their own data-k cells")"
    else
      bad "$(L "13.4 [clean] form $f renders the zero counts in their own data-k cells")"
    fi
  done
  # (c) no priced record: amount null, absent no-priced-record, an em dash.
  three_forms "$out" nopriced --model vendorless-model-zz
  forms_b "$out" nopriced --model vendorless-model-zz
  for f in A B C; do
    if json_ok "$out/nopriced.$f.json" && [ "$(vget "$out/nopriced.$f.json" '[v.totals.price.amount, v.totals.price.absent, v.totals.price.unpricedCount].join(",")')" = ",no-priced-record,1" ] && [ "$(vget "$out/nopriced.$f.json" 'v.totals.price.amount === null')" = "true" ]; then
      record_view "$out/nopriced.$f.json"
      ok "$(L "13.4 [no priced record] form $f: amount null, absent no-priced-record (R4)")"
    else
      bad "$(L "13.4 [no priced record] form $f: amount null, absent no-priced-record (R4)")" "$(vget "$out/nopriced.$f.json" 'v.totals.price' 2>&1 | head -c 400)"
    fi
  done
  if grep -q $'\xe2\x80\x94' "$out/nopriced.C.txt" && grep -q 'no-priced-record' "$out/nopriced.C.txt"; then
    ok "$(L '13.4 [no priced record] form C prints an em dash with the absence reason')"
  else
    bad "$(L '13.4 [no priced record] form C prints an em dash with the absence reason')"
  fi
  stop_server
}

# =============================================================================
# Case 13.5 — unconverted prices never enter a sum (v1-F2).
# =============================================================================
case_unconverted() {
  local root out rc a_id b_id f
  fresh_root_into root empty
  out="$(new_out_dir)"
  drv pin-only "$PRICING_FIXTURES_DIR"
  drv seed-fx "$PRICING_FIXTURES_DIR"
  drv write-one "$FIXTURES_DIR/records-unconverted/ua-stored-eur.json"
  bash "$DASH_REPO/scripts/usage-price.sh" --session sess-eur-a --currency EUR >/dev/null
  rm -rf "$root/fx"
  drv write-one "$FIXTURES_DIR/records-unconverted/ub-no-fixing.json"
  a_id="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).recordId)' "$FIXTURES_DIR/records-unconverted/ua-stored-eur.json")"
  local stored
  stored="$(drv stored-amount "$root" "$a_id")"
  if [ "$(node -e 'const s = JSON.parse(process.argv[1]); console.log(s && s.status === "ok" && s.currency === "EUR")' "$stored")" != "true" ]; then
    bad "$(L '13.5a setup: record A is stored in EUR with status ok')" "$stored"
    return 0
  fi
  local manifest_before
  manifest_before="$(drv manifest "$root")"
  if ! start_server; then
    bad "$(L '13.5 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  three_forms "$out" unconv --currency EUR
  forms_b "$out" unconv --currency EUR
  local amount_a
  amount_a="$(node -e 'console.log(JSON.parse(process.argv[1]).amount)' "$stored")"
  for f in A B C; do
    if ! json_ok "$out/unconv.$f.json"; then
      bad "$(L "13.5a form $f yields a view model")"
      continue
    fi
    record_view "$out/unconv.$f.json"
    local got
    got="$(vget "$out/unconv.$f.json" "[v.totals.price.pricedCount, v.totals.price.unconvertedCount, v.totals.price.amount === $amount_a].join(',')")"
    if [ "$got" = "1,1,true" ]; then
      ok "$(L "13.5a form $f: priced 1, unconverted 1, amount = A's stored EUR amount exactly (B's USD figure excluded)")"
    else
      bad "$(L "13.5a form $f: priced 1, unconverted 1, amount = A's stored EUR amount exactly (B's USD figure excluded)")" "got $got; price $(vget "$out/unconv.$f.json" 'JSON.stringify(v.totals.price)' | head -c 500)"
    fi
  done
  rc=0
  msg="$(drv equal recomputed "$out/unconv.A.json" "$out/unconv.C.json" "$out/unconv.B.json" "$out/unconv.Bv.json")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L '13.5a the four renderings agree (recomputed)')"
  else
    bad "$(L '13.5a the four renderings agree (recomputed)')" "$msg"
  fi
  stop_server
  # The page files A wrote live under --out, outside the root; nothing else moved.
  if [ "$(drv manifest "$root")" = "$manifest_before" ]; then
    ok "$(L '13.5a the store: false reads leave the root unchanged')"
  else
    bad "$(L '13.5a the store: false reads leave the root unchanged')" "$(diff <(echo "$manifest_before") <(drv manifest "$root") | head -10)"
  fi

  # (b) --currency XXX: every priced-model record is no-such-currency.
  fresh_root_into root
  dash report --json --currency XXX >"$out/xxx.json" 2>"$out/xxx.err" || true
  if json_ok "$out/xxx.json" && [ "$(vget "$out/xxx.json" '[v.totals.price.pricedCount === 0, v.totals.price.unconvertedCount >= 1, v.totals.price.amount === null, v.totals.price.absent].join(",")')" = "true,true,true,no-converted-price" ]; then
    record_view "$out/xxx.json"
    ok "$(L '13.5b --currency XXX: priced 0, unconverted >= 1, amount null, absent no-converted-price')"
  else
    bad "$(L '13.5b --currency XXX: priced 0, unconverted >= 1, amount null, absent no-converted-price')" "$(vget "$out/xxx.json" 'JSON.stringify(v.totals.price)' 2>&1 | head -c 500) $(head -3 "$out/xxx.err")"
  fi
}

# =============================================================================
# Case 13.6 — buckets (R3, D4).
# =============================================================================
case_buckets() {
  local root out rc msg
  fresh_root_into root
  out="$(new_out_dir)"
  dash report --json >"$out/whole.json" 2>"$out/whole.err" || true
  if ! json_ok "$out/whole.json"; then
    bad "$(L '13.6 report --json yields a view model')" "$(head -5 "$out/whole.err")"
    return 0
  fi
  record_view "$out/whole.json"
  rc=0
  msg="$(drv sums "$out/whole.json")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L '13.6 Σ day = Σ week = Σ month = Σ byCli = Σ byModel = totals, per fidelity, keys ascending')"
  else
    bad "$(L '13.6 Σ day = Σ week = Σ month = Σ byCli = Σ byModel = totals, per fidelity, keys ascending')" "$msg"
  fi
  local got want
  got="$(vget "$out/whole.json" "(e => e ? [e.recordCount, e.tokens.byFidelity['per-request'].netInput].join(',') : 'absent')(v.byBucket.week.find((e) => e.key === '2026-W53'))")"
  want="$(expect "[v.isoWeekW53.recordCount, v.isoWeekW53.perRequestNetInput].join(',')")"
  if [ "$got" = "$want" ]; then
    ok "$(L '13.6 2026-12-31 and 2027-01-01 both land in ISO week 2026-W53')"
  else
    bad "$(L '13.6 2026-12-31 and 2027-01-01 both land in ISO week 2026-W53')" "got $got want $want"
  fi
  got="$(vget "$out/whole.json" "v.byBucket.month.map((e) => e.key).join(' ')")"
  if [ "$got" = "$(expect 'v.months.join(" ")')" ]; then
    ok "$(L '13.6 month keys are the UTC months holding a placed record')"
  else
    bad "$(L '13.6 month keys are the UTC months holding a placed record')" "got $got"
  fi
  # Hand-derived whole-store figures (expected.json).
  got="$(vget "$out/whole.json" "[v.totals.recordCount, v.totals.capturedCount, v.totals.uncapturedCount, v.totals.price.pricedCount, v.totals.price.unpricedCount, ...['per-request','run-total','session-cumulative'].map((f) => ['netInput','cacheRead','output','reasoning'].map((k) => v.totals.tokens.byFidelity[f][k]).join('/')), JSON.stringify(v.totals.tokens.byFidelity['per-request'].cacheWrite)].join(',')")"
  want="$(expect "[v.wholeStore.recordCount, v.wholeStore.capturedCount, v.wholeStore.uncapturedCount, v.wholeStore.pricedCount, v.wholeStore.unpricedCount, ...['per-request','run-total','session-cumulative'].map((f) => ['netInput','cacheRead','output','reasoning'].map((k) => v.wholeStore.tokens[f][k]).join('/')), JSON.stringify(v.wholeStore.perRequestCacheWrite)].join(',')")"
  if [ "$got" = "$want" ]; then
    ok "$(L '13.6 whole-store totals equal the hand-derived expected.json figures')"
  else
    bad "$(L '13.6 whole-store totals equal the hand-derived expected.json figures')" "got  $got
want $want"
  fi
}

# =============================================================================
# Case 13.7 — placement equality (v1-F4): a bucket equals the view filtered
# to it, per fidelity, for tokens, prices and the six tallies. The
# unfiltered view is a whole-store read, so this is also the bounded-read
# vs whole-store-read equality.
# =============================================================================
placement_eq() {
  # $1 label, $2 unfiltered-view expr, $3... filters
  local label="$1" expr="$2" f
  shift 2
  f="$PLACE_OUT/$(printf '%s' "$label" | tr -c 'A-Za-z0-9_-' '_').json"
  dash report --json "$@" >"$f" 2>"$f.err" || true
  if ! json_ok "$f"; then
    PLACE_ERRS="$PLACE_ERRS
$label: no view ($(head -2 "$f.err"))"
    return 0
  fi
  record_view "$f"
  local rc=0 msg
  msg="$(drv group-eq "$PLACE_OUT/whole.json" "$expr" "$f" 'v.totals')" || rc=$?
  PLACE_N=$((PLACE_N + 1))
  if [ "$rc" -ne 0 ]; then
    PLACE_ERRS="$PLACE_ERRS
$label: $msg"
  fi
}

case_placement() {
  local root rc msg d w mon sun m key cli
  fresh_root_into root
  PLACE_OUT="$(new_out_dir)"
  PLACE_ERRS=""
  PLACE_N=0
  dash report --json >"$PLACE_OUT/whole.json" 2>"$PLACE_OUT/whole.err" || true
  if ! json_ok "$PLACE_OUT/whole.json"; then
    bad "$(L '13.7 report --json yields a view model')" "$(head -5 "$PLACE_OUT/whole.err")"
    return 0
  fi
  for d in $(drv fixture-axes "$FIXTURES_DIR/records" day); do
    placement_eq "day $d" "find(v.byBucket.day, '$d')" --from "$d" --to "$d"
  done
  while read -r w mon sun; do
    [ -n "$w" ] || continue
    placement_eq "week $w" "find(v.byBucket.week, '$w')" --from "$mon" --to "$sun"
  done <<EOF
$(drv fixture-axes "$FIXTURES_DIR/records" week)
EOF
  for m in $(drv fixture-axes "$FIXTURES_DIR/records" month); do
    placement_eq "month $m (--period)" "find(v.byBucket.month, '$m')" --period "$m"
    placement_eq "month $m (--from/--to)" "find(v.byBucket.month, '$m')" --from "$m-01" --to "$(drv last-day "$m")"
  done
  for key in $(drv fixture-axes "$FIXTURES_DIR/records" model); do
    placement_eq "model $key" "find(v.byModel, '$key')" --model "$key"
  done
  for cli in $(drv fixture-axes "$FIXTURES_DIR/records" cli); do
    placement_eq "cli $cli" "find(v.byCli, '$cli')" --cli "$cli"
  done
  if [ -z "$PLACE_ERRS" ] && [ "$PLACE_N" -gt 20 ]; then
    ok "$(L "13.7 every day, ISO week, month (--period and --from/--to), model and CLI bucket equals the view filtered to it ($PLACE_N views)")"
  else
    bad "$(L "13.7 every day, ISO week, month (--period and --from/--to), model and CLI bucket equals the view filtered to it ($PLACE_N views)")" "$(printf '%s\n' "$PLACE_ERRS" | sed '/^$/d' | head -12)"
  fi
  # Inside a filtered view, each day bucket equals the unfiltered one.
  dash report --json --from 2026-09-18 --to 2026-10-06 >"$PLACE_OUT/ranged.json" 2>/dev/null || true
  local errs="" n=0
  for d in $(drv fixture-axes "$FIXTURES_DIR/records" day); do
    case "$d" in 2026-09-* | 2026-10-0[1-6]) ;; *) continue ;; esac
    n=$((n + 1))
    rc=0
    msg="$(drv group-eq "$PLACE_OUT/whole.json" "find(v.byBucket.day, '$d')" "$PLACE_OUT/ranged.json" "find(v.byBucket.day, '$d')")" || rc=$?
    [ "$rc" -eq 0 ] || errs="$errs
$d: $msg"
  done
  if [ -z "$errs" ] && [ "$n" -gt 0 ]; then
    ok "$(L "13.7 inside --from 2026-09-18 --to 2026-10-06, each day bucket equals the unfiltered one ($n days)")"
  else
    bad "$(L '13.7 inside --from 2026-09-18 --to 2026-10-06, each day bucket equals the unfiltered one')" "$errs"
  fi
  # S1's pinned figures: 2026-09-20 holds only superseded snapshots.
  local got
  got="$(vget "$PLACE_OUT/whole.json" "[find(v.byBucket.day, '2026-09-20') === undefined, (find(v.byBucket.day, '2026-09-21') || {tokens:{byFidelity:{'session-cumulative':{}}}}).tokens.byFidelity['session-cumulative'].netInput].join(',')" 2>&1)"
  if [ "$got" = "true,500" ]; then
    ok "$(L '13.7 S1: byBucket.day has no 2026-09-20 entry, 2026-09-21 = 500 session-cumulative')"
  else
    bad "$(L '13.7 S1: byBucket.day has no 2026-09-20 entry, 2026-09-21 = 500 session-cumulative')" "got $got"
  fi
  local w38
  w38="$(vget "$PLACE_OUT/whole.json" "(e => e ? e.tokens.byFidelity['session-cumulative'].netInput : 0)(find(v.byBucket.week, '2026-W38'))")"
  if [ "$w38" = "0" ]; then
    ok "$(L '13.7 S1: 2026-W38 gets nothing from S1')"
  else
    bad "$(L '13.7 S1: 2026-W38 gets nothing from S1')" "session-cumulative netInput $w38"
  fi
  got="$(vget "$PLACE_OUT/day_2026-09-20.json" "[v.empty, v.totals.recordCount, v.totals.tokens.combined.netInput].join(',')" 2>&1)"
  if [ "$got" = "superseded-only,0,0" ]; then
    ok "$(L '13.7 S1: --from 2026-09-20 --to 2026-09-20 gives zero and the superseded-only empty state (v2-F1)')"
  else
    bad "$(L '13.7 S1: --from 2026-09-20 --to 2026-09-20 gives zero and the superseded-only empty state (v2-F1)')" "got $got"
  fi
}

# =============================================================================
# Case 13.8 — the stated divergence from the filter-first commands (D4).
# `task usage:query -- --period P --rollup` reads month P and rolls it up,
# so a session whose snapshots straddle the end of P contributes its last
# in-P snapshot to P; the dashboard places the session's last snapshot in
# the month it falls in. docs/usage-dashboard.md ("Reading the views")
# cites this case: a change to either side's semantics shows up here.
# =============================================================================
case_divergence() {
  local root out m q dsh wq wd
  fresh_root_into root
  out="$(new_out_dir)"
  for m in 2026-09 2026-10; do
    q="$(bash "$DASH_REPO/scripts/usage-query.sh" --period "$m" --rollup | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log(JSON.parse(s).byFidelity["session-cumulative"].netInput))')"
    dash report --json --period "$m" >"$out/$m.json" 2>/dev/null || true
    dsh="$(vget "$out/$m.json" "v.totals.tokens.byFidelity['session-cumulative'].netInput" 2>&1)"
    wq="$(expect "v.divergence['$m'].usageQuerySessionCumulativeNetInput")"
    wd="$(expect "v.divergence['$m'].dashboardSessionCumulativeNetInput")"
    if [ "$q" = "$wq" ] && [ "$dsh" = "$wd" ]; then
      ok "$(L "13.8 --period $m: usage:query --rollup = $q, dashboard = $dsh (pinned divergence)")"
    else
      bad "$(L "13.8 --period $m: usage:query --rollup = $wq, dashboard = $wd (pinned divergence)")" "got usage:query $q, dashboard $dsh"
    fi
  done
}

# =============================================================================
# Case 13.9 — the mixed marker and fidelity propagate unchanged (R7, R30).
# Case 13.10 — drill-down shows a session with no agent explicitly (R6).
# =============================================================================
case_mixed_and_drilldown() {
  local root out f marker
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.9 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  three_forms "$out" mixed --task-key task-mixed
  forms_b "$out" mixed --task-key task-mixed
  if ! json_ok "$out/mixed.C.json"; then
    bad "$(L '13.9 report --json --task-key task-mixed yields a view model')"
    stop_server
    return 0
  fi
  local got
  got="$(vget "$out/mixed.C.json" "JSON.stringify([v.totals.tokens.combined.mixed, v.totals.price.mixed, (v.tasks.find((t) => t.taskHandoffKey === 'task-mixed') || {tokens:{combined:{}}}).tokens.combined.mixed])")"
  if [ "$got" = '[["per-request","session-cumulative"],["per-request","session-cumulative"],["per-request","session-cumulative"]]' ]; then
    ok "$(L '13.9 the task rollup carries mixed = [per-request, session-cumulative] on tokens and price')"
  else
    bad "$(L '13.9 the task rollup carries mixed = [per-request, session-cumulative] on tokens and price')" "got $got"
  fi
  marker="$(USAGE_TEST_REPO_DIR="$DASH_REPO" node -e "const f = require(process.argv[1] + '/scripts/lib/usage-dashboard/format.js'); console.log(f.mixed(['per-request', 'session-cumulative']))" "$DASH_REPO" 2>/dev/null || true)"
  if [ -n "$marker" ] && [ "${marker#*per-request}" != "$marker" ] && [ "${marker#*session-cumulative}" != "$marker" ]; then
    for f in A.html B.html C.txt; do
      # the marker must sit on the combined figures — count it on data-k
      # combined cells in HTML, on the Totals rows in text.
      if grep -qF -- "$marker" "$out/mixed.$f"; then
        ok "$(L "13.9 form ${f%%.*} prints the mixed marker \"$marker\"")"
      else
        bad "$(L "13.9 form ${f%%.*} prints the mixed marker \"$marker\"")"
      fi
    done
    for f in A B; do
      if node -e '
const html = require("fs").readFileSync(process.argv[1], "utf8");
const marker = process.argv[2];
const re = /<([a-z]+)\b[^>]*data-k="totals\.tokens\.combined\.[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
let m, n = 0, bad = 0;
while ((m = re.exec(html)) !== null) { n++; }
const block = /data-k="totals\.tokens\.combined[^"]*"/.test(html);
// the combined figures of the totals must be accompanied by the marker in their row
const row = /<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*data-k="totals\.tokens\.combined\.netInput"(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(html);
process.exit(block && row && row[0].includes(marker) ? 0 : 1);
' "$out/mixed.$f.html" "$marker"; then
        ok "$(L "13.9 form $f: the combined totals row carries the mixed marker")"
      else
        bad "$(L "13.9 form $f: the combined totals row carries the mixed marker")"
      fi
    done
  else
    bad "$(L '13.9 format.mixed() names both fidelities')" "got \"$marker\""
  fi

  # 13.10 — sess-alpha has no sub-agent; sess-parent has agent-reviewer.
  three_forms "$out" whole
  forms_b "$out" whole
  for f in A C B; do
    got="$(vget "$out/whole.$f.json" "JSON.stringify([(v.sessions.find((s) => s.sessionId === 'sess-alpha') || {}).agents, (v.sessions.find((s) => s.sessionId === 'sess-parent') || {agents: []}).agents.map((a) => a.agentId).includes('agent-reviewer')])" 2>&1)"
    if [ "$got" = '[[],true]' ]; then
      ok "$(L "13.10 form $f: a session with no agent keeps agents: [], a parent lists its agent")"
    else
      bad "$(L "13.10 form $f: a session with no agent keeps agents: [], a parent lists its agent")" "got $got"
    fi
  done
  for f in A.html B.html C.txt; do
    if grep -qF 'No subordinate agent' "$out/whole.$f" && grep -qF 'sess-alpha' "$out/whole.$f"; then
      ok "$(L "13.10 form ${f%%.*} shows sess-alpha with \"No subordinate agent\"")"
    else
      bad "$(L "13.10 form ${f%%.*} shows sess-alpha with \"No subordinate agent\"")"
    fi
  done
  stop_server
}

# =============================================================================
# Case 13.11 — empty states (R10): no-match, store-empty, (b) store-empty
# after a prune leaves empty journal/<cli>/<YYYY-MM>/ directories (v2-F2),
# (c) superseded-only (v2-F1).
# =============================================================================
empty_state_all_forms() {
  # $1 label, $2 expected empty value, $3 banner substring, $4... filters
  local label="$1" want="$2" banner="$3" out rc f
  shift 3
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L "13.11 [$label] form B starts")" "$(cat "$SERVER_LOG")"
    return 0
  fi
  three_forms "$out" e "$@"
  forms_b "$out" e "$@"
  for f in A C B Bv; do
    if json_ok "$out/e.$f.json" && [ "$(vget "$out/e.$f.json" 'v.empty')" = "$want" ]; then
      ok "$(L "13.11 [$label] form $f: empty = \"$want\"")"
    else
      bad "$(L "13.11 [$label] form $f: empty = \"$want\"")" "$(vget "$out/e.$f.json" 'v.empty' 2>&1 | head -2)"
    fi
  done
  rc=0
  dash report "$@" >"$out/e.rc.txt" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L "13.11 [$label] form C exits 0 (an empty result is not an error)")"
  else
    bad "$(L "13.11 [$label] form C exits 0 (an empty result is not an error)")" "exit $rc"
  fi
  if [ "$(cat "$out/e.Bpage.status")" = "200" ]; then
    ok "$(L "13.11 [$label] form B answers 200")"
  else
    bad "$(L "13.11 [$label] form B answers 200")" "status $(cat "$out/e.Bpage.status")"
  fi
  for f in A.html B.html C.txt; do
    if grep -qF -- "$banner" "$out/e.$f"; then
      ok "$(L "13.11 [$label] form ${f%%.*} shows the banner \"$banner\"")"
    else
      bad "$(L "13.11 [$label] form ${f%%.*} shows the banner \"$banner\"")"
    fi
  done
  stop_server
  EMPTY_LAST_OUT="$out"
}

case_empty() {
  local root cli m
  fresh_root_into root
  empty_state_all_forms "no-match" "no-match" "No record matches this selection" --session no-such-session
  local nomatch_out="$EMPTY_LAST_OUT"
  fresh_root_into root empty
  drv pin-only "$PRICING_FIXTURES_DIR"
  empty_state_all_forms "store-empty" "store-empty" "The usage store holds no record"
  local empty_out="$EMPTY_LAST_OUT"
  # the two banners are distinct (R10: never indistinguishable)
  if ! grep -qF 'The usage store holds no record' "$nomatch_out/e.C.txt" && ! grep -qF 'No record matches this selection' "$empty_out/e.C.txt"; then
    ok "$(L '13.11 the no-match and store-empty banners are distinct')"
  else
    bad "$(L '13.11 the no-match and store-empty banners are distinct')"
  fi

  # (b) v2-F2 — prune every period; empty partition directories remain.
  fresh_root_into root
  for cli in $(drv fixture-axes "$FIXTURES_DIR/records" cli); do
    for m in $(expect 'v.months.join(" ")'); do
      if [ -d "$root/journal/$cli/$m" ]; then
        bash "$DASH_REPO/scripts/usage-prune.sh" "$cli" "$m" --force >/dev/null 2>&1 || true
      fi
    done
  done
  local left
  left="$(find "$root/journal" -type f -name '*.json' ! -name '*.wing.json' ! -name '*.attr.json' | wc -l | tr -d ' ')"
  if [ "$left" = "0" ] && [ -n "$(find "$root/journal" -mindepth 2 -maxdepth 2 -type d)" ]; then
    ok "$(L '13.11b setup: the prune removed every entry and left journal/<cli>/<YYYY-MM>/ directories behind')"
  else
    bad "$(L '13.11b setup: the prune removed every entry and left journal/<cli>/<YYYY-MM>/ directories behind')" "entries left: $left"
  fi
  empty_state_all_forms "pruned store (v2-F2)" "store-empty" "The usage store holds no record"

  # (c) v2-F1 — only superseded session-cumulative snapshots match.
  fresh_root_into root
  empty_state_all_forms "superseded-only (v2-F1)" "superseded-only" "superseded by a later snapshot of the same session" --from 2026-09-20 --to 2026-09-20
  local f n
  n="$(expect 'v.supersededOnlyDay.matchingSnapshots')"
  for f in A.html B.html C.txt; do
    if grep -Eq "(^|[^0-9])$n session-cumulative snapshot" "$EMPTY_LAST_OUT/e.$f"; then
      ok "$(L "13.11c form ${f%%.*} counts the $n matching superseded snapshots")"
    else
      bad "$(L "13.11c form ${f%%.*} counts the $n matching superseded snapshots")"
    fi
  done
  if ! grep -qF 'No record matches this selection' "$EMPTY_LAST_OUT/e.C.txt"; then
    ok "$(L '13.11c superseded-only never claims that no record matches')"
  else
    bad "$(L '13.11c superseded-only never claims that no record matches')"
  fi
  fresh_root_into root
  empty_state_all_forms "superseded-only, session selector (v2-F1)" "superseded-only" "superseded by a later snapshot of the same session" --session sess-s1 --from 2026-09-20 --to 2026-09-20
}

# =============================================================================
# Case 13.12 — A is self-contained and injection-safe (R11, R12, R28).
# =============================================================================
case_static_page() {
  local root out page f rc
  fresh_root_into root
  out="$(new_out_dir)"
  dash page >"$out/page.stdout" 2>"$out/page.stderr" || true
  page="$root/dashboard/usage-dashboard.html"
  if [ ! -f "$page" ]; then
    bad "$(L '13.12 page writes <root>/dashboard/usage-dashboard.html by default')" "$(cat "$out/page.stdout" "$out/page.stderr" | head -5)"
    return 0
  fi
  ok "$(L '13.12 page writes <root>/dashboard/usage-dashboard.html by default')"
  if grep -qF "$page" "$out/page.stdout"; then
    ok "$(L '13.12 page prints the path it wrote')"
  else
    bad "$(L '13.12 page prints the path it wrote')" "$(head -3 "$out/page.stdout")"
  fi
  local n_open n_close
  n_open="$(grep -o '<script' "$page" | wc -l | tr -d ' ')"
  n_close="$(grep -o '</script' "$page" | wc -l | tr -d ' ')"
  if [ "$n_open" = "1" ] && [ "$n_close" = "1" ] && grep -Eq '<script[^>]*type="application/json"' "$page"; then
    ok "$(L '13.12 exactly one <script and one </script, type="application/json"')"
  else
    bad "$(L '13.12 exactly one <script and one </script, type="application/json"')" "<script x$n_open, </script x$n_close"
  fi
  if ! grep -qF '<!--' "$page"; then
    ok "$(L '13.12 no <!-- anywhere in the file')"
  else
    bad "$(L '13.12 no <!-- anywhere in the file')"
  fi
  local hits
  hits="$(node -e '
const html = require("fs").readFileSync(process.argv[1], "utf8");
// the one application/json block is data, not markup: scan everything else
const markup = html.replace(/(<script\b[^>]*type="application\/json"[^>]*>)[\s\S]*?(<\/script)/i, "$1$2");
// text is entity-escaped, so a raw "<" only ever opens a real tag
const tags = (markup.match(/<[A-Za-z][^>]*>/g) || []).join("\n");
const styles = (markup.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join("\n");
const hits = [];
if (/<link\b/i.test(tags)) hits.push("<link");
const attr = /\s(src|href|srcset|action|poster)\s*=/i.exec(tags);
if (attr) hits.push(`${attr[1]}=`);
if (/url\(|@import/i.test(styles)) hits.push("url( or @import in <style>");
for (const p of [/fetch\(/, /XMLHttpRequest/, /import\(/]) if (p.test(markup)) hits.push(String(p));
console.log(hits.join(" "));
' "$page")"
  if [ -z "$hits" ]; then
    ok "$(L '13.12 no <link, src=, href=, srcset=, action=, poster=, url(, @import, fetch(, XMLHttpRequest, import( outside the JSON data block')"
  else
    bad "$(L '13.12 no <link, src=, href=, srcset=, action=, poster=, url(, @import, fetch(, XMLHttpRequest, import( outside the JSON data block')" "found: $hits"
  fi
  if grep -Eq "<meta[^>]*http-equiv=\"Content-Security-Policy\"[^>]*default-src 'none'" "$page"; then
    ok "$(L "13.12 a CSP meta carries default-src 'none'")"
  else
    bad "$(L "13.12 a CSP meta carries default-src 'none'")"
  fi
  if grep -qF '\u003c/script' "$page"; then
    ok "$(L '13.12 the embedded JSON carries the literal six-byte escape \u003c/script for the hostile record')"
  else
    bad "$(L '13.12 the embedded JSON carries the literal six-byte escape \u003c/script for the hostile record')"
  fi
  drv extract "$page" >"$out/page.json" 2>"$out/extract.err" || true
  rc=0
  node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const hostile = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const want = hostile.identity.agentId;
const agents = v.sessions.flatMap((s) => s.agents || []).map((a) => a.agentId);
const refs = v.assets.map((a) => a.ref);
process.exit(agents.includes(want) && refs.includes(hostile.attribution.externalAsset.ref) ? 0 : 1);
' "$out/page.json" "$FIXTURES_DIR/records/r10-hostile-child.json" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L '13.12 the hostile agentId and asset ref parse back byte-identical')"
  else
    bad "$(L '13.12 the hostile agentId and asset ref parse back byte-identical')" "$(head -3 "$out/extract.err")"
  fi
  if node -e '
const html = require("fs").readFileSync(process.argv[1], "utf8");
const markup = html.replace(/(<script\b[^>]*type="application\/json"[^>]*>)[\s\S]*?(<\/script)/i, "$1$2");
process.exit(/evil\.example\/x\.js"/.test(markup) || /<script\b[^>]*\bsrc/i.test(markup) || /[\u2028\u2029]/.test(html.match(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script/i)[1]) ? 1 : 0);
' "$page"; then
    ok "$(L '13.12 the hostile string is escaped in the markup, and no raw U+2028/U+2029 sits in the JSON block')"
  else
    bad "$(L '13.12 the hostile string is escaped in the markup, and no raw U+2028/U+2029 sits in the JSON block')"
  fi
  local gen
  gen="$(vget "$out/page.json" 'v.generatedAt' 2>/dev/null || true)"
  if [ -n "$gen" ] && grep -qF "$gen" "$page" && grep -qF -- '--as-of-today' "$page" && grep -qF 'task usage:dashboard' "$page"; then
    ok "$(L '13.12 the footer states generatedAt, the regeneration command and its --as-of-today variant (R12)')"
  else
    bad "$(L '13.12 the footer states generatedAt, the regeneration command and its --as-of-today variant (R12)')" "generatedAt=$gen"
  fi
  local mode dmode
  mode="$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$page")"
  dmode="$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$root/dashboard")"
  if [ "$mode" = "600" ] && [ "$dmode" = "700" ]; then
    ok "$(L '13.12 the file is mode 600 in a mode-700 directory')"
  else
    bad "$(L '13.12 the file is mode 600 in a mode-700 directory')" "file $mode, dir $dmode"
  fi
  # the umask cannot widen the modes: regenerate under umask 000
  (umask 000 && dash page >/dev/null 2>&1) || true
  mode="$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$page")"
  if [ "$mode" = "600" ]; then
    ok "$(L '13.12 regenerating under umask 000 keeps mode 600')"
  else
    bad "$(L '13.12 regenerating under umask 000 keeps mode 600')" "file $mode"
  fi
}

# =============================================================================
# Case 13.13 — B binds loopback only (R14, R29).
# =============================================================================
case_bind() {
  local root out rc ip got
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.13 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  if grep -qx 'BOUND 127.0.0.1' "$SERVER_LOG"; then
    ok "$(L '13.13 BOUND 127.0.0.1')"
  else
    bad "$(L '13.13 BOUND 127.0.0.1')" "$(cat "$SERVER_LOG")"
  fi
  ip="$(drv non-internal-ipv4)"
  if [ -z "$ip" ]; then
    bad "$(L '13.13 a non-internal IPv4 exists on this runner to probe the non-loopback bind')" "none found — this check FAILs rather than skips (PLAN v2 13.13)"
  else
    got="$(drv connect "$ip" "$SERVER_PORT")"
    if [ "$got" != "CONNECTED" ]; then
      ok "$(L "13.13 connecting to $ip:$SERVER_PORT is refused ($got)")"
    else
      bad "$(L "13.13 connecting to $ip:$SERVER_PORT is refused")" "CONNECTED"
    fi
  fi
  stop_server
  for flag in --host --bind --address; do
    rc="$(run_bounded 10 "$out/flag.out" bash "$DASH_REPO/scripts/usage-dashboard.sh" serve --port 0 "$flag" 0.0.0.0)"
    if [ "$rc" = "2" ]; then
      ok "$(L "13.13 serve $flag 0.0.0.0 exits 2")"
    else
      bad "$(L "13.13 serve $flag 0.0.0.0 exits 2")" "exit $rc: $(head -3 "$out/flag.out")"
    fi
  done
  HOST=0.0.0.0 start_server || true
  if [ -n "$SERVER_PORT" ] && grep -qx 'BOUND 127.0.0.1' "$SERVER_LOG"; then
    ok "$(L '13.13 HOST=0.0.0.0 in the environment leaves BOUND at 127.0.0.1')"
  else
    bad "$(L '13.13 HOST=0.0.0.0 in the environment leaves BOUND at 127.0.0.1')" "$(cat "$SERVER_LOG")"
  fi
  stop_server
  local server_js="$DASH_REPO/scripts/lib/usage-dashboard/server.js"
  local n_listen
  n_listen="$(grep -c '\.listen(' "$server_js" || true)"
  if [ "$n_listen" = "1" ] && grep -Eq "\.listen\([^)]*'127\.0\.0\.1'" "$server_js"; then
    ok "$(L "13.13 server.js holds exactly one .listen( with the literal '127.0.0.1'")"
  else
    bad "$(L "13.13 server.js holds exactly one .listen( with the literal '127.0.0.1'")" "$(grep -n '\.listen(' "$server_js" || true)"
  fi
}

# =============================================================================
# Case 13.14 — B refuses a taken port (R18).
# =============================================================================
case_port_conflict() {
  local out held_log held_pid port rc i=0
  out="$(new_out_dir)"
  local root
  fresh_root_into root
  held_log="$out/held.log"
  drv hold-port >"$held_log" 2>&1 &
  held_pid=$!
  BG_PIDS="$BG_PIDS $held_pid"
  while [ $i -lt 100 ] && ! grep -q '^PORT=' "$held_log"; do
    sleep 0.1
    i=$((i + 1))
  done
  port="$(sed -n 's/^PORT=//p' "$held_log")"
  rc="$(run_bounded 10 "$out/conflict.out" bash "$DASH_REPO/scripts/usage-dashboard.sh" serve --port "$port")"
  if [ "$rc" = "3" ] && grep -qF "$port" "$out/conflict.out" && grep -qi 'in use' "$out/conflict.out"; then
    ok "$(L "13.14 serve --port <taken> exits 3 and names port $port")"
  else
    bad "$(L "13.14 serve --port <taken> exits 3 and names port $port")" "exit $rc: $(head -3 "$out/conflict.out")"
  fi
  if grep -q 'LISTENING' "$out/conflict.out"; then
    bad "$(L '13.14 no fallback port was chosen')" "$(head -3 "$out/conflict.out")"
  else
    ok "$(L '13.14 no fallback port was chosen')"
  fi
  SERVER_PORT="$port"
  http_to "$out/held" GET "/"
  if [ "$(cat "$out/held.body")" = "held-by-test-listener" ]; then
    ok "$(L '13.14 the foreign listener still owns the port')"
  else
    bad "$(L '13.14 the foreign listener still owns the port')" "$(head -c 200 "$out/held.body")"
  fi
  kill "$held_pid" 2>/dev/null || true
  wait "$held_pid" 2>/dev/null || true
}

# =============================================================================
# Case 13.15 — B's per-request guard.
# =============================================================================
case_security() {
  local root out token
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.15 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  http_to "$out/evilhost" GET "/" '{"Host":"evil.example"}'
  http_to "$out/goodhost" GET "/" "{\"Host\":\"127.0.0.1:$SERVER_PORT\"}"
  http_to "$out/localhost" GET "/view.json" "{\"Host\":\"localhost:$SERVER_PORT\"}"
  if [ "$(cat "$out/evilhost.status")" = "421" ] && [ "$(cat "$out/goodhost.status")" = "200" ] && [ "$(cat "$out/localhost.status")" = "200" ]; then
    ok "$(L '13.15 Host: evil.example -> 421; 127.0.0.1:<port> and localhost:<port> -> 200')"
  else
    bad "$(L '13.15 Host: evil.example -> 421; 127.0.0.1:<port> and localhost:<port> -> 200')" "evil $(cat "$out/evilhost.status"), 127 $(cat "$out/goodhost.status"), localhost $(cat "$out/localhost.status")"
  fi
  token="$(drv form-token "$out/goodhost.body")"
  if [ -n "$token" ]; then
    ok "$(L '13.15 the served page carries a per-process POST token')"
  else
    bad "$(L '13.15 the served page carries a per-process POST token')"
  fi
  http_to "$out/notoken" POST "/recompute" '{"Content-Type":"application/x-www-form-urlencoded"}' "token="
  http_to "$out/badtoken" POST "/recompute" '{"Content-Type":"application/x-www-form-urlencoded"}' "token=deadbeef"
  http_to "$out/evilorigin" POST "/recompute" '{"Content-Type":"application/x-www-form-urlencoded","Origin":"https://evil.example"}' "token=$token"
  http_to "$out/crosssite" POST "/recompute" '{"Content-Type":"application/x-www-form-urlencoded","Sec-Fetch-Site":"cross-site"}' "token=$token"
  http_to "$out/stopnotoken" POST "/stop" '{"Content-Type":"application/x-www-form-urlencoded"}' "token="
  local s1 s2 s3 s4 s5
  s1="$(cat "$out/notoken.status")"; s2="$(cat "$out/badtoken.status")"; s3="$(cat "$out/evilorigin.status")"; s4="$(cat "$out/crosssite.status")"; s5="$(cat "$out/stopnotoken.status")"
  if [ "$s1" = "403" ] && [ "$s2" = "403" ] && [ "$s3" = "403" ] && [ "$s4" = "403" ] && [ "$s5" = "403" ]; then
    ok "$(L '13.15 POST without the token, with a wrong token, a foreign Origin or cross-site Sec-Fetch-Site -> 403')"
  else
    bad "$(L '13.15 POST without the token, with a wrong token, a foreign Origin or cross-site Sec-Fetch-Site -> 403')" "no-token $s1, bad-token $s2, evil-origin $s3, cross-site $s4, stop-no-token $s5"
  fi
  http_to "$out/getrecompute" GET "/recompute"
  http_to "$out/put" PUT "/"
  http_to "$out/traversal" GET "/../../etc/passwd"
  http_to "$out/journal" GET "/journal/"
  http_to "$out/big" POST "/recompute" '{"Content-Type":"application/x-www-form-urlencoded"}' "token=$token&pad=$(head -c 20000 /dev/zero | tr '\0' 'a')"
  local g p t j b
  g="$(cat "$out/getrecompute.status")"; p="$(cat "$out/put.status")"; t="$(cat "$out/traversal.status")"; j="$(cat "$out/journal.status")"; b="$(cat "$out/big.status")"
  if { [ "$g" = "404" ] || [ "$g" = "405" ]; } && [ "$p" = "405" ] && [ "$t" = "404" ] && [ "$j" = "404" ] && [ "$b" = "413" ]; then
    ok "$(L '13.15 GET /recompute 404|405, PUT 405, path traversal and /journal/ 404, a 20 KB body 413')"
  else
    bad "$(L '13.15 GET /recompute 404|405, PUT 405, path traversal and /journal/ 404, a 20 KB body 413')" "GET /recompute $g, PUT $p, traversal $t, /journal/ $j, big $b"
  fi
  if node -e '
const fs = require("fs");
let bad = [];
for (const f of process.argv.slice(1)) {
  const h = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const k of Object.keys(h)) if (/^access-control-/i.test(k)) bad.push(`${f}: ${k}`);
}
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
' "$out"/*.headers; then
    ok "$(L '13.15 no response carries an Access-Control-* header')"
  else
    bad "$(L '13.15 no response carries an Access-Control-* header')"
  fi
  if node -e '
const h = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const csp = h["content-security-policy"] || "";
const ok = /default-src .none./.test(csp) && /frame-ancestors .none./.test(csp) &&
  h["cache-control"] === "no-store" && h["x-content-type-options"] === "nosniff" &&
  h["referrer-policy"] === "no-referrer" && h["x-frame-options"] === "DENY" &&
  h["cross-origin-resource-policy"] === "same-origin";
process.exit(ok ? 0 : 1);
' "$out/goodhost.headers"; then
    ok "$(L '13.15 CSP (default-src none, frame-ancestors none), no-store, nosniff, no-referrer, DENY, CORP same-origin')"
  else
    bad "$(L '13.15 CSP (default-src none, frame-ancestors none), no-store, nosniff, no-referrer, DENY, CORP same-origin')" "$(cat "$out/goodhost.headers")"
  fi
  stop_server
}

# =============================================================================
# Case 13.16 — B is read-only (R15, R16, R17), and the offline guard (D2, M8).
# =============================================================================
case_readonly() {
  local root out token before after stored_max rc
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.16 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  before="$(drv manifest "$root")"
  stored_max="$(drv stored-computed-max "$root")"
  http_to "$out/get" GET "/"
  http_to "$out/view" GET "/view.json"
  token="$(drv form-token "$out/get.body")"
  http_to "$out/recompute" POST "/recompute" "{\"Content-Type\":\"application/x-www-form-urlencoded\",\"Origin\":\"http://127.0.0.1:$SERVER_PORT\",\"Sec-Fetch-Site\":\"same-origin\"}" "token=$token"
  cp "$out/recompute.body" "$out/recompute.html"
  drv extract "$out/recompute.html" >"$out/recompute.json" 2>/dev/null || true
  local recomputed_min
  recomputed_min="$(vget "$out/recompute.json" 'v.totals.price.timestamps.computedAt.min' 2>/dev/null || true)"
  if [ -n "$recomputed_min" ] && [ -n "$stored_max" ] && [[ "$recomputed_min" > "$stored_max" ]]; then
    ok "$(L '13.16 POST /recompute recomputes: its computedAt is later than every stored one')"
  else
    bad "$(L '13.16 POST /recompute recomputes: its computedAt is later than every stored one')" "recomputed min '$recomputed_min', stored max '$stored_max', status $(cat "$out/recompute.status")"
  fi
  if grep -Eq 'task usage:price -- [^<]*--as-of-today' "$out/recompute.body"; then
    ok "$(L '13.16 the recompute page points to task usage:price -- --as-of-today to persist')"
  else
    bad "$(L '13.16 the recompute page points to task usage:price -- --as-of-today to persist')"
  fi
  local m1
  m1="$(drv manifest "$root")"
  if [ "$m1" = "$before" ]; then
    ok "$(L '13.16 sha256 manifest of every file under the root is unchanged across GET /, GET /view.json and POST /recompute')"
  else
    bad "$(L '13.16 sha256 manifest of every file under the root is unchanged across GET /, GET /view.json and POST /recompute')" "$(diff <(echo "$before") <(echo "$m1") | head -10)"
  fi
  # re-read per request: a record the suite writes between two GETs is counted
  local n1 n2 m2
  n1="$(vget "$out/view.body" 'v.totals.recordCount' 2>/dev/null || true)"
  drv clone-record "$FIXTURES_DIR/records/r01-alpha-pr-1.json" "$out/fresh-record.json" "r21-written-between-gets" "2026-10-15T10:00:00.000Z"
  drv write-one "$out/fresh-record.json"
  m2="$(drv manifest "$root")"
  http_to "$out/view2" GET "/view.json"
  n2="$(vget "$out/view2.body" 'v.totals.recordCount' 2>/dev/null || true)"
  if [ -n "$n1" ] && [ "$n2" = "$((n1 + 1))" ]; then
    ok "$(L '13.16 a record written between two GETs is counted by the second (R15)')"
  else
    bad "$(L '13.16 a record written between two GETs is counted by the second (R15)')" "first $n1, second $n2"
  fi
  http_to "$out/stop" POST "/stop" "{\"Content-Type\":\"application/x-www-form-urlencoded\",\"Origin\":\"http://127.0.0.1:$SERVER_PORT\"}" "token=$token"
  local i=0 stopped=0
  while [ $i -lt 50 ]; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then stopped=1; break; fi
    sleep 0.1
    i=$((i + 1))
  done
  rc=0
  if [ "$stopped" = "1" ]; then wait "$SERVER_PID" 2>/dev/null || rc=$?; fi
  if [ "$stopped" = "1" ] && [ "$rc" = "0" ]; then
    ok "$(L '13.16 POST /stop with the token stops the server with exit 0')"
  else
    bad "$(L '13.16 POST /stop with the token stops the server with exit 0')" "stopped=$stopped rc=$rc status $(cat "$out/stop.status")"
  fi
  SERVER_PID=""
  after="$(drv manifest "$root")"
  if [ "$after" = "$m2" ]; then
    ok "$(L '13.16 the manifest is unchanged across the second GET /view.json and POST /stop')"
  else
    bad "$(L '13.16 the manifest is unchanged across the second GET /view.json and POST /stop')" "$(diff <(echo "$m2") <(echo "$after") | head -10)"
  fi
  if [ ! -e "$root/dashboard" ]; then
    ok "$(L '13.16 form B wrote no page and no pid file under the root')"
  else
    bad "$(L '13.16 form B wrote no page and no pid file under the root')" "$(find "$root/dashboard")"
  fi

  # Offline guard (M8): CREWRIG_USAGE_OFFLINE unset, fetch stubbed, EUR
  # against a stale FX cache (the fixture fixings predate today).
  fresh_root_into root
  before="$(drv manifest "$root")"
  local guard
  guard="$(env -u CREWRIG_USAGE_OFFLINE USAGE_TEST_REPO_DIR="$DASH_REPO" node --disable-warning=ExperimentalWarning "$DRIVER" offline-guard 2>&1 || true)"
  if grep -qx 'FETCH_CALLS=0' <<<"$guard" && ! grep -q '^PRICED=0$' <<<"$guard" && grep -q '^PRICED=' <<<"$guard"; then
    ok "$(L '13.16 offline guard: model.build() makes zero fetch calls with CREWRIG_USAGE_OFFLINE unset (D2)')"
  else
    bad "$(L '13.16 offline guard: model.build() makes zero fetch calls with CREWRIG_USAGE_OFFLINE unset (D2)')" "$guard"
  fi
  if grep -Eq '^STALENESS=(offline)?$' <<<"$guard"; then
    ok "$(L '13.16 offline guard: any fxStaleness in the view reads offline')"
  else
    bad "$(L '13.16 offline guard: any fxStaleness in the view reads offline')" "$guard"
  fi
  if [ "$(drv manifest "$root")" = "$before" ]; then
    ok "$(L '13.16 offline guard: the root manifest is unchanged')"
  else
    bad "$(L '13.16 offline guard: the root manifest is unchanged')"
  fi
}

# =============================================================================
# Case 13.17 — no daemon (R21): everything above ran with no MemPalace; the
# require closure of usage-dashboard/ never reaches mcp.js or mirror.js.
# =============================================================================
case_no_daemon() {
  local closure
  closure="$(drv require-closure "$DASH_REPO/scripts/lib/usage-dashboard")"
  if [ -n "$closure" ] && ! grep -Eq 'usage-store/(mcp|mirror)\.js$' <<<"$closure"; then
    ok "$(L "13.17 the require closure of usage-dashboard/ ($(wc -l <<<"$closure" | tr -d ' ') modules) never reaches usage-store/mcp.js or mirror.js")"
  else
    bad "$(L '13.17 the require closure of usage-dashboard/ never reaches usage-store/mcp.js or mirror.js')" "$closure"
  fi
  if grep -q 'usage-store/query.js' <<<"$closure" && grep -q 'usage-price/store.js' <<<"$closure"; then
    ok "$(L '13.17 the closure reads through query.js and usage-price/store.js (R1)')"
  else
    bad "$(L '13.17 the closure reads through query.js and usage-price/store.js (R1)')" "$closure"
  fi
}

# =============================================================================
# Case 13.18 — no conversation text (R22): the fixture sentinels in raw,
# uncapturedReason and projectRoot appear in no output of A, B or C.
# =============================================================================
case_no_conversation_text() {
  local root out f leaks=""
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L '13.18 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  three_forms "$out" whole
  forms_b "$out" whole
  three_forms "$out" gaps --session sess-gaps
  forms_b "$out" gaps --session sess-gaps
  stop_server
  for f in "$out"/whole.A.html "$out"/whole.C.json "$out"/whole.C.txt "$out"/whole.Bpage.body "$out"/whole.Bview.body "$out"/gaps.A.html "$out"/gaps.C.json "$out"/gaps.C.txt "$out"/gaps.Bpage.body "$out"/gaps.Bview.body; do
    if [ ! -s "$f" ]; then
      leaks="$leaks
$(basename "$f"): empty or missing"
      continue
    fi
    if grep -qE 'SENTINEL-CONVERSATION-TEXT|SENTINEL-PROJECT-ROOT|transcriptExcerpt|uncapturedReason|rawStatus' "$f"; then
      leaks="$leaks
$(basename "$f")"
    fi
  done
  if [ -z "$leaks" ]; then
    ok "$(L '13.18 no raw, uncapturedReason or projectRoot content reaches any output of A, B or C')"
  else
    bad "$(L '13.18 no raw, uncapturedReason or projectRoot content reaches any output of A, B or C')" "$leaks"
  fi
}

# =============================================================================
# Case 13.19 — C is stable (R19).
# =============================================================================
case_text_stable() {
  local root out
  fresh_root_into root
  out="$(new_out_dir)"
  dash report >"$out/r1.txt" 2>/dev/null || true
  dash report >"$out/r2.txt" 2>/dev/null || true
  if [ -s "$out/r1.txt" ] && [ "$(grep -v 'Generated' "$out/r1.txt")" = "$(grep -v 'Generated' "$out/r2.txt")" ]; then
    ok "$(L '13.19 two runs are byte-identical after dropping the Generated line')"
  else
    bad "$(L '13.19 two runs are byte-identical after dropping the Generated line')" "$(diff "$out/r1.txt" "$out/r2.txt" | head -6)"
  fi
  if ! LC_ALL=C grep -q $'\x1b' "$out/r1.txt"; then
    ok "$(L '13.19 no ESC byte in the text report')"
  else
    bad "$(L '13.19 no ESC byte in the text report')"
  fi
  local header
  header="$(grep -m1 -E '^[[:space:]]*key[[:space:]]*\|' "$out/r1.txt" | tr -d ' ' || true)"
  if [ "$header" = "key|records|uncaptured|netInput|cacheRead|cacheWrite|output|reasoning|fidelity|price|priced|unpriced|unconverted" ]; then
    ok "$(L '13.19 the header row lists the columns in the fixed order')"
  else
    bad "$(L '13.19 the header row lists the columns in the fixed order')" "got: $header"
  fi
  local sections
  sections="$(sed -n 's/^== \(.*\) ==$/\1/p' "$out/r1.txt" | tr '\n' '|')"
  if [[ "$sections" =~ ^Selection\|Pricing\|Totals\|By\ (day|week|month)[^|]*\|By\ CLI\|By\ model\|Sessions[^|]*\|Tasks\|Assets\|$ ]]; then
    ok "$(L '13.19 sections come in the fixed order Selection, Pricing, Totals, By <bucket>, By CLI, By model, Sessions, Tasks, Assets')"
  else
    bad "$(L '13.19 sections come in the fixed order Selection, Pricing, Totals, By <bucket>, By CLI, By model, Sessions, Tasks, Assets')" "got: $sections"
  fi
}

# =============================================================================
# Argument handling shared by every form (D6): refused flags exit 2 FATAL.
# =============================================================================
case_arguments() {
  local root out rc flag
  fresh_root_into root
  out="$(new_out_dir)"
  for flag in --undrained --pending --rollup --combined "--period 2026-9" "--bucket year" "--from 2026-10-02 --to 2026-10-01" "--agent a"; do
    rc=0
    # shellcheck disable=SC2086  # deliberate word split of the flag pair
    dash report $flag >"$out/arg.out" 2>&1 || rc=$?
    if [ "$rc" = "2" ] && grep -q 'FATAL' "$out/arg.out"; then
      ok "$(L "D6 report $flag exits 2 with FATAL")"
    else
      bad "$(L "D6 report $flag exits 2 with FATAL")" "exit $rc: $(head -2 "$out/arg.out")"
    fi
  done
}

# =============================================================================
# Hardening (commit d9ab9e8): control characters in identifiers, and a
# symlink planted at form A's --out path. The fixture records-controls/
# carries an agentId and an asset ref holding C0 (with CR and ESC), DEL, C1,
# U+2028/U+2029 and a tab.
# =============================================================================
case_control_chars() {
  local root out rc victim
  fresh_root_into root empty
  out="$(new_out_dir)"
  drv pin-only "$PRICING_FIXTURES_DIR"
  drv write-dir "$FIXTURES_DIR/records-controls"
  local fixture="$FIXTURES_DIR/records-controls/c02-ctl-child.json"
  dash report --json >"$out/c.json" 2>"$out/c.err" || true
  rc=0
  msg="$(node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
const want = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bad = new RegExp("[\\x7f-\\x9f" + String.fromCharCode(0x2028, 0x2029) + "]");
const errs = [];
if (bad.test(raw)) errs.push("a raw DEL, C1, U+2028 or U+2029 character is in the --json output");
for (const hex of ["007f", "0080", "0085", "009f", "2028", "2029"]) {
  if (!raw.includes("\\" + "u" + hex)) errs.push(`no \\u${hex} escape in the --json output`);
}
const v = JSON.parse(raw);
const agents = v.sessions.flatMap((s) => s.agents || []).map((a) => a.agentId);
if (!agents.includes(want.identity.agentId)) errs.push("the agentId does not JSON.parse-round-trip exactly");
if (!v.assets.map((a) => a.ref).includes(want.attribution.externalAsset.ref)) errs.push("the asset ref does not JSON.parse-round-trip exactly");
if (errs.length) { console.log(errs.join("\n")); process.exit(1); }
' "$out/c.json" "$fixture" 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L 'hardening: report --json escapes U+007F-U+009F, U+2028, U+2029 as \uXXXX and round-trips the identifiers exactly')"
  else
    bad "$(L 'hardening: report --json escapes U+007F-U+009F, U+2028, U+2029 as \uXXXX and round-trips the identifiers exactly')" "$msg $(head -3 "$out/c.err")"
  fi

  dash page --out "$out/c.html" >/dev/null 2>"$out/p.err" || true
  rc=0
  msg="$(node -e '
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const want = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const block = /<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script/i.exec(html);
const errs = [];
if (!block) { console.log("no JSON block"); process.exit(1); }
const markup = html.replace(block[1], "");
const ctl = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
const m = ctl.exec(markup);
if (m) errs.push(`markup carries a raw control character U+${m[0].charCodeAt(0).toString(16).padStart(4, "0")}`);
if (!markup.includes(String.fromCharCode(0xfffd))) errs.push("markup carries no U+FFFD replacement character");
if (!markup.includes("tab" + String.fromCharCode(9) + "here")) errs.push("the tab was not kept in the markup");
const tags = (markup.match(/<[A-Za-z][^>]*>/g) || []).join("\n");
if (ctl.test(tags)) errs.push("an attribute carries a raw control character");
if (new RegExp("[\\x7f-\\x9f" + String.fromCharCode(0x2028, 0x2029) + "]").test(block[1])) errs.push("the JSON block carries a raw DEL, C1, U+2028 or U+2029");
const v = JSON.parse(block[1]);
const agents = v.sessions.flatMap((s) => s.agents || []).map((a) => a.agentId);
if (!agents.includes(want.identity.agentId)) errs.push("the embedded agentId does not JSON.parse-round-trip exactly");
if (!v.assets.map((a) => a.ref).includes(want.attribution.externalAsset.ref)) errs.push("the embedded asset ref does not JSON.parse-round-trip exactly");
if (errs.length) { console.log(errs.join("\n")); process.exit(1); }
' "$out/c.html" "$fixture" 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$(L 'hardening: HTML text and attributes map C0 (not tab/newline), DEL and C1 to U+FFFD; the embedded JSON round-trips exactly')"
  else
    bad "$(L 'hardening: HTML text and attributes map C0 (not tab/newline), DEL and C1 to U+FFFD; the embedded JSON round-trips exactly')" "$msg $(head -3 "$out/p.err")"
  fi

  # A symlink pre-planted at the final --out path is replaced, not followed.
  victim="$out/victim.txt"
  printf 'victim-content\n' >"$victim"
  mkdir -p "$out/sl"
  ln -s "$victim" "$out/sl/usage-dashboard.html"
  rc=0
  dash page --out "$out/sl/usage-dashboard.html" >"$out/sl.out" 2>&1 || rc=$?
  local mode=""
  [ -f "$out/sl/usage-dashboard.html" ] && mode="$(node -e 'console.log((require("fs").lstatSync(process.argv[1]).mode & 0o777).toString(8))' "$out/sl/usage-dashboard.html")"
  if [ "$rc" -eq 0 ] && [ "$(cat "$victim")" = "victim-content" ] && [ ! -L "$out/sl/usage-dashboard.html" ] && [ "$mode" = "600" ] && drv extract "$out/sl/usage-dashboard.html" >/dev/null 2>&1; then
    ok "$(L 'hardening: page --out onto a planted symlink replaces the link (mode 600) and never writes through it')"
  else
    bad "$(L 'hardening: page --out onto a planted symlink replaces the link (mode 600) and never writes through it')" "exit $rc; victim now: $(head -c 80 "$victim"); link still a symlink: $([ -L "$out/sl/usage-dashboard.html" ] && echo yes || echo no); mode $mode; $(head -3 "$out/sl.out")"
  fi
}

# =============================================================================
# Review finding i1-F1 (PR #1195): a --session X view of a session WITH
# subordinate agents lists the same agents as the unfiltered view's
# sessions[X], with equal tokens, prices and tallies, in every form; and
# never states "No subordinate agent" for X. (13.10 keeps the R6 case of a
# session with no agent.) sess-parent has agent-reviewer and the hostile
# sub-agent in the fixture.
# =============================================================================
case_session_subtree() {
  local root out rc msg f sid=sess-parent
  fresh_root_into root
  out="$(new_out_dir)"
  if ! start_server; then
    bad "$(L 'i1-F1 form B starts')" "$(cat "$SERVER_LOG")"
    return 0
  fi
  dash report --json >"$out/whole.json" 2>/dev/null || true
  three_forms "$out" sub --session "$sid"
  forms_b "$out" sub --session "$sid"
  stop_server
  for f in A C B Bv; do
    rc=0
    msg="$(drv session-subtree "$out/whole.json" "$out/sub.$f.json" "$sid" 2>&1)" || rc=$?
    if [ "$rc" -eq 0 ]; then
      record_view "$out/sub.$f.json"
      ok "$(L "i1-F1 form $f (--session $sid): sessions[$sid] lists the unfiltered view's agents with equal totals and tallies ($msg)")"
    else
      bad "$(L "i1-F1 form $f (--session $sid): sessions[$sid] lists the unfiltered view's agents with equal totals and tallies")" "$msg"
    fi
  done
  local n
  n="$(vget "$out/whole.json" "v.sessions.find((s) => s.sessionId === '$sid').agents.length")"
  for f in A.html B.html C.txt; do
    local block cells
    block="$(drv session-block "$out/sub.$f" "$sid" 2>&1 || true)"
    if [ "${f#C}" != "$f" ]; then
      cells="$(grep -c '^agent-reviewer ' <<<"$block" || true)"
    else
      cells="$(grep -oE "data-k=\"sessions\.[0-9]+\.agents\.[0-9]+\.recordCount\"" <<<"$block" | wc -l | tr -d ' ')"
    fi
    if ! grep -qF 'No subordinate agent' <<<"$block" && grep -qF 'agent-reviewer' <<<"$block" && { [ "${f#C}" != "$f" ] && [ "$cells" = "1" ] || [ "$cells" = "$n" ]; }; then
      ok "$(L "i1-F1 form ${f%%.*} renders $sid's agents in its drill-down, never \"No subordinate agent\"")"
    else
      bad "$(L "i1-F1 form ${f%%.*} renders $sid's agents in its drill-down, never \"No subordinate agent\"")" "agent rows: $cells (want $n); block: $(head -c 400 <<<"$block")"
    fi
  done
  for f in A B; do
    rc=0
    msg="$(drv cells "$out/sub.$f.html" "$out/sub.$f.json")" || rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "$(L "i1-F1 form $f (--session $sid): every rendered figure, drill-down included, equals format(value)")"
    else
      bad "$(L "i1-F1 form $f (--session $sid): every rendered figure, drill-down included, equals format(value)")" "$msg"
    fi
  done
}

# --- Main pass -------------------------------------------------------------
run_case() {
  "$1" || true
}

run_all_cases() {
  echo; echo "=== Case 13.1 / 13.2: four renderings agree; a statement next to every price ==="
  run_case case_agreement
  echo; echo "=== Case 13.3: 0209 cross-check through the explicit mapping ==="
  run_case case_0209
  echo; echo "=== Case 13.4: tallies and partition ==="
  run_case case_tallies
  echo; echo "=== Case 13.5: unconverted prices ==="
  run_case case_unconverted
  echo; echo "=== Case 13.6: buckets ==="
  run_case case_buckets
  echo; echo "=== Case 13.7: placement equality ==="
  run_case case_placement
  echo; echo "=== Case 13.8: stated divergence from usage:query --period --rollup ==="
  run_case case_divergence
  echo; echo "=== Case 13.9 / 13.10: mixed marker; drill-down ==="
  run_case case_mixed_and_drilldown
  echo; echo "=== Case 13.11: empty states (no-match, store-empty, pruned, superseded-only) ==="
  run_case case_empty
  echo; echo "=== Case 13.12: A is self-contained and injection-safe ==="
  run_case case_static_page
  echo; echo "=== Case 13.13: B binds loopback only ==="
  run_case case_bind
  echo; echo "=== Case 13.14: B refuses a taken port ==="
  run_case case_port_conflict
  echo; echo "=== Case 13.15: B security ==="
  run_case case_security
  echo; echo "=== Case 13.16: B read-only; offline guard ==="
  run_case case_readonly
  echo; echo "=== Case 13.17: no daemon ==="
  run_case case_no_daemon
  echo; echo "=== Case 13.18: no conversation text ==="
  run_case case_no_conversation_text
  echo; echo "=== Case 13.19: C is stable ==="
  run_case case_text_stable
  echo; echo "=== D6: refused and malformed arguments ==="
  run_case case_arguments
  echo; echo "=== Review i1-F1: --session view of a session with agents ==="
  run_case case_session_subtree
  echo; echo "=== Hardening: control characters; symlink at --out ==="
  run_case case_control_chars
}

run_all_cases

# Case 13.4 (end): D3's identities hold in every view model the pass produced.
echo; echo "=== Case 13.4 (every run): partition identities ==="
PART_ERRS=""
PART_N=0
for vf in "$VIEWS_DIR"/*; do
  [ -f "$vf" ] || continue
  PART_N=$((PART_N + 1))
  rc=0
  msg="$(drv partition "$vf")" || rc=$?
  [ "$rc" -eq 0 ] || PART_ERRS="$PART_ERRS
$(basename "$vf"): $msg"
done
if [ -z "$PART_ERRS" ] && [ "$PART_N" -gt 0 ]; then
  ok "13.4 priced+unpriced+unconverted = captured and captured+uncaptured = records in every group of all $PART_N views"
else
  bad "13.4 priced+unpriced+unconverted = captured and captured+uncaptured = records in every group of all $PART_N views" "$(printf '%s\n' "$PART_ERRS" | sed '/^$/d' | head -12)"
fi

# =============================================================================
# Case 13.20 — mutations. Each is applied to a throwaway copy, never to the
# checkout; the named case must go red against the copy.
# =============================================================================
MUT_ROOT=""
make_mutation_copy() {
  MUT_ROOT="$(mktemp -d)"
  CASE_ROOTS="$CASE_ROOTS $MUT_ROOT"
  cp -R "$REPO_DIR/scripts" "$MUT_ROOT/scripts"
  cp -R "$REPO_DIR/schemas" "$MUT_ROOT/schemas"
  [ -f "$REPO_DIR/model-prices.org.json" ] && cp "$REPO_DIR/model-prices.org.json" "$MUT_ROOT/"
  ln -s "$REPO_DIR/node_modules" "$MUT_ROOT/node_modules"
}

# mutate <id> <file-rel> <perl-substitution> <case-function> <case-label>
mutate() {
  local id="$1" rel="$2" expr="$3" fn="$4" label="$5" before_fail after_fail
  make_mutation_copy
  local target="$MUT_ROOT/$rel"
  if [ ! -f "$target" ]; then
    bad "$id: $rel exists in the copy" "missing"
    return 0
  fi
  cp "$target" "$target.orig"
  perl -0pi -e "$expr" "$target"
  if cmp -s "$target" "$target.orig"; then
    bad "$id: the mutation's anchor matches $rel" "the substitution changed nothing — update the anchor in case 13.20"
    return 0
  fi
  before_fail=$fail
  local saved_pass=$pass
  DASH_REPO="$MUT_ROOT"
  IN_MUTATION=1
  local log="$HELPERS_DIR/$id.log"
  "$fn" >"$log" 2>&1 || true
  DASH_REPO="$REPO_DIR"
  IN_MUTATION=0
  stop_server
  after_fail=$(grep -c '^FAIL' "$log" || true)
  # the mutated run's own PASS/FAIL lines are evidence, not suite results
  pass=$saved_pass
  fail=$before_fail
  if [ "$after_fail" -gt 0 ]; then
    ok "$id turns $label red ($after_fail check(s): $(grep -m1 '^FAIL' "$log" | sed 's/^FAIL  \[mutated\] //'))"
  else
    bad "$id turns $label red" "the case stayed green against the mutated copy"
  fi
}

if [ "${USAGE_DASHBOARD_SKIP_MUTATIONS:-0}" = "1" ]; then
  echo; echo "=== Case 13.20: mutations SKIPPED (USAGE_DASHBOARD_SKIP_MUTATIONS=1) ==="
else
  echo; echo "=== Case 13.20: mutations (applied to a throwaway copy) ==="
  D=scripts/lib/usage-dashboard
  # M1 text.js prints totals.recordCount + 1 on the Totals row.
  mutate M1 "$D/text.js" 's/out\.push\(line\(cellTexts\[i\]\)\);/out.push(line(entries[0].path === "totals" && i === 0 ? cellTexts[i].map((c, j) => (j === 1 ? String(Number(c) + 1) : c)) : cellTexts[i]));/' case_agreement "13.1"
  # M2 model.js counts an unpriced record as priced with amount 0.
  mutate M2 "$D/model.js" 's/entry\.unpricedCount \+= 1;/entry.pricedCount += 1;/' case_tallies "13.4"
  # M3 the html.js template gains an external stylesheet.
  mutate M3 "$D/html.js" 's/<meta charset="utf-8">/<meta charset="utf-8">\n<link rel="stylesheet" href="https:\/\/cdn.example\/x.css">/' case_static_page "13.12"
  # M4 server.js listens on 0.0.0.0.
  mutate M4 "$D/server.js" "s/listen\\(([^)]*)'127\\.0\\.0\\.1'/listen(\$1'0.0.0.0'/" case_bind "13.13"
  # M5 the Host allow-list check is removed.
  mutate M5 "$D/server.js" 's/if \(!allowedHosts\(\)\.includes\(host\)\)/if (false)/' case_security "13.15"
  # M6 recompute (every build) prices with store: true.
  mutate M6 "$D/model.js" 's/store: false,/store: true,/' case_readonly "13.16"
  # M7 embedJson stops escaping <.
  mutate M7 "$D/html.js" 's/(function embedJson[\s\S]*?\.replace\(\/\[)</$1/' case_static_page "13.12"
  # M8 D2's offline line is removed (the guard's driver unsets the variable
  # the rest of the suite exports, which would otherwise mask this mutation).
  mutate M8 "$D/model.js" "s/process\\.env\\.CREWRIG_USAGE_OFFLINE\\s*=\\s*'1';?//" case_readonly "13.16 (offline guard)"
  # M9 model.js sums unconverted amounts into price.amount.
  mutate M9 "$D/model.js" 's/entry\.unconvertedCount \+= 1;/entry.unconvertedCount += 1;\n        sum += p.amount;/' case_unconverted "13.5a"
  # M10 html.js omits the mixed string on combined figures.
  mutate M10 "$D/html.js" 's/\$\{esc\(c\.text\)\}<\/td>` : `<td>/\${esc(\/mixed\$\/.test(c.k) ? "" : c.text)}<\/td>` : `<td>/' case_mixed_and_drilldown "13.9"
  # M11 text.js drops the note: price-statement line.
  mutate M11 "$D/text.js" 's/if \(r\.statement\) out\.push\([^;]*;//' case_agreement "13.2"
  # M12 model.js applies the placement predicate BEFORE contributingRecords.
  mutate M12 "$D/model.js" 's/contributingRecords\(records\);/contributingRecords(records.filter(place));/' case_placement "13.7"
  # M14 esc() stops mapping control characters to U+FFFD (hardening, d9ab9e8).
  mutate M14 "$D/html.js" 's/\n\s*\.replace\(\/\[\\u0000[^\n]*//' case_control_chars "hardening (HTML controls)"
  # M15 source.js reverts to reading only sessionId === X for --session X
  # (review finding i1-F1: the subordinate agents' records drop out).
  mutate M15 "$D/source.js" 's/const subordinates = sel\.session \? readSubordinates\([^;]*;/const subordinates = [];/' case_session_subtree "i1-F1"
  # M13 source.js stops reading at month(U).
  mutate M13 "$D/source.js" 's/ && touched\.size === 0\) break;/) break;/' case_placement "13.7"
fi

# --- HOME marker: re-assert unchanged --------------------------------------
echo
if [ -e "$REAL_HOME_USAGE_DIR" ]; then
  HOME_USAGE_MARKER_AFTER="$(find "$REAL_HOME_USAGE_DIR" -type f 2>/dev/null | LC_ALL=C sort)"
else
  HOME_USAGE_MARKER_AFTER="<absent>"
fi
if [ "$HOME_USAGE_MARKER_BEFORE" = "$HOME_USAGE_MARKER_AFTER" ]; then
  ok "\$HOME/.crewrig/usage is unchanged by the suite"
else
  bad "\$HOME/.crewrig/usage is unchanged by the suite"
fi

echo
echo "=== Summary: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
