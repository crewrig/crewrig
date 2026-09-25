// fx.js — the ECB currency layer (spec 0209 R22-R26; PLAN v2 step 3).
//
// resolve(date, ctx) — the rule, stated once and implemented once:
//   (a) Selection: the largest cached fixing date <= `date`, never later.
//   (b) Freshness gate, before selection: when the newest cached fixing is
//       STRICTLY OLDER than `date`, the cache cannot itself prove it holds
//       the most recent published fixing, so resolve() attempts ONE refresh
//       — suppressed entirely under CREWRIG_USAGE_OFFLINE=1, abandoned on
//       any network failure. It then re-selects. An empty cache is
//       "strictly older" by construction.
//   (c) Weekend/holiday/pre-publication: after a refresh, the newest
//       PUBLISHED fixing may still be dated before `date` — that fixing IS
//       the live one (R22 is satisfied exactly by resolving to it).
//   (d) fxStaleness: whenever the gate fired but the refresh was suppressed
//       or failed, the result carries
//       fxStaleness: {ageDays, resolvedFixing, newestCached, reason}, where
//       reason is "offline" | "network-error" | "mirror-disagreement". The
//       field means "this fixing was not confirmed against the source", not
//       "this fixing is wrong".
//   (e) No fixing at all after the gate has run -> {status:
//       "no-fixing-on-or-before"}; an ISO 4217 code the fixing does not list
//       -> "no-such-currency", never a guess. The latter carries the consulted
//       fixing's date as conversion.fixingDate (spec 0209 delta-02 R51).
//   (f) Per-pass memo: when ctx.fxMemo is a Map, resolve() runs at most once
//       per (date, mirror) and every later call in that pass reuses the same
//       promise — so re-attempting failed conversions (delta-02 R52) costs one
//       refresh attempt per computation date per pass, not one per record. The
//       caller owns the Map (one per usage:price run, rollup or dashboard
//       build); it is never held at module level, because a long-lived form-B
//       server must see a fixing a later --refresh-fx writes.
//
// ctx.fetchFixings is the injection seam the suite uses to stay offline
// while exercising both the freshness and the suppression paths.
//
// ECB rates are EUR-based and the fixing carries no EUR row: USD -> X is
// rate(X) / rate(USD), USD -> EUR is 1 / rate(USD).
//
// --fx-mirror frankfurter reaches api.frankfurter.dev only AFTER the ECB
// host fails, asking it for the exact date being sought, and asserts the
// mirror's own reported date equals that date — a differing date is a hard
// error (mirror-disagreement), never a second, independently-trusted rate.

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('../usage-store/layout');

const ECB_HIST_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const FRANKFURTER_URL = (date) => `https://api.frankfurter.dev/v1/${date}`;

function ecbDir() {
  return path.join(layout.fxDir(), 'ecb');
}

function fixingPath(date) {
  return path.join(ecbDir(), `${date}.json`);
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

const FIXING_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function listCachedDates() {
  let names;
  try {
    names = fs.readdirSync(ecbDir());
  } catch (err) {
    return [];
  }
  return names
    .map((n) => FIXING_FILE_RE.exec(n))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
}

function newestCachedDate() {
  const dates = listCachedDates();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

// selectFixing(date) — the largest cached date <= `date`, or null.
function selectFixing(date) {
  const dates = listCachedDates();
  let chosen = null;
  for (const d of dates) {
    if (d <= date) chosen = d;
    else break;
  }
  return chosen;
}

function readFixing(date) {
  const p = fixingPath(date);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// parseEcbHistXml(xml) -> [{date, rates: {CCY: number, ...}}, ...]. No
// EUR row (ECB's own rates are EUR-based); regex-based, no XML dependency
// (Node-only, no new runtime dependency).
function parseEcbHistXml(xml) {
  const fixings = [];
  const dayRe = /<Cube time="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>/g;
  let dayMatch;
  while ((dayMatch = dayRe.exec(xml))) {
    const date = dayMatch[1];
    const block = dayMatch[2];
    const rates = {};
    const rateRe = /<Cube currency="([A-Z]{3})" rate="([0-9.]+)"\s*\/>/g;
    let rateMatch;
    while ((rateMatch = rateRe.exec(block))) {
      rates[rateMatch[1]] = parseFloat(rateMatch[2]);
    }
    fixings.push({ date, rates });
  }
  return fixings;
}

async function fetchEcbFull(fetchImpl) {
  const res = await fetchImpl(ECB_HIST_URL, { headers: { 'User-Agent': 'crewrig-usage-price' } });
  if (!res.ok) {
    throw new Error(`ECB fixing feed returned ${res.status} for ${ECB_HIST_URL}`);
  }
  const xml = await res.text();
  return parseEcbHistXml(xml);
}

async function fetchViaMirror(date, fetchImpl) {
  const url = FRANKFURTER_URL(date);
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'crewrig-usage-price' } });
  if (!res.ok) {
    throw new Error(`frankfurter mirror returned ${res.status} for ${date}`);
  }
  const body = await res.json();
  if (body.date !== date) {
    const err = new Error(`frankfurter mirror disagreement: requested ${date}, mirror reports ${body.date}`);
    err.mirrorDisagreement = true;
    throw err;
  }
  return { date: body.date, rates: body.rates || {} };
}

