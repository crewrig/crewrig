// setup-golden-daemon.ts — a loopback MemPalace MCP daemon stand-in for the TYPESCRIPT leg of the
// golden matrix (spec 0256 requirement 7, plan v2 step C4; delta-01 (o): the TypeScript setup
// probes the daemon with real HTTP, in-process; a request record replaces the stub's `curl` one).
//
// The shell leg is driven by a PATH stub `curl` (setup-stubs.ts, header "PROBE DECISION"); this
// server reproduces that stub's three modes so the TypeScript leg takes the same path:
//
//   probe 0  accept the real bearer: any non-empty bearer that is not the placeholder
//   probe 1  never accept: the server listens only to record the request and then drops the
//            connection (the stub printed 000, exit 7): the probe still fails, and the harness
//            still sees WHICH request the TypeScript setup made
//   probe 2  accept ONLY the placeholder bearer
//   GET  /healthz       200 unless probe 1 (the stub accepts every /healthz URL but in mode 1)
//   POST /mcp           `tools/list` answered 200 with a minimal body when the mode accepts the
//                       bearer, 401 otherwise
//
// Every request is RECORDED (method, url path, Host header, bearer class real / placeholder / none)
// and handed back by `requests()`: the harness maps the records onto the `curl` records the shell
// stub wrote and compares them (setup-golden-run.ts), so the in-process probe has no blanket
// exemption. The decision needs no token file: the stub never compared the bearer with the file either, only
// with the placeholder. The server runs in a child process because the sandbox run is synchronous
// (`spawnSync`), as the Chroma heartbeat does. It binds 127.0.0.1 only, on the cell's
// `MEMPALACE_MCP_PORT` when given, else on a free port: the golden suites of the four CLIs run in
// parallel, so the harness asks for port 0 and maps the real port back to the one the fixtures record.
// API: startGoldenDaemon(options) -> { port, stop(), requests() }.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { PLACEHOLDER_BEARER } from "./setup-stubs.ts";

/** The shell's default `MEMPALACE_MCP_PORT` (scripts/lib/common.sh), which the fixtures record. */
export const DEFAULT_MCP_PORT = "41893";

export interface GoldenDaemonOptions {
  /** The stub `curl` probe mode of the cell (default 0). */
  readonly probe?: 0 | 1 | 2;
  /** The cell's `MEMPALACE_MCP_PORT`, when it sets one. */
  readonly port?: string | undefined;
}

/** One request the stand-in received, as the child recorded it. */
export interface DaemonRequest {
  readonly method: string;
  /** The request target: `/mcp`, `/healthz`... */
  readonly path: string;
  /** The `Host` header (`127.0.0.1:41893`), empty when absent. */
  readonly host: string;
  /** `none` (no bearer), `placeholder` (the setup placeholder) or `real` (any other bearer). */
  readonly bearer: "none" | "placeholder" | "real";
}

export interface GoldenDaemon {
  readonly port: number;
  stop(): void;
  /** Stop the server and return every request it received, oldest first. */
  requests(): Promise<readonly DaemonRequest[]>;
}

/** The child's program: argv = [port, mode, placeholder]; prints the bound port once listening, then one `REQ <json>` line per request. */
const SERVER = `
const http = require("node:http");
const [port, mode, placeholder] = process.argv.slice(1);
const accepts = (bearer) =>
  mode === "2" ? bearer === placeholder : bearer !== "" && bearer !== placeholder;
const fs = require("node:fs");
const server = http.createServer((req, res) => {
  const m = /^Bearer (.*)$/.exec(String(req.headers.authorization ?? ""));
  const bearer = m === null ? "" : m[1].trim();
  fs.writeSync(1, "REQ " + JSON.stringify({
    method: req.method,
    path: req.url,
    host: String(req.headers.host ?? ""),
    bearer: bearer === "" ? "none" : bearer === placeholder ? "placeholder" : "real",
  }) + "\\n");
  if (mode === "1") return void req.socket.destroy();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
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
let told = false;
const announce = () => { if (!told) { told = true; fs.writeSync(1, server.address().port + "\\n"); } };
server.once("error", () => server.listen(0, "127.0.0.1", announce));
server.listen(Number(port), "127.0.0.1", announce);
`;

const isBearer = (value: unknown): value is DaemonRequest["bearer"] =>
  value === "none" || value === "placeholder" || value === "real";

/** The `REQ <json>` lines of the child's output, in order. */
function parseRequests(output: string): DaemonRequest[] {
  const out: DaemonRequest[] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("REQ ")) continue;
    const raw: unknown = JSON.parse(line.slice(4));
    const field = (key: string): unknown =>
      typeof raw === "object" && raw !== null ? Reflect.get(raw, key) : undefined;
    const bearer = field("bearer");
    out.push({
      method: String(field("method")),
      path: String(field("path")),
      host: String(field("host")),
      bearer: isBearer(bearer) ? bearer : "real",
    });
  }
  return out;
}

/** Collect the child's whole output; resolves with it once the child has exited. */
const outputOf = (child: ChildProcess): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (c: Buffer) => chunks.push(c));
    child.once("close", () => resolve(Buffer.concat(chunks).toString()));
  });

/**
 * Start the stand-in for a cell. In probe 1 it listens too, only to record and drop. When the
 * wanted port is taken the server falls back to a free port and the caller must read `port` back.
 */
export async function startGoldenDaemon(options: GoldenDaemonOptions = {}): Promise<GoldenDaemon> {
  const probe = options.probe ?? 0;
  const wanted = /^\d+$/.test(options.port ?? "") ? (options.port as string) : DEFAULT_MCP_PORT;
  const child = spawn(process.execPath, ["-e", SERVER, wanted, String(probe), PLACEHOLDER_BEARER], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const output = outputOf(child);
  const port = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().split("\n")[0])));
  });
  return {
    port,
    stop: () => void child.kill(),
    requests: async () => {
      child.kill();
      return parseRequests(await output);
    },
  };
}
