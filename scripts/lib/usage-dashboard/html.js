// html.js — forms A and B of the usage dashboard (spec 0210 R11-R13, R20,
// R28; PLAN v2 step 7). The page carries ZERO executable script: charts are
// inline SVG drawn here, granularity switching is CSS radio tabs, drill-down
// is native <details>. The Content-Security-Policy's only non-'none'
// directive is a hash-pinned inline style, and no src/href/srcset/url(/
// @import is ever emitted, so a conforming browser has nothing to fetch.
//
// The view model is embedded once, in <script type="application/json">,
// escaped by embedJson(): every `<`, `>`, `&`, U+2028 and U+2029 in the
// JSON.stringify output becomes its six-character JSON escape (backslash,
// `u`, four hex digits). JSON syntax outside string literals never contains
// those characters, so each replacement lands inside a string literal and
// JSON.parse restores the original exactly; with no raw `<` left, neither
// `</script` nor `<!--` can occur inside the block.

'use strict';

const crypto = require('crypto');

const format = require('./format');

const STYLE = `
:root{--bg:#ffffff;--fg:#1b1f24;--muted:#57606a;--line:#d0d7de;--accent:#0b5cad;--warn-bg:#fff4d6;--warn-fg:#5c4400;--panel:#f6f8fa}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9da7b3;--line:#30363d;--accent:#6cb6ff;--warn-bg:#3a2e05;--warn-fg:#f2d785;--panel:#161b22}}
html{color-scheme:light dark}
body{margin:0;padding:1rem 1.25rem 3rem;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:1.4rem;margin:.2rem 0 .6rem}
h2{font-size:1.1rem;margin:1.6rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.2rem}
h3{font-size:1rem;margin:.8rem 0 .3rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;word-break:break-all}
.banner{background:var(--warn-bg);color:var(--warn-fg);border:1px solid var(--line);padding:.6rem .8rem;border-radius:4px;font-weight:600}
.meta{color:var(--muted)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;margin:.3rem 0 .8rem;font-variant-numeric:tabular-nums}
th,td{border:1px solid var(--line);padding:.2rem .45rem;text-align:right;vertical-align:top}
th[scope=row],thead th{text-align:left;background:var(--panel)}
tr.fid th[scope=row]{font-weight:400;color:var(--muted)}
.price-statement{display:block;max-width:34rem;text-align:left;font-size:.75rem;color:var(--muted);white-space:normal}
.tabs>input{margin:0 .2rem 0 .8rem}
.tabs>input:first-of-type{margin-left:0}
.panel{display:none;margin-top:.6rem}
#g-day:checked~.p-day,#g-week:checked~.p-week,#g-month:checked~.p-month{display:block}
.chart{max-width:40rem;color:var(--accent)}
.chart text{fill:var(--fg);font-size:12px}
details{margin:.3rem 0}
summary{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
form{margin:.4rem 0;padding:.5rem;border:1px solid var(--line);border-radius:4px}
form label{display:inline-block;margin:.2rem .6rem .2rem 0}
input[type=text]{width:11rem}
footer{margin-top:2rem;border-top:1px solid var(--line);padding-top:.6rem;color:var(--muted)}
`;

const STYLE_HASH = crypto.createHash('sha256').update(STYLE, 'utf8').digest('base64');

