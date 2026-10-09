// mcp-launcher-lifecycle.test.ts — the installed MCP launcher under a model
// of Restart=always / KeepAlive, with real processes and short injected delays
// (spec 0252 requirement 11; plan v3 D6 cases 1 to 6). POSIX only.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  alive,
  renderPrograms,
  sleep,
  StandInSupervisor,
  until,
  type Installed,
} from "./lib/supervisor-stand-in.ts";

const skip = process.platform === "win32" ? "POSIX only" : false;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-lifecycle-"));
let installed: Installed;
let chroma: http.Server;
let env: NodeJS.ProcessEnv;
const running: StandInSupervisor[] = [];

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

before(async () => {
  if (skip) return;
  chroma = http.createServer((_req, res) => res.end("{}"));
  await new Promise<void>((r) => chroma.listen(0, "127.0.0.1", r));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const tokenFile = path.join(root, "token");
  fs.writeFileSync(tokenFile, "t".repeat(40));
  installed = renderPrograms(path.join(root, "installed"), {
    repoDir: path.join(root, "repo"),
    host: "127.0.0.1",
    port: String(await freePort()),
    chromaHost: "127.0.0.1",
    chromaPort: String((chroma.address() as net.AddressInfo).port),
    python: process.execPath,
  });
  env = {
    PATH: process.env.PATH,
    HOME: home,
    MEMPALACE_MCP_TOKEN_FILE: tokenFile,
    MEMPALACE_MCP_CHROMA_WAIT: "5",
    MEMPALACE_LAUNCHER_KILL_AFTER_MS: "600",
  };
});

after(() => {
  for (const s of running) s.dispose();
  chroma?.close();
});

function supervise(mode: string): { sup: StandInSupervisor; pidFile: string } {
  const pidFile = path.join(root, `pid-${running.length}`);
  const sup = new StandInSupervisor(
    [process.execPath, installed.launcher],
    { ...env, STANDIN_MODE: mode, STANDIN_PID_FILE: pidFile },
    100,
  );
  running.push(sup);
  sup.start();
  return { sup, pidFile };
}

async function daemonPid(pidFile: string): Promise<number> {
  await until(
    () => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8") !== "",
    15_000,
    "the daemon pid",
  );
  return Number(fs.readFileSync(pidFile, "utf8"));
}

test(
  "1: a child that exits 0 ends the launcher non-zero, and the supervisor restarts once",
  { skip },
  async () => {
    const { sup } = supervise("exit0");
    await until(() => sup.startCount >= 2, 15_000, "a restart");
    assert.equal(sup.history[0]?.code, 1);
    sup.dispose();
  },
);

test("2: a child that exits 3 gives 3", { skip }, async () => {
  const { sup } = supervise("exit3");
  await until(() => sup.history.length >= 1, 15_000, "the launcher to end");
  assert.equal(sup.history[0]?.code, 3);
  sup.dispose();
});

test("3: a child SIGKILLed from outside ends the launcher non-zero", { skip }, async () => {
  const { sup, pidFile } = supervise("run");
  process.kill(await daemonPid(pidFile), "SIGKILL");
  await until(() => sup.history.length >= 1, 15_000, "the launcher to end");
  assert.equal(sup.history[0]?.code, 137);
  sup.dispose();
});

for (const style of ["systemd", "launchd"] as const) {
  test(`${style} stop: launcher and child gone, no spurious restart`, { skip }, async () => {
    const { sup, pidFile } = supervise("run");
    const child = await daemonPid(pidFile);
    const launcher = sup.pid as number;
    if (style === "systemd") await sup.stopSystemd(8000);
    else await sup.stopLaunchd(8000);
    assert.equal(sup.groupKilled, false, "a cooperative stop needs no group SIGKILL");
    assert.equal(sup.history[0]?.code, 0, "a requested stop exits 0");
    await until(() => !alive(child), 3000, "the child to disappear");
    assert.equal(alive(launcher), false);
    const count = sup.startCount;
    await sleep(600);
    assert.equal(sup.startCount, count);
  });
}

test("6: a child that ignores SIGTERM is escalated by the launcher", { skip }, async () => {
  const { sup, pidFile } = supervise("ignoreterm");
  const child = await daemonPid(pidFile);
  await sup.stopLaunchd(8000);
  assert.equal(sup.groupKilled, false, "the launcher escalated, not the supervisor");
  assert.equal(sup.history[0]?.code, 0);
  await until(() => !alive(child), 3000, "the child to disappear");
  assert.equal(sup.startCount, 1);
});
