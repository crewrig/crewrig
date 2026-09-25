// prune.js — R18-R20's explicit, period-scoped removal (spec 0207 PLAN v3
// step 8), plus delta-01 R28/R31/R33's registered-derived-store reach (spec
// 0208 PLAN v3 step 9). Never automatic: no expiry code path exists
// anywhere in this module tree.
//
// Order, load-bearing: (1) write prunedMarker(cli, period) FIRST, so a
// crash mid-prune leaves the period protected against repopulation rather
// than exposed; (2) then per record, not per batch: delete the drawer
// (mempalace_delete_by_source, matching on source_file alone — no client-
// side id list, and it also reaches a drawer an older run filed under a
// different wing), unlink the mirrored/pending marker, unlink the
// attribution sidecar, unlink the wing sidecar, unlink the entry last (its
// presence is what a re-run keys on). A record whose marker is in pending/
// has no drawer, so its marker, sidecars and entry go with no daemon
// contact (R8). Refuses when a mirrored drawer exists for the period and
// MemPalace is unreachable or does not confirm the drawer's deletion: the
// failing record's marker, sidecars and entry are kept, and the prune exits
// non-zero (R19). (3) after every record, walk layout.derivedStores() and
// remove each registered store's items for this period, reporting only a
// store it actually reached (delta-01 R33's second clause).

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('./layout');
const mcp = require('./mcp');

function currentPeriod() {
  return layout.period({ timing: { requestInstant: new Date().toISOString() } });
}

async function pruneRecord(cli, per, recordId) {
  const entryPath = layout.journalEntry(cli, per, recordId);
  const sidecarPath = layout.wingSidecar(cli, per, recordId);
  const attrPath = layout.attributionSidecar(cli, per, recordId);
  const pendingPath = layout.pendingMarker(cli, per, recordId);
  const mirroredPath = layout.mirroredMarker(cli, per, recordId);

  const isMirrored = fs.existsSync(mirroredPath);
  if (isMirrored) {
    const result = await mcp.deleteBySource({ source_file: entryPath, dry_run: false });
    if (!result.ok) {
      return { ok: false, kind: result.kind, message: result.message };
    }
    try {
      fs.unlinkSync(mirroredPath);
    } catch (err) {
      // already gone
    }
  } else {
    try {
      fs.unlinkSync(pendingPath);
    } catch (err) {
      // no pending marker for this record — fine
    }
  }

  try {
    fs.unlinkSync(sidecarPath);
  } catch (err) {
    // already gone
  }
  try {
    fs.unlinkSync(attrPath);
  } catch (err) {
    // already gone
  }
  try {
    fs.unlinkSync(entryPath);
  } catch (err) {
    // already gone
  }
  return { ok: true };
}

// periodHasAnyJournalEntries(per) — true iff any CLI's journal partition
// still holds an entry for `per`. Used to gate the ledger's own (scope:
// 'period') removal: pruning claude-code/2026-08 while gemini-cli/2026-08
// is retained must leave that period's ledger entries in place too (R17
// "leaving neither behind on its own", in both directions) — only the last
// CLI's prune of a period takes the ledger with it.
function periodHasAnyJournalEntries(per) {
  let clis;
  try {
    clis = fs.readdirSync(layout.journalRoot());
  } catch (err) {
    return false;
  }
  for (const c of clis) {
    let names;
    try {
      names = fs.readdirSync(layout.partitionDir(c, per));
    } catch (err) {
      continue;
    }
    if (names.some(layout.isEntry)) return true;
  }
  return false;
}

