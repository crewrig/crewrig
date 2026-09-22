// adapters/antigravity.js — consumes the statusline payload on stdin (PLAN
// v3 step 8). Antigravity's own session record exposes no field a token
// count can be tied to with confidence (R22 parity gap — see docs/usage-
// capture.md); this channel is the only one this CLI's capture step reads.
//
// Field sources, per probe 4's captured shape:
//   cli               = "antigravity"
//   cliVersion        = the payload's own `version` — no subprocess
//   captureChannel    = "statusline-shim"
//   identity.sessionId = the payload's own `session_id` (`conversation_id`
//                        twin rides in `raw`)
//   identity.projectRoot = the payload's own `workspace.project_dir`
//   parentSessionId / agentId = null (the channel exposes neither)
//   timing.requestInstant = the snapshot instant, which the channel does NOT
//                        report — equal to captureInstant, the shim's own
//                        read instant (stated here rather than disguised)
//   fidelity           = "session-cumulative"
//   interaction         = "unknown" (R11)
//   modelId             = `model.id` VERBATIM, display label and all (R30)
//   key                 = sha256(session_id + snapshot instant)
//
// The channel fires ten times for one `agy -p` (probe 4), progressively
// richer rather than holding still. A record is derived only when the
// cumulative counters differ from the cursor's own lastSnapshotDigest — that
// buys exactly one thing: a firing whose counters have not moved derives
// nothing. It does NOT buy one record per turn: if the counters move several
// times inside one turn, several records are legitimately derived (R5 keys
// on the session identifier and this channel's own snapshot instant
// precisely because it carries no per-request identifier of its own).

'use strict';

const crypto = require('crypto');
const record = require('../record');
const cursorLib = require('../cursor');

const CLI = 'antigravity';
const CAPTURE_CHANNEL = 'statusline-shim';

const FINGERPRINT_KEY_PATHS = ['context_window.current_usage.input_tokens', 'context_window.current_usage.output_tokens'];

function digestFor(usage) {
  return crypto.createHash('sha256').update(JSON.stringify(usage)).digest('hex');
}

function unrecognized(reason, identity, timing, now) {
  return record.uncaptured({
    provenance: { cli: CLI, cliVersion: 'unknown', captureChannel: CAPTURE_CHANNEL, formatFingerprint: 'unrecognized' },
    identity,
    timing,
    idempotencyKey: `unrecognized:${now()}`,
    uncapturedReason: reason,
    fidelity: 'session-cumulative',
  });
}

function capture({ payload, now = record.nowInstant } = {}) {
  const readInstant = now();

  if (!payload || typeof payload !== 'object') {
    const identity = { sessionId: 'unknown', projectRoot: 'unknown' };
    const timing = { requestInstant: readInstant, captureInstant: readInstant };
    return [unrecognized('no payload on stdin', identity, timing, now)];
  }

  const sessionId = payload.session_id || 'unknown';
  const projectRoot = (payload.workspace && payload.workspace.project_dir) || 'unknown';
  const identity = { sessionId, parentSessionId: null, agentId: null, projectRoot };
  const timing = { requestInstant: readInstant, captureInstant: readInstant };

  const fp = record.fingerprint(payload, FINGERPRINT_KEY_PATHS);
  if (!fp.ok) {
    return [unrecognized(`format mismatch: missing ${fp.missing.join(', ')}`, identity, timing, now)];
  }

  const usage = payload.context_window.current_usage;
  const digest = digestFor(usage);
  const cur = cursorLib.readCursor(CLI, sessionId);
  if (cur.lastSnapshotDigest === digest) {
    return [];
  }
  cursorLib.writeCursor(CLI, sessionId, { ...cur, lastSnapshotDigest: digest });

  const idempotencyKey = crypto.createHash('sha256').update(`${sessionId}${readInstant}`).digest('hex');

  return [
    record.captured({
      provenance: { cli: CLI, cliVersion: payload.version || 'unknown', captureChannel: CAPTURE_CHANNEL, formatFingerprint: fp.formatFingerprint },
      identity,
      timing,
      modelId: (payload.model && payload.model.id) || 'unknown',
      interaction: 'unknown',
      tokens: record.mapTokens({
        netInput: usage.input_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens || 0,
        output: usage.output_tokens,
        reasoning: 0,
      }),
      raw: { conversation_id: payload.conversation_id, model: payload.model, context_window: payload.context_window },
      rawStatus: 'complete',
      fidelity: 'session-cumulative',
      idempotencyKey,
    }),
  ];
}

module.exports = { cli: CLI, captureChannel: CAPTURE_CHANNEL, capture };
