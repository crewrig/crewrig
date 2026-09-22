// declaration.js — R2's one writing command and R3's lookup (spec 0208 PLAN
// v3 step 3). write()/read()/clear() over a per-scope declaration record,
// full-replace on every write (writeFileSync to a temp + renameSync — R2
// mandates replacement in full, so linkSync's EEXIST tolerance would be
// exactly wrong here, unlike the journal's own append-only primitive).
//
// Two scopes, same shape: session-scoped (keyed on identity.sessionId) and
// project-scoped (keyed on checkout.checkoutRootFor(), falling back to
// checkout.realpathOrSelf() when no ancestor holds .git within the cap).
// read() considers both candidates and returns the one with the later
// `timestamp` — not a fixed scope precedence — because a protocol write
// landing in the session scope must not permanently shadow a later explicit
// declaration that names no session id (R3's last sentence).

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('./layout');
const checkout = require('./checkout');

const DECLARING_CHANNELS = ['explicit', 'protocol'];

function envMs(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// write({taskHandoffKey, externalAsset, declaringChannel, sessionId,
// checkoutRoot}) — a session id selects the session scope; otherwise
// checkoutRoot selects the project scope. Exactly one target per write.
function write({ taskHandoffKey, externalAsset, declaringChannel, sessionId, checkoutRoot }) {
  if (!DECLARING_CHANNELS.includes(declaringChannel)) {
    throw new Error(`declaringChannel must be one of ${DECLARING_CHANNELS.join('|')}, got: ${declaringChannel}`);
  }
  if (!taskHandoffKey && !externalAsset) {
    throw new Error('write() requires taskHandoffKey and/or externalAsset');
  }

  const record = { declaringChannel, timestamp: new Date().toISOString() };
  if (taskHandoffKey) record.taskHandoffKey = taskHandoffKey;
  if (externalAsset) record.externalAsset = externalAsset;

  let target;
  if (sessionId) {
    record.sessionId = sessionId;
    target = layout.sessionDeclaration(sessionId);
  } else {
    if (!checkoutRoot) {
      throw new Error('write() requires sessionId or checkoutRoot');
    }
    record.checkoutRoot = checkoutRoot;
    target = layout.projectDeclaration(checkoutRoot);
  }

  writeAtomic(target, record);
  return record;
}

// read({sessionId, checkoutRoot, now}) — at most two candidates: the
// session-scoped record for `sessionId` and the project-scoped one for
// `checkoutRoot`. A session-scoped candidate whose stored sessionId differs
// is discarded (stale/copied file); a project-scoped one older than
// CREWRIG_TASK_DECLARATION_TTL_MS (default 12h) against `now` is discarded.
// The survivor with the later `timestamp` wins; an exact tie goes to the
// session-scoped one.
function read({ sessionId, checkoutRoot, now }) {
  const at = now === undefined ? Date.now() : now;
  const ttlMs = envMs('CREWRIG_TASK_DECLARATION_TTL_MS', 43200000);

  let sessionRecord = null;
  if (sessionId) {
    const raw = readJsonSafe(layout.sessionDeclaration(sessionId));
    if (raw && raw.sessionId === sessionId) sessionRecord = raw;
  }

  let projectRecord = null;
  if (checkoutRoot) {
    const raw = readJsonSafe(layout.projectDeclaration(checkoutRoot));
    if (raw) {
      const ts = Date.parse(raw.timestamp);
      if (Number.isFinite(ts) && at - ts <= ttlMs) {
        projectRecord = raw;
      }
    }
  }

  if (!sessionRecord && !projectRecord) return null;
  if (sessionRecord && !projectRecord) return { scope: 'session', record: sessionRecord };
  if (!sessionRecord && projectRecord) return { scope: 'project', record: projectRecord };

  const sessionTs = Date.parse(sessionRecord.timestamp);
  const projectTs = Date.parse(projectRecord.timestamp);
  if (projectTs > sessionTs) return { scope: 'project', record: projectRecord };
  return { scope: 'session', record: sessionRecord };
}

// clear({sessionId, checkoutRoot}) — unlinks both scoped files when their
// keys are resolvable, so a reset does not leave a stale candidate in the
// scope the caller did not think to name.
function clear({ sessionId, checkoutRoot }) {
  if (sessionId) {
    try {
      fs.unlinkSync(layout.sessionDeclaration(sessionId));
    } catch (err) {
      // already gone
    }
  }
  if (checkoutRoot) {
    try {
      fs.unlinkSync(layout.projectDeclaration(checkoutRoot));
    } catch (err) {
      // already gone
    }
  }
}

module.exports = { write, read, clear };

// --- CLI: scripts/usage-task.sh set|show|clear (spec 0208 PLAN v3 step 3) --

function resolveScopeArgs(args) {
  const sessionId = args.session || process.env.CREWRIG_SESSION_ID || null;
  const checkoutRoot = checkout.checkoutRootFor(process.cwd()) || checkout.realpathOrSelf(process.cwd());
  return { sessionId, checkoutRoot };
}

function parseAssetArg(spec) {
  const idx = spec.indexOf(':');
  if (idx === -1) {
    throw new Error(`--asset must be <kind>:<ref>, got: ${spec}`);
  }
  return { kind: spec.slice(0, idx), ref: spec.slice(idx + 1) };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--task-key':
        args.taskKey = argv[++i];
        break;
      case '--asset':
        args.asset = argv[++i];
        break;
      case '--channel':
        args.channel = argv[++i];
        break;
      case '--session':
        args.session = argv[++i];
        break;
      default:
        throw new Error(`unrecognized argument: ${argv[i]}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: bash scripts/usage-task.sh set --channel explicit|protocol [--task-key <key>] [--asset <kind>:<ref>] [--session <id>]
       bash scripts/usage-task.sh show [--session <id>]
       bash scripts/usage-task.sh clear [--session <id>]

Writes, reads, or clears the current session's usage-attribution declaration
record (spec 0208 R2/R3). A --session id, else $CREWRIG_SESSION_ID, selects
the session scope; otherwise the project scope is keyed on the checkout root
of the current working directory.`);
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === '--help') {
    printHelp();
    process.exit(sub ? 0 : 2);
  }

  const args = parseArgs(rest);

  if (sub === 'set') {
    if (!DECLARING_CHANNELS.includes(args.channel)) {
      throw new Error('set requires --channel explicit|protocol');
    }
    if (!args.taskKey && !args.asset) {
      throw new Error('set requires --task-key and/or --asset');
    }
    const { sessionId, checkoutRoot } = resolveScopeArgs(args);
    const record = write({
      taskHandoffKey: args.taskKey,
      externalAsset: args.asset ? parseAssetArg(args.asset) : undefined,
      declaringChannel: args.channel,
      sessionId,
      checkoutRoot,
    });
    console.log(JSON.stringify(record));
  } else if (sub === 'show') {
    const { sessionId, checkoutRoot } = resolveScopeArgs(args);
    const result = read({ sessionId, checkoutRoot, now: Date.now() });
    console.log(result ? JSON.stringify(result) : 'no declaration record resolved');
  } else if (sub === 'clear') {
    const { sessionId, checkoutRoot } = resolveScopeArgs(args);
    clear({ sessionId, checkoutRoot });
    console.log('cleared');
  } else {
    printHelp();
    process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
}