async function prune(cli, per, opts) {
  opts = opts || {};

  if (per >= currentPeriod() && !opts.force) {
    console.error(
      `FATAL: refusing to prune ${cli}/${per} — it is the current or a future period. Pass --force to override.`
    );
    process.exitCode = 1;
    return;
  }

  // (1) write the pruned marker first.
  const prunedPath = layout.prunedMarker(cli, per);
  fs.mkdirSync(path.dirname(prunedPath), { recursive: true });
  const tmp = `${prunedPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ prunedAt: new Date().toISOString() }));
  fs.renameSync(tmp, prunedPath);

  // (2) per record.
  const partitionDir = layout.partitionDir(cli, per);
  let names;
  try {
    names = fs.readdirSync(partitionDir);
  } catch (err) {
    names = [];
  }
  const recordIds = names.filter(layout.isEntry).map(layout.entryToRecordId);

  let removed = 0;
  for (const recordId of recordIds) {
    const result = await pruneRecord(cli, per, recordId);
    if (!result.ok) {
      const reason = result.message || 'unknown error';
      if (result.kind === 'transport') {
        console.error(
          `FATAL: ${cli}/${per} has a mirrored drawer and the MemPalace daemon is unreachable (${reason}) — ` +
            `refusing to continue. ${removed} record(s) removed before the refusal; re-run once the daemon is reachable.`
        );
      } else {
        // tool-error or tool-unavailable (mcp.js header): the daemon answered
        // but did not acknowledge the deletion, so nothing of this record goes.
        console.error(
          `FATAL: ${cli}/${per}: MemPalace did not confirm deleting the drawer of record ${recordId} (${reason}) — ` +
            `refusing to continue; its journal entry, sidecars and mirrored marker are kept. ` +
            `${removed} record(s) removed before the refusal; re-run once MemPalace reports the deletion as successful.`
        );
      }
      process.exitCode = 1;
      return;
    }
    removed += 1;
  }

  // (3) registered derived stores (spec 0207 delta-01 R28/R31/R33).
  const storeReports = [];
  for (const store of layout.derivedStores()) {
    if (store.scope === 'period' && periodHasAnyJournalEntries(per)) {
      continue; // another CLI still holds journal entries for this period
    }
    let dir;
    if (store.scope === 'period') {
      dir = store.dirFor(per);
    } else if (store.scope === 'cli-period') {
      dir = store.dirFor(cli, per);
    } else {
      continue; // an unrecognized scope is a registration bug, not a prune-time concern
    }
    let storeNames;
    try {
      storeNames = fs.readdirSync(dir);
    } catch (err) {
      continue; // nothing recorded for this store at this period
    }
    const items = storeNames.filter(store.isEntry);
    if (items.length === 0) continue; // R33: a store holding nothing is not named in the report
    for (const name of items) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch (err) {
        // already gone
      }
    }
    try {
      fs.rmdirSync(dir);
    } catch (err) {
      // ENOTEMPTY (an unrecognized name survived) / ENOENT — best-effort
    }
    storeReports.push({ id: store.id, removed: items.length });
  }

  const storeSummary =
    storeReports.length > 0 ? ` (${storeReports.map((s) => `${s.id}: ${s.removed}`).join(', ')})` : '';
  console.log(`Pruned ${cli}/${per}: ${removed} record(s) removed${storeSummary}.`);
}

function unprune(cli, per) {
  const prunedPath = layout.prunedMarker(cli, per);
  try {
    fs.unlinkSync(prunedPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`${cli}/${per} was not pruned.`);
      return;
    }
    throw err;
  }
  console.log(
    `Unpruned ${cli}/${per}: writability restored. This does NOT restore deleted entries, sidecars, or ` +
      `drawers, and does NOT recover records rejected while the period was pruned — 0206's cursors have ` +
      `already advanced past them. Recovery: bash scripts/usage-backfill.sh --reset-cursors.`
  );
}

function printHelp() {
  console.log(`Usage: node scripts/lib/usage-store/prune.js <cli> <YYYY-MM> [--force]
       node scripts/lib/usage-store/prune.js <cli> <YYYY-MM> --unprune

Removes a period's journal entries and mirrored drawers together (spec 0207
R18-R20). Never automatic — no expiry code path exists in this contract.
Refuses a period >= the current one unless --force. Refuses when a
mirrored drawer exists for the period and MemPalace is unreachable or does
not confirm the drawer's deletion.

--unprune restores writability to a pruned period ONLY. It does not restore
deleted entries, sidecars, or drawers, and does not recover records
rejected while the period was pruned — recover those with:
  bash scripts/usage-backfill.sh --reset-cursors

To remove all usage data, follow one of the two procedures in
docs/usage-organization.md → "Removing usage data": purge the data
while capture stays enabled, or remove the feature entirely. Deleting the
CREWRIG_USAGE_ROOT directory is not enough on its own: it leaves the
mirrored MemPalace drawers and each CLI's capture wiring behind.`);
}

module.exports = { prune, unprune, currentPeriod };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    printHelp();
    process.exit(args.length === 0 ? 2 : 0);
  }
  const [cli, per, ...rest] = args;
  if (!cli || !per) {
    printHelp();
    process.exit(2);
  }
  if (rest.includes('--unprune')) {
    unprune(cli, per);
  } else {
    prune(cli, per, { force: rest.includes('--force') }).catch((err) => {
      console.error(`FATAL: ${err.message}`);
      process.exit(1);
    });
  }
}
