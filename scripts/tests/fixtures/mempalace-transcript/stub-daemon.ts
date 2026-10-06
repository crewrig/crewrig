// stub-daemon.ts — a loopback stand-in for the shared MemPalace MCP HTTP
// daemon (ADR-0016), used by scripts/tests/test-mempalace-transcript-hook.sh
// (spec 0247 R32, issue #1329) and, later, by the golden differential of the
// TypeScript transcript hook. It never talks to the real daemon at
// 127.0.0.1:41893: it binds an ephemeral loopback port and reports it.
//
// It observes the hook from the outside, at the HTTP boundary, so one suite
// holds against both the shell hook (which spawns curl) and the TypeScript
// hook (which spawns none). It records what a daemon can see — method, URL,
// content type, authorization header, body — and nothing else.
//
// A DEDICATED fixture, not an extension of
// scripts/tests/fixtures/usage-storage/fake-mempalace-mcp.js: that file's
// header scopes it to the two tools mirror.js calls, and it records no
// request headers, which the bearer-token cases need.
//
// Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON stub-daemon.ts \
//     --port-file <file> --log <jsonl> [--mode ok|rpc-error|is-error|http-500-html|hang]
//
//   --port-file  written once, atomically, when the server listens; its
//                appearance is the readiness signal.
//   --log        one JSON line appended per request:
//                {method, url, contentType, authorization, body}
//                `body` is the parsed JSON body, or the raw string when it
//                does not parse.
//   --mode       how every request is answered (default `ok`):
//                  ok             200, a successful tools/call envelope
//                  rpc-error      200, {"error":{"message":"lease held"}}
//                  is-error       200, result.isError true
//                  http-500-html  500, an HTML body
//                  hang           never answers
//
// Standard library only. Exits 0 on SIGTERM or SIGINT; exits 2 on a usage
// error.

import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";

const MODES = ["ok", "rpc-error", "is-error", "http-500-html", "hang"] as const;
type Mode = (typeof MODES)[number];

interface Options {
  portFile: string;
  log: string;
  mode: Mode;
}

function usage(message: string): never {
  process.stderr.write(`stub-daemon: ${message}\n`);
  process.stderr.write(
    "usage: stub-daemon.ts --port-file <file> --log <jsonl> [--mode ok|rpc-error|is-error|http-500-html|hang]\n",
  );
  process.exit(2);
}

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

function parseOptions(argv: string[]): Options {
  let portFile = "";
  let log = "";
  let mode: Mode = "ok";
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) usage(`missing value for ${flag ?? ""}`);
    if (flag === "--port-file") portFile = value;
    else if (flag === "--log") log = value;
    else if (flag === "--mode") {
      if (!isMode(value)) usage(`unknown mode: ${value}`);
      mode = value;
    } else usage(`unknown argument: ${flag ?? ""}`);
    i += 1;
  }
  if (portFile === "") usage("--port-file is required");
  if (log === "") usage("--log is required");
  return { portFile, log, mode };
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function requestId(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "id" in body) {
    return (body as { id: unknown }).id;
  }
  return null;
}

function answer(res: http.ServerResponse, mode: Mode, id: unknown): void {
  if (mode === "hang") return;
  if (mode === "http-500-html") {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<html><body><h1>500 Internal Server Error</h1></body></html>\n");
    return;
  }
  let envelope: object;
  if (mode === "rpc-error") {
    envelope = { jsonrpc: "2.0", id, error: { message: "lease held" } };
  } else if (mode === "is-error") {
    envelope = {
      jsonrpc: "2.0",
      id,
      result: { isError: true, content: [{ type: "text", text: "drawer refused" }] },
    };
  } else {
    envelope = {
      jsonrpc: "2.0",
      id,
      result: { isError: false, content: [{ type: "text", text: "OK" }] },
    };
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(`${JSON.stringify(envelope)}\n`);
}

const options = parseOptions(process.argv.slice(2));

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const body = parseBody(Buffer.concat(chunks).toString("utf8"));
    const entry = {
      method: req.method ?? "",
      url: req.url ?? "",
      contentType: req.headers["content-type"] ?? null,
      authorization: req.headers.authorization ?? null,
      body,
    };
    appendFileSync(options.log, `${JSON.stringify(entry)}\n`);
    answer(res, options.mode, requestId(body));
  });
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  const staging = `${options.portFile}.tmp`;
  writeFileSync(staging, `${port}\n`);
  renameSync(staging, options.portFile);
});

function shutdown(): void {
  server.closeAllConnections();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
