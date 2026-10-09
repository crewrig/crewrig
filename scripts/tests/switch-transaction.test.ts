// switch-transaction.test.ts — scripts/lib/service/switch-transaction.ts,
// daemon-replace.ts and assistant-config.ts (spec 0252 requirement 18): the
// all-or-nothing order, the rollback restoring each captured registration, the
// replacement-window warning, the rotate purge and the loopback-only bearer probe.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerAssistant } from "../lib/service/assistant-config.ts";
import type { ServiceBackend } from "../lib/service/backend.ts";
import { replaceDaemonProcess } from "../lib/service/daemon-replace.ts";
import type { ProbeRequest } from "../lib/service/probe.ts";
import { runSwitch } from "../lib/service/switch-transaction.ts";
import type { SwitchOptions } from "../lib/service/switch-transaction.ts";
import { serviceNames } from "../lib/service/names.ts";
import { tokenFilePath } from "../lib/service/token.ts";

interface Fx {
  home: string;
  env: NodeJS.ProcessEnv;
  out: string[];
  err: string[];
}

function fixture(): Fx {
  const home = mkdtempSync(path.join(tmpdir(), "svc-switch-"));
  const bin = path.join(home, "bin");
  mkdirSync(bin);
  for (const name of ["claude", "gemini", "copilot", "agy"]) {
    writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(bin, name), 0o755);
  }
  mkdirSync(path.join(home, ".gemini", "config"), { recursive: true });
  mkdirSync(path.join(home, ".copilot"), { recursive: true });
  const old = (url: string) =>
    JSON.stringify({ mcpServers: { mempalace: { command: "old-stdio", args: [url] } } });
  writeFileSync(path.join(home, ".claude.json"), old("claude"));
  writeFileSync(path.join(home, ".gemini", "settings.json"), old("gemini"));
  writeFileSync(path.join(home, ".copilot", "mcp-config.json"), old("copilot"));
  writeFileSync(path.join(home, ".gemini", "config", "mcp_config.json"), old("agy"));
  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
  delete process.env["MEMPALACE_PALACE_PATH"];
  return { home, env: { ...process.env, PATH: bin, HOME: home }, out: [], err: [] };
}

function options(fx: Fx, extra: Partial<SwitchOptions> = {}): SwitchOptions {
  return {
    rotate: false,
    repoDir: path.resolve(import.meta.dirname, "..", ".."),
    env: fx.env,
    home: fx.home,
    platform: process.platform,
    io: { out: (l) => void fx.out.push(l), err: (l) => void fx.err.push(l) },
    removeClaude: () => undefined,
    ...extra,
  };
}

const backend: ServiceBackend = {
  kind: "systemd",
  install: () => ({ ok: true }),
  start: () => ({ ok: true }),
  stop: () => ({ ok: true }),
  status: () => ({ registered: true, running: true }),
  uninstall: () => ({ ok: true }),
  supervisorPid: () => ({ state: "none" }),
};

