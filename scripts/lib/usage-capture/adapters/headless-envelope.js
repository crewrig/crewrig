// adapters/headless-envelope.js — the R19 derivation, shared by all four
// CLIs (PLAN v3 step 9): one `run-total` record from the structured summary
// a framework-launched non-interactive run's own `--output-format json` (or
// equivalent) output already carries. Driven by scripts/lib/usage-headless.sh
// (step 15), which resolves `envelope` by parsing that run's own stdout.
//
//   captureChannel   = "headless-envelope"
//   fidelity         = "run-total"
//   identity.sessionId = the envelope's own session identifier when it
//                      reports one, else a launch-instant-keyed placeholder
//   cliVersion       = record.cliVersionFor() (memoized)
//   requestInstant   = the envelope's own terminal timestamp when it carries
//                      one, else the launch instant the caller recorded
//                      BEFORE the run
//   captureInstant   = after the run
//   idempotencyKey   = "run-total:<session id>", falling back to
//                      "run-total:sha256(launch instant + argv digest)" so a
//                      run-total key can never collide with a per-request key
//   modelId          = the envelope's own model field where it reports one.
//                      Antigravity's turn envelope and Copilot's terminal
//                      `result` event name NONE (probes 3/10) — those land
//                      on the sentinel "(unreported)", never a value
//                      borrowed from another source (R30).
//   interaction      = "unknown"

'use strict';

const crypto = require('crypto');
const record = require('../record');

const CAPTURE_CHANNEL = 'headless-envelope';
const UNREPORTED_MODEL = '(unreported)';

// extractSessionId / extractModel / extractTokens — per-CLI best-effort
// readers over that CLI's own `--output-format json` (or equivalent) shape.
// Every reader is defensive: an envelope shape not on this list, or a field
// the envelope genuinely omits, falls through to the caller's own default
// (an unreported-session placeholder, the UNREPORTED_MODEL sentinel, or an
// all-zero tokens object — never invented).
function extractSessionId(cli, envelope) {
  if (!envelope) return null;
  return envelope.session_id || envelope.sessionId || null;
}

function extractTerminalTimestamp(envelope) {
  if (!envelope) return null;
  return envelope.timestamp || envelope.terminal_timestamp || null;
}

function extractModel(cli, envelope) {
  if (!envelope) return UNREPORTED_MODEL;
  if (cli === 'claude-code' && envelope.modelUsage && typeof envelope.modelUsage === 'object') {
    const models = Object.keys(envelope.modelUsage);
    return models.length > 0 ? models[0] : UNREPORTED_MODEL;
  }
  if (cli === 'gemini-cli' && envelope.stats && envelope.stats.models && typeof envelope.stats.models === 'object') {
    const models = Object.keys(envelope.stats.models);
    return models.length > 0 ? models[0] : UNREPORTED_MODEL;
  }
  // Antigravity's turn envelope and Copilot's terminal `result` event name
  // no model (probes 3/10) — both fall through to the sentinel here.
  return envelope.model || UNREPORTED_MODEL;
}

function extractTokens(cli, envelope) {
  if (!envelope) return {};
  if (cli === 'claude-code' && envelope.modelUsage) {
    const models = Object.values(envelope.modelUsage);
    const first = models[0] || {};
    return {
      netInput: first.inputTokens,
      cacheRead: first.cacheReadInputTokens,
      cacheWrite: first.cacheCreationInputTokens,
      output: first.outputTokens,
      reasoning: 0,
    };
  }
  if (cli === 'gemini-cli' && envelope.stats && envelope.stats.models) {
    const models = Object.values(envelope.stats.models);
    const first = models[0] && models[0].tokens ? models[0].tokens : {};
    return {
      netInput: (first.prompt || 0) - (first.cached || 0),
      cacheRead: first.cached,
      cacheWrite: 0,
      output: first.candidates,
      reasoning: first.thoughts,
    };
  }
  if (envelope.usage && typeof envelope.usage === 'object') {
    return envelope.usage;
  }
  return {};
}

function capture({ cli, envelope, launchInstant, projectRoot, now = record.nowInstant } = {}) {
  const captureInstant = now();
  const sessionId = extractSessionId(cli, envelope);
  const idempotencyKey = sessionId
    ? `run-total:${sessionId}`
    : `run-total:${crypto.createHash('sha256').update(`${launchInstant || captureInstant}${JSON.stringify(process.argv)}`).digest('hex')}`;

  const identity = {
    sessionId: sessionId || `run-total-unreported:${launchInstant || captureInstant}`,
    parentSessionId: null,
    agentId: null,
    projectRoot: projectRoot || 'unknown',
  };
  const timing = {
    requestInstant: extractTerminalTimestamp(envelope) || launchInstant || captureInstant,
    captureInstant,
  };

  const BINARY_BY_CLI = { 'claude-code': 'claude', 'gemini-cli': 'gemini', 'copilot-cli': 'copilot', antigravity: 'agy' };
  const cliVersion = record.cliVersionFor(cli, { binary: BINARY_BY_CLI[cli] || cli }) || 'unknown';

  return record.captured({
    provenance: { cli, cliVersion, captureChannel: CAPTURE_CHANNEL, formatFingerprint: 'headless-envelope-run-total' },
    identity,
    timing,
    modelId: extractModel(cli, envelope),
    interaction: 'unknown',
    tokens: record.mapTokens(extractTokens(cli, envelope)),
    raw: envelope || {},
    rawStatus: 'complete',
    fidelity: 'run-total',
    idempotencyKey,
  });
}

module.exports = { captureChannel: CAPTURE_CHANNEL, capture };
