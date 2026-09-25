// cli.js — the usage-price command surface (spec 0209; PLAN v2 step 11).
// Selectors mirror eight of query.js's ten `parseArgs` declares (--session,
// --agent+--parent, --period[--cli], --task-key, --asset, --fidelity);
// --undrained and --pending are deliberately not mirrored — both are
// journal plumbing, meaningless for a price. Added: --currency,
// --as-of-today, --rollup, --no-store, --refresh-pricelist[--sha],
// --refresh-fx[--fx-mirror], --cross-check.
//
// Output is JSONL, one price per line, each carrying the three R27
// timestamps, the resolution step, every flag, and the R31 disclaimer; an
// uncaptured record's line is instead store.js's R34 marker (`uncaptured:
// true`, `amount: null`, no timestamps, never stored); --rollup emits one
// JSON object with the per-fidelity sums, the mixed marker, the three bucket
// tallies (pricedCount, unpricedCount, unconvertedCount) and uncapturedCount.
//
// Seam (f) (#1173) consumes store.readPrices(selector) and rollup.rollup
// (selector) plus the <root>/prices/** layout directly — this file is the
// human-facing surface, not that contract.

'use strict';

const pricelist = require('./pricelist');
const fx = require('./fx');
const resolveModel = require('./resolve');
const store = require('./store');
const priceRollup = require('./rollup');
const crosscheck = require('./crosscheck');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--session':
        opts.session = argv[++i];
        break;
      case '--agent':
        opts.agent = argv[++i];
        break;
      case '--parent':
        opts.parent = argv[++i];
        break;
      case '--period':
        opts.period = argv[++i];
        break;
      case '--cli':
        opts.cli = argv[++i];
        break;
      case '--task-key':
        opts.taskKey = argv[++i];
        break;
      case '--asset':
        opts.asset = argv[++i];
        break;
      case '--fidelity':
        opts.fidelity = argv[++i];
        break;
      case '--currency':
        opts.currency = argv[++i];
        break;
      case '--as-of-today':
        opts.asOfToday = true;
        break;
      case '--rollup':
        opts.rollup = true;
        break;
      case '--no-store':
        opts.noStore = true;
        break;
      case '--refresh-pricelist':
        opts.refreshPricelist = true;
        break;
      case '--sha':
        opts.sha = argv[++i];
        break;
      case '--refresh-fx':
        opts.refreshFx = true;
        break;
      case '--fx-mirror':
        opts.fxMirror = argv[++i];
        break;
      case '--cross-check':
        opts.crossCheck = argv[++i];
        break;
      default:
        throw new Error(`unrecognized argument: ${a}`);
    }
  }
  if ((opts.agent && !opts.parent) || (opts.parent && !opts.agent)) {
    throw new Error('--agent and --parent are required together');
  }
  return opts;
}

function selectorFrom(opts) {
  const selector = {};
  if (opts.session) selector.session = opts.session;
  if (opts.agent) selector.agent = opts.agent;
  if (opts.parent) selector.parent = opts.parent;
  if (opts.period) selector.period = opts.period;
  if (opts.cli) selector.cli = opts.cli;
  if (opts.taskKey) selector.taskKey = opts.taskKey;
  if (opts.asset) selector.asset = opts.asset;
  if (opts.fidelity) selector.fidelity = opts.fidelity;
  return selector;
}

async function run(opts) {
  if (opts.refreshPricelist) {
    return pricelist.refresh({ sha: opts.sha });
  }
  if (opts.refreshFx) {
    return fx.refresh({ mirror: opts.fxMirror });
  }
  if (opts.crossCheck) {
    const pricelistSnapshot = pricelist.pinned();
    const org = store.loadOrgTable();
    const resolved = resolveModel.resolve(opts.crossCheck, { pricelist: pricelistSnapshot, org });
    await crosscheck.crossCheck(opts.crossCheck, { resolved });
    return null;
  }

  const selector = selectorFrom(opts);
  const priceOpts = {
    currency: opts.currency || 'USD',
    asOfToday: !!opts.asOfToday,
    store: !opts.noStore,
  };

  if (opts.rollup) {
    return priceRollup.rollup(selector, { ...priceOpts, combined: true });
  }

  return store.priceSelector(selector, priceOpts);
}

module.exports = { parseArgs, run };

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }

  run(opts)
    .then((result) => {
      if (result === null || result === undefined) return;
      if (Array.isArray(result)) {
        for (const item of result) {
          process.stdout.write(`${JSON.stringify(item)}\n`);
        }
      } else {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    })
    .catch((err) => {
      console.error(`FATAL: ${err.message}`);
      process.exit(1);
    });
}