const entryOf = (file: string): unknown =>
  (JSON.parse(readFileSync(file, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers[
    "mempalace"
  ];

test("all-or-nothing order: install, token, replace, register, status", async () => {
  const fx = fixture();
  try {
    const order: string[] = [];
    const code = await runSwitch(
      options(fx, {
        backend,
        installDaemon: async () => (order.push("install"), { ok: true, lines: [] }),
        replaceProcess: async (t) => (
          order.push(`replace:${existsSync(tokenFilePath())}:${t.length}`),
          true
        ),
        runStatus: () => (order.push("status"), 0),
      }),
    );
    assert.equal(code, 0);
    assert.deepEqual(order, ["install", "replace:true:48", "status"]);
    const token = readFileSync(tokenFilePath(), "utf8");
    for (const f of [".claude.json", ".gemini/settings.json", ".copilot/mcp-config.json"]) {
      const e = entryOf(path.join(fx.home, f)) as {
        type: string;
        headers: { Authorization: string };
      };
      assert.equal(e.type, "http");
      assert.equal(e.headers.Authorization, `Bearer ${token}`);
    }
    const agy = entryOf(path.join(fx.home, ".gemini/config/mcp_config.json")) as Record<
      string,
      unknown
    >;
    assert.ok("serverUrl" in agy && !("type" in agy));
    if (process.platform !== "win32") {
      assert.equal(statSync(path.join(fx.home, ".gemini/settings.json")).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test("a daemon that is not serving switches no assistant", async () => {
  const fx = fixture();
  try {
    const before = readFileSync(path.join(fx.home, ".claude.json"), "utf8");
    const code = await runSwitch(
      options(fx, { backend, installDaemon: async () => ({ ok: false, lines: ["boom"] }) }),
    );
    assert.equal(code, 1);
    assert.equal(readFileSync(path.join(fx.home, ".claude.json"), "utf8"), before);
    assert.ok(fx.out.some((l) => l.includes("no assistant has been switched")));
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test("rollback restores each captured registration, including the one that failed", async () => {
  const fx = fixture();
  try {
    const files = {
      claude: path.join(fx.home, ".claude.json"),
      gemini: path.join(fx.home, ".gemini", "settings.json"),
    };
    const before = { claude: entryOf(files.claude), gemini: entryOf(files.gemini) };
    const code = await runSwitch(
      options(fx, {
        backend,
        installDaemon: async () => ({ ok: true, lines: [] }),
        replaceProcess: async () => true,
        register: (cli, token) => {
          if (cli === "gemini") {
            // a partial write, then the failure: the registration is lost
            writeFileSync(files.gemini, JSON.stringify({ mcpServers: {} }));
            throw new Error("disk full");
          }
          registerAssistant(cli, fx.home, "http://127.0.0.1:41893/mcp", token, () => undefined);
        },
        runStatus: () => 0,
      }),
    );
    assert.equal(code, 1);
    assert.deepEqual(entryOf(files.claude), before.claude);
    assert.deepEqual(entryOf(files.gemini), before.gemini);
    assert.ok(fx.out.some((l) => l.includes("gemini could not be switched")));
    assert.ok(fx.out.includes("    claude: restored"));
    assert.ok(fx.out.includes("    gemini: restored"));
    assert.equal(
      readdirSync(fx.home).filter((n) => n.startsWith(".claude.json.bak.")).length,
      1,
      "a backup was taken before the change",
    );
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test("--rotate removes the old token, purges every .bak.* and registers the new token", async () => {
  const fx = fixture();
  try {
    mkdirSync(path.dirname(tokenFilePath()), { recursive: true });
    writeFileSync(tokenFilePath(), "OLDTOKEN");
    for (const f of [
      ".claude.json.bak.20200101-000000",
      ".gemini/settings.json.bak.20200101-000000",
    ]) {
      writeFileSync(path.join(fx.home, f), "OLDTOKEN");
    }
    const code = await runSwitch(
      options(fx, {
        rotate: true,
        env: { ...fx.env, CREWRIG_TEST_MOCK_DAEMON: "true" },
      }),
    );
    assert.equal(code, 0);
    const fresh = readFileSync(tokenFilePath(), "utf8");
    assert.notEqual(fresh, "OLDTOKEN");
    assert.match(fresh, /^[A-Za-z0-9]{48}$/);
    assert.ok(fx.out.some((l) => l.includes("Removed superseded token file")));
    assert.ok(fx.out.some((l) => l.startsWith("  Purged stale backup file: ")));
    const leftovers = [fx.home, path.join(fx.home, ".gemini")].flatMap((d) =>
      readdirSync(d).filter((n) => n.includes(".bak.")),
    );
    assert.deepEqual(leftovers, []);
    const e = entryOf(path.join(fx.home, ".claude.json")) as { headers: { Authorization: string } };
    assert.equal(e.headers.Authorization, `Bearer ${fresh}`);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test("the final status run decides the exit status", async () => {
  const fx = fixture();
  try {
    const code = await runSwitch(
      options(fx, {
        backend,
        installDaemon: async () => ({ ok: true, lines: [] }),
        replaceProcess: async () => true,
        runStatus: () => 1,
      }),
    );
    assert.equal(code, 1);
    assert.ok(fx.out.some((l) => l.includes("treat the token as burned")));
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

function replaceFixture(accept: (n: number) => boolean) {
  const out: string[] = [];
  const err: string[] = [];
  const probes: ProbeRequest[] = [];
  const calls: string[] = [];
  let t = 0;
  const opts = {
    backend: { ...backend, stop: () => (calls.push("stop"), { ok: true } as const) },
    names: serviceNames("mcp", {}),
    host: "127.0.0.1",
    port: "41893",
    token: "SECRETTOKEN",
    env: {},
    home: "/h",
    io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) },
    probeFn: async (req: ProbeRequest) => (
      probes.push(req),
      accept(probes.length) ? { status: 200, body: "{}" } : { status: 401, body: "" }
    ),
    listener: () => null,
    sleep: async (ms: number) => void (t += ms),
    now: () => t,
  };
  return { opts, out, err, probes, calls };
}

test("replacement: an already-accepting daemon is left alone and no warning is shown", async () => {
  const r = replaceFixture(() => true);
  assert.equal(await replaceDaemonProcess(r.opts), true);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.out, []);
});

test("replacement: the window warning precedes the restart; the probe carries the bearer to loopback only", async () => {
  const r = replaceFixture((n) => n >= 3);
  assert.equal(await replaceDaemonProcess(r.opts), true);
  assert.ok(r.out.some((l) => l.includes("WARNING: replacing the daemon frees 127.0.0.1:41893")));
  assert.deepEqual(r.calls, ["stop"]);
  for (const p of r.probes) {
    assert.equal(p.url, "http://127.0.0.1:41893/mcp");
    assert.equal(p.headers?.["authorization"], "Bearer SECRETTOKEN");
    assert.equal(p.method, "POST");
    assert.match(p.body ?? "", /"method":"tools\/list"/);
  }
});

test("replacement: expiry is reported as a failure", async () => {
  const r = replaceFixture(() => false);
  assert.equal(
    await replaceDaemonProcess({ ...r.opts, env: { MCP_DAEMON_REPLACE_DEADLINE: "1" } }),
    false,
  );
  assert.ok(r.err.some((l) => l.includes("did not accept the current token within 1s")));
});

test("replacement: a squatter is evicted with MEMPALACE_MCP_EVICT_CMD", async () => {
  const r = replaceFixture((n) => n >= 3);
  let listener: number | null = 999;
  const evicted: string[] = [];
  const ok = await replaceDaemonProcess({
    ...r.opts,
    env: { MEMPALACE_MCP_EVICT_CMD: "kill-it" },
    backend: { ...r.opts.backend, supervisorPid: () => ({ state: "pid", pid: 111 }) },
    listener: () => listener,
    evict: (c) => {
      evicted.push(c);
      listener = 111;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(evicted, ["kill-it"]);
  assert.ok(r.err.some((l) => l.includes("squatter PID 999 detected")));
});
