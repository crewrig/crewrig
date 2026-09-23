// text.js — form C of the usage dashboard (spec 0210 R19/R20; PLAN v2
// step 8). Plain text, no colour and no escape sequence at all, sections
// and columns in a fixed order; every row that prints a price is followed by
// one `  note: <price statement>` line. --json prints the very object forms
// A and B embed.

'use strict';

const format = require('./format');

function pad(rowsOfCells) {
  const widths = format.COLUMNS.map((c, i) => Math.max(c.length, ...rowsOfCells.map((r) => r[i].length)));
  return (cells) => cells.map((c, i) => c.padEnd(widths[i])).join(' | ').replace(/\s+$/, '');
}

function tableLines(entries) {
  if (entries.length === 0) return ['(none in this view)'];
  const rows = entries.flatMap((e) => format.rows(e.path, e.label, e.group));
  const cellTexts = rows.map((r) => r.cells.map((c) => format.textSafe(c.text)));
  const line = pad(cellTexts);
  const out = [line(format.COLUMNS)];
  rows.forEach((r, i) => {
    out.push(line(cellTexts[i]));
    if (r.statement) out.push(`  note: ${r.statement.text}`);
  });
  return out;
}

function keyed(list, base, kind) {
  return list.map((g, i) => ({ path: `${base}.${i}`, label: format.keyLabel(g.key, kind), group: g }));
}

function renderText(view) {
  const out = [];
  const section = (title) => out.push('', `== ${title} ==`);

  out.push('Usage dashboard');
  out.push(`Generated ${view.generatedAt} UTC`);
  const banner = format.emptyBanner(view);
  if (banner) out.push(`EMPTY: ${format.textSafe(banner)}`);

  section('Selection');
  out.push(`filters: ${view.selection.args ? format.textSafe(view.selection.args) : '(none: the whole store)'}`);
  out.push(`bucket: ${view.selection.bucket}`);
  out.push(`currency: ${view.selection.currency}`);
  out.push(`as-of-today: ${view.selection.asOfToday ? 'yes' : 'no'}`);
  out.push(`regenerate: ${format.textSafe(view.selection.regenerate)}`);

  section('Pricing');
  const p = view.pricing;
  if (!p.available) {
    out.push(`no pinned price list — run ${p.hint}; every price is absent, token figures are complete`);
  } else {
    out.push(`${p.disclaimer}`);
    out.push(`price list: ${p.snapshot.sha} fetched ${p.snapshot.fetchedAt}`);
    out.push(`currency: ${p.currency}; as-of-today: ${p.asOfToday ? 'yes' : 'no'}; FX: offline (cached fixings only)`);
    if (p.fxStaleness) out.push(`FX staleness: ${p.fxStaleness.reason}; fresher FX fixing: ${p.fxStaleness.hint}`);
  }
  out.push('tallies: priced + unpriced + unconverted = captured; captured + uncaptured = records');
  out.push(`persist a recomputed price: ${format.textSafe(view.selection.persist)}`);

  section('Totals');
  out.push(...tableLines([{ path: 'totals', label: 'total', group: view.totals }]));

  const bucket = view.selection.bucket;
  section(`By ${bucket} (UTC${bucket === 'week' ? ', ISO 8601' : ''})`);
  out.push(...tableLines(keyed(view.byBucket[bucket], `byBucket.${bucket}`, 'bucket')));

  section('By CLI');
  out.push(...tableLines(keyed(view.byCli, 'byCli', 'cli')));

  section('By model');
  out.push(...tableLines(keyed(view.byModel, 'byModel', 'model')));

  section('Sessions -> agents');
  if (view.sessions.length === 0) out.push('(none in this view)');
  view.sessions.forEach((s, i) => {
    const path = `sessions.${i}`;
    out.push(`session ${format.textSafe(s.sessionId)} (${format.textSafe(s.cli)})`);
    out.push(...tableLines([{ path, label: s.sessionId, group: s }]));
    if (s.agents.length === 0) {
      out.push('  agents: No subordinate agent');
    } else {
      out.push('  agents:');
      out.push(...tableLines(s.agents.map((a, j) => ({ path: `${path}.agents.${j}`, label: format.keyLabel(a.agentId, 'agent'), group: a }))));
    }
  });

  section('Tasks');
  out.push(...tableLines(view.tasks.map((t, i) => ({ path: `tasks.${i}`, label: t.taskHandoffKey, group: t }))));

  section('Assets');
  out.push(...tableLines(view.assets.map((a, i) => ({ path: `assets.${i}`, label: `${a.kind}:${a.ref}`, group: a }))));

  return `${out.join('\n')}\n`;
}

function renderJson(view) {
  return `${JSON.stringify(view)}\n`;
}

module.exports = { renderText, renderJson };
