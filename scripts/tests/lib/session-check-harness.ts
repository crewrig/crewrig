// session-check-harness.ts — the hermetic harness shared by every spec 0246
// test (issue #1410, plan v4 step 8, v3-F4, #1456).
//
// Isolation contract, applied by every helper below:
//   - a scratch HOME and a scratch CLAUDE_CONFIG_DIR under os.tmpdir(), never the
//     operator's own (#1456: a test run against the real HOME deleted a live
//     `mempalace` registration);
//   - the child environment is BUILT, never inherited: no MEMPALACE_*, no token,
//     no operator PATH entry ahead of the stubs;
//   - recording `claude`, `gemini`, `copilot` and `agy` stubs first on PATH. Each
//     logs its argv to a file and exits 1. `assertNoCliInvoked` is R10's
//     "SHALL NOT invoke any assistant CLI" evidence, and the stubs keep
//     `mcp_assistant_arrangement claude` from returning `absent`;
//   - a fake MCP endpoint on 127.0.0.1:0; a fixture launcher records ITS port, so
//     nothing ever falls back to the live daemon on 127.0.0.1:41893 (R16).

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const COMMON_SH = path.join(REPO, "scripts", "lib", "common.sh");
export const OPTIN_SH = path.join(REPO, "scripts", "lib", "usage-capture-optin.sh");
export const CHECK_TS = path.join(REPO, "scripts", "mempalace-session-check.ts");
export const WRITER_TS = path.join(REPO, "scripts", "session-check-hooks.ts");
export const REGISTRATION_TS = path.join(REPO, "scripts", "lib", "mempalace-registration.ts");
export const THROTTLE_TS = path.join(REPO, "scripts", "lib", "session-check-throttle.ts");
export const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "session-check");

export const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;
export type Cli = (typeof CLIS)[number];
export const STUB_CLIS = ["claude", "gemini", "copilot", "agy"] as const;

/** The PID the stubbed supervisor and listener probes both report. */
export const STATUS_PROBE_PID = 4242;

/** The live daemon's port. No test may ever address it (R16). */
export const LIVE_PORT = 41893;

/** Planted in the token file and in every fixture header; must never surface (R10). */
export const SENTINEL = "SENTINEL-0246-d2f7c1b9e4a8";

/** User-level registration file of each CLI, relative to HOME (common.sh:1492-1500). */
export const CONFIG_REL: Record<Cli, string> = {
  claude: ".claude.json",
  gemini: path.join(".gemini", "settings.json"),
  copilot: path.join(".copilot", "mcp-config.json"),
  antigravity: path.join(".gemini", "config", "mcp_config.json"),
};

/** The setup script each CLI's missing-file warning must name (R5). */
export const SETUP_SCRIPT: Record<Cli, string> = {
  claude: "scripts/setup-claude-interactive.sh",
  gemini: "scripts/setup-gemini-interactive.sh",
  copilot: "scripts/setup-copilot-interactive.sh",
  antigravity: "scripts/setup-antigravity-interactive.sh",
};

/** Directory holding a binary found on the parent's PATH, or null. */
function whichDir(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return dir;
    } catch {
      // not here
    }
  }
  return null;
}

/**
 * Every distinct jq binary to run the shell reader under, by ABSOLUTE path:
 * the macOS system one and Homebrew's, plus whatever the runner's PATH holds
 * (CI). Their directories never reach a child's PATH: each sandbox links the
 * selected binary into a private tool directory (`Sandbox.pathWithJq`), so
 * nothing else in /opt/homebrew/bin can shadow a system tool.
 */
export const JQ_BINARIES: readonly string[] = (() => {
  const found = whichDir("jq");
  const candidates = [
    "/usr/bin/jq",
    "/opt/homebrew/bin/jq",
    ...(found === null ? [] : [path.join(found, "jq")]),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const bin of candidates) {
    let real: string;
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      real = fs.realpathSync(bin);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(bin);
  }
  return out;
})();

/** The jq the other shell-side tests run under. */
export const DEFAULT_JQ: string | null = JQ_BINARIES[0] ?? null;

