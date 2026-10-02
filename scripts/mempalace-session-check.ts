// mempalace-session-check.ts — the MemPalace session-start check (spec 0246,
// amended by delta-01; plan v4 step 4, issue #1410).
//
//   node --no-warnings mempalace-session-check.ts <cli> [--platform <p>]
//
// <cli> is claude, gemini, copilot or antigravity. `--platform` exists for
// tests only. Setup installs this file and lib/ into
// ~/.crewrig/hooks/session-check/ and registers it as a session-start hook
// (on Antigravity CLI, `PreInvocation` behind the throttle). When the
// installed daemon is serving and this CLI is not registered against it, the
// check prints one warning on the channels that CLI offers; otherwise it
// prints nothing.
//
// It always exits 0 (R9), within 2 s: a deadline armed from process start
// self-kills with SIGKILL, and the hook command's trailing `exit 0` turns that
// into a success status. It spawns no child process at all, so `jq` and every
// assistant CLI are excluded by construction (R4, R10). It never reads the
// bearer token, and its one network request is an unauthenticated loopback
// probe bounded to 1 s (R2, R10).

import http from "node:http";
import os from "node:os";
import {
  claimThrottle,
  payloadKey,
  readPayload,
  readRegular,
} from "./lib/session-check-throttle.ts";

// Armed first: everything above this line is module loading. The timer is
// cleared before stdout is written, so a self-kill never truncates the JSON.
const DEADLINE_MS = 1900;
const deadline = setTimeout(
  () => process.kill(process.pid, "SIGKILL"),
  Math.max(0, DEADLINE_MS - performance.now()),
);
// R9: no path ends in a failure status or a stack trace, a closed stdout
// included.
process.on("uncaughtException", () => process.exit(0));
process.stdout.on("error", () => process.exit(0));

const PROBE_TIMEOUT_MS = 1000;
const MAX_PROBE_BODY = 1024 * 1024;
const MAX_LAUNCHER_BYTES = 1024 * 1024;
const NODE_FLOOR = 24;

/** A JSON-RPC 2.0 answer that carries a `result`, as JSON or as SSE events. */
function carriesResult(body: string): boolean {
  const isResult = (v: unknown): boolean =>
    typeof v === "object" &&
    v !== null &&
    Object.hasOwn(v, "result") &&
    (v as { jsonrpc?: unknown }).jsonrpc === "2.0";
  const candidates = [
    body,
    ...body.split(/\r?\n/).flatMap((l) => (l.startsWith("data:") ? [l.slice(5)] : [])),
  ];
  for (const text of candidates) {
    try {
      const value: unknown = JSON.parse(text);
      if (Array.isArray(value) ? value.some(isResult) : isResult(value)) return true;
    } catch {
      // not JSON: try the next candidate
    }
  }
  return false;
}

/**
 * R2: serving means an authentication refusal (401) or a 2xx JSON-RPC answer
 * from POST /mcp, sent without any credential. Anything else, a refused
 * connection or no answer within 1 s, is "not serving".
 */
function probeServing(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    let settled = false;
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (serving: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(serving);
    };
    const req = http.request(
      {
        host: host.replace(/^\[(.*)\]$/, "$1"),
        port,
        method: "POST",
        path: "/mcp",
        // A private agent: never the global one, which an environment proxy
        // setting could route off the machine.
        agent: new http.Agent({ keepAlive: false }),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status === 401) return done(true);
        if (status < 200 || status > 299) return done(false);
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PROBE_BODY) return done(false);
          chunks.push(chunk);
          if (carriesResult(Buffer.concat(chunks).toString("utf8"))) done(true);
        });
        res.on("end", () => done(carriesResult(Buffer.concat(chunks).toString("utf8"))));
        res.on("error", () => done(false));
      },
    );
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    req.on("error", () => done(false));
    req.end(body);
  });
}

function parseArgs(argv: readonly string[]): { cli: string; platform: string } {
  let platform: string = process.platform;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--platform") platform = argv[++i] ?? "";
    else rest.push(arg);
  }
  return { cli: rest[0] ?? "", platform };
}

/** The hook's stdout: one JSON object, or "" for silence. */
async function main(argv: readonly string[]): Promise<string> {
  const { cli, platform } = parseArgs(argv);
  if (Number(process.versions.node.split(".")[0]) < NODE_FLOOR) return "";
  // R6: no daemon supervisor this framework installs on any other platform.
  if (platform !== "darwin" && platform !== "linux") return "";
  const home =
    process.env.HOME !== undefined && process.env.HOME !== "" ? process.env.HOME : os.homedir();
  if (home === "") return "";

  if (cli === "antigravity") {
    // R8 guarded path: the payload and the state file, nothing else.
    const key = payloadKey(await readPayload(process.stdin));
    if (!(await claimThrottle(home, key, Date.now()))) return "";
  }

  const reg = await import("./lib/mempalace-registration.ts");
  if (!reg.isCli(cli)) return "";

  // R1: no readable launcher means no installed daemon, and no request.
  const launcher = await readRegular(reg.launcherPath(process.env, home), MAX_LAUNCHER_BYTES);
  if (launcher.kind !== "ok") return "";
  const endpoint = reg.parseLauncher(Buffer.from(launcher.bytes).toString("utf8"));
  if (endpoint === null) return "";

  // R10 allows a loopback request only; a launcher recording any other host
  // gets no probe and therefore counts as not serving.
  const serving = endpoint.loopback ? await probeServing(endpoint.host, endpoint.port) : false;

  const file = reg.configPath(cli, home);
  const classification = reg.classifyFile(await readRegular(file), endpoint.url, cli);
  const warning = reg.warningFor(cli, classification, {
    serving,
    expected: endpoint.url,
    config: reg.displayPath(file, home),
  });
  return reg.render(cli, warning);
}

function finish(output: string): void {
  clearTimeout(deadline);
  if (output === "") process.exit(0);
  process.stdout.write(output, () => process.exit(0));
}

main(process.argv.slice(2)).then(finish, () => finish(""));
