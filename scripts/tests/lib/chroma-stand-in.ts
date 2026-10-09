// chroma-stand-in.ts — the fixtures of scripts/tests/chroma-lifecycle.test.ts and
// chroma-launch.test.ts: an isolated HOME, a stub interpreter standing in for
// MEMPALACE_PYTHON (a wrapper around the host python3), and its sibling `chroma`
// stand-in, which serves the heartbeat on the requested port and records its pid
// and argv. CHROMA_STUB_MODE selects `die` (exits 3 at once), `ignore-term`
// (ignores SIGTERM), `silent` (never serves the heartbeat) or the default.

import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

const CHROMA = `import http.server, json, os, signal, sys, time
a = sys.argv
mode = os.environ.get("CHROMA_STUB_MODE", "")
d = os.environ["CHROMA_STUB_DIR"]
if mode == "die":
    sys.stderr.write("stand-in: dying at startup\\n")
    sys.exit(3)
if mode == "ignore-term":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
try:
    import resource
    soft = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
except ImportError:
    soft = None
open(os.path.join(d, "daemon.json"), "w").write(json.dumps({"pid": os.getpid(), "argv": a[1:], "nofile": soft}))
print("stand-in started", flush=True)
if mode == "silent":
    while True:
        time.sleep(1)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/api/v2/heartbeat" else 404)
        self.end_headers()
        self.wfile.write(b"{}")
    def log_message(self, *x):
        pass
http.server.HTTPServer((a[a.index("--host") + 1], int(a[a.index("--port") + 1])), H).serve_forever()
`;

/** The host python3 (an absolute path), or null when none is on PATH. */
export function hostPython(): string | null {
  const r = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export interface Sandbox {
  readonly home: string;
  readonly bin: string;
  readonly python: string;
  readonly port: number;
  readonly env: NodeJS.ProcessEnv;
  readonly pidFile: string;
  readonly cleanups: Array<() => void>;
}

/** An isolated HOME and a stub interpreter dir; `withChroma` adds the sibling `chroma` stand-in. */
export async function makeSandbox(withChroma = true, python = hostPython()): Promise<Sandbox> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-chroma-"));
  const bin = path.join(home, "venv-bin");
  fs.mkdirSync(bin);
  const stub = path.join(bin, "python");
  if (python !== null && process.platform !== "win32") {
    fs.writeFileSync(stub, `#!/bin/sh\nexec "${python}" "$@"\n`, { mode: 0o755 });
  }
  if (withChroma) fs.writeFileSync(path.join(bin, "chroma"), CHROMA, { mode: 0o755 });
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    MEMPALACE_PYTHON: stub,
    MEMPALACE_CHROMA_HOST: "127.0.0.1",
    MEMPALACE_CHROMA_PORT: String(port),
    CHROMA_STUB_DIR: home,
  };
  for (const k of ["MEMPALACE_PALACE_PATH", "MEMPALACE_CHROMA_ULIMIT_FLOOR", "CHROMA_STUB_MODE"])
    delete env[k];
  const pidFile = path.join(home, ".mempalace", "chroma-server.pid");
  return { home, bin, python: stub, port, env, pidFile, cleanups: [] };
}

export function dispose(s: Sandbox): void {
  for (const c of s.cleanups) c();
  for (const f of [s.pidFile, path.join(s.home, "daemon.json")]) {
    try {
      const raw = fs.readFileSync(f, "utf8");
      const pid = Number(f.endsWith(".json") ? JSON.parse(raw).pid : raw.trim());
      if (pid > 0) process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(s.home, { recursive: true, force: true });
}

export function daemonRecord(s: Sandbox): { pid: number; argv: string[]; nofile: number | null } {
  return JSON.parse(fs.readFileSync(path.join(s.home, "daemon.json"), "utf8"));
}

/**
 * A loopback server answering the ChromaDB heartbeat (a supervisor-managed daemon).
 * It runs in its own process: the runs under test are synchronous and would starve
 * an in-process server.
 */
export function heartbeatStub(s: Sandbox): Promise<void> {
  const code = `require("http").createServer((q, r) => { r.statusCode = q.url === "/api/v2/heartbeat" ? 200 : 404; r.end("{}"); }).listen(${s.port}, "127.0.0.1", () => console.log("up"));`;
  const c = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "ignore"] });
  s.cleanups.push(() => c.kill("SIGKILL"));
  return new Promise((resolve) => c.stdout?.once("data", () => resolve()));
}

/** A live process that is not a daemon, to put its pid in the PID file. */
export function sleeper(s: Sandbox): ChildProcess {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  s.cleanups.push(() => c.kill("SIGKILL"));
  return c;
}

/** A pid that is certainly dead. */
export function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid;
}

export function writePidFile(s: Sandbox, pid: number): void {
  fs.mkdirSync(path.dirname(s.pidFile), { recursive: true });
  fs.writeFileSync(s.pidFile, `${pid}\n`);
}

export type Entry = (name: string) => readonly [string, string[]];

export function run(
  entry: Entry,
  name: string,
  s: Sandbox,
  extra: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  const [cmd, args] = entry(name);
  return spawnSync(cmd, args, {
    cwd: REPO,
    env: { ...s.env, ...extra },
    encoding: "utf8",
    timeout: 60_000,
  });
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