// defaultFetchFixings({date, mirror, fetchImpl}) — resolve()'s injection
// seam default. Tries the ECB host's full feed first (writes every fixing
// it reports); on failure, when a mirror is named, falls back to it for
// exactly the one fixing being sought — never a second, independent rate.
async function defaultFetchFixings({ date, mirror, fetchImpl = fetch } = {}) {
  try {
    const fixings = await fetchEcbFull(fetchImpl);
    for (const fixing of fixings) {
      atomicWrite(fixingPath(fixing.date), JSON.stringify(fixing, null, 2));
    }
    return { source: 'ecb', fixingsWritten: fixings.length };
  } catch (ecbErr) {
    if (mirror !== 'frankfurter') throw ecbErr;
    const fixing = await fetchViaMirror(date, fetchImpl);
    atomicWrite(fixingPath(fixing.date), JSON.stringify(fixing, null, 2));
    return { source: 'frankfurter', fixingsWritten: 1 };
  }
}

// refresh({mirror, fetchImpl}) — the explicit `--refresh-fx` CLI path.
async function refresh({ mirror, fetchImpl = fetch } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return defaultFetchFixings({ date: today, mirror, fetchImpl });
}

function ageDaysBetween(computationDate, fixingDate) {
  const ms = new Date(`${computationDate}T00:00:00Z`) - new Date(`${fixingDate}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

// resolveOnce(date, ctx) — see module header for the full rule.
async function resolveOnce(date, ctx = {}) {
  const offline = process.env.CREWRIG_USAGE_OFFLINE === '1';
  let newest = newestCachedDate();
  const gateFires = !newest || newest < date;
  let staleReason = null;

  if (gateFires) {
    if (offline) {
      staleReason = 'offline';
    } else {
      const fetchFixings = ctx.fetchFixings || defaultFetchFixings;
      try {
        await fetchFixings({ date, mirror: ctx.mirror, fetchImpl: ctx.fetchImpl });
      } catch (err) {
        staleReason = err && err.mirrorDisagreement ? 'mirror-disagreement' : 'network-error';
      }
    }
  }

  const selectedDate = selectFixing(date);
  if (!selectedDate) {
    return { status: 'no-fixing-on-or-before' };
  }

  const fixing = readFixing(selectedDate);
  const result = { fixingDate: selectedDate, fixing };
  if (staleReason) {
    result.fxStaleness = {
      ageDays: ageDaysBetween(date, selectedDate),
      resolvedFixing: selectedDate,
      newestCached: newestCachedDate(),
      reason: staleReason,
    };
  }
  return result;
}

// resolve(date, ctx) — resolveOnce(), memoised per pass in ctx.fxMemo when the
// caller provides one (header clause (f)).
function resolve(date, ctx = {}) {
  if (!(ctx.fxMemo instanceof Map)) return resolveOnce(date, ctx);
  const key = `${date}|${ctx.mirror || ''}`;
  if (!ctx.fxMemo.has(key)) ctx.fxMemo.set(key, resolveOnce(date, ctx));
  return ctx.fxMemo.get(key);
}

// crossRate(fixing, ccy) — the USD -> ccy multiplier, or null when the
// fixing does not list `ccy` (no-such-currency).
function crossRate(fixing, ccy) {
  if (ccy === 'USD') return 1;
  const usdRate = fixing.rates.USD;
  if (!usdRate) return null;
  if (ccy === 'EUR') return 1 / usdRate;
  const rate = fixing.rates[ccy];
  if (rate === undefined) return null;
  return rate / usdRate;
}

// convert(amountUsd, ccy, date, ctx) — R22/R23/R26 together. USD is a
// pass-through (R25: the primary source's own prices are USD-denominated).
async function convert(amountUsd, ccy, date, ctx = {}) {
  if (ccy === 'USD') {
    return { amount: amountUsd, conversion: { status: 'ok', currency: 'USD' } };
  }

  const resolved = await resolve(date, ctx);
  if (resolved.status === 'no-fixing-on-or-before') {
    return { amount: amountUsd, conversion: { status: 'no-fixing-on-or-before', requested: ccy } };
  }

  const rate = crossRate(resolved.fixing, ccy);
  if (rate === null) {
    return { amount: amountUsd, conversion: { status: 'no-such-currency', requested: ccy, fixingDate: resolved.fixingDate } };
  }

  const out = {
    amount: amountUsd * rate,
    conversion: {
      status: 'ok',
      currency: ccy,
      fixingDate: resolved.fixingDate,
      rateOfRecord: 'ECB',
      attribution: 'European Central Bank daily reference rate (https://www.ecb.europa.eu/stats/eurofxref/)',
    },
  };
  if (resolved.fxStaleness) out.fxStaleness = resolved.fxStaleness;
  return out;
}

module.exports = {
  refresh,
  resolve,
  convert,
  crossRate,
  listCachedDates,
  newestCachedDate,
  readFixing,
  parseEcbHistXml,
};
