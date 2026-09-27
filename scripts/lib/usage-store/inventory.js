// inventory.js — MemPalace-only drawer inventory and purge for the
// usage-record store's own `usage-records` room (spec 0239, issue #1206).
//
// This module treats MemPalace's own `usage-records` room as the SOLE source
// of truth: never the local journal, never mirror markers, never a
// `source_file` match. That is deliberate (R1) — its whole purpose is
// recovering a drawer whose local journal entry, sidecars, and mirror marker
// are already gone, or one left behind by an older, informal purge that only
// ever deleted the local usage root (see docs/usage-organization.md's
// "Removing usage data"). prune.js and mirror.js remain the local-state-aware
// paths; this module never reads layout.journalRoot(), layout.mirrorDir(),
// or any of their siblings, and touches `<usage root>/mirror/mirrored/` in NO
// way (R17 — an explicit non-goal, not an oversight: a deleted drawer's local
// marker is left exactly as-is, and scripts/lib/usage-store/prune.js remains
// the path that keeps a local marker and its drawer in sync while the local
// journal is still present).
//
// Confirmation (R2/R12) is schema-driven, never a hardcoded version: every
// `schemas/usage-record/*.schema.json` file's own `properties.schemaVersion.
// const` and `properties.provenance.properties.cli.enum` are read at
// startup, so a later schema version this repository ships is picked up
// without an edit here. A drawer's FULL content (never `list_drawers`'
// truncated content_preview) must parse as JSON, match a recognized
// schemaVersion, carry a `provenance.cli` that schema's own enum names, and
// yield a derivable period from `timing.requestInstant` via layout.period()
// (the identical function prune.js's derived-store walk already reuses) —
// anything short of all four excludes the drawer from every count, listing,
// grouping, and removal this module performs (R2), and it is identified
// solely by its own MemPalace drawer id and content, never a filename or path
// convention (R12).
//
// mcp.js's four inventory wrappers: listWings/listDrawers/getDrawer are thin
// pass-throughs with no invented success-field contract (see mcp.js's own
// header), while deleteDrawer DOES carry a verified success-field contract
// and is wired through requireSuccess() inside mcp.js itself. Either way,
// every non-ok result from any of them makes the WHOLE touched scope
// "unconfirmed": exit non-zero, never reported as empty or removed (R8/R9).
// getDrawer's own content-less error payload (a well-formed envelope with no
// `content` string — see mcp.js's header and confirmOneDrawer() below) is
// likewise treated as non-ok for this purpose, distinct from a drawer whose
// content parses fine but fails schema/CLI recognition. A reachable,
// fully-answered sweep that simply finds zero wings, zero room members, or
// only unrecognized members is a legitimate empty confirmed inventory
// instead (R15): exit zero. Running the inventory operation makes no write
// of any kind — listWings/listDrawers/getDrawer are the only calls a plain
// run makes (R13); deleteDrawer is reachable only from the removal path's
// own `--commit` branch, and only ever addresses a drawer this SAME run's
// own confirmed+filtered result set selected (R5/R6/R14) — an external
// drawer id is never accepted.
//
// The per-drawer getDrawer()+confirm step runs with bounded concurrency
// (CONCURRENCY, below) rather than one drawer at a time: sequential fetches
// measured ~48ms/drawer live against this project's own ~24,765-drawer
// installation, making the default all-wings sweep take roughly 20 minutes.
// See CONCURRENCY's own comment and sweep()'s for the exact fail-closed
// policy under concurrency (R9 still holds: the whole scope goes
// unconfirmed on the first failure found, never a partial result).
//
// The removal path defaults to a dry run (R7): `--commit` is required to
// delete anything. A wide deletion — more confirmed+selected drawers than
// CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD (module-private envInt,
// default 25 — this repository's own judgment call, not spec-derived; see
// PLAN v1's own Risks section), or an all-wings scope — additionally
// requires `--confirm-count <N>` to equal the exact confirmed+selected count
// the SAME invocation's own dry-run pass computed (R16), so an operator
// cannot pass a wide deletion reflexively without having seen the count.

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('./layout');
const mcp = require('./mcp');

