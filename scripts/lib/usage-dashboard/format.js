// format.js — the one number-to-string layer both renderers use (spec 0210
// R2/R19/R20; PLAN v2 step 6). Nothing here computes a figure: every value
// comes from the view model as is. rows() fixes which figures a group shows
// and in what column order, so the HTML page and the text report carry the
// same strings for the same view-model paths, and cell(view, path) returns
// the string any `data-k="<path>"` hook must carry.

'use strict';

const FIDELITIES = ['per-request', 'run-total', 'session-cumulative'];
const TOKEN_CLASSES = ['netInput', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
const COLUMNS = ['key', 'records', 'uncaptured', ...TOKEN_CLASSES, 'fidelity', 'price', 'priced', 'unpriced', 'unconverted'];
const NOT_SHOWN = '-';

function int(n) {
  return String(n);
}

function money(amount, currency, absent) {
  if (amount === null || amount === undefined) return `— (${absent || 'absent'})`;
  return `${amount.toFixed(6)} ${currency}`;
}

function cacheWrite(v) {
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .sort()
      .map((tier) => `${tier}=${v[tier]}`)
      .join(';');
  }
  return int(v);
}

function tokens(sum) {
  return {
    netInput: int(sum.netInput),
    cacheRead: int(sum.cacheRead),
    cacheWrite: cacheWrite(sum.cacheWrite),
    output: int(sum.output),
    reasoning: int(sum.reasoning),
  };
}

function mixed(list) {
  if (!list || list.length === 0) return 'none';
  if (list.length === 1) return list[0];
  return `mixed: ${list.join('+')}`;
}

function tally(price) {
  return `${price.pricedCount}/${price.unpricedCount}/${price.unconvertedCount}`;
}

function span(r) {
  if (!r) return null;
  return r.min === r.max ? String(r.min) : `${r.min} to ${r.max}`;
}

// priceStatement(price) — the reference-not-invoice statement and the three
// 0209 timestamps (price-list snapshot, FX fixing, computation), as one
// string printed directly next to every price (R20).
function priceStatement(price) {
  const t = price.timestamps || {};
  if (!t.snapshotSha) {
    return `${price.disclaimer}; no pinned price list — run task usage:price -- --refresh-pricelist`;
  }
  const fixing = span(t.fixingDate) || (price.currency === 'USD' ? 'none (USD, no conversion)' : 'none');
  return `${price.disclaimer}; price list ${t.snapshotSha} fetched ${t.snapshotFetchedAt}; FX fixing ${fixing}; computed ${span(t.computedAt) || 'none'}`;
}

function emptyBanner(view) {
  switch (view.empty) {
    case 'store-empty':
      return 'The usage store holds no record';
    case 'no-match':
      return `No record matches this selection: ${view.selection.args || '(no filter)'}`;
    case 'superseded-only':
      return `${view.supersededCount} session-cumulative snapshot(s) match this selection but are superseded by a later snapshot of the same session outside it — see "Reading the views"`;
    default:
      return null;
  }
}

// textSafe(s) — identifiers are record data: neutralise control characters
// (and U+2028/U+2029) so a hostile identifier cannot drive a terminal.
function textSafe(s) {
  return String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function segments(path) {
  return path.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

// cell(view, path) — the string a `data-k="<path>"` hook carries. A leaf
// named `amount` is formatted as money in the currency of the nearest
// enclosing `price` object; `mixed` as the fidelity marker; `cacheWrite` as
// a (possibly tiered) count; any other number as a plain integer.
function cell(view, path) {
  let node = view;
  let price = null;
  const segs = segments(path);
  let parent = null;
  for (const s of segs) {
    parent = node;
    if (node === null || node === undefined) throw new Error(`no value at ${path}`);
    node = node[s];
    if (s === 'price') price = node;
  }
  const leaf = segs[segs.length - 1];
  if (leaf === 'amount') return money(node, price ? price.currency : parent.currency, parent.absent);
  if (leaf === 'mixed') return mixed(node);
  if (leaf === 'cacheWrite') return cacheWrite(node);
  if (typeof node === 'number') return int(node);
  if (node === null || node === undefined) throw new Error(`no value at ${path}`);
  return String(node);
}

// rows(path, label, group) — the rows a group renders as, in COLUMNS order.
// The first row is the group's combined figure (fidelity column = the mixed
// marker, R7/R30) and carries the group's price, followed by its statement.
// When the group combines more than one fidelity, one row per fidelity
// follows, carrying that fidelity's tokens and price tallies (no price, so
// no statement). Each cell is {text, k} where k is its view-model path.
function rows(path, label, g) {
  const t = tokens(g.tokens.combined);
  const out = [
    {
      cells: [
        { text: label, k: null },
        { text: int(g.recordCount), k: `${path}.recordCount` },
        { text: int(g.uncapturedCount), k: `${path}.uncapturedCount` },
        ...TOKEN_CLASSES.map((c) => ({ text: t[c], k: `${path}.tokens.combined.${c}` })),
        { text: mixed(g.tokens.combined.mixed), k: `${path}.tokens.combined.mixed` },
        { text: money(g.price.amount, g.price.currency, g.price.absent), k: `${path}.price.amount`, price: true },
        { text: int(g.price.pricedCount), k: `${path}.price.pricedCount` },
        { text: int(g.price.unpricedCount), k: `${path}.price.unpricedCount` },
        { text: int(g.price.unconvertedCount), k: `${path}.price.unconvertedCount` },
      ],
      statement: { text: priceStatement(g.price), s: path },
    },
  ];
  if (g.tokens.combined.mixed.length > 1) {
    for (const f of g.tokens.combined.mixed) {
      const ft = tokens(g.tokens.byFidelity[f]);
      const fp = g.price.byFidelity[f];
      const base = `${path}.price.byFidelity.${f}`;
      out.push({
        cells: [
          { text: label, k: null },
          { text: NOT_SHOWN, k: null },
          { text: NOT_SHOWN, k: null },
          ...TOKEN_CLASSES.map((c) => ({ text: ft[c], k: `${path}.tokens.byFidelity.${f}.${c}` })),
          { text: f, k: null },
          { text: NOT_SHOWN, k: null },
          { text: int(fp.pricedCount), k: `${base}.pricedCount` },
          { text: int(fp.unpricedCount), k: `${base}.unpricedCount` },
          { text: int(fp.unconvertedCount), k: `${base}.unconvertedCount` },
        ],
        statement: null,
        fidelity: f,
      });
    }
  }
  return out;
}

function keyLabel(key, kind) {
  if (key !== null && key !== undefined) return String(key);
  if (kind === 'model') return '(no model: uncaptured)';
  if (kind === 'agent') return '(no agent id)';
  return '(none)';
}

module.exports = {
  FIDELITIES,
  TOKEN_CLASSES,
  COLUMNS,
  NOT_SHOWN,
  int,
  money,
  cacheWrite,
  tokens,
  mixed,
  tally,
  priceStatement,
  emptyBanner,
  textSafe,
  cell,
  rows,
  keyLabel,
};
