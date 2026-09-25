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
//                      Antigravity's own turn envelope names NONE (verified
//                      live, DEV follow-up: `agy -p ... --output-format
//                      json` returns {conversation_id, status, response,
//                      duration_seconds, num_turns, usage} — no model key)
//                      — that lands on the sentinel "(unreported)", never a
//                      value borrowed from another source (R30). Copilot's
//                      `--usage-output-file` DOES report one, as
//                      `currentModel` (verified live the same session).
//   interaction      = "unknown"
//   raw              = an allow-listed subset of the envelope (pickRaw()),
//                      never the whole envelope — spec 0206 R18. Each
//                      allowed top-level key is copied unaltered (R8) when
//                      present and never invented when absent. The reply
//                      text (`response`, `result`) and tool input
//                      (`permission_denials`) are never copied.
//
// Per-CLI envelope shapes verified live on the authoring machine (DEV
// follow-up, issue #1169):
//   antigravity  (agy -p ... --output-format json):
//     {conversation_id, status, response, duration_seconds, num_turns,
//      usage: {input_tokens, output_tokens, thinking_tokens,
//      cache_read_tokens, total_tokens}} — snake_case, no model, no
//      session_id (conversation_id is the only identifier).
//   copilot-cli  (copilot ... --usage-output-file <file>):
//     {..., currentModel, modelMetrics: {<model>: {usage: {inputTokens,
//      outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens}}},
//      ...} — no session id in this file at all.

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
  if (cli === 'antigravity') return envelope.conversation_id || null;
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
  if (cli === 'copilot-cli' && envelope.currentModel) {
    return envelope.currentModel;
  }
  // Antigravity's own turn envelope names no model at all (verified live).
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
  if (cli === 'antigravity' && envelope.usage && typeof envelope.usage === 'object') {
    const u = envelope.usage;
    return {
      netInput: u.input_tokens,
      cacheRead: u.cache_read_tokens,
      cacheWrite: 0,
      output: u.output_tokens,
      reasoning: u.thinking_tokens,
    };
  }
  if (cli === 'copilot-cli' && envelope.currentModel && envelope.modelMetrics && envelope.modelMetrics[envelope.currentModel]) {
    const u = envelope.modelMetrics[envelope.currentModel].usage || {};
    return {
      netInput: u.inputTokens,
      cacheRead: u.cacheReadTokens,
      cacheWrite: u.cacheWriteTokens,
      output: u.outputTokens,
      reasoning: u.reasoningTokens,
    };
  }
  if (envelope.usage && typeof envelope.usage === 'object') {
    return envelope.usage;
  }
  return {};
}

// RAW_KEYS_BY_CLI — the top-level envelope keys pickRaw() copies per CLI:
// identifiers, counters, and the token/model blocks the extractors above
// read. Anything else, including every conversation-text field, is dropped.
// Gemini's `stats` is reduced to `stats.models` (stats.tools and
// stats.files are not copied). TIMING_KEYS are kept for every CLI because
// extractTerminalTimestamp() reads them. The copilot-cli pricing keys
// (`pricing`, `total_nano_aiu`, `request_multiplier`) are what
// scripts/lib/usage-price/copilot.js firstPartyCopilot() reads — keep the
// two in step.
const RAW_KEYS_BY_CLI = {
  antigravity: ['conversation_id', 'status', 'duration_seconds', 'num_turns', 'usage'],
  'claude-code': ['session_id', 'modelUsage', 'usage', 'total_cost_usd', 'duration_ms', 'num_turns'],
  'gemini-cli': ['session_id'],
  'copilot-cli': ['currentModel', 'modelMetrics', 'pricing', 'total_nano_aiu', 'request_multiplier'],
};
const RAW_KEYS_DEFAULT = ['session_id', 'sessionId', 'model', 'usage'];
const TIMING_KEYS = ['timestamp', 'terminal_timestamp'];

function pickRaw(cli, envelope) {
  const raw = {};
  if (!envelope || typeof envelope !== 'object') return raw;
  const keys = (RAW_KEYS_BY_CLI[cli] || RAW_KEYS_DEFAULT).concat(TIMING_KEYS);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(envelope, key)) raw[key] = envelope[key];
  }
  if (cli === 'gemini-cli' && envelope.stats && typeof envelope.stats === 'object'
      && Object.prototype.hasOwnProperty.call(envelope.stats, 'models')) {
    raw.stats = { models: envelope.stats.models };
  }
  return raw;
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
    raw: pickRaw(cli, envelope),
    rawStatus: 'complete',
    fidelity: 'run-total',
    idempotencyKey,
  });
}

module.exports = { captureChannel: CAPTURE_CHANNEL, capture };
