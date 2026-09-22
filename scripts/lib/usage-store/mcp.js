// mcp.js — a dependency-free MemPalace MCP HTTP client over node:http (spec
// 0207 PLAN v3 step 6). The only module in this tree that imports network
// primitives, and the only module mirror.js imports for daemon access.
//
// `endpoint()` and `tokenPath()` port scripts/lib/common.sh's own
// MCP_DAEMON_HOST_DEFAULT/MCP_DAEMON_PORT_DEFAULT (l. 757, l. 763) and
// mcp_token_path() (l. 1695-1711) — verified byte-identical against
// `bash -c '. scripts/lib/common.sh; mcp_token_path'` under a fixed HOME
// (see scripts/tests/test-usage-storage-mirror.sh, step 10 entry criteria).
// The mkdir under tokenPath()'s "does not yet exist" branch is the one
// intentional departure common.sh's own function also makes: a side effect
// on an otherwise pure path computation, kept for parity, and unobservable —
// it changes no returned string, only whether an ancestor directory exists.
//
// `call(tool, args)` posts exactly ONE bearer-authenticated JSON-RPC
// `tools/call` object — no `initialize`, no session header, no SSE — the
// shape `_mcp_daemon_probe_accepts` (common.sh l. 948-999) contracts for.
// It NEVER throws: a missing token, a connection refusal, a timeout, a
// non-2xx status or an unparseable body all resolve to
// `{ok:false, kind:'transport'}`; a well-formed JSON-RPC error response
// resolves to `{ok:false, kind:'tool-error', message}` so callers can tell
// "the daemon is unreachable" (stop and back off) from "this one call
// failed" (log and continue). The write path never calls this module —
// journal.js's write() only checks tokenPath() for existence (R4).

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MCP_DAEMON_HOST_DEFAULT = '127.0.0.1';
const MCP_DAEMON_PORT_DEFAULT = '41893';
const CALL_TIMEOUT_MS = 2000;

function endpoint() {
  return {
    host: process.env.MEMPALACE_MCP_HOST || MCP_DAEMON_HOST_DEFAULT,
    port: process.env.MEMPALACE_MCP_PORT || MCP_DAEMON_PORT_DEFAULT,
  };
}

function tokenPath() {
  const palacePath = process.env.MEMPALACE_PALACE_PATH || path.join(os.homedir(), '.mempalace', 'palace');
  let isDir = false;
  try {
    isDir = fs.statSync(palacePath).isDirectory();
  } catch (err) {
    isDir = false;
  }

  let resolved;
  if (isDir) {
    resolved = fs.realpathSync(palacePath);
  } else {
    const parent = path.dirname(palacePath);
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch (err) {
      // best-effort, mirrors common.sh's `mkdir -p ... || true`
    }
    let parentResolved;
    try {
      parentResolved = fs.realpathSync(parent);
    } catch (err) {
      parentResolved = parent;
    }
    resolved = path.join(parentResolved, path.basename(palacePath));
  }

  const key = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 24);
  return path.join(os.homedir(), '.mempalace', 'server', key, 'token');
}

function readToken() {
  const raw = fs.readFileSync(tokenPath(), 'utf8');
  const trimmed = raw.replace(/\s+/g, '');
  if (!trimmed) {
    throw new Error('token file is whitespace-only');
  }
  return trimmed;
}

function call(tool, args) {
  return new Promise((resolve) => {
    let token;
    try {
      token = readToken();
    } catch (err) {
      resolve({ ok: false, kind: 'transport', message: 'no readable token file' });
      return;
    }

    const { host, port } = endpoint();
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    });

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = http.request(
      {
        host,
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
        timeout: CALL_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            settle({ ok: false, kind: 'transport', message: `HTTP ${res.statusCode}` });
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch (err) {
            settle({ ok: false, kind: 'transport', message: 'unparseable response body' });
            return;
          }
          if (parsed && parsed.error) {
            settle({ ok: false, kind: 'tool-error', message: parsed.error.message || 'tool error' });
            return;
          }
          settle({ ok: true, result: parsed && parsed.result });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      settle({ ok: false, kind: 'transport', message: 'timeout' });
    });
    req.on('error', (err) => {
      settle({ ok: false, kind: 'transport', message: err.message });
    });

    req.write(body);
    req.end();
  });
}

function addDrawer(args) {
  return call('mempalace_add_drawer', args);
}

function deleteBySource(args) {
  return call('mempalace_delete_by_source', args);
}

module.exports = { endpoint, tokenPath, call, addDrawer, deleteBySource };
