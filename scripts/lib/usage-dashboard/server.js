// server.js — form B of the usage dashboard (spec 0210 R14-R18, R29; PLAN
// v2 step 9, D9). node:http only. It binds 127.0.0.1 and nothing else (the
// host is a literal; no option or variable can change it), runs in the
// foreground until SIGINT/SIGTERM or the token-protected Stop action, and
// writes nothing: every request rebuilds the view through model.build(),
// which prices with store: false and forces the FX layer offline.
//
// Per-request guard: a Host allow-list (DNS rebinding), no CORS header ever,
// hardening headers plus the page CSP on every response, GET/POST only, a
// 16 KiB body cap. The two POST actions also need the per-process token
// (random, in memory only, compared in constant time) and a same-origin
// Origin / Sec-Fetch-Site when the browser sends them.

'use strict';

const http = require('http');
const crypto = require('crypto');

const filtersMod = require('./filters');
const model = require('./model');
const html = require('./html');

const DEFAULT_PORT = 41920;
const BODY_LIMIT = 16 * 1024;

function send(res, status, type, body, extra) {
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `${html.csp('served')}; frame-ancestors 'none'`,
    ...(extra || {}),
  };
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, message, extra) {
  send(res, status, 'text/plain; charset=utf-8', `${message}\n`, extra);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > BODY_LIMIT) {
      reject(Object.assign(new Error('request body too large'), { status: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

function tokenMatches(expected, given) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function start(opts) {
  opts = opts || {};
  const requestedPort = opts.port === undefined ? DEFAULT_PORT : opts.port;
  const token = crypto.randomBytes(32).toString('hex');
  let port = null;

  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = () => [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }

  async function renderView(res, filters, asJson) {
    const view = await model.build(filters, { now: new Date() });
    if (asJson) {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(view));
    } else {
      send(res, 200, 'text/html; charset=utf-8', html.renderPage(view, { mode: 'served', token }));
    }
  }

  function postAllowed(req) {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins().includes(origin)) return false;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return false;
    return true;
  }

  async function handle(req, res) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts().includes(host)) {
      sendText(res, 421, 'misdirected request: this server answers only to 127.0.0.1 and localhost');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      sendText(res, 405, 'method not allowed', { Allow: 'GET, POST' });
      return;
    }

    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${port}`);
    } catch (err) {
      sendText(res, 400, 'bad request');
      return;
    }
    const route = url.pathname;

    if (route === '/' || route === '/view.json') {
      if (req.method !== 'GET') {
        sendText(res, 405, 'method not allowed', { Allow: 'GET' });
        return;
      }
      let filters;
      try {
        filters = filtersMod.fromSearchParams(url.searchParams);
      } catch (err) {
        sendText(res, 400, `bad filter: ${err.message}`);
        return;
      }
      await renderView(res, filters, route === '/view.json');
      return;
    }

    if (route === '/recompute' || route === '/stop') {
      if (req.method !== 'POST') {
        sendText(res, 405, 'method not allowed', { Allow: 'POST' });
        return;
      }
      if (!postAllowed(req)) {
        sendText(res, 403, 'forbidden: cross-origin request');
        return;
      }
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      if (!tokenMatches(token, params.get('token'))) {
        sendText(res, 403, 'forbidden: missing or wrong token');
        return;
      }
      params.delete('token');
      if (route === '/stop') {
        sendText(res, 200, 'usage dashboard stopped');
        stop();
        return;
      }
      let filters;
      try {
        filters = filtersMod.fromSearchParams(params);
      } catch (err) {
        sendText(res, 400, `bad filter: ${err.message}`);
        return;
      }
      filters.options.asOfToday = true;
      await renderView(res, filters, false);
      return;
    }

    sendText(res, 404, 'not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err && err.status === 413) {
        sendText(res, 413, 'request body too large', { Connection: 'close' });
        req.destroy();
        return;
      }
      sendText(res, 500, `internal error: ${err && err.message}`);
    });
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`FATAL: port ${requestedPort} on 127.0.0.1 is already in use by another process — pass --port <n>`);
      process.exit(3);
    }
    console.error(`FATAL: ${err && err.message}`);
    process.exit(1);
  });

  server.listen(requestedPort, '127.0.0.1', () => {
    const address = server.address();
    port = address.port;
    process.stdout.write(`LISTENING http://127.0.0.1:${port}/\n`);
    process.stdout.write(`BOUND ${address.address}\n`);
  });

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return server;
}

module.exports = { start, DEFAULT_PORT };
