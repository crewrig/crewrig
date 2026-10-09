// chroma-windows-pidfile.test.ts — the PID-file paths of the ChromaDB trio on a
// real Windows host (spec 0252 requirements 13 and 14), which no other CI leg
// reaches: `stop` against a PID file naming a live process TREE (the `endTree`
// of scripts/lib/service/chroma-state.ts) and `start` through the Windows launch
// branch of chroma-launch.ts. The start leg uses a compiled stand-in for
// `chroma.exe` (C#, built with the .NET Framework `csc.exe`) beside an interpreter
// file under a `Scripts` directory. The entry only needs that file to exist and
// the chroma binary beside it; it is never run. Skipped off win32.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { alive, freePort, measure, waitFor } from "./lib/windows-service-fixture.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const skip = process.platform !== "win32" && "Windows only";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-chroma-pid-"));
const killers: Array<() => void> = [];
after(() => {
  for (const k of killers) k();
  fs.rmSync(root, { recursive: true, force: true });
});

const entry = (name: string, home: string, port: number, extra: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [`scripts/${name}.ts`], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      MEMPALACE_CHROMA_HOST: "127.0.0.1",
      MEMPALACE_CHROMA_PORT: String(port),
      ...extra,
    },
  });

const pidFileOf = (home: string) => path.join(home, ".mempalace", "chroma-server.pid");

function kill(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
}

// A Node parent that spawns a Node child; both stay alive until killed.
const PARENT = `const { spawn } = require("child_process"), fs = require("fs");
const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(process.argv[1], JSON.stringify({ parent: process.pid, child: c.pid }));
setInterval(() => {}, 1000);
`;

test("stop: a PID file naming a live process tree ends parent and child", { skip }, async () => {
  const home = path.join(root, "home-stop");
  fs.mkdirSync(path.join(home, ".mempalace"), { recursive: true });
  const record = path.join(root, "tree.json");
  const parent = spawn(process.execPath, ["-e", PARENT, record], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  parent.unref();
  const tree = await waitFor<{ parent: number; child: number }>(
    "process tree record",
    () => {
      try {
        return JSON.parse(fs.readFileSync(record, "utf8")) as { parent: number; child: number };
      } catch {
        return null;
      }
    },
    30_000,
  );
  killers.push(() => {
    kill(tree.child);
    kill(tree.parent);
  });
  assert.equal(tree.parent, parent.pid);
  assert.equal(alive(tree.parent) && alive(tree.child), true, "the tree is up before the stop");
  fs.writeFileSync(pidFileOf(home), `${tree.parent}\n`);

  const stop = entry("stop-chroma-server", home, await freePort());
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  assert.match(stop.stdout, new RegExp(`chroma server force-stopped \\(was PID ${tree.parent}\\)`));
  assert.equal(fs.existsSync(pidFileOf(home)), false, "the PID file is removed");
  await waitFor("parent and child gone", () => !alive(tree.parent) && !alive(tree.child), 15_000);
});

const STAND_IN_SOURCE = `using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
class Chroma {
  static int Main(string[] a) {
    int port = 8001;
    for (int i = 0; i < a.Length - 1; i++) if (a[i] == "--port") port = int.Parse(a[i + 1]);
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    File.WriteAllText(Path.Combine(dir, "daemon.txt"),
      System.Diagnostics.Process.GetCurrentProcess().Id + " " + string.Join(" ", a));
    TcpListener l = new TcpListener(IPAddress.Loopback, port);
    l.Start();
    byte[] ok = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\n{}");
    byte[] no = Encoding.ASCII.GetBytes("HTTP/1.1 404 Not Found\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n");
    for (;;) {
      try {
        using (TcpClient c = l.AcceptTcpClient()) {
          NetworkStream s = c.GetStream();
          byte[] buf = new byte[2048];
          int n = s.Read(buf, 0, buf.Length);
          string req = Encoding.ASCII.GetString(buf, 0, n);
          byte[] reply = req.StartsWith("GET /api/v2/heartbeat") ? ok : no;
          s.Write(reply, 0, reply.Length);
        }
      } catch (Exception) { }
    }
  }
}
`;

function compileStandIn(exe: string): boolean {
  const csc = path.join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const src = path.join(path.dirname(exe), "chroma-stand-in.cs");
  fs.writeFileSync(src, STAND_IN_SOURCE);
  return fs.existsSync(csc) && spawnSync(csc, ["/nologo", `/out:${exe}`, src]).status === 0;
}

test(
  "start: the Windows launch branch starts chroma.exe, then status and stop",
  { skip },
  async (t) => {
    const home = path.join(root, "home-start");
    const scripts = path.join(home, "venv", "Scripts");
    fs.mkdirSync(scripts, { recursive: true });
    const exe = path.join(scripts, "chroma.exe");
    if (!compileStandIn(exe)) {
      measure("pidfile-start skipped csc-missing");
      t.skip("csc.exe unavailable");
      return;
    }
    // The entry never runs the interpreter on Windows; it only has to exist.
    const python = path.join(scripts, "python.exe");
    fs.writeFileSync(python, "not a real interpreter: the Windows launch never runs it\n");
    const port = await freePort();
    const env = { MEMPALACE_PYTHON: python };
    killers.push(() => {
      try {
        kill(Number(fs.readFileSync(pidFileOf(home), "utf8").trim()));
      } catch {
        /* no PID file */
      }
    });

    const start = entry("start-chroma-server", home, port, env);
    assert.equal(start.status, 0, start.stdout + start.stderr);
    assert.match(start.stdout, /chroma server started \(PID \d+, 127\.0\.0\.1:\d+\)/);
    const pid = Number(fs.readFileSync(pidFileOf(home), "utf8").trim());
    assert.ok(pid > 0, "the PID file names a pid");
    assert.equal(await heartbeat(port), true, "the heartbeat answers");
    assert.match(fs.readFileSync(path.join(scripts, "daemon.txt"), "utf8"), /--port \d+/);

    const status = entry("status-chroma-server", home, port, env);
    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.match(
      status.stdout,
      new RegExp(`chroma server: HEALTHY \\(PID ${pid}, 127\\.0\\.0\\.1:`),
    );

    const stop = entry("stop-chroma-server", home, port, env);
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.match(stop.stdout, new RegExp(`force-stopped \\(was PID ${pid}\\)`));
    assert.equal(fs.existsSync(pidFileOf(home)), false, "the PID file is removed");
    await waitFor("daemon gone", () => !alive(pid), 15_000);
  },
);

/** The ChromaDB heartbeat route, which `healthz` (a /healthz probe) does not cover. */
function heartbeat(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/api/v2/heartbeat`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.status === 200)
    .catch(() => false);
}
