// prune.js — R18-R20's explicit, period-scoped removal (spec 0207 PLAN v3
// step 8). Never automatic: no expiry code path exists anywhere in this
// module tree.
//
// Order, load-bearing: (1) write prunedMarker(cli, period) FIRST, so a
// crash mid-prune leaves the period protected against repopulation rather
// than exposed; (2) then per record, not per batch: delete the drawer
// (mempalace_delete_by_source, matching on source_file alone — no client-
// side id list, and it also reaches a drawer an older run filed under a
// different wing), unlink the mirrored/pending marker, unlink the sidecar,
// unlink the entry last (its presence is what a re-run keys on). A record
// whose marker is in pending/ has no drawer, so its marker, sidecar and
// entry go with no daemon contact (R8). With at least one mirrored/ marker
// for the period and the daemon unreachable, the prune refuses and exits
// non-zero (R19).

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
  const pendingPath = layout.pendingMarker(cli, per, recordId);
  const mirroredPath = layout.mirroredMarker(cli, per, recordId);

  const isMirrored = fs.existsSync(mirroredPath);
  if (isMirrored) {
    const result = await mcp.deleteBySource({ source_file: entryPath, dry_run: false });
    if (!result.ok) {
      return { ok: false };
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
    fs.unlinkSync(entryPath);
  } catch (err) {
    // already gone
  }
  return { ok: true };
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
      console.error(
        `FATAL: ${cli}/${per} has a mirrored drawer and the MemPalace daemon is unreachable — refusing to continue. ` +
          `${removed} record(s) removed before the refusal; re-run once the daemon is reachable.`
      );
      process.exitCode = 1;
      return;
    }
    removed += 1;
  }

  console.log(`Pruned ${cli}/${per}: ${removed} record(s) removed.`);
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
mirrored drawer exists for the period and the MemPalace daemon is
unreachable.

--unprune restores writability to a pruned period ONLY. It does not restore
deleted entries, sidecars, or drawers, and does not recover records
rejected while the period was pruned — recover those with:
  bash scripts/usage-backfill.sh --reset-cursors

To purge everything this storage contract writes under CREWRIG_USAGE_ROOT,
remove <root>/journal/, <root>/mirror/, <root>/cache/, and <root>/tmp/.`);
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
