// adapters/copilot-cli.js — opens ~/.copilot/session-store.db with
// node:sqlite's DatabaseSync(path, { readOnly: true }) (PLAN v3 step 7).
//
// Field sources, verified against the live store on the authoring machine
// (schema_version 8):
//   provenance.cli        = "copilot-cli"
//   provenance.cliVersion = no column in the store carries it. Read from the
//                            first line of that session's own
//                            ~/.copilot/session-state/<sessionId>/events.jsonl
//                            (`session.start.data.copilotVersion`, one line,
//                            never a full re-parse of the file), falling
//                            back to record.cliVersionFor('copilot-cli', ...)
//                            (memoized `copilot --version`) when that file is
//                            absent — exact on the live path, and on backfill
//                            a documented caveat: it stamps the binary
//                            present today onto a row an older binary (before
//                            an auto-update) may have served.
//   captureChannel          = "sqlite-assistant-usage-events"
//   formatFingerprint        = schema_version + the sorted
//                              assistant_usage_events column set
//   identity.sessionId      = the row's own `session_id`
//   identity.projectRoot    = `sessions.cwd`, joined on session_id — the join
//                              selects `cwd` ONLY, never the adjacent
//                              `sessions.summary` (R18)
//   identity.agentId        = the row's own `agent_id` (null on a top-level row)
//   identity.parentSessionId = null — the store exposes no parent-session
//                              column; `parent_tool_call_id` rides in `raw`
//   timing.requestInstant    = the row's own `created_at`
//   key                      = the row's own `id`
//   interaction               from the row's own `initiator`
//   modelId                  = the row's own `model` column, authoritative
//                              even across a mid-session model change (R4) —
//                              `events.jsonl` is never read for a token value.
//
// If the read-only open fails (a WAL whose -shm cannot be attached), retries
// once against a temp copy of session-store.db, -wal AND -shm TOGETHER —
// copying the .db alone yields a pre-WAL snapshot (observed live on this
// machine as schema_version 7 with copilot_usage_model missing against a
// live 8). An unavailable node:sqlite or a second failure yields one
// uncaptured record naming the whole source, never zeros.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const record = require('../record');
const cursorLib = require('../cursor');

const CLI = 'copilot-cli';
const CAPTURE_CHANNEL = 'sqlite-assistant-usage-events';
const DEFAULT_STORE = path.join(os.homedir(), '.copilot', 'session-store.db');

const EXPECTED_COLUMNS = [
  'id', 'session_id', 'turn_index', 'agent_id', 'parent_tool_call_id', 'model',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'reasoning_tokens', 'total_nano_aiu', 'request_multiplier', 'duration_ms',
  'time_to_first_token_ms', 'inter_token_latency_ms', 'initiator', 'api_endpoint',
  'reasoning_effort', 'finish_reason', 'content_filter_triggered',
  'token_details_json', 'created_at', 'output_ttft_ms', 'copilot_usage_model',
];

function loadSqlite() {
  try {
    // eslint-disable-next-line global-require
    return require('node:sqlite');
  } catch (err) {
    return null;
  }
}

function openStore(storePath) {
  const sqlite = loadSqlite();
  if (!sqlite) return null;
  try {
    return new sqlite.DatabaseSync(storePath, { readOnly: true });
  } catch (err) {
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewrig-usage-copilot-'));
      const tmpDb = path.join(tmpDir, 'session-store.db');
      fs.copyFileSync(storePath, tmpDb);
      for (const suffix of ['-wal', '-shm']) {
        const src = `${storePath}${suffix}`;
        if (fs.existsSync(src)) fs.copyFileSync(src, `${tmpDb}${suffix}`);
      }
      return new sqlite.DatabaseSync(tmpDb, { readOnly: true });
    } catch (err2) {
      return null;
    }
  }
}

function fingerprintForSchema(schemaVersion, actualColumns) {
  const sorted = [...actualColumns].sort();
  const expected = [...EXPECTED_COLUMNS].sort();
  const same = sorted.length === expected.length && sorted.every((c, i) => c === expected[i]);
  if (!same) {
    return {
      ok: false,
      reason: `schema_version=${schemaVersion} column set diverges from the expected set (expected [${expected.join(',')}], got [${sorted.join(',')}])`,
    };
  }
  const crypto = require('crypto');
  const digest = crypto.createHash('sha256').update(`${schemaVersion}\n${sorted.join('\n')}`).digest('hex');
  return { ok: true, formatFingerprint: `sha256:${digest}` };
}

