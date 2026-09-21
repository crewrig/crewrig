// adapters/gemini-cli.js — reads the `transcript_path` the AfterModel hook
// payload carries under ~/.gemini/tmp/<project>/chats/, plus
// chats/<parentSessionId>/<sub>.jsonl for subagents (PLAN v3 step 6). The
// AfterModel payload itself is the TRIGGER only (partial usage metadata, the
// requested rather than serving model) — every record is derived from the
// session record, never the payload.
//
// Three format generations, verified live on the authoring machine, each
// carrying its own fingerprint:
//   legacy-json        a whole `.json` file: {sessionId, projectHash,
//                      startTime, lastUpdated, messages: [...]}, no `kind`.
//   json-kind-summary  a whole `.json` file with a top-level `kind` (and
//                      `summary`) alongside `messages`.
//   jsonl              newline-delimited: line 1 is the header
//                      {sessionId, projectHash, startTime, lastUpdated,
//                      kind}; later lines are EITHER a `$set`-patch
//                      ({"$set":{"messages":[entry, ...]}}) or a flat entry
//                      object — both are reduced to entry state before
//                      emitting, and only an entry carrying `tokens` (a
//                      completed response) is a candidate record.
//
// Field sources:
//   provenance.cli        = "gemini-cli"
//   provenance.cliVersion = NOT present in any Gemini source — resolved via
//                            record.cliVersionFor('gemini-cli', ...)
//                            (memoized `gemini --version`).
//   captureChannel         = "own-record-tail"
//   identity.sessionId     = the header's own `sessionId`
//   identity.projectRoot   = the hook payload's own `cwd` on the live path;
//                             on backfill (no cwd given), the reverse index
//                             of the header's own `projectHash` against the
//                             KEYS of the nested `projects` object in
//                             ~/.gemini/projects.json — verified live:
//                             sha256(<absolute project path>) equals that
//                             file's projectHash exactly.
//   identity.parentSessionId / agentId = null for a subagent transcript: its
//                             header assigns neither: the parent id exists
//                             only as the enclosing DIRECTORY name, and R12
//                             binds the value to a field the source assigns,
//                             never to file adjacency. Preserved in
//                             `raw.sourceDirectory` instead.
//   timing.requestInstant  = the response entry's own `timestamp`
//   netInput                = tokens.input - tokens.cached (R7); the
//                             unreduced figure stays in `raw` unaltered.
//   key                     = the response entry's own message `id`
//   interaction              from `toolCalls` presence in the session record
//
// R18: only the enumerated key paths are read — never `content` or
// `thoughts` text (the reasoning TRACE, distinct from `tokens.thoughts`, the
// reasoning token COUNT).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const record = require('../record');
const cursorLib = require('../cursor');

const CLI = 'gemini-cli';
const CAPTURE_CHANNEL = 'own-record-tail';

function interactionFor(entry) {
  if (Array.isArray(entry.toolCalls) && entry.toolCalls.length > 0) return 'tool-continuation';
  if (entry.type === 'gemini') return 'user-turn';
  return 'unknown';
}

function tokensFor(t) {
  const input = typeof t.input === 'number' ? t.input : 0;
  const cached = typeof t.cached === 'number' ? t.cached : 0;
  return record.mapTokens({
    netInput: input - cached,
    cacheRead: cached,
    cacheWrite: 0,
    output: t.output,
    reasoning: t.thoughts,
  });
}

function resolveProjectRootByHash(projectHash) {
  try {
    const projectsFile = path.join(os.homedir(), '.gemini', 'projects.json');
    const data = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
    const projects = (data && data.projects) || {};
    for (const absPath of Object.keys(projects)) {
      if (crypto.createHash('sha256').update(absPath).digest('hex') === projectHash) {
        return absPath;
      }
    }
  } catch (err) {
    // ~/.gemini/projects.json absent or unreadable — fall through to null.
  }
  return null;
}

function fingerprintFor(header, entry, keyPaths) {
  return record.fingerprint({ header, entry }, keyPaths);
}

function recordFromEntry(header, entry, { cwd, generationKeyPaths, sourceDirectory, now }) {
  const fp = fingerprintFor(header, entry, generationKeyPaths);
  const sessionId = header.sessionId;
  const projectRoot = cwd || resolveProjectRootByHash(header.projectHash) || 'unknown';
  const identity = { sessionId: sessionId || 'unknown', parentSessionId: null, agentId: null, projectRoot };
  const timing = { requestInstant: entry.timestamp || now(), captureInstant: now() };
  const idempotencyKey = entry.id;
  const cliVersion = record.cliVersionFor(CLI, { binary: 'gemini' }) || 'unknown';

  if (!fp.ok || !entry.tokens || !sessionId || !idempotencyKey) {
    return record.uncaptured({
      provenance: {
        cli: CLI,
        cliVersion,
        captureChannel: CAPTURE_CHANNEL,
        formatFingerprint: fp.ok ? fp.formatFingerprint : 'unrecognized',
      },
      identity,
      timing,
      idempotencyKey: idempotencyKey || `unrecognized:${entry.id || timing.captureInstant}`,
      uncapturedReason: fp.ok
        ? 'entry carries no tokens, sessionId, or idempotency key'
        : `format mismatch: missing ${fp.missing.join(', ')}`,
      fidelity: 'per-request',
    });
  }

  return record.captured({
    provenance: { cli: CLI, cliVersion, captureChannel: CAPTURE_CHANNEL, formatFingerprint: fp.formatFingerprint },
    identity,
    timing,
    modelId: entry.model || 'unknown',
    interaction: interactionFor(entry),
    tokens: tokensFor(entry.tokens),
    raw: { tokens: entry.tokens, model: entry.model, sourceDirectory },
    rawStatus: 'complete',
    fidelity: 'per-request',
    idempotencyKey,
  });
}