const ROOM = 'usage-records';
const LIST_PAGE_SIZE = 100; // mempalace_list_drawers' own documented maximum

function envInt(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

const WIDE_DELETE_THRESHOLD = envInt('CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD', 25);

// CONCURRENCY (i1-F3 review finding, PR #1361) — sweep()'s per-drawer
// mempalace_get_drawer fetch-and-confirm loop used to run strictly
// sequentially at ~48ms/drawer measured live against this project's own
// installation (~24,765 drawers in the usage-records room), which put the
// default all-wings sweep docs/usage-organization.md's usage_mirror_gate
// third check calls unconditionally at roughly 20 minutes. These are
// independent, order-independent read calls (each drawer's confirmation
// depends on nothing but its own content), so they are safe to run
// concurrently in bounded chunks — see confirmOneDrawer()/sweep() below for
// the fail-closed policy under concurrency. 16 is this repository's own
// judgment call (not spec-derived), chosen because it turns the measured
// ~20-minute sequential sweep into roughly 1-2 minutes without overwhelming
// the MemPalace daemon with an unbounded burst of simultaneous requests.
const CONCURRENCY = envInt('CREWRIG_USAGE_INVENTORY_CONCURRENCY', 16);

// --- Schema-driven recognition (R2, R12) -------------------------------------

// loadRecognizedSchemas() — reads every schemas/usage-record/*.schema.json
// file's own declared version and CLI enum. Never a hardcoded single
// version: a later schema version this repository ships (a new sibling
// file, never an edit of v1 — see v1.schema.json's own schemaVersion
// description) is picked up on the next invocation with no code change here.
function loadRecognizedSchemas() {
  const schemasDir = path.join(__dirname, '..', '..', '..', 'schemas', 'usage-record');
  let names;
  try {
    names = fs.readdirSync(schemasDir).filter((n) => n.endsWith('.schema.json'));
  } catch (err) {
    return [];
  }
  const schemas = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(schemasDir, name), 'utf8'));
    } catch (err) {
      continue; // an unparseable schema file is not this module's concern
    }
    const version = parsed && parsed.properties && parsed.properties.schemaVersion && parsed.properties.schemaVersion.const;
    const cliEnum =
      parsed &&
      parsed.properties &&
      parsed.properties.provenance &&
      parsed.properties.provenance.properties &&
      parsed.properties.provenance.properties.cli &&
      parsed.properties.provenance.properties.cli.enum;
    if (typeof version === 'string' && Array.isArray(cliEnum)) {
      schemas.push({ version, cliEnum });
    }
  }
  return schemas;
}

const PERIOD_RE = /^\d{4}-\d{2}$/;

// confirmDrawer(contentText, recognizedSchemas) — R2's full confirmation:
// full-content JSON parse, recognized schemaVersion, recognized
// provenance.cli for THAT matched version, and a derivable period. Returns
// {confirmed:false, reason} for the first thing that fails, or
// {confirmed:true, cli, period, recordId}.
function confirmDrawer(contentText, recognizedSchemas) {
  if (typeof contentText !== 'string') {
    return { confirmed: false, reason: 'drawer carries no content text' };
  }
  let parsed;
  try {
    parsed = JSON.parse(contentText);
  } catch (err) {
    return { confirmed: false, reason: 'content is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { confirmed: false, reason: 'content is not a JSON object' };
  }
  const match = recognizedSchemas.find((s) => s.version === parsed.schemaVersion);
  if (!match) {
    return { confirmed: false, reason: `unrecognized schemaVersion: ${JSON.stringify(parsed.schemaVersion)}` };
  }
  const cli = parsed.provenance && parsed.provenance.cli;
  if (!match.cliEnum.includes(cli)) {
    return { confirmed: false, reason: `unrecognized provenance.cli: ${JSON.stringify(cli)}` };
  }
  let period;
  try {
    period = layout.period(parsed);
  } catch (err) {
    return { confirmed: false, reason: 'timing.requestInstant is missing or unparseable' };
  }
  if (typeof period !== 'string' || !PERIOD_RE.test(period)) {
    return { confirmed: false, reason: 'timing.requestInstant did not derive a valid YYYY-MM period' };
  }
  return { confirmed: true, cli, period, recordId: parsed.recordId };
}

// --- Transport-shape extraction (defensive; see mcp.js's own header) --------

function extractWingNames(payload) {
  if (!payload || typeof payload !== 'object' || !payload.wings || typeof payload.wings !== 'object') {
    return null;
  }
  return Object.keys(payload.wings);
}

function extractDrawerPage(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.drawers)) {
    return null;
  }
  const total = typeof payload.total === 'number' ? payload.total : payload.drawers.length;
  return { items: payload.drawers, total };
}

