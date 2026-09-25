#!/usr/bin/env node
// fake-mempalace-mcp.js — a hermetic stand-in for the MemPalace MCP HTTP
// daemon, used ONLY by scripts/tests/test-usage-storage-mirror.sh (spec 0207
// R23, PLAN v3 step 11). Never the real daemon at 127.0.0.1:41893 — the test
// suite always binds this fixture to a caller-supplied ephemeral port.
//
// Conforms to the readiness/teardown precedent of
// scripts/tests/test-mcp-daemon.sh l. 775-811: a `/healthz` endpoint the
// caller polls at 100ms up to 5s, and a clean process the caller kills on
// exit. Answers exactly the two tools this ticket's mirror.js calls —
// `mempalace_add_drawer` and `mempalace_delete_by_source` — over a single
// bearer-authenticated `POST /mcp` JSON-RPC `tools/call`, no `initialize`,
// no session header, no SSE, mirroring `_mcp_daemon_probe_accepts`
// (scripts/lib/common.sh l. 948-999).
//
// `mempalace_add_drawer`'s content-addressed id mimics MemPalace 3.6.0's own
// `make_drawer_id_from_content` (mempalace/ids.py l. 80, cited in PLAN v3
// step 7's "Why there is no de-duplication probe"): the same
// (wing, room, content) triple always yields the same id, and a repeat
// yields `already_exists` without a new drawer. This fixture uses a full
// sha256 hex digest rather than the real daemon's truncated form — R-D
// (plan/1170#3 review) states plainly that the fake pins the SHAPE this
// ticket depends on (content-addressed, idempotent), not the real daemon's
// exact byte-for-byte id scheme, so the truncation width is not load-bearing
// for anything this suite asserts.
//
// Envelope (issue #1211, PLAN v2 step 5). Every successful `tools/call`
// answers in MemPalace 3.6.0's own envelope (mempalace/mcp_server.py
// l. 4849-4857): `result.content[0].text` holds the tool's payload serialised
// with `json.dumps(result, indent=2)`, and `isError` is never set. The
// payloads carry the real success fields:
//   - add_drawer stored:        {success: true, drawer_id, wing, room, chunks: 1}
//   - add_drawer already there: {success: true, reason: 'already_exists', drawer_id}
//   - delete_by_source real:    {success: true, dry_run: false, source_file, deleted: n}
//   - delete_by_source dry run: {success: true, dry_run: true, source_file,
//                                match_count: n, closet_match_count: 0,
//                                sample: [], hint}
//
// `dry_run` default. The real `tool_delete_by_source(source_file,
// dry_run=True)` (l. 2948) defaults to a DRY RUN and branches on Python
// truthiness (`if dry_run:`, l. 3008). This fake follows both: an absent
// `dry_run` argument is a dry run that deletes nothing; a present one is
// judged by JS truthiness. A caller that forgets `dry_run: false` therefore
// deletes nothing here, exactly as it would against the real daemon.
//
// Usage:
//   node fake-mempalace-mcp.js <port> <token> <logfile> <drawersfile>
//
// <logfile>     — JSONL, one line appended per tool call (including
//                 mempalace_search, so the suite can assert it is NEVER
//                 called). Delete lines carry `dry_run: <bool>` (the value
//                 the fake resolved); lines for calls answered by an armed
//                 toolFailure carry `injected_tool_failure: <shape>`.
// <drawersfile> — a JSON object {drawerId: {wing, room, content,
//                 source_file, added_by}}, rewritten atomically after every
//                 mutating call, so the suite can assert drawer counts and
//                 contents directly.
//
// Test control (`POST /control`, fixture-only, never a real endpoint):
//   {"failDeleteAfter": N | null}
//       delete calls 1..N succeed, N+1.. answer HTTP 500, which the client
//       reads as `transport` (case (e)). Evaluated BEFORE toolFailure.
//   {"toolFailure": {"tool": "<mempalace_add_drawer|mempalace_delete_by_source>",
//                    "shape": "<shape>" | null}}
//       while a shape is armed, every call to that tool answers HTTP 200 with
//       the shape, mutates no drawer, and still logs one line. Shapes:
//         success-false   — payload {success: false, error}: a per-record
//                           failure (l. 2554, 2604, 2665, 2988, 3062).
//         no-success-key  — payload _no_palace() verbatim (l. 1253-1257).
//         dry-run         — the dry-run payload, whatever dry_run the caller
//                           sent (a server ignoring the argument). Delete only.
//         is-error        — raw result {content: [text '{"success": true}'],
//                           isError: true}.
//         not-json-text   — raw result {content: [text 'not json']}.
//         no-text-content — raw result {content: []}.
//         no-result       — whole response {jsonrpc, id}: no result, no error.
//       An unknown tool or shape answers HTTP 400, so a typo in the suite
//       aborts it (curl -f under set -e) instead of silently arming nothing.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , portArg, token, logFile, drawersFile] = process.argv;
if (!portArg || !token || !logFile || !drawersFile) {
  console.error('Usage: node fake-mempalace-mcp.js <port> <token> <logfile> <drawersfile>');
  process.exit(2);
}
const PORT = Number(portArg);

