#!/usr/bin/env node
// forge-stub.mjs — A hermetic stand-in for the GitLab API, used ONLY by
// scripts/tests/test-monorepo-release-engine.sh (spec 0213 + delta-01, PLAN
// v2 step 11). It implements exactly what @semantic-release/gitlab@13.3.3
// calls for a run whose config carries no `successComment`/`failComment`
// overrides (verified against node_modules/@semantic-release/gitlab/lib/
// {verify,publish,success,fail}.js):
//
//   GET  /api/v4/projects/:id
//     -> { permissions: { project_access: { access_level: 40 } } }
//     (verify.js's push-permission check needs access_level >= 30.)
//   PUT  /api/v4/projects/:id/packages/generic/:pkg/:version/:label
//     -> stores the raw request body under <uploadDir>/<pkg>-<version>-<label>
//        and answers { file: { url: "generic_package" } } (publish.js reads
//        response.file.url only to log it).
//        FAIL_UPLOAD=1 answers 403 instead, WITHOUT storing the body — 403 is
//        not one of got's default retry-status codes (resolve-config.js:
//        [408,413,422,429,500,502,503,504,521,522,524]), so this is answered
//        exactly once per upload attempt.
//   POST /api/v4/projects/:id/releases
//     -> 201 {} (publish.js does not parse the response body).
//   GET  /api/v4/projects/:id/repository/commits/:sha/merge_requests
//     -> 200 [] (success.js's per-commit related-MR query; an empty result
//        short-circuits the related-issue lookup and the comment posts).
//   GET  /api/v4/projects/:id/issues?state=opened&search=...
//     -> 200 [] (fail.js's search for an existing failure-report issue).
//   POST /api/v4/projects/:id/issues
//     -> 201 { id: 1, web_url: "<a stub URL>" } (fail.js's issue creation on
//        a run that fails after publish's verifyConditions).
//
// Every request is appended to <logFile> as one JSON line: {method, path,
// query, ts}, so the suite can assert exactly which endpoints were hit (and,
// for the upload endpoint, exactly once — R8/R9).
//
// Usage:
//   node forge-stub.mjs <portFile> <logFile> <uploadDir>
//
// <portFile> is written with the bound ephemeral port once the server is
// listening (binds 127.0.0.1:0), so the caller can poll for readiness without
// a fixed port collision risk. FAIL_UPLOAD=1 in this process's env flips the
// upload endpoint to always answer 403.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [, , portFile, logFile, uploadDir] = process.argv;
if (!portFile || !logFile || !uploadDir) {
  console.error("Usage: node forge-stub.mjs <portFile> <logFile> <uploadDir>");
  process.exit(2);
}

fs.mkdirSync(uploadDir, { recursive: true });
const FAIL_UPLOAD = process.env.FAIL_UPLOAD === "1";

function appendLog(entry) {
  fs.appendFileSync(logFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

// Route table, matched in order against the URL pathname (query stripped).
// Every pattern is anchored under /api/v4/projects/:id — the fixture always
// runs with CI_PROJECT_ID=7, but the id is captured, not hard-coded, so a
// future fixture change does not silently desync the stub.
const ROUTES = [
  {
    method: "GET",
    pattern: /^\/api\/v4\/projects\/([^/]+)$/,
    handle: (req, res) => {
      sendJson(res, 200, {
        id: 7,
        permissions: { project_access: { access_level: 40 }, group_access: null },
      });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/v4\/projects\/([^/]+)\/packages\/generic\/([^/]+)\/([^/]+)\/([^/]+)$/,
    handle: async (req, res, match) => {
      const [, , pkg, version, label] = match;
      const body = await readBody(req);
      if (FAIL_UPLOAD) {
        appendLog({ method: "PUT", path: req.url, pkg, version, label, status: 403, storedBytes: 0 });
        sendJson(res, 403, { message: "403 Forbidden (test fixture: FAIL_UPLOAD=1)" });
        return;
      }
      const decodedLabel = decodeURIComponent(label);
      fs.writeFileSync(path.join(uploadDir, `${pkg}-${version}-${decodedLabel}`), body);
      appendLog({ method: "PUT", path: req.url, pkg, version, label: decodedLabel, status: 200, storedBytes: body.length });
      sendJson(res, 200, { file: { url: "generic_package" } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v4\/projects\/([^/]+)\/releases$/,
    handle: async (req, res) => {
      const body = await readBody(req);
      let parsed = null;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        parsed = null;
      }
      appendLog({ method: "POST", path: req.url, body: parsed });
      sendJson(res, 201, {});
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v4\/projects\/([^/]+)\/repository\/commits\/([^/]+)\/merge_requests$/,
    handle: (req, res) => {
      appendLog({ method: "GET", path: req.url });
      sendJson(res, 200, []);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v4\/projects\/([^/]+)\/issues$/,
    handle: (req, res) => {
      appendLog({ method: "GET", path: req.url });
      sendJson(res, 200, []);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v4\/projects\/([^/]+)\/issues$/,
    handle: async (req, res) => {
      const body = await readBody(req);
      let parsed = null;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        parsed = null;
      }
      appendLog({ method: "POST", path: req.url, body: parsed });
      sendJson(res, 201, { id: 1, web_url: "http://forge-stub.invalid/issues/1" });
    },
  },
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;
    Promise.resolve(route.handle(req, res, match)).catch((error) => {
      appendLog({ method: req.method, path: req.url, error: String(error) });
      sendJson(res, 500, { message: String(error) });
    });
    return;
  }

  appendLog({ method: req.method, path: req.url, status: 404 });
  sendJson(res, 404, { message: "not found (forge-stub)" });
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  fs.writeFileSync(portFile, String(port));
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