const temps: string[] = [];
process.on("exit", () => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

export function mkTemp(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

export interface Sandbox {
  root: string;
  home: string;
  claudeConfigDir: string;
  stubBin: string;
  stubLog: string;
  /** Argv log of the stubbed launchctl / lsof / systemctl / ss probes. */
  probeLog: string;
  /** The child environment: built from nothing, plus `extra`. */
  env(extra?: Record<string, string>): Record<string, string>;
  /** Absolute path of a CLI's registration file in this HOME. */
  config(cli: Cli): string;
  /** A child PATH whose only jq is `jqBin` (absolute), linked into a private directory. */
  pathWithJq(jqBin: string): string;
}

const SYSTEM_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function makeSandbox(prefix = "sc0246-"): Sandbox {
  const root = mkTemp(prefix);
  const home = path.join(root, "home");
  const claudeConfigDir = path.join(root, "claude-config");
  const stubBin = path.join(root, "stub-bin");
  const stubLog = path.join(root, "stub-cli.log");
  const probeLog = path.join(root, "status-probes.log");
  for (const dir of [home, claudeConfigDir, stubBin]) fs.mkdirSync(dir, { recursive: true });
  // The supervisor and listener probes of mcp_supervisor_pid / mcp_listener_pid
  // (common.sh), stubbed so no test reads the live machine's launchd, systemd or
  // sockets. Each logs its argv and reports the one PID, STATUS_PROBE_PID.
  const probe = (body: string): string =>
    `#!/bin/sh\nprintf '%s %s\\n' "$(basename "$0")" "$*" >> ${JSON.stringify(probeLog)}\n${body}\n`;
  const probes: Record<string, string> = {
    launchctl: `printf '\\tstate = running\\n\\tpid = %s\\n' ${STATUS_PROBE_PID}`,
    lsof: `printf '%s\\n' ${STATUS_PROBE_PID}`,
    systemctl: `printf '%s\\n' ${STATUS_PROBE_PID}`,
    ss: `printf 'LISTEN 0 128 127.0.0.1:1 0.0.0.0:* users:(("python3",pid=%s,fd=3))\\n' ${STATUS_PROBE_PID}`,
  };
  for (const [name, body] of Object.entries(probes)) {
    fs.writeFileSync(path.join(stubBin, name), probe(body), { mode: 0o755 });
  }
  for (const name of STUB_CLIS) {
    const stub = path.join(stubBin, name);
    fs.writeFileSync(
      stub,
      `#!/bin/sh\nprintf '%s %s\\n' ${JSON.stringify(name)} "$*" >> ${JSON.stringify(stubLog)}\nexit 1\n`,
      { mode: 0o755 },
    );
  }
  // Tools by absolute path, linked into private directories: node (the running
  // one) and jq. No operator directory such as /opt/homebrew/bin is on PATH.
  let tools = 0;
  const toolDir = (links: Record<string, string>): string => {
    const dir = path.join(root, `tools-${tools++}`);
    fs.mkdirSync(dir);
    for (const [name, target] of Object.entries(links))
      fs.symlinkSync(target, path.join(dir, name));
    return dir;
  };
  const pathWithJq = (jqBin: string): string =>
    [stubBin, toolDir({ node: process.execPath, jq: jqBin }), ...SYSTEM_DIRS].join(path.delimiter);
  const basePath =
    DEFAULT_JQ === null
      ? [stubBin, toolDir({ node: process.execPath }), ...SYSTEM_DIRS].join(path.delimiter)
      : pathWithJq(DEFAULT_JQ);
  return {
    root,
    home,
    claudeConfigDir,
    stubBin,
    stubLog,
    probeLog,
    env(extra = {}) {
      return {
        HOME: home,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        PATH: basePath,
        TMPDIR: os.tmpdir(),
        LC_ALL: "C",
        ...extra,
      };
    },
    config(cli) {
      return path.join(home, CONFIG_REL[cli]);
    },
    pathWithJq,
  };
}

/** R10: no assistant CLI was invoked. Every test calls it once at the end. */
export function assertNoCliInvoked(sb: Sandbox): void {
  const log = fs.existsSync(sb.stubLog) ? fs.readFileSync(sb.stubLog, "utf8") : "";
  assert.equal(log, "", `an assistant CLI stub was invoked:\n${log}`);
}

// --- fake MCP endpoint ------------------------------------------------------

export type ServerMode =
  /** 401 on POST /mcp, 200 on /healthz: a serving, authenticated daemon. */
  | "auth-refusal"
  /** 200 with a JSON-RPC result on POST /mcp. */
  | "mcp-result"
  /** 200 on /healthz, 404 on everything else: a stale process (R2). */
  | "healthz-only"
  /** accepts the connection and never answers. */
  | "hang";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeServer {
  port: number;
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeServer(mode: ServerMode): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (mode === "hang") return;
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      } else if (mode === "auth-refusal" && req.url === "/mcp") {
        res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
      } else if (mode === "mcp-result" && req.url === "/mcp") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
      } else {
        res.writeHead(404).end();
      }
    });
  });
  server.on("connection", (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  assert.notEqual(port, LIVE_PORT);
  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    close() {
      for (const s of sockets) s.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A loopback port with nothing listening (connection refused). */
export async function refusedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// --- fixture machine state ----------------------------------------------------

export function launcherPath(sb: Sandbox): string {
  return path.join(sb.home, ".crewrig", "mcp-daemon-launcher.sh");
}

/** A materialised launcher recording host/port, as install_mcp_launcher writes it. */
export function writeLauncher(sb: Sandbox, port: number, host = "127.0.0.1"): string {
  assert.notEqual(port, LIVE_PORT, "a fixture launcher must never record the live port");
  const file = launcherPath(sb);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "#!/usr/bin/env bash",
      "set -u",
      `CREWRIG_REPO_DIR="${REPO}"`,
      `MCP_HOST="${host}"`,
      `MCP_PORT="${port}"`,
      'CHROMA_HOST="127.0.0.1"',
      'CHROMA_PORT="8001"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return file;
}

export function writeFileDeep(file: string, data: string | Buffer, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode });
}

/** A correct HTTP `mempalace` entry in the CLI's own shape (R3), carrying the sentinel. */
export function httpEntry(
  cli: Cli,
  url: string,
  key: "url" | "serverUrl" = cli === "antigravity" ? "serverUrl" : "url",
): Record<string, unknown> {
  const headers = { Authorization: `Bearer ${SENTINEL}` };
  if (key === "serverUrl") return { serverUrl: url, headers };
  return { type: "http", url, headers };
}

export function stdioEntry(): Record<string, unknown> {
  return {
    command: "/usr/bin/python3",
    args: ["-m", "mempalace.mcp_server"],
    env: { MEMPALACE_TOKEN: SENTINEL },
  };
}

/** Writes `{"mcpServers": {"mempalace": entry}}` (or the raw text) to the CLI's config. */
export function writeConfig(sb: Sandbox, cli: Cli, content: unknown): string {
  const file = sb.config(cli);
  const text =
    typeof content === "string" || Buffer.isBuffer(content)
      ? content
      : JSON.stringify(content, null, 2) + "\n";
  writeFileDeep(file, text);
  return file;
}

/** Plants the sentinel in the token file mcp_token_path computes for this HOME. */
export function plantToken(sb: Sandbox): string {
  const r = spawnSync("bash", ["-c", `. ${shq(COMMON_SH)}; mcp_token_path`], {
    env: sb.env(),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const file = r.stdout.trim();
  assert.ok(file.startsWith(sb.home), `token path ${file} escapes the sandbox`);
  writeFileDeep(file, SENTINEL + "\n");
  return file;
}

// --- running things -----------------------------------------------------------

export interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Spawns asynchronously, so an in-process fake server keeps answering. */
export function run(
  cmd: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    input?: string;
    cwd?: string;
    timeoutMs?: number;
    keepStdinOpen?: boolean;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(cmd, args, {
      env: opts.env,
      cwd: opts.cwd ?? os.tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 15_000);
    child.on("error", reject);
    child.on("close", (status, signal) => {
      clearTimeout(killer);
      child.stdin.destroy();
      resolve({ status, signal, stdout, stderr, ms: performance.now() - started });
    });
    child.stdin.on("error", () => {});
    // A CLI may keep the hook's stdin open after writing the payload.
    if (opts.keepStdinOpen === true) child.stdin.write(opts.input ?? "");
    else child.stdin.end(opts.input ?? "");
  });
}

export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The hook command of plan v4 *Contracts*, materialised for `checkFile`.
 * `nodeBin` defaults to the running Node, as the writer records it at setup.
 */
export function hookCommand(
  checkFile: string,
  cli: Cli,
  nodeBin = process.execPath,
  extraArgs = "",
): string {
  return (
    `{ N=${dq(nodeBin)}; command -v "$N" >/dev/null 2>&1 || N=node; F=${dq(checkFile)}; ` +
    `[ -f "$F" ] && command -v "$N" >/dev/null 2>&1 && "$N" --no-warnings "$F" ${cli}${extraArgs}; } 2>/dev/null; exit 0`
  );
}

function dq(s: string): string {
  assert.ok(!/["$`\\\n]/.test(s), `path not safely double-quotable: ${s}`);
  return `"${s}"`;
}

/** Runs the check through `sh -c` on the hook command, as a CLI does. */
export function runCheck(
  sb: Sandbox,
  cli: Cli,
  opts: {
    input?: string;
    env?: Record<string, string>;
    checkFile?: string;
    nodeBin?: string;
    extraArgs?: string;
    keepStdinOpen?: boolean;
  } = {},
): Promise<RunResult> {
  return run(
    "sh",
    ["-c", hookCommand(opts.checkFile ?? CHECK_TS, cli, opts.nodeBin, opts.extraArgs)],
    {
      env: sb.env(opts.env),
      input: opts.input,
      keepStdinOpen: opts.keepStdinOpen,
    },
  );
}

/** Creates a FIFO (Node has no mkfifo). */
export function mkfifo(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync("mkfifo", [file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

/** Sources common.sh (and optionally the opt-in library) in a sandboxed bash. */
export function bashLib(
  sb: Sandbox,
  script: string,
  opts: { env?: Record<string, string>; optin?: boolean } = {},
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const prelude =
    `INSTALL_MODE=copy; CREWRIG_REPO_DIR=${shq(REPO)}; . ${shq(COMMON_SH)}; ` +
    (opts.optin ? `. ${shq(OPTIN_SH)}; ` : "");
  return spawnSync("bash", ["-c", prelude + script], {
    env: sb.env(opts.env),
    encoding: "utf8",
    cwd: sb.root,
  }) as ReturnType<typeof spawnSync> & { stdout: string; stderr: string };
}

/**
 * The warning a check run emitted, read from whichever channel carries it
 * (plan v4 *Output per CLI*, `injectSteps` included), or null when stdout is empty (silence, R6).
 */
export function emittedWarning(stdout: string): string | null {
  if (stdout.trim() === "") return null;
  const out = JSON.parse(stdout) as Record<string, unknown>;
  const texts = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") texts.add(v);
    else if (v !== null && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(out.systemMessage);
  walk(out.additionalContext);
  const hso = out.hookSpecificOutput as Record<string, unknown> | undefined;
  if (hso !== undefined) walk(hso.additionalContext);
  // Antigravity CLI: `injectSteps[].ephemeralMessage` (PreInvocation).
  walk(out.injectSteps);
  assert.equal(
    texts.size,
    1,
    `expected one warning text on every channel, got ${JSON.stringify(out)}`,
  );
  return [...texts][0] as string;
}

/** Every file under `dir`, recursively (for the sentinel sweep). */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * status-mcp-server.sh ran against the stubbed probes only: the owner line is
 * VERIFIED for STATUS_PROBE_PID, and the listener lookup asked about `port`.
 */
export function assertStatusProbesStubbed(sb: Sandbox, stdout: string, port: number): void {
  assert.match(stdout, new RegExp(`owner: +VERIFIED \\(listener PID ${STATUS_PROBE_PID} `), stdout);
  assert.ok(!stdout.includes("USURPED"), stdout);
  const calls = fs.existsSync(sb.probeLog) ? fs.readFileSync(sb.probeLog, "utf8") : "";
  assert.match(calls, /^(launchctl print gui\/\d+\/|systemctl --user show -p MainPID)/m, calls);
  assert.match(calls, new RegExp(`^(lsof .*-iTCP:${port} |ss .*sport = :${port})`, "m"), calls);
}
