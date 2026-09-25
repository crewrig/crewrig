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
// It NEVER throws, not even from its response handler: every outcome
// resolves to one of three not-ok kinds, or to `{ok:true, result}` where
// `result` is the tool's PARSED payload, decoded by decodeToolResult() from
// `result.content[].text` (MemPalace 3.6.0 fills that text with
// `json.dumps(payload)`, mcp_server.py l. 4849-4857):
//   - `transport` — the daemon is not reachable as a JSON-RPC peer: a
//     missing token, an endpoint that cannot be dialled (including a
//     malformed MEMPALACE_MCP_PORT), a connection refusal, a timeout, a
//     non-2xx status or a body that is not JSON. mirror.js stamps
//     unreachable.stamp and stops; prune.js refuses.
//   - `tool-error` — this one call failed: a JSON-RPC `error` answer
//     (left as is, see #1240), a payload with `success: false` (every
//     handled per-call failure of both mutating tools carries it), or a
//     delete answered as a dry run. mirror.js logs it and moves on to the
//     next record; prune.js refuses.
//   - `tool-unavailable` — the daemon answered but the tool cannot serve
//     ANY call right now: a payload with no `success` key (`_no_palace()`
//     and backend errors), `isError: true`, a malformed or empty envelope,
//     or an exception while handling the response. mirror.js stops its
//     pass after that one call WITHOUT stamping (the daemon is reachable);
//     prune.js refuses.
// `isError` is classified as palace-wide only because MemPalace 3.6.0
// never sets it; MCP gives it per-call semantics, so a MemPalace that
// adopts it for per-record failures would make one bad record stop every
// pass. #1240 re-examines this classification together with the JSON-RPC
// preflight refusals.
//
// The two mutating wrappers require a positive acknowledgment
// (requireSuccess(): `success: true`), and deleteBySource() also rejects an
// explicit `dry_run: true`, because the server's default is a dry run
// (mcp_server.py l. 2948). The write path never calls this module —
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

// decodeToolResult(parsed) — the pure MCP envelope decoder, applied to a
// JSON-RPC response that carries no `error`. Returns `{ok:true, result}`
// with the parsed payload, or a `tool-unavailable` result (see header).
function decodeToolResult(parsed) {
  const result = parsed && parsed.result;
  if (!result || typeof result !== 'object') {
    return { ok: false, kind: 'tool-unavailable', message: 'malformed tool result' };
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const textItem = content.find((item) => item && item.type === 'text' && typeof item.text === 'string');
  if (result.isError === true) {
    return {
      ok: false,
      kind: 'tool-unavailable',
      message: textItem ? textItem.text.slice(0, 200) : 'tool result has isError set',
    };
  }
  if (!textItem) {
    return { ok: false, kind: 'tool-unavailable', message: 'tool result has no text content' };
  }
  let payload;
  try {
    payload = JSON.parse(textItem.text);
  } catch (err) {
    return { ok: false, kind: 'tool-unavailable', message: 'tool result text is not JSON' };
  }
  return { ok: true, result: payload };
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

    // http.request() validates its options synchronously (a malformed
    // MEMPALACE_MCP_PORT throws ERR_SOCKET_BAD_PORT): an endpoint that
    // cannot be dialled is `transport`, never a rejection.
    try {
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
          res.on('error', (err) => settle({ ok: false, kind: 'transport', message: err.message }));
          res.on('end', () => {
            try {
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
              settle(decodeToolResult(parsed));
            } catch (err) {
              // An exception here would otherwise be an uncaught listener
              // exception that kills a catch-up holding mirror.lock.
              settle({ ok: false, kind: 'tool-unavailable', message: `response handling failed: ${err.message}` });
            }
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
    } catch (err) {
      settle({ ok: false, kind: 'transport', message: err.message });
    }
  });
}

function failureMessage(payload) {
  if (!payload || typeof payload !== 'object' || !payload.error) {
    return 'tool did not report success';
  }
  const detail = payload.details || payload.hint; // the specific details outrank the generic hint
  return detail ? `${payload.error} (${detail})` : `${payload.error}`;
}

// requireSuccess(res) — total: only `success: true` acknowledges the call.
// `success: false` is MemPalace's per-record failure (`tool-error`);
// anything else — no `success` key, a non-boolean one, a payload that is
// not an object — means the tool cannot serve any call (`tool-unavailable`).
function requireSuccess(res) {
  if (!res.ok) return res;
  const payload = res.result;
  if (payload && typeof payload === 'object' && payload.success === true) return res;
  const kind = payload && typeof payload === 'object' && payload.success === false ? 'tool-error' : 'tool-unavailable';
  return { ok: false, kind, message: failureMessage(payload) };
}

// rejectDryRun(res) — an acknowledged delete that reports `dry_run: true`
// deleted nothing (the server's default, mcp_server.py l. 2948).
function rejectDryRun(res) {
  if (res.ok && res.result.dry_run === true) {
    return { ok: false, kind: 'tool-error', message: 'MemPalace answered a dry run; nothing was deleted' };
  }
  return res;
}

function addDrawer(args) {
  return call('mempalace_add_drawer', args).then(requireSuccess);
}

function deleteBySource(args) {
  return call('mempalace_delete_by_source', args).then(requireSuccess).then(rejectDryRun);
}

module.exports = { endpoint, tokenPath, call, addDrawer, deleteBySource };