let drawers = {};
try {
  drawers = JSON.parse(fs.readFileSync(drawersFile, 'utf8'));
} catch (err) {
  drawers = {};
}

function persistDrawers() {
  const tmp = `${drawersFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(drawers));
  fs.renameSync(tmp, drawersFile);
}

function appendLog(entry) {
  fs.appendFileSync(logFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

function drawerId(wing, room, content) {
  const digest = crypto.createHash('sha256').update(`${wing}|${room}|${content}`).digest('hex');
  return `drawer_${wing}_${room}_${digest}`;
}

// The real envelope (mcp_server.py l. 4849-4857): the payload travels as
// indented JSON text inside result.content[0].
function jsonRpcResult(id, payload) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] },
  });
}

// A raw `result` object, bypassing the envelope — for the malformed shapes.
function jsonRpcRawResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

function dryRunPayload(sourceFile, matchCount) {
  return {
    success: true,
    dry_run: true,
    source_file: sourceFile,
    match_count: matchCount,
    closet_match_count: 0,
    sample: [],
    hint: matchCount
      ? `No drawers were deleted. Re-run with dry_run=false to remove these ${matchCount} drawer(s) and 0 index entr(y/ies).`
      : 'No drawers match this source_file.',
  };
}

function countBySource(sourceFile) {
  return Object.values(drawers).filter((d) => d.source_file === sourceFile).length;
}

// An absent dry_run is a dry run (l. 2948); a present one is judged by
// truthiness, like Python's `if dry_run:` (l. 3008).
function resolveDryRun(args) {
  if (!args || !Object.prototype.hasOwnProperty.call(args, 'dry_run')) return true;
  return Boolean(args.dry_run);
}

// --- Test control (fixture-only surface; never a real MemPalace endpoint) --
// failDeleteAfter lets the suite simulate "the daemon fails partway through a
// prune" (case (e), an interrupted-prune scenario) deterministically, instead
// of racing a process kill against prune.js's own sequential await loop.
// toolFailure injects the tool-level failure shapes of issue #1211.
let deleteCallsSoFar = 0;
let failDeleteAfter = null; // null = never fail; N = calls 1..N succeed, N+1.. fail
const toolFailure = { mempalace_add_drawer: null, mempalace_delete_by_source: null };
const SHAPES = {
  mempalace_add_drawer: ['success-false', 'no-success-key', 'is-error', 'not-json-text', 'no-text-content', 'no-result'],
  mempalace_delete_by_source: [
    'success-false',
    'no-success-key',
    'dry-run',
    'is-error',
    'not-json-text',
    'no-text-content',
    'no-result',
  ],
};

// injectedBody(shape, id, args) — the HTTP 200 body for an armed shape.
function injectedBody(shape, id, args) {
  switch (shape) {
    case 'success-false':
      return jsonRpcResult(id, { success: false, error: 'injected tool failure (test control)' });
    case 'no-success-key':
      return jsonRpcResult(id, { error: 'No palace found', hint: 'Run: mempalace init <dir> && mempalace mine <dir>' });
    case 'dry-run': {
      const sourceFile = args && args.source_file;
      return jsonRpcResult(id, dryRunPayload(sourceFile, countBySource(sourceFile)));
    }
    case 'is-error':
      return jsonRpcRawResult(id, { content: [{ type: 'text', text: '{"success": true}' }], isError: true });
    case 'not-json-text':
      return jsonRpcRawResult(id, { content: [{ type: 'text', text: 'not json' }] });
    case 'no-text-content':
      return jsonRpcRawResult(id, { content: [] });
    case 'no-result':
      return JSON.stringify({ jsonrpc: '2.0', id });
    default:
      throw new Error(`unknown toolFailure shape: ${shape}`);
  }
}

function handleAddDrawer(id, args) {
  const { wing, room, content, source_file: sourceFile, added_by: addedBy } = args || {};
  const shape = toolFailure.mempalace_add_drawer;
  if (shape) {
    appendLog({
      tool: 'mempalace_add_drawer',
      wing,
      room,
      source_file: sourceFile,
      added_by: addedBy,
      injected_tool_failure: shape,
    });
    return injectedBody(shape, id, args);
  }

  const drawId = drawerId(wing, room, content);
  const alreadyExists = Object.prototype.hasOwnProperty.call(drawers, drawId);
  if (!alreadyExists) {
    drawers[drawId] = { wing, room, content, source_file: sourceFile, added_by: addedBy };
    persistDrawers();
  }
  appendLog({
    tool: 'mempalace_add_drawer',
    wing,
    room,
    source_file: sourceFile,
    added_by: addedBy,
    drawer_id: drawId,
    already_exists: alreadyExists,
  });
  if (alreadyExists) {
    return jsonRpcResult(id, { success: true, reason: 'already_exists', drawer_id: drawId });
  }
  return jsonRpcResult(id, { success: true, drawer_id: drawId, wing, room, chunks: 1 });
}

function handleDeleteBySource(id, args) {
  deleteCallsSoFar += 1;
  if (failDeleteAfter !== null && deleteCallsSoFar > failDeleteAfter) {
    appendLog({ tool: 'mempalace_delete_by_source', source_file: args && args.source_file, injected_failure: true });
    return { __injectedFailure: true };
  }

  const { source_file: sourceFile } = args || {};
  const dryRun = resolveDryRun(args);
  const shape = toolFailure.mempalace_delete_by_source;
  if (shape) {
    appendLog({
      tool: 'mempalace_delete_by_source',
      source_file: sourceFile,
      dry_run: dryRun,
      injected_tool_failure: shape,
    });
    return injectedBody(shape, id, args);
  }

  if (dryRun) {
    const matchCount = countBySource(sourceFile);
    appendLog({ tool: 'mempalace_delete_by_source', source_file: sourceFile, dry_run: true, deleted_count: 0 });
    return jsonRpcResult(id, dryRunPayload(sourceFile, matchCount));
  }

  let deletedCount = 0;
  for (const drawId of Object.keys(drawers)) {
    if (drawers[drawId].source_file === sourceFile) {
      delete drawers[drawId];
      deletedCount += 1;
    }
  }
  if (deletedCount > 0) persistDrawers();
  appendLog({ tool: 'mempalace_delete_by_source', source_file: sourceFile, dry_run: false, deleted_count: deletedCount });
  return jsonRpcResult(id, { success: true, dry_run: false, source_file: sourceFile, deleted: deletedCount });
}

function handleSearch(id, args) {
  // Logged distinctly so the suite can assert this is NEVER called
  // (v2-F2 retired the only caller — see mirror.js's own header comment).
  appendLog({ tool: 'mempalace_search', args: args || {} });
  return jsonRpcResult(id, { results: [] });
}

const TOOLS = {
  mempalace_add_drawer: handleAddDrawer,
  mempalace_delete_by_source: handleDeleteBySource,
  mempalace_search: handleSearch,
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/control') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (err) {
        // ignore — treat as a no-op control call
      }
      if (Object.prototype.hasOwnProperty.call(body, 'failDeleteAfter')) {
        failDeleteAfter = body.failDeleteAfter;
        deleteCallsSoFar = 0;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'toolFailure')) {
        const tf = body.toolFailure || {};
        const allowed = SHAPES[tf.tool];
        if (!allowed || (tf.shape !== null && !allowed.includes(tf.shape))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `unknown toolFailure tool/shape: ${tf.tool}/${tf.shape}` }));
          return;
        }
        toolFailure[tf.tool] = tf.shape;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, failDeleteAfter, toolFailure }));
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/mcp') {
    res.writeHead(404);
    res.end();
    return;
  }

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${token}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }

    if (body.method !== 'tools/call') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(jsonRpcError(body.id, `unsupported method: ${body.method}`));
      return;
    }

    const toolName = body.params && body.params.name;
    const handler = TOOLS[toolName];
    if (!handler) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(jsonRpcError(body.id, `unknown tool: ${toolName}`));
      return;
    }
    const result = handler(body.id, body.params.arguments);
    if (result && result.__injectedFailure) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'injected failure (test control)' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(result);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake-mempalace-mcp listening on 127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  // Force-exit if close() hangs on a keep-alive socket.
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
