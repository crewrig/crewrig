// adapters/claude-code.js — reads ~/.claude/projects/<project>/<session>.jsonl
// and its sibling <session>/subagents/agent-*.jsonl (PLAN v3 step 5).
//
// Field sources, verified against live records on the authoring machine:
//   provenance.cli          = "claude-code"
//   provenance.cliVersion   = the record's own `version`
//   captureChannel          = "own-record-tail"
//   formatFingerprint       = presence of message.usage.{input_tokens,output_tokens}
//   identity.sessionId      = the record's own `sessionId` (fallback `session_id`)
//   identity.projectRoot    = the record's own `cwd`
//   identity.agentId        = the record's own `agentId` on a subagent record,
//                             else null (R2) — never the file name
//   identity.parentSessionId = always null: a Claude Code subagent record
//                             carries the PARENT's sessionId in its own
//                             `sessionId` field rather than a session id of
//                             its own (verified live: a subagent file's
//                             entries report `sessionId` equal to the
//                             enclosing session directory's name), so there
//                             is no distinct child id to carry here (R12 is
//                             satisfied by fields, never file adjacency) —
//                             isSidechain/parentUuid/attributionAgent ride
//                             along in `raw` instead.
//   timing.requestInstant   = the record's own `timestamp`
//   rawStatus               = "complete"
//
// Key = requestId, falling back to the entry's own `uuid` (probe 6: ~25.8%
// of interactive entrypoint:"cli" records lack requestId). All entries
// sharing one requestId collapse into one record (R6, "streaming
// duplicates"): the LAST entry for a key wins, since duplicates observed
// live carry identical usage.
//
// cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens is preserved as a
// structured tokens.cacheWrite object (R9), falling back to the flat
// cache_creation_input_tokens figure when no tier split is reported.
//
// R18: only the enumerated key paths are read — never message.content.

'use strict';

const fs = require('fs');
const path = require('path');
const record = require('../record');
const cursorLib = require('../cursor');

const CLI = 'claude-code';
const CAPTURE_CHANNEL = 'own-record-tail';

function interactionFor(entry) {
  // R10: derived from a signal the source already carries — the newest
  // input's own shape (approximated here by agentId presence, i.e. a
  // subordinate-agent call) and the response's own stop reason — never from
  // token counts or timing.
  if (entry.agentId) return 'agent-internal';
  const stopReason = entry.message && entry.message.stop_reason;
  if (stopReason === 'tool_use') return 'tool-continuation';
  if (stopReason) return 'user-turn';
  return 'unknown';
}

function tokensFor(usage) {
  const cacheCreation = usage.cache_creation;
  let cacheWrite;
  if (cacheCreation && typeof cacheCreation === 'object') {
    cacheWrite = {
      ephemeral_5m_input_tokens: cacheCreation.ephemeral_5m_input_tokens || 0,
      ephemeral_1h_input_tokens: cacheCreation.ephemeral_1h_input_tokens || 0,
    };
  } else {
    cacheWrite = usage.cache_creation_input_tokens;
  }
  return record.mapTokens({
    netInput: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite,
    output: usage.output_tokens,
    reasoning: usage.output_tokens_details && usage.output_tokens_details.thinking_tokens,
  });
}

function recordFromEntry(entry, { projectRootFallback, now }) {
  const usage = entry.message && entry.message.usage;
  const fp = record.fingerprint(entry, ['message.usage.input_tokens', 'message.usage.output_tokens']);
  const sessionId = entry.sessionId || entry.session_id;
  const identity = {
    sessionId,
    parentSessionId: null,
    agentId: entry.agentId || null,
    projectRoot: entry.cwd || projectRootFallback || 'unknown',
  };
  const timing = { requestInstant: entry.timestamp || now(), captureInstant: now() };
  const idempotencyKey = entry.requestId || entry.uuid;

  if (!fp.ok || !usage || !sessionId || !idempotencyKey) {
    return record.uncaptured({
      provenance: {
        cli: CLI,
        cliVersion: entry.version || 'unknown',
        captureChannel: CAPTURE_CHANNEL,
        formatFingerprint: fp.ok ? fp.formatFingerprint : 'unrecognized',
      },
      identity: { ...identity, sessionId: sessionId || 'unknown' },
      timing,
      idempotencyKey: idempotencyKey || `unrecognized:${entry.uuid || timing.captureInstant}`,
      uncapturedReason: fp.ok
        ? 'entry carries no usage, sessionId, or idempotency key'
        : `format mismatch: missing ${fp.missing.join(', ')}`,
      fidelity: 'per-request',
    });
  }

  return record.captured({
    provenance: {
      cli: CLI,
      cliVersion: entry.version || 'unknown',
      captureChannel: CAPTURE_CHANNEL,
      formatFingerprint: fp.formatFingerprint,
    },
    identity,
    timing,
    modelId: (entry.message && entry.message.model) || 'unknown',
    interaction: interactionFor(entry),
    tokens: tokensFor(usage),
    raw: { usage, stop_reason: entry.message && entry.message.stop_reason },
    rawStatus: 'complete',
    fidelity: 'per-request',
    idempotencyKey,
  });
}

// tailNewLines — reads only the bytes appended since the cursor's last pass,
// carrying an unterminated trailing line over to the NEXT pass rather than
// parsing a half-written line. A headDigest mismatch (rotation/truncation)
// resets the read to byte 0.
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
      // No trailing newline: the last line is a partial write, held back.
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

function deriveFromFile(filePath, { projectRootFallback, now }) {
  if (!fs.existsSync(filePath)) return [];

  const cur = cursorLib.readCursor(CLI, filePath);
  const { lines, newOffset, headDigest, mtimeMs } = tailNewLines(filePath, cur);

  const byKey = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (err) {
      continue; // malformed line — skip, never abort the whole file
    }
    if (!entry.message || !entry.message.usage) continue; // not a completed response
    const key = entry.requestId || entry.uuid;
    if (!key) continue;
    byKey.set(key, entry); // last entry for a shared key wins (R6)
  }

  const records = Array.from(byKey.values()).map((entry) => recordFromEntry(entry, { projectRootFallback, now }));

  cursorLib.writeCursor(CLI, filePath, { ...cur, byteOffset: newOffset, headDigest });
  cursorLib.touchStamp(CLI, filePath, mtimeMs);

  return records;
}

function subagentsDirFor(transcriptPath) {
  const dir = path.dirname(transcriptPath);
  const base = path.basename(transcriptPath, '.jsonl');
  return path.join(dir, base, 'subagents');
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

  const records = deriveFromFile(transcriptPath, { projectRootFallback: cwd, now });

  const subDir = subagentsDirFor(transcriptPath);
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir)) {
      if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;
      records.push(...deriveFromFile(path.join(subDir, name), { projectRootFallback: cwd, now }));
    }
  }

  return records;
}

module.exports = { cli: CLI, captureChannel: CAPTURE_CHANNEL, capture };
