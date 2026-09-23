// cli.js — the usage dashboard's command surface (spec 0210 R25; PLAN v2
// step 10). Three subcommands, one per delivery form:
//
//   page   [filters] [--as-of-today] [--out <path>]   form A: one self-contained HTML file
//   serve  [--port <n>]                               form B: 127.0.0.1-only live server
//   report [filters] [--as-of-today] [--json]         form C: plain-text report (or the view model as JSON)
//
// Filters: --session <id> | --agent <id> --parent <id> | --task-key <key> |
// --asset <kind>:<ref> | --cli <cli> | --fidelity <f> | --no-ledger |
// --from <YYYY-MM-DD> | --to <YYYY-MM-DD> | --period <YYYY-MM> |
// --model <id> | --bucket day|week|month | --currency <ISO4217>.
// Argument errors exit 2 with `FATAL: ...`.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const layout = require('../usage-store/layout');
const filtersMod = require('./filters');
const model = require('./model');
const html = require('./html');
const text = require('./text');

const OPTION_OWNER = { '--out': 'page', '--json': 'report', '--port': 'serve' };

function usageError(message) {
  const err = new Error(message);
  err.usage = true;
  return err;
}

function parseCommand(argv) {
  const sub = argv[0];
  if (!['page', 'serve', 'report'].includes(sub)) {
    throw usageError(`expected a subcommand (page | serve | report), got: ${sub === undefined ? '(none)' : sub}`);
  }
  let filters;
  try {
    filters = filtersMod.parse(argv.slice(1));
  } catch (err) {
    throw usageError(err.message);
  }
  for (const flag of filters.given) {
    if (OPTION_OWNER[flag] && OPTION_OWNER[flag] !== sub) {
      throw usageError(`${flag} applies to the ${OPTION_OWNER[flag]} subcommand only`);
    }
  }
  if (sub === 'serve') {
    const extra = filters.given.some((f) => f !== '--port') || Object.keys(filters.selection).length > 0;
    if (extra) throw usageError('serve takes no filter: pass filters as request parameters instead (e.g. /?period=2026-09)');
  }
  return { sub, filters };
}

// writePage(file, content) — atomic (tmp + rename), mode 0600; the default
// directory is created and kept at 0700. The temp name carries a random
// suffix and is created O_EXCL ('wx'), so a planted file or symlink makes
// the write fail instead of being followed; its mode is set through the
// descriptor so the umask cannot widen it. rename() replaces, never
// follows, a symlink at the final path.
function writePage(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (dir === layout.dashboardDir()) fs.chmodSync(dir, 0o700);
  const tmp = path.join(dir, `.${path.basename(file)}.${crypto.randomBytes(16).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

async function run(argv) {
  const { sub, filters } = parseCommand(argv);
  if (sub === 'serve') {
    require('./server').start({ port: filters.options.port });
    return;
  }
  const view = await model.build(filters, { now: new Date() });
  if (sub === 'page') {
    const file = path.resolve(filters.options.out || layout.dashboardFile());
    writePage(file, html.renderPage(view, { mode: 'static' }));
    process.stdout.write(`${file}\n`);
    return;
  }
  process.stdout.write(filters.options.json ? text.renderJson(view) : text.renderText(view));
}

module.exports = { parseCommand, run, writePage };

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(`FATAL: ${err.message}`);
    process.exit(err.usage ? 2 : 1);
  });
}