function csp(mode) {
  const formAction = mode === 'served' ? "'self'" : "'none'";
  return `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; img-src 'none'; form-action ${formAction}; base-uri 'none'`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function embedJson(view) {
  return JSON.stringify(view).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function tableHead() {
  return `<thead><tr>${format.COLUMNS.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`;
}

function rowHtml(row) {
  const cells = row.cells.map((c, i) => {
    if (i === 0) return `<th scope="row">${esc(c.text)}</th>`;
    if (c.price) {
      const st = row.statement;
      return `<td><span data-k="${esc(c.k)}">${esc(c.text)}</span><span class="price-statement" data-s="${esc(st.s)}">${esc(st.text)}</span></td>`;
    }
    return c.k ? `<td data-k="${esc(c.k)}">${esc(c.text)}</td>` : `<td>${esc(c.text)}</td>`;
  });
  return `<tr${row.fidelity ? ' class="fid"' : ''}>${cells.join('')}</tr>`;
}

function table(entries) {
  if (entries.length === 0) return '<p class="meta">None in this view.</p>';
  const body = entries.flatMap((e) => format.rows(e.path, e.label, e.group)).map(rowHtml).join('\n');
  return `<div class="scroll"><table>${tableHead()}<tbody>\n${body}\n</tbody></table></div>`;
}

// svgBars(entries, id, title) — one horizontal bar per bucket, drawn from
// each entry's combined net-input count; the table beside it is the text
// alternative (R13).
function svgBars(entries, id, title) {
  if (entries.length === 0) return '';
  const values = entries.map((e) => e.group.tokens.combined.netInput);
  const max = Math.max(...values);
  const rowH = 22;
  const height = entries.length * rowH + 4;
  const bars = entries
    .map((e, i) => {
      const y = i * rowH;
      const w = max > 0 ? Math.round((values[i] / max) * 300) : 0;
      return `<text x="0" y="${y + 15}">${esc(e.label)}</text><rect x="120" y="${y + 4}" width="${w}" height="14" fill="currentColor"></rect><text x="${126 + w}" y="${y + 15}">${esc(format.int(values[i]))}</text>`;
    })
    .join('');
  const desc = entries.map((e, i) => `${e.label}: ${format.int(values[i])}`).join('; ');
  return `<svg class="chart" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 520 ${height}" width="100%"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${bars}</svg>`;
}

function keyed(list, base, kind) {
  return list.map((g, i) => ({ path: `${base}.${i}`, label: format.keyLabel(g.key, kind), group: g }));
}

function periodsSection(view) {
  const grans = [
    ['day', 'Day'],
    ['week', 'ISO week'],
    ['month', 'Month'],
  ];
  const selected = view.selection.bucket;
  const radios = grans
    .map(([g, label]) => `<input type="radio" name="granularity" id="g-${g}"${g === selected ? ' checked' : ''}><label for="g-${g}">${label}</label>`)
    .join('\n');
  const panels = grans
    .map(([g, label]) => {
      const entries = keyed(view.byBucket[g], `byBucket.${g}`, 'bucket');
      return `<div class="panel p-${g}">${svgBars(entries, `chart-${g}`, `Net input tokens per ${label.toLowerCase()} (UTC)`)}<details open><summary>Data table — by ${label.toLowerCase()}</summary>${table(entries)}</details></div>`;
    })
    .join('\n');
  return `<section aria-labelledby="h-periods"><h2 id="h-periods">By period (UTC)</h2><div class="tabs">\n${radios}\n${panels}\n</div></section>`;
}

function sessionsSection(view) {
  if (view.sessions.length === 0) {
    return '<section aria-labelledby="h-sessions"><h2 id="h-sessions">Sessions and their agents</h2><p class="meta">None in this view.</p></section>';
  }
  const items = view.sessions
    .map((s, i) => {
      const path = `sessions.${i}`;
      const agents =
        s.agents.length === 0
          ? '<p class="meta">No subordinate agent</p>'
          : table(s.agents.map((a, j) => ({ path: `${path}.agents.${j}`, label: format.keyLabel(a.agentId, 'agent'), group: a })));
      return `<details><summary>Session <code>${esc(s.sessionId)}</code> · ${esc(s.cli)}</summary>${table([{ path, label: s.sessionId, group: s }])}<h3>Subordinate agents</h3>${agents}</details>`;
    })
    .join('\n');
  return `<section aria-labelledby="h-sessions"><h2 id="h-sessions">Sessions and their agents</h2><p class="meta">A session's row covers its own records; each subordinate agent is listed beneath it.</p>\n${items}\n</section>`;
}

function listSection(id, title, entries) {
  return `<section aria-labelledby="h-${id}"><h2 id="h-${id}">${esc(title)}</h2><details open><summary>${esc(title)} (${entries.length})</summary>${table(entries)}</details></section>`;
}

function pricingSection(view) {
  const p = view.pricing;
  const lines = [];
  if (!p.available) {
    lines.push(`<p class="banner">No pinned price list — run <code>${esc(p.hint)}</code>. Token figures are complete; every price is absent.</p>`);
  } else {
    lines.push(`<p><strong>${esc(p.disclaimer)}.</strong> Currency <code>${esc(p.currency)}</code>; recomputed as of today: ${p.asOfToday ? 'yes' : 'no'}.</p>`);
    lines.push(`<p>Price list snapshot <code>${esc(p.snapshot.sha)}</code>, fetched ${esc(p.snapshot.fetchedAt)}.</p>`);
    lines.push('<p class="meta">The dashboard never reaches the network: FX conversion uses the cached fixings only.</p>');
    if (p.fxStaleness) {
      lines.push(`<p class="banner">FX fixing is stale (${esc(p.fxStaleness.reason)}). Fresher FX fixing: <code>${esc(p.fxStaleness.hint)}</code></p>`);
    }
  }
  lines.push('<p class="meta">Tallies: <em>priced</em> + <em>unpriced</em> + <em>unconverted</em> = captured records; captured + <em>uncaptured</em> = records. Unpriced, unconverted and uncaptured records never enter a price sum.</p>');
  return `<section aria-labelledby="h-pricing"><h2 id="h-pricing">Pricing</h2>${lines.join('')}</section>`;
}

function paramValues(view) {
  const s = view.selection.filters.selection;
  const p = view.selection.filters.placement;
  return {
    session: s.session,
    agent: s.agent,
    parent: s.parent,
    cli: s.cli,
    'task-key': s.taskKey,
    asset: s.asset,
    fidelity: s.fidelity,
    'no-ledger': s.noLedger ? '1' : undefined,
    from: p.from,
    to: p.to,
    period: p.period,
    model: p.model,
    bucket: view.selection.bucket,
    currency: view.selection.currency,
  };
}

function hiddenFilters(view) {
  return Object.entries(paramValues(view))
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
}

function servedControls(view, token) {
  const values = paramValues(view);
  const fields = Object.entries(values)
    .filter(([k]) => k !== 'no-ledger')
    .map(([k, v]) => `<label>${esc(k)} <input type="text" name="${esc(k)}" value="${esc(v === undefined ? '' : v)}"></label>`)
    .join('');
  const noLedger = `<label><input type="checkbox" name="no-ledger" value="1"${values['no-ledger'] ? ' checked' : ''}> no-ledger</label>`;
  const recomputed = view.selection.asOfToday
    ? `<p class="banner">Prices recomputed as of today for this view only — nothing was stored. To persist them: <code>${esc(view.selection.persist)}</code></p>`
    : '';
  return `<section aria-labelledby="h-controls"><h2 id="h-controls">Filters and actions</h2>${recomputed}
<form method="get" action="/">${fields}${noLedger} <button type="submit">Apply filters</button></form>
<form method="post" action="/recompute"><input type="hidden" name="token" value="${esc(token)}">${hiddenFilters(view)}<button type="submit">Recompute prices as of today (this view only)</button> <span class="meta">To persist: <code>${esc(view.selection.persist)}</code></span></form>
<form method="post" action="/stop"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">Stop the dashboard server</button></form></section>`;
}

function footer(view, mode) {
  const live = mode === 'served' ? '<p>Live view: every request re-reads the usage store.</p>' : '';
  return `<footer>${live}<p>Generated ${esc(view.generatedAt)} (UTC).</p>
<p>Regenerate: <code>${esc(view.selection.regenerate)}</code></p>
<p>Regenerate with prices recomputed as of today: <code>${esc(view.selection.regenerateAsOfToday)}</code></p>
<p>Fresher FX fixing: <code>task usage:price -- --refresh-fx</code></p></footer>`;
}

// renderPage(view, {mode: 'static'|'served', token}).
function renderPage(view, opts) {
  opts = opts || {};
  const mode = opts.mode === 'served' ? 'served' : 'static';
  const banner = format.emptyBanner(view);
  const filtersLine = view.selection.args ? `<code>${esc(view.selection.args)}</code>` : 'none (the whole store)';
  const body = [
    `<header><h1>Usage dashboard</h1><p class="meta">Filters: ${filtersLine} · bucket ${esc(view.selection.bucket)} · currency ${esc(view.selection.currency)}</p></header>`,
    '<main>',
    banner ? `<p class="banner" role="status" data-empty="${esc(view.empty)}">${esc(banner)}</p>` : '',
    mode === 'served' ? servedControls(view, opts.token || '') : '',
    pricingSection(view),
    `<section aria-labelledby="h-totals"><h2 id="h-totals">Totals</h2>${table([{ path: 'totals', label: 'total', group: view.totals }])}</section>`,
    periodsSection(view),
    `<section aria-labelledby="h-cli"><h2 id="h-cli">By CLI</h2>${table(keyed(view.byCli, 'byCli', 'cli'))}</section>`,
    `<section aria-labelledby="h-model"><h2 id="h-model">By model</h2>${table(keyed(view.byModel, 'byModel', 'model'))}</section>`,
    sessionsSection(view),
    listSection('tasks', 'Tasks', view.tasks.map((t, i) => ({ path: `tasks.${i}`, label: t.taskHandoffKey, group: t }))),
    listSection('assets', 'External assets', view.assets.map((a, i) => ({ path: `assets.${i}`, label: `${a.kind}:${a.ref}`, group: a }))),
    '</main>',
    footer(view, mode),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(mode)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Usage dashboard</title>
<style>${STYLE}</style>
</head>
<body>
${body}
<script type="application/json" id="usage-view">${embedJson(view)}</script>
</body>
</html>
`;
}

module.exports = { renderPage, embedJson, esc, csp, STYLE_HASH };
