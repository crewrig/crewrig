// setup-golden-daemon.ts — a loopback MemPalace MCP daemon stand-in for the TYPESCRIPT leg of the
// golden matrix (spec 0256 requirement 7, plan v2 step C4; deviation (l) of requirement 44: the
// TypeScript setup probes the daemon with real HTTP, in-process).
//
// The shell leg is driven by a PATH stub `curl` (setup-stubs.ts, header "PROBE DECISION"); this
// server reproduces that stub's three modes so the TypeScript leg takes the same path:
//
//   probe 0  accept the real bearer: any non-empty bearer that is not the placeholder
//   probe 1  never accept: the server does not listen at all (the stub printed 000, exit 7)
//   probe 2  accept ONLY the placeholder bearer
//   GET  /healthz       200 unless probe 1 (the stub accepts every /healthz URL but in mode 1)
//   POST /mcp           `tools/list` answered 200 with a minimal body when the mode accepts the
//                       bearer, 401 otherwise
//
// The decision needs no token file: the stub never compared the bearer with the file either, only
// with the placeholder. The server runs in a child process because the sandbox run is synchronous
// (`spawnSync`), as the Chroma heartbeat does. It binds 127.0.0.1 only, on the cell's
// `MEMPALACE_MCP_PORT`, else on the shell's default port (so the endpoint the setup writes into
// the assistant configuration is the one the shell fixtures record), else on a free port.
// API: startGoldenDaemon(options) -> { port, stop() } | undefined (probe 1: nothing listens).

import { spawn } from "node:child_process";

import { PLACEHOLDER_BEARER } from "./setup-stubs.ts";

/** The shell's default `MEMPALACE_MCP_PORT` (scripts/lib/common.sh), which the fixtures record. */
export const DEFAULT_MCP_PORT = "41893";

export interface GoldenDaemonOptions {
  /** The stub `curl` probe mode of the cell (default 0). */
  readonly probe?: 0 | 1 | 2;
  /** The cell's `MEMPALACE_MCP_PORT`, when it sets one. */
  readonly port?: string | undefined;
}

export interface GoldenDaemon {
  readonly port: number;
  stop(): void;
}

/** The child's program: argv = [port, mode, placeholder]; prints the bound port once listening. */
const SERVER = `
const http = require("node:http");
const [port, mode, placeholder] = process.argv.slice(1);
const accepts = (bearer) =>
  mode === "2" ? bearer === placeholder : bearer !== "" && bearer !== placeholder;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const m = /^Bearer (.*)$/.exec(String(req.headers.authorization ?? ""));
    const bearer = m === null ? "" : m[1].trim();
    if (req.method === "GET" && req.url === "/healthz") {
      res.statusCode = 200;
      res.end("ok");
    } else if (req.method === "POST" && req.url === "/mcp" && accepts(bearer)) {
      let id = 1;
      try { id = JSON.parse(Buffer.concat(chunks).toString()).id ?? 1; } catch {}
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }));
    } else {
      res.statusCode = req.url === "/mcp" ? 401 : 404;
      res.end("");
    }
  });
});
const announce = () => console.log(server.address().port);
server.once("error", () => server.listen(0, "127.0.0.1", announce));
server.listen(Number(port), "127.0.0.1", announce);
`;

/**
 * Start the stand-in for a cell; `undefined` in probe 1 (nothing listens). When the wanted port is
 * taken the server falls back to a free port and the caller must read `port` back.
 */
export async function startGoldenDaemon(
  options: GoldenDaemonOptions = {},
): Promise<GoldenDaemon | undefined> {
  const probe = options.probe ?? 0;
  if (probe === 1) return undefined;
  const wanted = /^\d+$/.test(options.port ?? "") ? (options.port as string) : DEFAULT_MCP_PORT;
  const child = spawn(process.execPath, ["-e", SERVER, wanted, String(probe), PLACEHOLDER_BEARER], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
  });
  return { port, stop: () => void child.kill() };
}
