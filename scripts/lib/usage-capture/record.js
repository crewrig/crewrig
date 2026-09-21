// record.js — shared normalizer for the usage-capture module tree (spec 0206
// PLAN v3 step 1). Every adapter builds its records through captured() /
// uncaptured() here rather than assembling the schemas/usage-record/v1
// shape by hand, so the derivation rules below (recordId, the closed
// captureChannel vocabulary, the five-class token defaulting) live in one
// place.
//
// CREWRIG_USAGE_ROOT (default ${HOME}/.crewrig/usage) is resolved here and
// re-exported so every consumer in this module tree — sink.js, spool.js,
// cursor.js, and this file's own cliVersionFor() — reads the SAME root
// (PLAN v3 named edit 2).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// U+001F, byte-identical to scripts/lib/usage-record-validator.js's own
// UNIT_SEPARATOR (R22 derivation: sha256(sessionId + U+001F + idempotencyKey)).
// Not imported from that file — it is a CLI entry point with no exports —
// so the literal is duplicated here and kept in sync by inspection.
const UNIT_SEPARATOR = '\u001f';

const CLI_VALUES = Object.freeze(['claude-code', 'gemini-cli', 'copilot-cli', 'antigravity']);

// The closed captureChannel vocabulary (PLAN v3 step 1) — exactly the four
// values the merged schemas/usage-record/samples/*.json already use.
const CAPTURE_CHANNELS = Object.freeze([
  'own-record-tail',
  'sqlite-assistant-usage-events',
  'statusline-shim',
  'headless-envelope',
]);

const FIDELITY_VALUES = Object.freeze(['per-request', 'run-total', 'session-cumulative']);
const INTERACTION_VALUES = Object.freeze(['user-turn', 'tool-continuation', 'agent-internal', 'unknown']);
const RAW_STATUS_VALUES = Object.freeze(['complete', 'truncated', 'externalized', 'elided']);

function usageRoot() {
  return process.env.CREWRIG_USAGE_ROOT || path.join(os.homedir(), '.crewrig', 'usage');
}

function deriveRecordId(sessionId, idempotencyKey) {
  return crypto.createHash('sha256').update(`${sessionId}${UNIT_SEPARATOR}${idempotencyKey}`).digest('hex');
}

function nowInstant() {
  return new Date().toISOString();
}

function hasPath(obj, keyPath) {
  const segs = keyPath.split('.');
  let cur = obj;
  for (const seg of segs) {
    if (cur === null || typeof cur !== 'object' || !(seg in cur)) return false;
    cur = cur[seg];
  }
  return true;
}

// fingerprint(obj, keyPaths) — the asserted key-path set, sorted, hashed as a
// SET (never over content): a fixture and a live source of the same
// generation carry the same formatFingerprint (PLAN v3 step 1). Returns
// { ok: true, formatFingerprint } when every key path resolves on obj, or
// { ok: false, missing } naming what did not — the caller turns that into an
// uncaptured record (R17).
function fingerprint(obj, keyPaths) {
  const sorted = Array.from(new Set(keyPaths)).sort();
  const missing = sorted.filter((p) => !hasPath(obj, p));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  const digest = crypto.createHash('sha256').update(sorted.join('\n')).digest('hex');
  return { ok: true, formatFingerprint: `sha256:${digest}` };
}

// mapTokens(...) — the five-class token mapper. A class the source genuinely
// did not report is recorded as zero (R8), never omitted. cacheWrite is the
// one class that may be a structured per-tier map instead of a plain integer
// (R9); callers pass either shape through untouched.
function mapTokens({ netInput, cacheRead, cacheWrite, output, reasoning }) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let cw;
  if (cacheWrite && typeof cacheWrite === 'object') {
    cw = {};
    for (const [tier, v] of Object.entries(cacheWrite)) {
      cw[tier] = num(v);
    }
  } else {
    cw = num(cacheWrite);
  }
  return {
    netInput: num(netInput),
    cacheRead: num(cacheRead),
    cacheWrite: cw,
    output: num(output),
    reasoning: num(reasoning),
  };
}