function interactionFor(initiator) {
  switch (initiator) {
    case 'user':
      return 'user-turn';
    case 'agent':
    case 'sub-agent':
      return 'agent-internal';
    case 'compaction':
      return 'tool-continuation';
    default:
      return 'unknown';
  }
}

// versionFromEventsJsonl — reads ONLY the first line of that session's
// events.jsonl, never a full re-parse (probe 7 measured a full re-parse at
// 82-90ms, not paid here).
function versionFromEventsJsonl(sessionId) {
  if (!sessionId) return null;
  const file = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    const firstLine = buf.toString('utf8', 0, bytesRead).split('\n', 1)[0];
    const obj = JSON.parse(firstLine);
    if (obj.type === 'session.start' && obj.data && obj.data.copilotVersion) {
      return obj.data.copilotVersion;
    }
  } catch (err) {
    // absent, unreadable, or the first line does not parse — fall back.
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (err) {
        // already closed
      }
    }
  }
  return null;
}

function recordFromRow(row, { formatFingerprint, fallbackCliVersion, now }) {
  const identity = {
    sessionId: row.session_id,
    parentSessionId: null,
    agentId: row.agent_id || null,
    projectRoot: row.session_cwd || 'unknown',
  };
  const timing = { requestInstant: row.created_at, captureInstant: now() };
  const idempotencyKey = String(row.id);
  const cliVersion = versionFromEventsJsonl(row.session_id) || fallbackCliVersion;

  return record.captured({
    provenance: { cli: CLI, cliVersion, captureChannel: CAPTURE_CHANNEL, formatFingerprint },
    identity,
    timing,
    modelId: row.model || 'unknown',
    interaction: interactionFor(row.initiator),
    tokens: record.mapTokens({
      netInput: row.input_tokens,
      cacheRead: row.cache_read_tokens,
      cacheWrite: row.cache_write_tokens,
      output: row.output_tokens,
      reasoning: row.reasoning_tokens,
    }),
    raw: {
      initiator: row.initiator,
      parent_tool_call_id: row.parent_tool_call_id,
      finish_reason: row.finish_reason,
      copilot_usage_model: row.copilot_usage_model,
    },
    rawStatus: 'complete',
    fidelity: 'per-request',
    idempotencyKey,
  });
}

function unrecognized(reason, now) {
  return record.uncaptured({
    provenance: { cli: CLI, cliVersion: 'unknown', captureChannel: CAPTURE_CHANNEL, formatFingerprint: 'unrecognized' },
    identity: { sessionId: 'unknown', projectRoot: 'unknown' },
    timing: { requestInstant: now(), captureInstant: now() },
    idempotencyKey: `unrecognized:${now()}`,
    uncapturedReason: reason,
    fidelity: 'per-request',
  });
}

function capture({ storePath = DEFAULT_STORE, now = record.nowInstant } = {}) {
  const db = openStore(storePath);
  if (!db) {
    return [unrecognized(`could not open ${storePath} read-only (node:sqlite unavailable, or unreadable after the WAL-copy retry)`, now)];
  }

  try {
    const versionRow = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
    const schemaVersion = versionRow ? versionRow.version : null;
    const columns = db.prepare('PRAGMA table_info(assistant_usage_events)').all().map((c) => c.name);
    const fp = fingerprintForSchema(schemaVersion, columns);
    if (!fp.ok) {
      return [unrecognized(fp.reason, now)];
    }

    const fallbackCliVersion = record.cliVersionFor(CLI, { binary: 'copilot' }) || 'unknown';
    const cur = cursorLib.readCursor(CLI, storePath);
    const rows = db
      .prepare(
        `SELECT e.*, s.cwd as session_cwd FROM assistant_usage_events e
         LEFT JOIN sessions s ON s.id = e.session_id
         WHERE e.id > ? ORDER BY e.id ASC`
      )
      .all(cur.maxRowId || 0);

    const records = rows.map((row) => recordFromRow(row, { formatFingerprint: fp.formatFingerprint, fallbackCliVersion, now }));

    let maxRowId = cur.maxRowId || 0;
    for (const row of rows) {
      if (row.id > maxRowId) maxRowId = row.id;
    }
    cursorLib.writeCursor(CLI, storePath, { ...cur, maxRowId });

    return records;
  } finally {
    db.close();
  }
}

module.exports = { cli: CLI, captureChannel: CAPTURE_CHANNEL, capture };
