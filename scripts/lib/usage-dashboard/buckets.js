// buckets.js — UTC period keys for the dashboard's placement rule (spec 0210
// PLAN v2 D4, step 3). Every key is derived from timing.requestInstant, the
// same instant layout.period() partitions the journal by.

'use strict';

const DAY_MS = 86400000;

function utcDate(instant) {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`not a valid instant: ${instant}`);
  }
  return d;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function dayKey(instant) {
  return ymd(utcDate(instant));
}

function monthKey(instant) {
  return ymd(utcDate(instant)).slice(0, 7);
}

// isoWeekKey(instant) — ISO 8601: weeks start on Monday, and a week belongs
// to the ISO week-year of its Thursday (2027-01-01 is 2026-W53).
function isoWeekKey(instant) {
  const d = utcDate(instant);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  const thursday = new Date(day + (3 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const ordinal = Math.round((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
  const week = Math.ceil(ordinal / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// isoWeekBounds(key) — the Monday and Sunday (YYYY-MM-DD, UTC) of an ISO week.
function isoWeekBounds(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`not an ISO week key: ${key}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const monday = jan4 - jan4Weekday * DAY_MS + (week - 1) * 7 * DAY_MS;
  return { monday: ymd(new Date(monday)), sunday: ymd(new Date(monday + 6 * DAY_MS)) };
}

// lastDayOfMonth('YYYY-MM') -> 'YYYY-MM-DD'.
function lastDayOfMonth(month) {
  const [y, mo] = month.split('-').map(Number);
  return ymd(new Date(Date.UTC(y, mo, 0)));
}

function compareKeys(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

// groupBy(records, keyFn) -> [{key, records}] sorted ascending by key; a null
// key sorts last.
function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return Array.from(map.keys())
    .sort(compareKeys)
    .map((key) => ({ key, records: map.get(key) }));
}

module.exports = { dayKey, isoWeekKey, monthKey, isoWeekBounds, lastDayOfMonth, groupBy, compareKeys };