// --- Sweep (R1, R3, R4, R13) -------------------------------------------------

// resolveWings(explicitWings) — R4: an explicit --wing list (operator
// override) is used as-is and skips mempalace_list_wings entirely; the
// default calls mempalace_list_wings and sweeps every wing it reports. A wing
// that turns out to hold zero usage-records members simply contributes zero
// confirmed/excluded drawers below — there is no way to ask MemPalace which
// wings hold that room specifically without probing each one.
async function resolveWings(explicitWings) {
  if (Array.isArray(explicitWings) && explicitWings.length > 0) {
    return { ok: true, wings: explicitWings, scope: 'explicit' };
  }
  const res = await mcp.listWings();
  if (!res.ok) {
    return { ok: false, kind: res.kind, message: res.message };
  }
  const wings = extractWingNames(res.result);
  if (!wings) {
    return { ok: false, kind: 'tool-unavailable', message: 'mempalace_list_wings answered an unrecognized shape' };
  }
  return { ok: true, wings, scope: 'all' };
}

// listAllDrawers(wing) — pages mempalace_list_drawers to exhaustion for one
// wing's usage-records room. Stops on an empty page OR once offset reaches
// the reported total, whichever comes first, so a wrong/stale `total` cannot
// cause an infinite loop.
async function listAllDrawers(wing) {
  const items = [];
  let offset = 0;
  for (;;) {
    const res = await mcp.listDrawers({ wing, room: ROOM, limit: LIST_PAGE_SIZE, offset });
    if (!res.ok) {
      return { ok: false, kind: res.kind, message: res.message };
    }
    const page = extractDrawerPage(res.result);
    if (!page) {
      return { ok: false, kind: 'tool-unavailable', message: 'mempalace_list_drawers answered an unrecognized shape' };
    }
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return { ok: true, items };
}

// confirmOneDrawer(wing, preview, recognizedSchemas) — the per-drawer unit of
// work inside sweep()'s worker pool (i1-F3 review finding, PR #1361). Fetches
// ONE drawer's own full content (R2: never the listing's truncated
// content_preview) and classifies it. Returns a fatal `{ok:false, kind,
// message}` for any non-ok mcp.getDrawer() call, OR (i1-F2 review finding)
// for a well-formed envelope whose payload itself signals failure — a normal
// 200 response with no usable `content` string, `mempalace_get_drawer`'s only
// failure shape (see mcp.js's own header comment). That is deliberately NOT
// the same outcome as a drawer whose content parses fine but fails schema/CLI
// recognition (confirmDrawer() below correctly routes that to `excluded`,
// returned here as a non-fatal `{excluded: {...}}`): a content-less payload
// means MemPalace could not actually serve this drawer at all, so R9's
// fail-closed contract applies — the caller aborts the WHOLE sweep as
// unconfirmed, never silently drops the drawer from the count. Pure and
// side-effect-free (no shared mutable state touched), so it is safe to run
// concurrently across a chunk of drawers via Promise.all.
async function confirmOneDrawer(wing, preview, recognizedSchemas) {
  const drawerId = preview && preview.drawer_id;
  if (typeof drawerId !== 'string' || !drawerId) {
    return { excluded: { wing, drawerId: null, reason: 'a room member preview carries no drawer_id' } };
  }
  const fullResult = await mcp.getDrawer(drawerId);
  if (!fullResult.ok) {
    return {
      ok: false,
      kind: fullResult.kind,
      message: `fetching drawer "${drawerId}" in wing "${wing}": ${fullResult.message || 'unknown error'}`,
    };
  }
  const payload = fullResult.result;
  const hasContent = payload && typeof payload === 'object' && typeof payload.content === 'string';
  if (!hasContent) {
    const detail = payload && typeof payload === 'object' && typeof payload.error === 'string' ? payload.error : 'no usable content';
    return {
      ok: false,
      kind: 'tool-error',
      message: `fetching drawer "${drawerId}" in wing "${wing}": ${detail}`,
    };
  }
  const verdict = confirmDrawer(payload.content, recognizedSchemas);
  if (!verdict.confirmed) {
    return { excluded: { wing, drawerId, reason: verdict.reason } };
  }
  return { confirmed: { wing, drawerId, cli: verdict.cli, period: verdict.period, recordId: verdict.recordId } };
}

// sweep(opts) — the read-only core (R13 holds by construction: only
// listWings/listDrawers/getDrawer are called here). ANY non-ok call anywhere
// in the sweep makes the WHOLE touched scope unconfirmed (R9): the function
// returns {ok:false, ...} immediately rather than a partial result. A
// reachable, fully-answered sweep that simply finds nothing confirmable is a
// legitimate empty result (R15).
//
// Concurrency policy (i1-F3 review finding, PR #1361): each wing's drawer
// list is walked in fixed-size chunks of CONCURRENCY, confirmed concurrently
// within a chunk via Promise.all, one chunk at a time. Promise.all here never
// rejects — confirmOneDrawer() resolves to a classification object for every
// input, it never throws — so no request is ever orphaned or left running
// unobserved. Once a whole chunk has settled, the first fatal (`ok:false`)
// result found aborts the sweep immediately WITHOUT starting the next chunk
// or the next wing; requests already in flight within the CURRENT chunk are
// never cancelled (this transport has no cancellation primitive — see
// mcp.js's call()), but no request from a LATER chunk is ever issued once a
// chunk has produced a fatal result. This bounds the "wasted" work a failure
// can cause to at most one in-flight chunk (CONCURRENCY drawers), not the
// whole remaining sweep, while still satisfying R9 exactly: the function
// never returns a partial confirmed/excluded set alongside a fatal result.
// Confirmed/excluded classification, and the ORDER of both arrays, is
// identical to the previous strictly-sequential implementation: chunks are
// still processed in list order, one at a time, and Promise.all resolves in
// the same order its input array was given.
async function sweep(opts) {
  opts = opts || {};
  const recognizedSchemas = loadRecognizedSchemas();

  const wingsResult = await resolveWings(opts.wings);
  if (!wingsResult.ok) {
    return { ok: false, kind: wingsResult.kind, message: wingsResult.message };
  }

  const confirmed = [];
  const excluded = [];
  for (const wing of wingsResult.wings) {
    const drawersResult = await listAllDrawers(wing);
    if (!drawersResult.ok) {
      return {
        ok: false,
        kind: drawersResult.kind,
        message: `listing drawers for wing "${wing}": ${drawersResult.message || 'unknown error'}`,
      };
    }
    for (let i = 0; i < drawersResult.items.length; i += CONCURRENCY) {
      const chunk = drawersResult.items.slice(i, i + CONCURRENCY);
      // eslint-disable-next-line no-await-in-loop -- deliberate: chunks are
      // processed one at a time so a failure never starts a later chunk.
      const results = await Promise.all(chunk.map((preview) => confirmOneDrawer(wing, preview, recognizedSchemas)));
      const fatal = results.find((r) => r.ok === false);
      if (fatal) {
        return fatal;
      }
      for (const result of results) {
        if (result.confirmed) confirmed.push(result.confirmed);
        else if (result.excluded) excluded.push(result.excluded);
      }
    }
  }

  return { ok: true, scope: wingsResult.scope, wingsSwept: wingsResult.wings, confirmed, excluded };
}

// --- Grouping and filtering (R3, R14) ---------------------------------------

// applyFilters() — --cli and --period are independently usable (R3) and
// compose with AND when both are given; each narrows the SAME run's own
// confirmed set, never a different or externally supplied one.
function applyFilters(confirmedList, filters) {
  filters = filters || {};
  return confirmedList.filter((d) => {
    if (filters.cli && d.cli !== filters.cli) return false;
    if (filters.period && d.period !== filters.period) return false;
    return true;
  });
}

function countBy(list, keyFn) {
  const counts = {};
  for (const item of list) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// buildReport(sweepResult, filters) — the grouped, filtered view over one
// sweep's confirmed set (R3: wing/CLI/period, each independently usable).
function buildReport(sweepResult, filters) {
  const selected = applyFilters(sweepResult.confirmed, filters);
  return {
    scope: sweepResult.scope,
    wingsSwept: sweepResult.wingsSwept,
    filters: { cli: (filters && filters.cli) || null, period: (filters && filters.period) || null },
    confirmedTotal: sweepResult.confirmed.length,
    excludedTotal: sweepResult.excluded.length,
    excluded: sweepResult.excluded,
    selected,
    selectedTotal: selected.length,
    byWing: countBy(selected, (d) => d.wing),
    byCli: countBy(selected, (d) => d.cli),
    byPeriod: countBy(selected, (d) => d.period),
  };
}

// --- CLI argument parsing ----------------------------------------------------

function parseArgs(argv) {
  const args = {
    mode: 'list',
    wings: null,
    cli: null,
    period: null,
    json: false,
    commit: false,
    confirmCount: null,
    help: false,
  };
  let i = 0;
  if (argv[0] === 'delete') {
    args.mode = 'delete';
    i = 1;
  } else if (argv[0] === 'list') {
    i = 1;
  }
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--wing') {
      i += 1;
      const raw = argv[i];
      if (raw === undefined) throw new Error('--wing requires a value');
      const wings = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // i1-F4 review finding (PR #1361): an explicitly-empty --wing value
      // (a literal "", or a value made only of commas/whitespace) must NOT
      // silently widen the scope to the all-wings default — resolveWings()'s
      // `explicitWings.length > 0` guard cannot itself distinguish "no --wing
      // given" from "an empty --wing list", so this is rejected here,
      // eagerly, as a clear error instead.
      if (wings.length === 0) {
        throw new Error(
          '--wing was given an explicitly empty value (no wing name found) — omit --wing entirely for the default all-wings sweep, or pass at least one wing name'
        );
      }
      args.wings = wings;
    } else if (a === '--cli') {
      i += 1;
      if (argv[i] === undefined) throw new Error('--cli requires a value');
      args.cli = argv[i];
    } else if (a === '--period') {
      i += 1;
      if (argv[i] === undefined) throw new Error('--period requires a value');
      args.period = argv[i];
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--commit') {
      args.commit = true;
    } else if (a === '--confirm-count') {
      i += 1;
      if (argv[i] === undefined) throw new Error('--confirm-count requires a value');
      const n = Number(argv[i]);
      if (!Number.isInteger(n) || n < 0) throw new Error(`--confirm-count must be a non-negative integer, got: ${argv[i]}`);
      args.confirmCount = n;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`unrecognized argument: ${a}`);
    }
  }
  if ((args.commit || args.confirmCount !== null) && args.mode !== 'delete') {
    throw new Error('--commit and --confirm-count are only valid with the "delete" subcommand');
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/lib/usage-store/inventory.js [list] [--wing <name>[,<name>...]] [--cli <cli>] [--period <YYYY-MM>] [--json]
       node scripts/lib/usage-store/inventory.js delete [--wing <name>[,<name>...]] [--cli <cli>] [--period <YYYY-MM>] [--json] [--commit [--confirm-count <N>]]

Inventories every drawer MemPalace holds in the usage-records room, confirmed
solely from each drawer's own content (spec 0239). Independent of the local
usage root, journal, and mirror markers under it — works even when none of
them exist.

With no --wing, sweeps every wing MemPalace reports (the default scope) and
states so in its output. --wing restricts the sweep to an explicit,
comma-separated list; an explicitly empty --wing value (no wing name found)
is rejected rather than silently widened to the all-wings default.

Per-drawer content fetches run with bounded concurrency (default 16;
override: CREWRIG_USAGE_INVENTORY_CONCURRENCY). Sweep time still scales with
the swept room's total drawer count, so this can take real time on a large,
established installation — see docs/usage-storage.md's "Inventory and purge
(MemPalace-only)" section for the measured cost.

"delete" only ever removes a drawer THIS SAME run's own confirmed, filtered
inventory selected, addressed by its own MemPalace drawer id. It defaults to
a dry run: pass --commit to actually delete. A run whose selected count
exceeds ${WIDE_DELETE_THRESHOLD} (override: CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD), or
whose scope is every wing, additionally requires --confirm-count <N>, where
N must equal the exact selected count the same invocation's own dry-run pass
computed.

Exit status: 0 for a completed inventory (including a legitimately empty
one) or a fully-confirmed deletion; non-zero when MemPalace could not be
reached or did not confirm every requested deletion, or when a wide
deletion's added confirmation is missing or does not match.

Known limitation: a deleted drawer's local mirror marker under
<usage root>/mirror/mirrored/, if one exists, is never reconciled by this
command — see scripts/lib/usage-store/prune.js for the path that keeps a
local marker and its MemPalace drawer in sync while the local journal is
still present.`);
}

// --- Rendering ---------------------------------------------------------------

function printUnconfirmed(sweepFailure, json) {
  const message = `MemPalace inventory: UNCONFIRMED (${sweepFailure.kind}: ${sweepFailure.message || 'unknown error'})`;
  if (json) {
    console.log(JSON.stringify({ outcome: 'unconfirmed', kind: sweepFailure.kind, message: sweepFailure.message || null }));
  } else {
    console.error(message);
  }
}

function printInventory(report, json) {
  if (json) {
    console.log(JSON.stringify({ outcome: 'inventory', ...report }));
    return;
  }
  console.log(`MemPalace usage-record inventory — scope: ${report.scope} (${report.wingsSwept.join(', ') || 'none'})`);
  if (report.filters.cli || report.filters.period) {
    console.log(`Filters: ${report.filters.cli ? `cli=${report.filters.cli} ` : ''}${report.filters.period ? `period=${report.filters.period}` : ''}`.trim());
  }
  console.log(`Confirmed: ${report.confirmedTotal} (selected by filters: ${report.selectedTotal}); excluded (unrecognized): ${report.excludedTotal}`);
  console.log(`By wing: ${JSON.stringify(report.byWing)}`);
  console.log(`By CLI: ${JSON.stringify(report.byCli)}`);
  console.log(`By period: ${JSON.stringify(report.byPeriod)}`);
  for (const d of report.selected) {
    console.log(`  ${d.drawerId}  wing=${d.wing}  cli=${d.cli}  period=${d.period}  recordId=${d.recordId}`);
  }
}

function printDryRun(report, json) {
  if (json) {
    console.log(JSON.stringify({ outcome: 'dry-run', ...report }));
    return;
  }
  console.log(`MemPalace inventory delete — DRY RUN (pass --commit to actually delete). Scope: ${report.scope} (${report.wingsSwept.join(', ') || 'none'})`);
  console.log(`Would delete ${report.selectedTotal} confirmed drawer(s):`);
  for (const d of report.selected) {
    console.log(`  ${d.drawerId}  wing=${d.wing}  cli=${d.cli}  period=${d.period}  recordId=${d.recordId}`);
  }
}

function printConfirmationRequired(report, json) {
  const reason = report.scope === 'all' ? 'an all-wings sweep' : `more than ${WIDE_DELETE_THRESHOLD} confirmed drawer(s)`;
  if (json) {
    console.log(JSON.stringify({ outcome: 'confirmation-required', requiredConfirmCount: report.selectedTotal, reason, ...report }));
    return;
  }
  console.error(
    `MemPalace inventory delete — REFUSED: this run's scope is ${reason} (${report.selectedTotal} selected); ` +
      `pass --confirm-count ${report.selectedTotal} together with --commit to proceed. Nothing was deleted.`
  );
}