// extractEntries(line) — reduces one line of a `.jsonl` journal to its
// entry-state array: a `$set`-patch's own `messages` array, or the line
// itself when it is already a flat entry. Anything else (the header line)
// yields nothing.
function extractEntries(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (err) {
    return [];
  }
  if (obj && obj['$set'] && Array.isArray(obj['$set'].messages)) {
    return obj['$set'].messages;
  }
  if (obj && obj.id && obj.type) {
    return [obj];
  }
  return [];
}

function tailNewLines(filePath, cur) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const headLen = Math.min(4096, stat.size);
    const headBuf = Buffer.alloc(headLen);
    if (headLen > 0) fs.readSync(fd, headBuf, 0, headLen, 0);
    const headDigest = cursorLib.headDigestFor(headBuf, headLen);

    let offset = cur.byteOffset || 0;
    if ((cur.headDigest && cur.headDigest !== headDigest) || offset > stat.size) {
      offset = 0;
    }

    const toRead = stat.size - offset;
    let text = '';
    if (toRead > 0) {
      const buf = Buffer.alloc(toRead);
      fs.readSync(fd, buf, 0, toRead, offset);
      text = buf.toString('utf8');
    }

    let consumed = offset + toRead;
    const lines = text.split('\n');
    const last = lines[lines.length - 1];
    if (last !== '') {
      lines.pop();
      consumed -= Buffer.byteLength(last, 'utf8');
    } else {
      lines.pop();
    }

    return { lines, newOffset: consumed, headDigest, mtimeMs: stat.mtimeMs };
  } finally {
    fs.closeSync(fd);
  }
}

function readHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    const firstLine = buf.toString('utf8').split('\n', 1)[0];
    return JSON.parse(firstLine);
  } finally {
    fs.closeSync(fd);
  }
}

function deriveFromJsonl(filePath, { cwd, sourceDirectory, now }) {
  const header = readHeader(filePath);
  const keyPaths = ['header.kind', 'entry.tokens.input', 'entry.tokens.output'];

  const cur = cursorLib.readCursor(CLI, filePath);
  const { lines, newOffset, headDigest, mtimeMs } = tailNewLines(filePath, cur);

  const byKey = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const entry of extractEntries(trimmed)) {
      if (!entry.tokens) continue; // not a completed response yet
      if (!entry.id) continue;
      byKey.set(entry.id, entry);
    }
  }

  const records = Array.from(byKey.values()).map((entry) =>
    recordFromEntry(header, entry, { cwd, generationKeyPaths: keyPaths, sourceDirectory, now })
  );

  cursorLib.writeCursor(CLI, filePath, { ...cur, byteOffset: newOffset, headDigest });
  cursorLib.touchStamp(CLI, filePath, mtimeMs);

  return records;
}

function deriveFromWholeJson(filePath, { cwd, sourceDirectory, now }) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const header = { sessionId: data.sessionId, projectHash: data.projectHash, kind: data.kind };
  const keyPaths = data.kind
    ? ['header.kind', 'entry.tokens.input', 'entry.tokens.output']
    : ['entry.tokens.input', 'entry.tokens.output'];

  const messages = Array.isArray(data.messages) ? data.messages : [];
  return messages
    .filter((entry) => entry.tokens)
    .map((entry) => recordFromEntry(header, entry, { cwd, generationKeyPaths: keyPaths, sourceDirectory, now }));
}

function deriveFromFile(filePath, opts) {
  if (!fs.existsSync(filePath)) return [];
  if (filePath.endsWith('.jsonl')) return deriveFromJsonl(filePath, opts);
  return deriveFromWholeJson(filePath, opts);
}

function subagentsDirFor(transcriptPath, sessionId) {
  if (!sessionId) return null;
  return path.join(path.dirname(transcriptPath), sessionId);
}

function capture({ transcriptPath, cwd, now = record.nowInstant } = {}) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return [
      record.uncaptured({
        provenance: { cli: CLI, cliVersion: 'unknown', captureChannel: CAPTURE_CHANNEL, formatFingerprint: 'unrecognized' },
        identity: { sessionId: 'unknown', projectRoot: cwd || 'unknown' },
        timing: { requestInstant: now(), captureInstant: now() },
        idempotencyKey: `unresolved-transcript-path:${now()}`,
        uncapturedReason: 'no readable transcript_path in the hook payload',
        fidelity: 'per-request',
      }),
    ];
  }

  const records = deriveFromFile(transcriptPath, { cwd, sourceDirectory: null, now });

  let header;
  try {
    header = readHeader(transcriptPath);
  } catch (err) {
    header = {};
  }
  const subDir = subagentsDirFor(transcriptPath, header.sessionId);
  if (subDir && fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir)) {
      if (!name.endsWith('.jsonl') && !name.endsWith('.json')) continue;
      records.push(...deriveFromFile(path.join(subDir, name), { cwd, sourceDirectory: subDir, now }));
    }
  }

  return records;
}

module.exports = { cli: CLI, captureChannel: CAPTURE_CHANNEL, capture };
