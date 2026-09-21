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
// Usage:
//   node fake-mempalace-mcp.js <port> <token> <logfile> <drawersfile>
//
// <logfile>     — JSONL, one line appended per tool call (including
//                 mempalace_search, so the suite can assert it is NEVER
//                 called).
// <drawersfile> — a JSON object {drawerId: {wing, room, content,
//                 source_file, added_by}}, rewritten atomically after every
//                 mutating call, so the suite can assert drawer counts and
//                 contents directly.

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

function jsonRpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

function handleAddDrawer(id, args) {
  const { wing, room, content, source_file: sourceFile, added_by: addedBy } = args || {};
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
  return jsonRpcResult(id, { success: true, reason: alreadyExists ? 'already_exists' : 'stored', drawer_id: drawId });
}

function handleDeleteBySource(id, args) {
  deleteCallsSoFar += 1;
  if (failDeleteAfter !== null && deleteCallsSoFar > failDeleteAfter) {
    appendLog({ tool: 'mempalace_delete_by_source', source_file: args && args.source_file, injected_failure: true });
    return { __injectedFailure: true };
  }

  const { source_file: sourceFile } = args || {};
  let deletedCount = 0;
  for (const drawId of Object.keys(drawers)) {
    if (drawers[drawId].source_file === sourceFile) {
      delete drawers[drawId];
      deletedCount += 1;
    }
  }
  if (deletedCount > 0) persistDrawers();
  appendLog({ tool: 'mempalace_delete_by_source', source_file: sourceFile, deleted_count: deletedCount });
  return jsonRpcResult(id, { success: true, deleted_count: deletedCount });
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

// --- Test control (fixture-only surface; never a real MemPalace endpoint) --
// Lets the suite simulate "the daemon fails partway through a prune" (case
// (e), an interrupted-prune scenario) deterministically, instead of racing a
// process kill against prune.js's own sequential await loop.
let deleteCallsSoFar = 0;
let failDeleteAfter = null; // null = never fail; N = calls 1..N succeed, N+1.. fail

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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, failDeleteAfter }));
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