function printDeleted(report, deletedIds, json) {
  if (json) {
    console.log(JSON.stringify({ outcome: 'deleted', deletedCount: deletedIds.length, deletedDrawerIds: deletedIds, ...report }));
    return;
  }
  console.log(`MemPalace inventory delete — deleted ${deletedIds.length} confirmed drawer(s):`);
  for (const id of deletedIds) console.log(`  ${id}`);
}

function printDeletionUnconfirmed(report, deletedIds, failedDrawer, failure, json) {
  const message = `MemPalace inventory delete — UNCONFIRMED after ${deletedIds.length}/${report.selectedTotal} deletion(s): ${failedDrawer.drawerId} (${failure.kind}: ${failure.message || 'unknown error'})`;
  if (json) {
    console.log(
      JSON.stringify({
        outcome: 'unconfirmed',
        deletedCount: deletedIds.length,
        deletedDrawerIds: deletedIds,
        failedDrawerId: failedDrawer.drawerId,
        kind: failure.kind,
        message: failure.message || null,
        ...report,
      })
    );
  } else {
    console.error(message);
  }
}

// --- Delete path (R5, R6, R7, R12, R14, R16) ---------------------------------

// runDelete(report, args) — every deletion is addressed solely by a drawer id
// from THIS report's own `selected` array (R6/R12/R14) — never an externally
// supplied id. Dry run by default (R7). A wide scope (over the threshold, or
// an all-wings sweep) requires --confirm-count to equal the exact selected
// count (R16) before any deleteDrawer() call is made.
async function runDelete(report, args) {
  const wide = report.selectedTotal > WIDE_DELETE_THRESHOLD || report.scope === 'all';

  if (!args.commit) {
    printDryRun(report, args.json);
    return 0;
  }

  if (wide && args.confirmCount !== report.selectedTotal) {
    printConfirmationRequired(report, args.json);
    return 1;
  }

  const deletedIds = [];
  for (const drawer of report.selected) {
    const res = await mcp.deleteDrawer(drawer.drawerId);
    if (!res.ok) {
      printDeletionUnconfirmed(report, deletedIds, drawer, res, args.json);
      return 1;
    }
    deletedIds.push(drawer.drawerId);
  }

  printDeleted(report, deletedIds, args.json);
  return 0;
}

// --- Entry point -------------------------------------------------------------

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    printHelp();
    return 2;
  }
  if (args.help) {
    printHelp();
    return 0;
  }

  const sweepResult = await sweep({ wings: args.wings });
  if (!sweepResult.ok) {
    printUnconfirmed(sweepResult, args.json);
    return 1;
  }

  const report = buildReport(sweepResult, { cli: args.cli, period: args.period });

  if (args.mode === 'list') {
    printInventory(report, args.json);
    return 0;
  }

  return runDelete(report, args);
}

module.exports = {
  loadRecognizedSchemas,
  confirmDrawer,
  extractWingNames,
  extractDrawerPage,
  resolveWings,
  listAllDrawers,
  confirmOneDrawer,
  sweep,
  applyFilters,
  buildReport,
  parseArgs,
  runDelete,
  main,
  WIDE_DELETE_THRESHOLD,
  CONCURRENCY,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(`FATAL: ${err.message}`);
      process.exit(1);
    });
}