function normalizeIdentity({ sessionId, parentSessionId = null, agentId = null, projectRoot }) {
  // R2/R12: never omitted — a response with no subordinate-agent linkage
  // still carries an explicit null, not an absent field.
  return {
    sessionId,
    parentSessionId: parentSessionId === undefined ? null : parentSessionId,
    agentId: agentId === undefined ? null : agentId,
    projectRoot,
  };
}

// captured(...) — build a `kind: "captured"` record. `raw` is the source
// vendor's original fields, unaltered (R5/R18 — an adapter passes only the
// key paths it already asserted, never full conversational content).
function captured({
  provenance,
  identity,
  timing,
  modelId,
  interaction,
  tokens,
  raw,
  rawStatus = 'complete',
  fidelity,
  idempotencyKey,
  corrects,
  attribution,
}) {
  const normIdentity = normalizeIdentity(identity);
  const record = {
    schemaVersion: '1.0.0',
    kind: 'captured',
    fidelity,
    recordId: deriveRecordId(normIdentity.sessionId, idempotencyKey),
    idempotencyKey,
    provenance,
    identity: normIdentity,
    timing,
    modelId,
    interaction,
    tokens,
    raw,
    rawStatus,
  };
  if (corrects) record.corrects = corrects;
  if (attribution) record.attribution = attribution;
  return record;
}

// uncaptured(...) — build a `kind: "uncaptured"` record (R6/R16/R17): no
// token class, no raw, no modelId — only the failure's own provenance.
function uncaptured({ provenance, identity, timing, idempotencyKey, uncapturedReason, fidelity }) {
  const normIdentity = normalizeIdentity(identity);
  return {
    schemaVersion: '1.0.0',
    kind: 'uncaptured',
    fidelity,
    recordId: deriveRecordId(normIdentity.sessionId, idempotencyKey),
    idempotencyKey,
    provenance,
    identity: normIdentity,
    timing,
    uncapturedReason,
  };
}

function stateDir(cli) {
  return path.join(usageRoot(), 'state', cli);
}

