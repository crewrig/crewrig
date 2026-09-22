// index.js — the dispatcher (PLAN v3 step 10). capture({ cli, event, payload })
// selects the adapter, lets it advance its own cursor(s), and submits every
// derived record through submit() (spec 0208 PLAN v3 step 5), which resolves
// the record's attribution then hands off to sink.js. The whole body runs
// inside ONE try/catch whose handler emits a single uncaptured record
// carrying the failure's own provenance (R16) — a capture failure never
// propagates past this function.
//
// A `rejected` outcome from submit() is turned into exactly one uncaptured
// record naming the rejection reason and submitted once; if THAT record is
// itself rejected, the dispatcher writes nothing and returns — one retry
// level, never a loop.

'use strict';

const record = require('./record');
const sink = require('./sink');
const attribution = require('./attribution');
const claudeCode = require('./adapters/claude-code');
const geminiCli = require('./adapters/gemini-cli');
const copilotCli = require('./adapters/copilot-cli');
const antigravity = require('./adapters/antigravity');

// submit(rec, ctx) — the one resolution point (spec 0208 R1, R24): resolves
// rec's attribution against ctx, sets rec.attribution only when the outcome
// is 'attributed', and hands off to sink.submit() with the resolution as
// meta. Never throws — a resolver failure yields an unattributed outcome
// rather than propagating, so the shim's always-exit-0 contract stands.
function submit(rec, ctx) {
  let resolved;
  try {
    resolved = attribution.resolveAttribution(rec, ctx);
  } catch (err) {
    resolved = {
      attribution: null,
      channel: null,
      outcome: 'unattributed',
      reason: `resolver threw: ${err && err.message ? err.message : String(err)}`,
      assetReason: null,
    };
  }
  if (resolved.outcome === 'attributed') {
    rec.attribution = resolved.attribution;
  }
  return sink.submit(rec, {
    channel: resolved.channel,
    outcome: resolved.outcome,
    reason: resolved.reason,
    assetReason: resolved.assetReason,
    attribution: resolved.attribution,
  });
}

function buildCtx() {
  return { now: Date.now(), env: process.env, cwd: process.cwd(), declarations: true, memo: new Map() };
}

function extractTranscriptPath(payload) {
  return (payload && (payload.transcript_path || payload.transcriptPath)) || null;
}

function deriveRecords(cli, event, payload) {
  switch (cli) {
    case 'claude-code':
      return claudeCode.capture({ transcriptPath: extractTranscriptPath(payload), cwd: payload && payload.cwd });
    case 'gemini-cli':
      return geminiCli.capture({ transcriptPath: extractTranscriptPath(payload), cwd: payload && payload.cwd });
    case 'copilot-cli':
      return copilotCli.capture({});
    case 'antigravity':
      return antigravity.capture({ payload });
    default:
      return [
        record.uncaptured({
          provenance: { cli: 'claude-code', cliVersion: 'unknown', captureChannel: 'own-record-tail', formatFingerprint: 'unrecognized' },
          identity: { sessionId: 'unknown', projectRoot: 'unknown' },
          timing: { requestInstant: record.nowInstant(), captureInstant: record.nowInstant() },
          idempotencyKey: `unrecognized-cli:${cli}:${event}:${record.nowInstant()}`,
          uncapturedReason: `unrecognized cli argument: ${cli}`,
          fidelity: 'per-request',
        }),
      ];
  }
}

function submitWithRetry(rec, ctx) {
  const result = submit(rec, ctx);
  if (result.status !== 'rejected') return;

  const fallback = record.uncaptured({
    provenance: rec.provenance,
    identity: rec.identity,
    timing: rec.timing,
    idempotencyKey: rec.idempotencyKey,
    uncapturedReason: `rejected: ${result.reason}`,
    fidelity: rec.fidelity,
  });
  submit(fallback, ctx); // one retry level, never a loop — result ignored either way
}

function capture({ cli, event, payload }) {
  const ctx = buildCtx();
  try {
    const records = deriveRecords(cli, event, payload) || [];
    for (const rec of records) {
      submitWithRetry(rec, ctx);
    }
  } catch (err) {
    const failure = record.uncaptured({
      provenance: { cli: cli || 'claude-code', cliVersion: 'unknown', captureChannel: 'own-record-tail', formatFingerprint: 'unrecognized' },
      identity: { sessionId: (payload && (payload.session_id || payload.sessionId)) || 'unknown', projectRoot: (payload && payload.cwd) || 'unknown' },
      timing: { requestInstant: record.nowInstant(), captureInstant: record.nowInstant() },
      idempotencyKey: `capture-exception:${cli}:${event}:${record.nowInstant()}`,
      uncapturedReason: `capture threw: ${err && err.message ? err.message : String(err)}`,
      fidelity: 'per-request',
    });
    try {
      submit(failure, ctx);
    } catch (err2) {
      // sink itself threw — nothing left to do; the shim's own exit 0
      // contract (R15) covers the caller regardless.
    }
  }
}

module.exports = { capture, submit };