function resolveBinaryPath(binary) {
  try {
    const out = execFileSync('/bin/sh', ['-c', `command -v -- ${binary}`], { encoding: 'utf8' }).trim();
    return out || null;
  } catch (err) {
    return null;
  }
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// cliVersionFor(cli, opts) — memoized `<bin> --version` resolver (PLAN v3
// step 1): a subprocess runs at most once per binary upgrade, never once per
// firing (Gemini's AfterModel fires five times per prompt). Keyed on the
// resolved binary's {path, mtimeMs, size}, persisted to
// ~/.crewrig/usage/state/<cli>/version.json. Returns null when the binary
// cannot be resolved or run, so callers fall back to a prior cached value or
// leave cliVersion to another source.
function cliVersionFor(cli, { binary, versionArgs = ['--version'], parse } = {}) {
  const versionFile = path.join(stateDir(cli), 'version.json');
  const cached = readJsonSafe(versionFile);

  const resolvedPath = resolveBinaryPath(binary);
  if (!resolvedPath) {
    return cached ? cached.version : null;
  }

  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err) {
    return cached ? cached.version : null;
  }

  if (cached && cached.path === resolvedPath && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.version;
  }

  let raw;
  try {
    raw = execFileSync(resolvedPath, versionArgs, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (err) {
    return cached ? cached.version : null;
  }
  const version = parse ? parse(raw) : raw;
  writeJsonAtomic(versionFile, { path: resolvedPath, mtimeMs: stat.mtimeMs, size: stat.size, version });
  return version;
}

function hasNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// assertRecordShape(record) — the dependency-free structural precheck
// sink.js runs before handing a record to the storage boundary (PLAN v3
// step 1/step 2). Not a schema validator: it is the cheapest check that
// keeps a malformed record out of the hand-off, deliberately narrower than
// schemas/usage-record/v1.schema.json (ajv is a devDependency, unavailable
// in a hook's own process). Returns { ok: true } or { ok: false, reason }.
function assertRecordShape(record) {
  if (!record || typeof record !== 'object') {
    return { ok: false, reason: 'record is not an object' };
  }

  const rootRequired = ['schemaVersion', 'kind', 'fidelity', 'recordId', 'idempotencyKey', 'provenance', 'identity', 'timing'];
  for (const key of rootRequired) {
    if (!(key in record)) {
      return { ok: false, reason: `missing root key: ${key}` };
    }
  }

  if (record.schemaVersion !== '1.0.0') {
    return { ok: false, reason: `unexpected schemaVersion: ${record.schemaVersion}` };
  }
  if (record.kind !== 'captured' && record.kind !== 'uncaptured') {
    return { ok: false, reason: `unexpected kind: ${record.kind}` };
  }
  if (!FIDELITY_VALUES.includes(record.fidelity)) {
    return { ok: false, reason: `unexpected fidelity: ${record.fidelity}` };
  }
  if (!hasNonEmptyString(record.idempotencyKey)) {
    return { ok: false, reason: 'idempotencyKey missing or empty' };
  }

  const prov = record.provenance || {};
  for (const key of ['cli', 'cliVersion', 'captureChannel', 'formatFingerprint']) {
    if (!hasNonEmptyString(prov[key])) {
      return { ok: false, reason: `provenance.${key} missing or empty` };
    }
  }
  if (!CLI_VALUES.includes(prov.cli)) {
    return { ok: false, reason: `unexpected provenance.cli: ${prov.cli}` };
  }
  if (!CAPTURE_CHANNELS.includes(prov.captureChannel)) {
    return { ok: false, reason: `unexpected provenance.captureChannel: ${prov.captureChannel}` };
  }

  const identity = record.identity || {};
  if (!hasNonEmptyString(identity.sessionId)) {
    return { ok: false, reason: 'identity.sessionId missing or empty' };
  }
  if (!hasNonEmptyString(identity.projectRoot)) {
    return { ok: false, reason: 'identity.projectRoot missing or empty' };
  }

  const timing = record.timing || {};
  if (!hasNonEmptyString(timing.requestInstant)) {
    return { ok: false, reason: 'timing.requestInstant missing or empty' };
  }
  if (!hasNonEmptyString(timing.captureInstant)) {
    return { ok: false, reason: 'timing.captureInstant missing or empty' };
  }

  if (record.kind === 'captured') {
    if (!hasNonEmptyString(record.modelId)) {
      return { ok: false, reason: 'modelId missing or empty' };
    }
    if (!INTERACTION_VALUES.includes(record.interaction)) {
      return { ok: false, reason: `unexpected interaction: ${record.interaction}` };
    }
    const tokens = record.tokens;
    if (!tokens || typeof tokens !== 'object') {
      return { ok: false, reason: 'tokens missing' };
    }
    for (const cls of ['netInput', 'cacheRead', 'output', 'reasoning']) {
      if (!isNonNegativeNumber(tokens[cls])) {
        return { ok: false, reason: `tokens.${cls} is not a non-negative number` };
      }
    }
    const cw = tokens.cacheWrite;
    const cwOk =
      isNonNegativeNumber(cw) ||
      (cw && typeof cw === 'object' && Object.values(cw).length > 0 && Object.values(cw).every(isNonNegativeNumber));
    if (!cwOk) {
      return { ok: false, reason: 'tokens.cacheWrite is not a non-negative number or a non-empty tier map' };
    }
    if (!RAW_STATUS_VALUES.includes(record.rawStatus)) {
      return { ok: false, reason: `unexpected rawStatus: ${record.rawStatus}` };
    }
  } else if (!hasNonEmptyString(record.uncapturedReason)) {
    return { ok: false, reason: 'uncapturedReason missing or empty' };
  }

  const expected = deriveRecordId(identity.sessionId, record.idempotencyKey);
  if (record.recordId !== expected) {
    return { ok: false, reason: `recordId mismatch (expected ${expected}, found ${record.recordId})` };
  }

  return { ok: true };
}

module.exports = {
  UNIT_SEPARATOR,
  CLI_VALUES,
  CAPTURE_CHANNELS,
  FIDELITY_VALUES,
  INTERACTION_VALUES,
  RAW_STATUS_VALUES,
  usageRoot,
  stateDir,
  deriveRecordId,
  nowInstant,
  fingerprint,
  mapTokens,
  captured,
  uncaptured,
  cliVersionFor,
  assertRecordShape,
};
